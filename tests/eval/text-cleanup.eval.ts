/**
 * 文字整理實打評測（#33 建立，#35 改成定案結構）。
 *
 * 用 `pnpm eval:cleanup` 手動執行，不進 CI。流程：
 *   語料集每案 × 每個提示詞版本 × 每個 effort × N 次 → 呼叫真正的 `enhanceText`（打 Claude Haiku 5.5，
 *   依版本開啟 `wrapTranscript`）→ 套用斷言式判定（`tests/support/text-cleanup-judge.ts`）
 *   → N 次全過才算該案通過 → 報告寫到 `tests/eval/results/`（已加入 .gitignore，不進 repo）
 *
 * 報告另外記錄：每次呼叫的延遲（中位數／P90，#31 第 7 條）、模型有沒有抄回 `<transcript>` 標籤（#27）、
 * 語意飄移守衛對失敗輸出的攔截數與對通過輸出的誤擋數（#30 硬性條件：誤擋必須是 0）。
 *
 * 環境變數：
 *   ANTHROPIC_API_KEY  必填，且只從這裡讀（不讀 App 設定、不寫進檔案）；沒設定就整份略過
 *   EVAL_RUNS          每案每版本跑幾次，預設 5
 *   EVAL_VARIANTS      只跑指定提示詞版本（逗號分隔 id），預設全部
 *   EVAL_EFFORTS       要比較的 effort（逗號分隔，low／medium／high），預設只跑 App 的文字整理預設值
 *   EVAL_CASES         只跑指定案例 id 或類別（逗號分隔），預設全部
 *   EVAL_CONCURRENCY   同時進行的請求數，預設 4
 *   EVAL_MODEL         模型 id，預設 claude-haiku-5-5
 *   EVAL_STRICT        設為 1 時，只要有案例沒全過就讓測試失敗（預設只出報告）
 */

import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";

/** 每次呼叫的觀測值：模型原始回應有沒有抄回 <transcript>（enhanceText 會剝掉，只能在這裡看） */
interface CallObservation {
  echoedTranscriptTag: boolean;
}
const callContext = new AsyncLocalStorage<CallObservation>();

// Tauri 的 HTTP plugin 在 Node 底下不存在，改接到 Node 內建 fetch，其餘 enhancer 流程維持真實
// （呼叫時才取 globalThis.fetch，行為與直接指定相同，但離線驗證流程時可用替身取代）
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: async (...args: Parameters<typeof fetch>) => {
    const response = await globalThis.fetch(...args);
    const observation = callContext.getStore();
    if (observation && response.ok) {
      const body = await response.clone().text();
      if (body.includes("<transcript")) observation.echoedTranscriptTag = true;
    }
    return response;
  },
}));

import {
  enhanceText,
  EnhancerApiError,
  TEXT_CLEANUP_EFFORT,
} from "../../src/lib/enhancer";
import type { LlmEffort } from "../../src/lib/llmProvider";
import {
  detectEnhancementAnomaly,
  detectSemanticDrift,
} from "../../src/lib/hallucinationDetector";
import {
  TEXT_CLEANUP_CASES,
  TEXT_CLEANUP_CATEGORY_LABELS,
  type TextCleanupCase,
  type TextCleanupCategory,
} from "../support/fixtures/text-cleanup-cases";
import { judgeCleanupOutput } from "../support/text-cleanup-judge";
import { PROMPT_VARIANTS, type PromptVariant } from "./prompt-variants";

const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const RUNS = positiveInt(process.env.EVAL_RUNS, 5);
const CONCURRENCY = positiveInt(process.env.EVAL_CONCURRENCY, 4);
const MODEL_ID = process.env.EVAL_MODEL || "claude-haiku-5-5";
const STRICT = process.env.EVAL_STRICT === "1";
const MAX_ATTEMPTS = 4;
const EFFORTS = selectEfforts();
const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** undefined 代表沿用 App 的文字整理預設（TEXT_CLEANUP_EFFORT） */
function selectEfforts(): (LlmEffort | undefined)[] {
  const wanted = csv(process.env.EVAL_EFFORTS);
  if (wanted.length === 0) return [undefined];
  for (const effort of wanted) {
    if (!["low", "medium", "high"].includes(effort)) {
      throw new Error(`EVAL_EFFORTS 只接受 low／medium／high：${effort}`);
    }
  }
  return wanted as LlmEffort[];
}

