import { fetch } from "@tauri-apps/plugin-http";
import type { ChatUsageData, EnhanceResult } from "../types/transcription";
import { DEFAULT_LLM_MODEL_ID } from "./modelRegistry";
import {
  buildFetchParams,
  parseProviderResponse,
  getProviderIdForModel,
  getProviderTimeout,
  getDefaultMaxTokens,
  type LlmChatRequest,
  type LlmEffort,
} from "./llmProvider";
import {
  getMinimalPromptForLocale,
  getTranscriptStructureNote,
} from "../i18n/prompts";
import type { SupportedLocale } from "../i18n/languageConfig";
import i18n from "../i18n";
import {
  detectEnhancementAnomaly,
  detectSemanticDrift,
} from "./hallucinationDetector";
import { applyTranscriptTextTransforms } from "./transcriptTextTransforms";

const MAX_VOCABULARY_TERMS = 50;
const DEFAULT_ENHANCEMENT_RETRY_COUNT = 3;

export class EnhancerApiError extends Error {
  constructor(
    public statusCode: number,
    statusText: string,
    public body: string,
  ) {
    super(`Enhancement API error: ${statusCode} ${statusText}`);
    this.name = "EnhancerApiError";
  }
}

export function getDefaultSystemPrompt(): string {
  return getMinimalPromptForLocale(i18n.global.locale.value as SupportedLocale);
}

export interface EnhanceOptions {
  systemPrompt?: string;
  vocabularyTermList?: string[];
  modelId?: string;
  signal?: AbortSignal;
  maxTokens?: number;
  /**
   * 有效辨識語言（auto 已解析為介面語言）。有值時整理結果套用與原文相同的轉換
   * （zh-TW／yue → 簡轉繁，#83）。編輯模式、連線測試不傳。
   */
  transcriptLocale?: string;
  /**
   * 文字整理專用（#27）：user 訊息包成 `<transcript>`、system prompt 末尾附加各語系固定的結構說明，
   * 輸出剝除模型抄回的 `<transcript>` 標籤。預設不包；選取文字語音改寫與連線測試不傳。
   */
  wrapTranscript?: boolean;
  /** Anthropic `output_config.effort`；目前只對 Claude Haiku 5.5 生效，不傳等同 medium（#31 第 7 條） */
  effort?: LlmEffort;
}

/**
 * 文字整理（wrapTranscript）預設送出的 effort（#31 第 7 條）。Haiku 5.5 實測（32 案 × 5 次）：
 * high 全過 32/32、medium 30/32（口述指令類未全過），中位延遲差距 +0.6%，符合「通過率不降、延遲增幅 ≤ 30%」。
 * 只對 Claude Haiku 5.5 生效；呼叫端明確傳入 effort 時以呼叫端為準。
 */
export const TEXT_CLEANUP_EFFORT: LlmEffort | undefined = "high";

/** 文字整理送出的 user 訊息：逐字稿包進 `<transcript>`（#27） */
export function wrapTranscriptMessage(rawText: string): string {
  return `<transcript>\n${rawText}\n</transcript>`;
}

/** 剝除模型抄回來的 `<transcript>` 標籤（只去標籤、保留內容；不分大小寫） */
export function stripTranscriptTags(text: string): string {
  return text.replace(/<\/?transcript>/gi, "").trim();
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const raceList: Promise<T>[] = [promise];

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error("Enhancement timeout");
      (err as Error & { code: string }).code = "ENHANCEMENT_TIMEOUT";
      reject(err);
    }, ms);
  });
  raceList.push(timeoutPromise as Promise<T>);

  let abortHandler: (() => void) | undefined;
  if (signal) {
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      abortHandler = () =>
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abortHandler, { once: true });
    });
    raceList.push(abortPromise as Promise<T>);
  }

  try {
    return await Promise.race(raceList);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (abortHandler && signal)
      signal.removeEventListener("abort", abortHandler);
  }
}

export function buildSystemPrompt(
  basePrompt: string,
  vocabularyTermList?: string[],
): string {
  let prompt = basePrompt;

  if (vocabularyTermList && vocabularyTermList.length > 0) {
    const truncatedTermList = vocabularyTermList.slice(0, MAX_VOCABULARY_TERMS);
    prompt += `\n\n<vocabulary>\n${truncatedTermList.join(", ")}\n</vocabulary>`;
  }

  return prompt;
}

/**
 * 移除 reasoning model（如 Qwen3）回應中的 <think>...</think> 區塊，
 * 只保留最終輸出內容。
 */
