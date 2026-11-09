/**
 * 選取文字語音改寫的意圖判斷實打評測（#36，決議來源 #28）。
 *
 * 用 `pnpm eval:edit-intent` 手動執行，不進 CI。流程：
 *   6 個案例 × N 次 → 用真正的 `EDIT_MODE_PROMPTS` 與 `enhanceText`（打 Claude Haiku 5.5）
 *   → 解析 `<intent>` 標籤 → 量測：
 *     1. 模型意圖準確度：模型自己回報的意圖是否等於期望（標籤缺漏算錯）
 *     2. 最終意圖準確度：套用「標籤缺漏當 edit＋輸出等於選取文字則視為 replace」兜底後是否等於期望
 *   → 報告寫到 `tests/eval/results/`（已加入 .gitignore，不進 repo）
 *
 * 環境變數：
 *   ANTHROPIC_API_KEY  必填，且只從這裡讀（不讀 App 設定、不寫進檔案）；沒設定就整份略過
 *   EVAL_RUNS          每案跑幾次，預設 5
 *   EVAL_CASES         只跑指定案例 id 或類型（instruction／retype，逗號分隔），預設全部
 *   EVAL_CONCURRENCY   同時進行的請求數，預設 3
 *   EVAL_MODEL         模型 id，預設 claude-haiku-5-5
 *   EVAL_LOCALE        使用的語系 prompt，預設 zh-TW
 */

import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Tauri 的 HTTP plugin 在 Node 底下不存在，改接到 Node 內建 fetch，其餘 enhancer 流程維持真實
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
}));

import { enhanceText, EnhancerApiError } from "../../src/lib/enhancer";
import {
  buildEditUserMessage,
  parseEditResponse,
  resolveEditIntent,
  type EditIntent,
} from "../../src/lib/editIntent";
import { EDIT_MODE_PROMPTS } from "../../src/i18n/prompts";
import type { SupportedLocale } from "../../src/i18n/languageConfig";
import {
  EDIT_INTENT_CASES,
  type EditIntentCase,
} from "../support/fixtures/edit-intent-cases";

const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const RUNS = positiveInt(process.env.EVAL_RUNS, 5);
const CONCURRENCY = positiveInt(process.env.EVAL_CONCURRENCY, 3);
const MODEL_ID = process.env.EVAL_MODEL || "claude-haiku-5-5";
const LOCALE = (process.env.EVAL_LOCALE || "zh-TW") as SupportedLocale;
const MAX_ATTEMPTS = 4;
const EDIT_MODE_MAX_TOKENS = 4096;
const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function selectCases(): EditIntentCase[] {
  const wanted = (process.env.EVAL_CASES ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (wanted.length === 0) return EDIT_INTENT_CASES;
  const selected = EDIT_INTENT_CASES.filter(
    (c) => wanted.includes(c.id) || wanted.includes(c.kind),
  );
  if (selected.length === 0) {
    throw new Error(`EVAL_CASES 沒有符合的案例：${wanted.join(", ")}`);
  }
  return selected;
}

interface RunResult {
  /** 模型回報的意圖；標籤缺漏為 null */
  modelIntent: EditIntent | null;
  /** 套用兜底後的最終意圖 */
  finalIntent: EditIntent | null;
  viaFallback: boolean;
  /** 模型意圖等於期望（標籤缺漏算錯） */
  modelCorrect: boolean;
  /** 最終意圖等於期望 */
  finalCorrect: boolean;
  /** 模型輸出的內文（edit 的處理結果；replace 應為空） */
  body: string;
  error: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof EnhancerApiError) {
    return error.statusCode === 429 || error.statusCode >= 500;
  }
  return true;
}

async function runOnce(testCase: EditIntentCase): Promise<RunResult> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // 與 App 內 handleEditModeFlow 相同：system 放規則，user 放兩個包裝區塊
      const result = await enhanceText(
        buildEditUserMessage(testCase.selectedText, testCase.voiceInput),
        API_KEY,
        {
          systemPrompt: EDIT_MODE_PROMPTS[LOCALE],
          modelId: MODEL_ID,
          maxTokens: EDIT_MODE_MAX_TOKENS,
        },
      );
      const parsed = parseEditResponse(result.isRawFallback ? "" : result.text);
      const resolved = resolveEditIntent(parsed, testCase.selectedText);
      const modelIntent = parsed.hasIntentTag ? parsed.intent : null;
      return {
        modelIntent,
        finalIntent: resolved.intent,
        viaFallback: resolved.viaFallback,
        modelCorrect: modelIntent === testCase.expectedIntent,
        finalCorrect: resolved.intent === testCase.expectedIntent,
        body: parsed.body,
        error: null,
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
    modelIntent: null,
    finalIntent: null,
    viaFallback: false,
    modelCorrect: false,
    finalCorrect: false,
    body: "",
    error: lastError,
  };
}

async function runPool<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