function effortLabel(effort: LlmEffort | undefined): string {
  return effort ?? `預設（${TEXT_CLEANUP_EFFORT ?? "不送＝medium"}）`;
}

/** 報告中的一個欄位：提示詞版本 × effort */
interface EvalConfig {
  key: string;
  variant: PromptVariant;
  effort: LlmEffort | undefined;
}

function selectVariants(): PromptVariant[] {
  const wanted = csv(process.env.EVAL_VARIANTS);
  if (wanted.length === 0) return PROMPT_VARIANTS;
  const selected = PROMPT_VARIANTS.filter((v) => wanted.includes(v.id));
  if (selected.length === 0) {
    throw new Error(
      `EVAL_VARIANTS 沒有符合的版本：${wanted.join(", ")}（可用：${PROMPT_VARIANTS.map((v) => v.id).join(", ")}）`,
    );
  }
  return selected;
}

function selectCases(): TextCleanupCase[] {
  const wanted = csv(process.env.EVAL_CASES);
  if (wanted.length === 0) return TEXT_CLEANUP_CASES;
  const selected = TEXT_CLEANUP_CASES.filter(
    (c) => wanted.includes(c.id) || wanted.includes(c.category),
  );
  if (selected.length === 0) {
    throw new Error(`EVAL_CASES 沒有符合的案例：${wanted.join(", ")}`);
  }
  return selected;
}

interface RunResult {
  output: string;
  /** 模型原始回應抄回了 <transcript> 標籤（enhanceText 已剝除） */
  echoedTranscriptTag: boolean;
  /** 成功那次呼叫的延遲（毫秒）；API 錯誤時為 null */
  latencyMs: number | null;
  /** 模型回了空內容，enhanceText 退回原文 */
  emptyResponse: boolean;
  /** 重試用盡仍失敗的 API 錯誤訊息 */
  error: string | null;
  passed: boolean;
  failures: string[];
  /** 守衛（語意飄移或長度爆炸）會不會擋下這個輸出 */
  guardCaught: boolean;
  guardReasons: string[];
  overlapRatio: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof EnhancerApiError) {
    return error.statusCode === 429 || error.statusCode >= 500;
  }
  // 逾時與網路錯誤
  return true;
}

async function runOnce(
  config: EvalConfig,
  testCase: TextCleanupCase,
): Promise<RunResult> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const observation: CallObservation = { echoedTranscriptTag: false };
    try {
      const startedAt = performance.now();
      const result = await callContext.run(observation, () =>
        enhanceText(testCase.input, API_KEY, {
          systemPrompt: config.variant.systemPrompt,
          modelId: MODEL_ID,
          transcriptLocale: "zh-TW",
          wrapTranscript: config.variant.wrapTranscript,
          effort: config.effort,
        }),
      );
      const latencyMs = performance.now() - startedAt;
      const emptyResponse = result.isRawFallback === true;
      const judged = judgeCleanupOutput(testCase, result.text);
      const drift = detectSemanticDrift(testCase.input, result.text);
      const anomaly = detectEnhancementAnomaly({
        rawText: testCase.input,
        enhancedText: result.text,
      });
      const failures = [...judged.failures];
      if (emptyResponse) failures.push("模型回了空內容");
      return {
        output: result.text,
        echoedTranscriptTag: observation.echoedTranscriptTag,
        latencyMs,
        emptyResponse,
        error: null,
        passed: failures.length === 0,
        failures,
        guardCaught: drift.isDrift || anomaly.isAnomaly,
        guardReasons: [
          ...drift.reasons,
          ...(anomaly.isAnomaly ? ["length-explosion"] : []),
        ],
        overlapRatio: drift.overlapRatio,
      };
    } catch (error) {
      lastError =
        error instanceof EnhancerApiError
          ? `${error.message} ${error.body.slice(0, 200)}`
          : String(error);
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
      await sleep(1500 * attempt * attempt);
    }
  }
  return {
    output: "",
    echoedTranscriptTag: false,
    latencyMs: null,
    emptyResponse: false,
    error: lastError,
    passed: false,
    failures: [`API 錯誤：${lastError}`],
    guardCaught: false,
    guardReasons: [],
    overlapRatio: 1,
  };
}

