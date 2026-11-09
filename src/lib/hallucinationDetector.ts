/**
 * 幻覺偵測模組 — 純函式，不依賴 Vue/Pinia/Tauri。
 *
 * 二層偵測邏輯（純物理信號）：
 *  Layer 1: 語速異常（錄音 < 1 秒但文字 > 10 字）
 *  Layer 2: 無人聲偵測（靜音 / 低 RMS + 高 NSP 聯合判斷）
 */

import { convertSimplifiedToTraditional } from "./simplifiedToTraditional";

// ── 常數 ──

/** Layer 1 錄音時長門檻（ms） */
export const SPEED_ANOMALY_MAX_DURATION_MS = 1000;
/** Layer 1 文字長度門檻 */
export const SPEED_ANOMALY_MIN_CHARS = 10;
/** Layer 2a 靜音峰值能量門檻（0.0 = 完全靜音, 1.0 = 最大音量） */
export const SILENCE_PEAK_ENERGY_THRESHOLD = 0.01;
/** Layer 2b 低 RMS 門檻 — 搭配高 NSP 聯合判斷（人聲 RMS ≥ 0.03，背景噪音 RMS ≈ 0.005~0.02） */
export const SILENCE_RMS_THRESHOLD = 0.015;
/** Layer 2b NSP 門檻（Whisper 認為「可能無語音」的信心度） */
export const SILENCE_NSP_THRESHOLD = 0.7;
/** Layer 2b peak energy 天花板 — peak >= 此值表示有明確可聽聲音，跳過 RMS+NSP 聯合判斷
 *  （避免小聲說話因 RMS 被靜音段稀釋而誤判為幻覺） */
export const LAYER2B_PEAK_ENERGY_CEILING = 0.03;

// ── 型別 ──

export interface HallucinationDetectionParams {
  rawText: string;
  recordingDurationMs: number;
  peakEnergyLevel: number;
  rmsEnergyLevel: number;
  noSpeechProbability: number;
}

export interface HallucinationDetectionResult {
  isHallucination: boolean;
  reason: "speed-anomaly" | "no-speech-detected" | null;
  detectedText: string;
}

// ── 核心函式 ──

/**
 * 二層幻覺偵測邏輯（純物理信號）。
 *
 * Layer 1: 語速異常 — 錄音不到 1 秒但 Whisper 回傳超過 10 字，物理上不可能。
 * Layer 2: 無人聲 — 靜音（peak < 0.02）、或 peak 偏低時（< 0.03）的低 RMS + 高 NSP 聯合判斷。
 *          若 peak >= 0.03 表示有明確可聽聲音，跳過 RMS+NSP 檢查避免小聲說話誤判。
 */
// ── 增強後偵測 ──

/** 增強後文字長度爆炸倍率門檻 — 校對只加標點空白，正常增幅 < 1.3 倍，2 倍已很寬鬆 */
export const ENHANCEMENT_LENGTH_EXPLOSION_RATIO = 2;

export interface EnhancementAnomalyParams {
  rawText: string;
  enhancedText: string;
}

export interface EnhancementAnomalyResult {
  isAnomaly: boolean;
  reason: "length-explosion" | null;
}

/**
 * 增強後語意偏移偵測 — 檢查 LLM 增強是否產生異常結果。
 *
 * 目前只做一層「長度爆炸」偵測：校對工具只改錯字和加標點，
 * 產出不應達到輸入的 2 倍。若達到，代表 LLM 在回答問題或產生幻覺。
 */
export function detectEnhancementAnomaly(
  params: EnhancementAnomalyParams,
): EnhancementAnomalyResult {
  const rawLength = params.rawText.trim().length;
  const enhancedLength = params.enhancedText.trim().length;

  // 避免除以零：rawText 為空時不判定異常
  if (rawLength === 0) {
    return { isAnomaly: false, reason: null };
  }

  if (enhancedLength >= rawLength * ENHANCEMENT_LENGTH_EXPLOSION_RATIO) {
    return { isAnomaly: true, reason: "length-explosion" };
  }

  return { isAnomaly: false, reason: null };
}

// ── 增強後語意 grounding 偵測（#43）──

/** 語意守衛：正規化後 rawText 至少要這麼長才判定（過短不可靠、交給 prompt） */
export const SEMANTIC_DRIFT_MIN_RAW_CHARS = 6;
/** 語意守衛門檻：enhanced 的 bigram 落在 raw 內的比例低於此值 → 判定「內容飄走」。
 *  刻意設低（保守）：只擋「明顯不相干」，避免把合法的條列化/大幅改寫誤判成 drift。 */
export const SEMANTIC_DRIFT_MIN_OVERLAP = 0.2;

/** 原文字元保留率門檻（#30）：原文（去除贅詞與自我更正片段後）的字元出現在輸出中的比例低於此值 → 飄移 */
export const SEMANTIC_DRIFT_MIN_CHAR_RETENTION = 0.75;