interface CaseResult {
  testCase: EditIntentCase;
  runs: RunResult[];
}

function count(runs: RunResult[], pick: (r: RunResult) => boolean): number {
  return runs.filter(pick).length;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, "⏎");
}

function buildReport(results: CaseResult[], startedAt: Date): string {
  const lines: string[] = [];
  lines.push("# 選取文字語音改寫意圖判斷實打評測報告", "");
  lines.push(`- 時間：${startedAt.toISOString()}`);
  lines.push(`- 模型：${MODEL_ID}`);
  lines.push(`- 語系 prompt：${LOCALE}`);
  lines.push(`- 每案跑 ${RUNS} 次`);
  lines.push("");

  lines.push("## 逐案", "");
  lines.push(
    "| 案例 | 類型 | 期望 | 模型意圖準確 | 最終意圖準確（含兜底） | 靠兜底救回 | 標籤缺漏 | API 錯誤 |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const { testCase, runs } of results) {
    lines.push(
      `| ${testCase.id} | ${testCase.kind === "instruction" ? "指令型" : "重講型"} | ${testCase.expectedIntent} | ${count(runs, (r) => r.modelCorrect)}/${runs.length} | ${count(runs, (r) => r.finalCorrect)}/${runs.length} | ${count(runs, (r) => r.finalCorrect && !r.modelCorrect)} | ${count(runs, (r) => !r.error && r.modelIntent === null)} | ${count(runs, (r) => r.error !== null)} |`,
    );
  }
  lines.push("");

  const all = results.flatMap((r) => r.runs);
  const byKind = (kind: EditIntentCase["kind"]) =>
    results.filter((r) => r.testCase.kind === kind).flatMap((r) => r.runs);
  lines.push("## 總表", "");
  lines.push(
    "| 範圍 | 模型意圖準確 | 最終意圖準確（含兜底） |",
    "|---|---|---|",
  );
  for (const [label, runs] of [
    ["指令型（期望 edit）", byKind("instruction")],
    ["重講型（期望 replace）", byKind("retype")],
    ["全部", all],
  ] as const) {
    lines.push(
      `| ${label} | ${count(runs, (r) => r.modelCorrect)}/${runs.length} | ${count(runs, (r) => r.finalCorrect)}/${runs.length} |`,
    );
  }
  lines.push("");

  lines.push("## 判錯明細", "");
  let anyWrong = false;
  for (const { testCase, runs } of results) {
    const wrong = runs.filter((r) => !r.finalCorrect);
    const modelWrong = runs.filter((r) => r.finalCorrect && !r.modelCorrect);
    if (wrong.length === 0 && modelWrong.length === 0) continue;
    anyWrong = true;
    lines.push(`### ${testCase.id}（期望 ${testCase.expectedIntent}）`, "");
    for (const run of [...wrong, ...modelWrong]) {
      lines.push(
        `- ${run.error ? `API 錯誤：${run.error}` : `模型意圖 ${run.modelIntent ?? "（缺標籤）"}，最終 ${run.finalIntent}${run.viaFallback ? "（兜底）" : ""}，內文：${escapeCell(run.body) || "（空）"}`}`,
      );
    }
    lines.push("");
  }
  if (!anyWrong) lines.push("沒有判錯案例。", "");

  return lines.join("\n");
}

describe.skipIf(!API_KEY)("選取文字語音改寫意圖判斷實打評測（Claude Haiku 5.5）", () => {
  it("案例 × N 次", async () => {
    const cases = selectCases();
    const startedAt = new Date();
    const tasks = cases.flatMap((testCase) =>
      Array.from({ length: RUNS }, () => () => runOnce(testCase)),
    );
    console.log(
      `[eval] ${cases.length} 案 × ${RUNS} 次 = ${tasks.length} 次呼叫，併發 ${CONCURRENCY}，模型 ${MODEL_ID}`,
    );
    const flat = await runPool(tasks, CONCURRENCY);
    const results: CaseResult[] = cases.map((testCase, index) => ({
      testCase,
      runs: flat.slice(index * RUNS, (index + 1) * RUNS),
    }));

    const report = buildReport(results, startedAt);
    mkdirSync(RESULTS_DIR, { recursive: true });
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    const reportPath = `${RESULTS_DIR}edit-intent-${stamp}.md`;
    writeFileSync(reportPath, report, "utf-8");
    writeFileSync(
      `${RESULTS_DIR}edit-intent-${stamp}.json`,
      JSON.stringify({ model: MODEL_ID, locale: LOCALE, runs: RUNS, results }, null, 2),
      "utf-8",
    );
    console.log(report);
    console.log(`[eval] 報告已寫入 ${reportPath}`);

    const allRuns = results.flatMap((r) => r.runs);
    expect(
      allRuns.filter((r) => r.error).length,
      "所有呼叫都失敗，請檢查 ANTHROPIC_API_KEY 與網路",
    ).toBeLessThan(allRuns.length);
  });
});