/** 簡單的併發池：同時最多 CONCURRENCY 個工作 */
async function runPool<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onProgress: (done: number, total: number) => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
      done += 1;
      onProgress(done, tasks.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

interface CellResult {
  configKey: string;
  caseId: string;
  runs: RunResult[];
}

function passCount(cell: CellResult): number {
  return cell.runs.filter((r) => r.passed).length;
}

function cellPassed(cell: CellResult): boolean {
  return passCount(cell) === cell.runs.length;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, "⏎");
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function formatMs(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}`;
}

function buildReport(
  configs: EvalConfig[],
  cases: TextCleanupCase[],
  cells: CellResult[],
  startedAt: Date,
): string {
  const cellOf = (configKey: string, caseId: string) =>
    cells.find((c) => c.configKey === configKey && c.caseId === caseId)!;
  const lines: string[] = [];

  lines.push("# 文字整理實打評測報告", "");
  lines.push(`- 時間：${startedAt.toISOString()}`);
  lines.push(`- 模型：${MODEL_ID}`);
  lines.push(`- 每案每設定跑 ${RUNS} 次；${RUNS} 次全過才算該案通過`);
  lines.push(`- 案例數：${cases.length}`);
  lines.push("");

  lines.push("## 總覽", "");
  lines.push(
    "| 設定（版本 @ effort） | 全過案例 | 通過次數 | 中位延遲 ms | P90 延遲 ms | 失敗中守衛擋下 | 通過卻被守衛誤擋 | 抄回 <transcript> | API 錯誤 |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const config of configs) {
    const own = cells.filter((c) => c.configKey === config.key);
    const runs = own.flatMap((c) => c.runs);
    const failedRuns = runs.filter((r) => !r.passed);
    const passedRuns = runs.filter((r) => r.passed);
    const latencies = runs
      .map((r) => r.latencyMs)
      .filter((v): v is number => v !== null);
    lines.push(
      `| ${config.variant.label}（${config.key}） | ${own.filter(cellPassed).length}/${own.length} | ${passedRuns.length}/${runs.length} | ${formatMs(percentile(latencies, 50))} | ${formatMs(percentile(latencies, 90))} | ${failedRuns.filter((r) => r.guardCaught).length}/${failedRuns.length} | ${passedRuns.filter((r) => r.guardCaught).length} | ${runs.filter((r) => r.echoedTranscriptTag).length} | ${runs.filter((r) => r.error).length} |`,
    );
  }
  lines.push("");

  lines.push("## 依類別（通過次數 / 總次數）", "");
  lines.push(
    `| 類別 | ${configs.map((c) => c.key).join(" | ")} |`,
    `|---|${configs.map(() => "---").join("|")}|`,
  );
  const categories = [...new Set(cases.map((c) => c.category))];
  for (const category of categories as TextCleanupCategory[]) {
    const ids = cases.filter((c) => c.category === category).map((c) => c.id);
    const cols = configs.map((config) => {
      const runs = ids.flatMap((id) => cellOf(config.key, id).runs);
      return `${runs.filter((r) => r.passed).length}/${runs.length}`;
    });
    lines.push(
      `| ${TEXT_CLEANUP_CATEGORY_LABELS[category]} | ${cols.join(" | ")} |`,
    );
  }
  lines.push("");

  lines.push("## 逐案並排（通過次數 / N）", "");
  lines.push(
    `| 案例 | 類別 | ${configs.map((c) => c.key).join(" | ")} |`,
    `|---|---|${configs.map(() => "---").join("|")}|`,
  );
  for (const c of cases) {
    const cols = configs.map((config) => {
      const cell = cellOf(config.key, c.id);
      return `${cellPassed(cell) ? "✅" : "❌"} ${passCount(cell)}/${cell.runs.length}`;
    });
    lines.push(
      `| ${c.id} | ${TEXT_CLEANUP_CATEGORY_LABELS[c.category]} | ${cols.join(" | ")} |`,
    );
  }
  lines.push("");

  lines.push("## 失敗明細（含模型實際輸出，只留在本機）", "");
  let anyFailure = false;
  for (const c of cases) {
    for (const config of configs) {
      const failedRuns = cellOf(config.key, c.id).runs.filter((r) => !r.passed);
      if (failedRuns.length === 0) continue;
      anyFailure = true;
      lines.push(
        `### ${c.id} × ${config.key}（失敗 ${failedRuns.length}/${RUNS}）`,
        "",
        `- 輸入：${escapeCell(c.input)}`,
      );
      // 相同輸出只列一次，避免洗版
      const seen = new Set<string>();
      for (const run of failedRuns) {
        if (seen.has(run.output)) continue;
        seen.add(run.output);
        const times = failedRuns.filter((r) => r.output === run.output).length;
        lines.push(
          `- 實際輸出（${times} 次）：${escapeCell(run.output) || "（無）"}`,
          `  - 違反：${run.failures.join("；")}`,
          `  - 守衛：${run.guardCaught ? `會擋下（${run.guardReasons.join("、")}）` : "放行"}（bigram 重疊 ${run.overlapRatio.toFixed(2)}）`,
        );
      }
      lines.push("");
    }
  }
  if (!anyFailure) lines.push("沒有失敗案例。", "");

  const falsePositives = cells.flatMap((cell) =>
    cell.runs
      .filter((r) => r.passed && r.guardCaught)
      .map(() => `${cell.caseId} × ${cell.configKey}`),
  );
  lines.push("## 守衛誤擋（通過的輸出被守衛判定飄移）", "");
  if (falsePositives.length === 0) {
    lines.push("沒有誤擋。", "");
  } else {
    for (const item of new Set(falsePositives)) lines.push(`- ${item}`);
    lines.push("");
  }

  return lines.join("\n");
}