/** 飄移原因（#30）；同一筆可同時命中多個 */
export type SemanticDriftReason =
  | "low-bigram-overlap"
  | "low-char-retention"
  | "person-changed"
  | "negation-dropped"
  | "response-opener";

export interface SemanticDriftResult {
  isDrift: boolean;
  /** enhanced 的 bigram 有多少比例 grounded 在 raw（containment，0~1） */
  overlapRatio: number;
  /** 原文（去除贅詞與自我更正片段後）的字元出現在輸出中的比例（0~1） */
  charRetention: number;
  /** 命中的判準；空陣列代表沒有飄移 */
  reasons: SemanticDriftReason[];
}

/**
 * 正規化：小寫化、去除空白與標點，只留字母/數字/CJK 等文字字元。
 * #83：兩側都先簡轉繁，避免「同內容、只差繁簡字形」被當成飄移
 * （例：簡體舊紀錄重新整理成繁體、模型沒照提示詞輸出繁體）。
 */
function normalizeForOverlap(text: string): string {
  return convertSimplifiedToTraditional(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function toBigramSet(text: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

// ── #30 新判準用的詞表 ──

/** 計算字元保留率前從原文移除的贅詞：模型照提示詞刪掉它們是正常行為 */
const DRIFT_FILLER_WORDS = ["基本上", "那個", "就是", "然後", "其實", "嗯", "呃", "欸"];
/** 自我更正訊號：訊號詞與被它取代的前一個說法，在比對前從原文移除 */
const SELF_CORRECTION_SIGNALS = [
  "更正一下",
  "講錯了",
  "說錯了",
  "我是說",
  "不對",
];
/** 人稱組（#30）：第一人稱、第二人稱；第三人稱不列入 */
const PERSON_GROUPS: { id: string; chars: string[] }[] = [
  { id: "first", chars: ["我"] },
  { id: "second", chars: ["你", "妳", "您"] },
];
/** 否定詞字元（#30） */
const NEGATION_CHAR_PATTERN = /[不沒別無未]/;
/** 回應語開頭（比對前已正規化：去除空白標點、轉小寫、簡轉繁） */
const RESPONSE_OPENERS = [
  "好的",
  "好喔",
  "沒問題",
  "當然",
  "以下是",
  "以下為",
  "抱歉",
  "很抱歉",
  "對不起",
  "不好意思",
  "我理解",
  "我明白",
  "了解",
  "收到",
  "謝謝",
];

/**
 * 移除原文中的自我更正片段：子句以訊號詞開頭時，連同前一個子句一起移除；
 * 訊號詞在子句中間時，移除該子句中訊號詞（含）之前的部分。
 * 只用來放寬判準（避免把合法的自我更正誤判成飄移），不會讓判定更嚴格。
 */
function stripSelfCorrections(rawText: string): string {
  const clauseList = convertSimplifiedToTraditional(rawText)
    .split(/[\s\p{P}]+/u)
    .filter(Boolean);
  const kept: string[] = [];
  // 訊號詞自成一個子句時（「三點 不對 是五點」），更正句型的「是」落在下一個子句
  let afterSignal = false;
  for (const clause of clauseList) {
    let rest = clause;
    let signalIndex = -1;
    let signalLength = 0;
    for (const signal of SELF_CORRECTION_SIGNALS) {
      const index = rest.lastIndexOf(signal);
      if (index > signalIndex) {
        signalIndex = index;
        signalLength = signal.length;
      }
    }
    if (signalIndex === 0) {
      kept.pop();
      rest = rest.slice(signalLength);
    } else if (signalIndex > 0) {
      rest = rest.slice(signalIndex + signalLength);
    }
    // 「不對，是五點」的「是」屬於更正句型本身，整理後通常不會留下
    if ((signalIndex >= 0 || afterSignal) && rest.startsWith("是")) {
      rest = rest.slice(1);
    }
    afterSignal = signalIndex >= 0 && rest === "";
    if (rest) kept.push(rest);
  }
  return kept.join(" ");
}

function presentPersonGroups(normalizedText: string): Set<string> {
  return new Set(
    PERSON_GROUPS.filter((group) =>
      group.chars.some((c) => normalizedText.includes(c)),
    ).map((group) => group.id),
  );
}

/** 原文（已去除贅詞）的字元有多少比例出現在輸出中（0~1） */
function charRetention(rawCore: string, enhanced: string): number {
  let core = rawCore;
  for (const filler of DRIFT_FILLER_WORDS) core = core.split(filler).join("");
  if (core.length === 0) return 1;
  const enhancedChars = new Set(enhanced);
  let retained = 0;
  for (const c of core) {
    if (enhancedChars.has(c)) retained += 1;
  }
  return retained / [...core].length;
}

/**
 * 增強後語意偏移偵測（#43 核心守衛，#30 擴充）。任一判準成立即判定飄移：
 *
 * 1. bigram containment（#43）：enhanced 的 bigram 落在 raw 內的比例過低 → 整段答非所問。
 * 2. 原文字元保留率（#30）：原文去除贅詞與自我更正片段後，字元出現在輸出中的比例過低 → 內容被換掉或漏掉。
 * 3. 人稱變動（#30）：原文的第一／第二人稱組在輸出整組消失，或輸出多出原文沒有的人稱組 → 我你對調。
 * 4. 否定詞由有變無（#30）：原文有否定詞、輸出完全沒有；數量變化本身不算（自我更正、「不是不是」會改變數量）。
 * 5. 回應語開頭（#30）：輸出以「好的」「抱歉」這類回應語開頭，原文卻沒有這個詞。
 *
 * 判準 2～4 的「原文」先移除自我更正片段（不對、我是說、講錯了…），避免合法更正被誤判；
 * 「多出人稱組」與回應語則比對完整原文。這是「長度爆炸」偵測之外的獨立守衛；短輸入直接豁免。
 */
export function detectSemanticDrift(
  rawText: string,
  enhancedText: string,
): SemanticDriftResult {
  const raw = normalizeForOverlap(rawText);
  const enhanced = normalizeForOverlap(enhancedText);

  // 極短原文不可靠、或 enhanced 為空 → 不在此判定 drift（交給 prompt / 既有守衛）
  if (raw.length < SEMANTIC_DRIFT_MIN_RAW_CHARS || enhanced.length === 0) {
    return { isDrift: false, overlapRatio: 1, charRetention: 1, reasons: [] };
  }

  const rawBigrams = toBigramSet(raw);
  const enhancedBigrams = toBigramSet(enhanced);
  // 單字元（無 bigram 可比）保護
  if (rawBigrams.size === 0 || enhancedBigrams.size === 0) {
    return { isDrift: false, overlapRatio: 1, charRetention: 1, reasons: [] };
  }

  let grounded = 0;
  for (const bigram of enhancedBigrams) {
    if (rawBigrams.has(bigram)) grounded += 1;
  }
  const overlapRatio = grounded / enhancedBigrams.size;

  const reasons: SemanticDriftReason[] = [];
  if (overlapRatio < SEMANTIC_DRIFT_MIN_OVERLAP) {
    reasons.push("low-bigram-overlap");
  }

  const rawCore = normalizeForOverlap(stripSelfCorrections(rawText));
  const retention = charRetention(rawCore, enhanced);
  if (retention < SEMANTIC_DRIFT_MIN_CHAR_RETENTION) {
    reasons.push("low-char-retention");
  }

  const corePersons = presentPersonGroups(rawCore);
  const rawPersons = presentPersonGroups(raw);
  const enhancedPersons = presentPersonGroups(enhanced);
  const personDropped = [...corePersons].some((id) => !enhancedPersons.has(id));
  const personAdded = [...enhancedPersons].some((id) => !rawPersons.has(id));
  if (personDropped || personAdded) {
    reasons.push("person-changed");
  }

  if (
    NEGATION_CHAR_PATTERN.test(rawCore) &&
    !NEGATION_CHAR_PATTERN.test(enhanced)
  ) {
    reasons.push("negation-dropped");
  }

  if (
    RESPONSE_OPENERS.some(
      (opener) => enhanced.startsWith(opener) && !raw.includes(opener),
    )
  ) {
    reasons.push("response-opener");
  }

  return {
    isDrift: reasons.length > 0,
    overlapRatio,
    charRetention: retention,
    reasons,
  };
}
// ── 轉錄幻覺偵測 ──

export function detectHallucination(
  params: HallucinationDetectionParams,
): HallucinationDetectionResult {
  const {
    rawText,
    recordingDurationMs,
    peakEnergyLevel,
    rmsEnergyLevel,
    noSpeechProbability,
  } = params;
  const trimmedText = rawText.trim();
  const charCount = trimmedText.length;

  // Layer 1: 語速異常（物理定律級判斷）
  if (
    recordingDurationMs < SPEED_ANOMALY_MAX_DURATION_MS &&
    charCount > SPEED_ANOMALY_MIN_CHARS
  ) {
    return {
      isHallucination: true,
      reason: "speed-anomaly",
      detectedText: trimmedText,
    };
  }

  // Layer 2: 無人聲偵測
  // 2a: 完全靜音 — 麥克風確認無任何聲音（peak < 0.02）
  // 2b: peak 偏低（< 0.03）+ 低 RMS + 高 NSP 聯合判斷
  //     若 peak >= 0.03 表示有明確可聽聲音，跳過此檢查（escape hatch）
  if (
    peakEnergyLevel < SILENCE_PEAK_ENERGY_THRESHOLD ||
    (peakEnergyLevel < LAYER2B_PEAK_ENERGY_CEILING &&
      rmsEnergyLevel < SILENCE_RMS_THRESHOLD &&
      noSpeechProbability > SILENCE_NSP_THRESHOLD)
  ) {
    return {
      isHallucination: true,
      reason: "no-speech-detected",
      detectedText: trimmedText,
    };
  }

  // 放行
  return {
    isHallucination: false,
    reason: null,
    detectedText: trimmedText,
  };
}
