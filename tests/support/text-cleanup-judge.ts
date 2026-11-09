/**
 * 文字整理回歸語料集的斷言式判定（wayfinder #26 決議第 6 點）。
 *
 * 不用 LLM 當評審；每個案例用宣告式斷言判定，離線測試與實打評測共用同一份邏輯：
 *  - mustContain：必須保留的片段
 *  - mustNotContain：不該出現的內容
 *  - 人稱集合相同
 *  - 否定詞數量相同
 *  - 開頭不是「好的」「抱歉」這類回應語（原文本身以這類詞開頭時不算）
 */

import type { TextCleanupCase } from "./fixtures/text-cleanup-cases";

/** 人稱字元集合（含我們、你們：以單字元比對） */
const PERSON_CHARS = ["我", "你", "妳", "您", "他", "她"];
/** 否定詞字元 */
const NEGATION_PATTERN = /[不沒別無未非]/g;
/** 回應式開頭（比對前已去除空白標點、轉小寫） */
const RESPONSE_OPENERS = [
  "好的",
  "好喔",
  "好啊",
  "沒問題",
  "當然",
  "抱歉",
  "對不起",
  "很抱歉",
  "不好意思",
  "了解",
  "收到",
  "我明白",
  "我理解",
  "不會的",
  "我無法",
  "understood",
  "sure",
  "okay",
  "ok",
  "certainly",
];

/** 去除空白與標點、轉小寫，只留文字字元（與守衛的 normalize 同思路，但不做簡轉繁） */
export function normalizeForJudge(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** 文字中出現的人稱字元集合，排序後串成字串方便比較 */
export function personSet(text: string): string {
  return PERSON_CHARS.filter((c) => text.includes(c)).join("");
}

export function negationCount(text: string): number {
  return (text.match(NEGATION_PATTERN) ?? []).length;
}

export function startsWithResponsePhrase(text: string): boolean {
  const normalized = normalizeForJudge(text);
  return RESPONSE_OPENERS.some((opener) => normalized.startsWith(opener));
}

/**
 * 輸出是否含該片段。比對前先去除空白與標點；
 * 片段本身只有標點（例如程式碼圍欄 ```）時，正規化後會變空字串，改用原樣（小寫）比對。
 */
function containsFragment(output: string, fragment: string): boolean {
  const normalizedFragment = normalizeForJudge(fragment);
  if (normalizedFragment === "") {
    return output.toLowerCase().includes(fragment.toLowerCase());
  }
  return normalizeForJudge(output).includes(normalizedFragment);
}

export interface JudgeResult {
  passed: boolean;
  /** 違反的斷言說明；空陣列代表通過 */
  failures: string[];
}

export function judgeCleanupOutput(
  testCase: TextCleanupCase,
  output: string,
): JudgeResult {
  const failures: string[] = [];
  const skip = testCase.skipChecks ?? [];

  for (const fragment of testCase.mustContain) {
    if (!containsFragment(output, fragment)) {
      failures.push(`缺少必須保留的片段「${fragment}」`);
    }
  }
  for (const fragment of testCase.mustNotContain) {
    if (containsFragment(output, fragment)) {
      failures.push(`出現不該有的內容「${fragment}」`);
    }
  }

  if (!skip.includes("persons")) {
    const expected = personSet(testCase.input);
    const actual = personSet(output);
    if (expected !== actual) {
      failures.push(`人稱集合改變（原文「${expected}」→ 輸出「${actual}」）`);
    }
  }

  if (!skip.includes("negation")) {
    const expected = negationCount(testCase.input);
    const actual = negationCount(output);
    if (expected !== actual) {
      failures.push(`否定詞數量改變（原文 ${expected} → 輸出 ${actual}）`);
    }
  }

  if (
    startsWithResponsePhrase(output) &&
    !startsWithResponsePhrase(testCase.input)
  ) {
    failures.push("開頭是回應語");
  }

  return { passed: failures.length === 0, failures };
}