describe.skipIf(!API_KEY)("文字整理實打評測（Claude Haiku 5.5）", () => {
  it("語料集 × 提示詞版本 × effort × N 次", async () => {
    const variants = selectVariants();
    const cases = selectCases();
    const startedAt = new Date();
    const configs: EvalConfig[] = variants.flatMap((variant) =>
      EFFORTS.map((effort) => ({
        key: effort ? `${variant.id}@${effort}` : variant.id,
        variant,
        effort,
      })),
    );

    // 案例在外層、設定在內層：各設定交錯送出，延遲比較不受 API 負載隨時間變化影響
    const jobs: { config: EvalConfig; testCase: TextCleanupCase }[] = [];
    for (const testCase of cases) {
      for (const config of configs) {
        jobs.push({ config, testCase });
      }
    }
    const tasks = jobs.flatMap(({ config, testCase }) =>
      Array.from({ length: RUNS }, () => () => runOnce(config, testCase)),
    );

    console.log(
      `[eval] ${configs.length} 個設定（effort：${EFFORTS.map(effortLabel).join("、")}）× ${cases.length} 案 × ${RUNS} 次 = ${tasks.length} 次呼叫，併發 ${CONCURRENCY}，模型 ${MODEL_ID}`,
    );
    let lastPrinted = 0;
    const flat = await runPool(tasks, CONCURRENCY, (done, total) => {
      if (done - lastPrinted >= 20 || done === total) {
        lastPrinted = done;
        console.log(`[eval] 進度 ${done}/${total}`);
      }
    });

    const cells: CellResult[] = jobs.map(({ config, testCase }, index) => ({
      configKey: config.key,
      caseId: testCase.id,
      runs: flat.slice(index * RUNS, (index + 1) * RUNS),
    }));

    const report = buildReport(configs, cases, cells, startedAt);
    mkdirSync(RESULTS_DIR, { recursive: true });
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    const reportPath = `${RESULTS_DIR}text-cleanup-${stamp}.md`;
    writeFileSync(reportPath, report, "utf-8");
    writeFileSync(
      `${RESULTS_DIR}text-cleanup-${stamp}.json`,
      JSON.stringify({ model: MODEL_ID, runs: RUNS, cells }, null, 2),
      "utf-8",
    );
    console.log(report);
    console.log(`[eval] 報告已寫入 ${reportPath}`);

    // 全部都是 API 錯誤代表金鑰或網路有問題，不是提示詞的問題，直接讓測試失敗
    const allRuns = cells.flatMap((c) => c.runs);
    expect(
      allRuns.filter((r) => r.error).length,
      "所有呼叫都失敗，請檢查 ANTHROPIC_API_KEY 與網路",
    ).toBeLessThan(allRuns.length);

    if (STRICT) {
      const failedCells = cells.filter((c) => !cellPassed(c));
      expect(
        failedCells.map((c) => `${c.configKey}/${c.caseId}`),
        "有案例未達 N 次全過",
      ).toEqual([]);
    }
  });
});