export function stripReasoningTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function enhanceText(
  rawText: string,
  apiKey: string,
  options?: EnhanceOptions,
): Promise<EnhanceResult> {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("API Key not configured");
  }

  const modelId = options?.modelId ?? DEFAULT_LLM_MODEL_ID;
  const providerId = getProviderIdForModel(modelId);

  const basePrompt = options?.systemPrompt || getDefaultSystemPrompt();
  const wrapTranscript = options?.wrapTranscript === true;
  let fullPrompt = buildSystemPrompt(basePrompt, options?.vocabularyTermList);
  if (wrapTranscript) {
    // 結構說明放在最末尾（比照 <vocabulary>）；內建與自訂 prompt 都套用（#27）
    const noteLocale =
      options?.transcriptLocale ?? (i18n.global.locale.value as string);
    fullPrompt += `\n\n${getTranscriptStructureNote(noteLocale)}`;
  }

  const request: LlmChatRequest = {
    model: modelId,
    messages: [
      { role: "system", content: fullPrompt },
      {
        role: "user",
        content: wrapTranscript ? wrapTranscriptMessage(rawText) : rawText,
      },
    ],
    temperature: 0.1,
    maxTokens: options?.maxTokens ?? getDefaultMaxTokens(providerId),
    effort:
      options?.effort ?? (wrapTranscript ? TEXT_CLEANUP_EFFORT : undefined),
  };

  const { url, init } = buildFetchParams(providerId, request, apiKey);

  const response = await withTimeout(
    fetch(url, {
      ...init,
      signal: options?.signal,
    }),
    getProviderTimeout(providerId),
    options?.signal,
  );

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    throw new EnhancerApiError(response.status, response.statusText, errorBody);
  }

  const json = await response.json();
  const result = parseProviderResponse(providerId, json);

  const usage: ChatUsageData | null = result.usage
    ? {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        promptTimeMs: result.usage.promptTimeMs,
        completionTimeMs: result.usage.completionTimeMs,
        totalTimeMs: result.usage.totalTimeMs,
      }
    : null;

  if (!result.text) {
    return { text: rawText, usage, isRawFallback: true };
  }

  const withoutReasoning = stripReasoningTags(result.text);
  const enhancedContent = wrapTranscript
    ? stripTranscriptTags(withoutReasoning)
    : withoutReasoning;
  if (!enhancedContent) {
    return { text: rawText, usage, isRawFallback: true };
  }
  return {
    text: options?.transcriptLocale
      ? applyTranscriptTextTransforms(enhancedContent, options.transcriptLocale)
      : enhancedContent,
    usage,
  };
}

export interface EnhanceWithGuardResult {
  text: string;
  usage: ChatUsageData | null;
  /** true 表示重試後仍偵測到長度爆炸異常，text 已 fallback 回 rawText。 */
  wasAnomalous: boolean;
  /** true 表示整理結果語意飄移（#43 bigram、#30 字元保留率／人稱／否定詞／回應語）；呼叫端應拒絕並保留既有結果、勿寫入 DB。 */
  wasDrift: boolean;
  /** true 表示 LLM 回了空內容、text 只是退回的原文；呼叫端應保留既有結果、勿寫入 DB。 */
  wasEmptyResponse: boolean;
  /** enhanced→raw 的 bigram containment 比例（0~1），供守衛決策與遙測透明化使用。 */
  driftOverlapRatio: number;
}

/**
 * enhanceText 外加兩道獨立守衛：
 * 1.「增強後長度爆炸」：偵測到異常時最多重試 maxRetries 次，仍異常則 fallback 回 rawText、標記 wasAnomalous=true。
 * 2.「語意飄移」（#43）：最終結果與原文 bigram 重疊過低時標記 wasDrift=true，呼叫端據此「拒絕並保留既有結果」。
 * 目前由歷史紀錄重新整理使用；邏輯與 useVoiceFlowStore 即時流程的 inline 迴圈一致，未來可收斂共用。
 */
export async function enhanceWithAnomalyGuard(
  rawText: string,
  apiKey: string,
  options?: EnhanceOptions,
  maxRetries = DEFAULT_ENHANCEMENT_RETRY_COUNT,
): Promise<EnhanceWithGuardResult> {
  let enhanceResult = await enhanceText(rawText, apiKey, options);

  let retryCount = 0;
  while (
    retryCount < maxRetries &&
    detectEnhancementAnomaly({ rawText, enhancedText: enhanceResult.text })
      .isAnomaly
  ) {
    retryCount++;
    enhanceResult = await enhanceText(rawText, apiKey, options);
  }

  // 空回應退回原文：enhanceText 已 fallback 成 rawText，對長度爆炸／飄移都「看起來正常」，
  // 這裡要先攔下，否則呼叫端會把原文當整理結果覆寫既有內容
  if (enhanceResult.isRawFallback) {
    return {
      text: rawText,
      usage: enhanceResult.usage,
      wasAnomalous: false,
      wasDrift: false,
      wasEmptyResponse: true,
      driftOverlapRatio: 1,
    };
  }

  const finalAnomaly = detectEnhancementAnomaly({
    rawText,
    enhancedText: enhanceResult.text,
  });

  if (finalAnomaly.isAnomaly) {
    return {
      text: rawText,
      usage: enhanceResult.usage,
      wasAnomalous: true,
      wasDrift: false,
      wasEmptyResponse: false,
      driftOverlapRatio: 1,
    };
  }

  // #43 語意飄移守衛：整理結果與原文 bigram 重疊過低 → 疑似答非所問，
  // 標記 wasDrift 交由呼叫端「拒絕並保留既有結果」（不覆寫 DB）。
  const drift = detectSemanticDrift(rawText, enhanceResult.text);
  if (drift.isDrift) {
    return {
      text: enhanceResult.text,
      usage: enhanceResult.usage,
      wasAnomalous: false,
      wasDrift: true,
      wasEmptyResponse: false,
      driftOverlapRatio: drift.overlapRatio,
    };
  }

  return {
    text: enhanceResult.text,
    usage: enhanceResult.usage,
    wasAnomalous: false,
    wasDrift: false,
    wasEmptyResponse: false,
    driftOverlapRatio: drift.overlapRatio,
  };
}
