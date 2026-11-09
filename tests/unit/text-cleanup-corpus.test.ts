import { describe, it, expect } from "vitest";
import {
  TEXT_CLEANUP_CASES,
  TEXT_CLEANUP_CATEGORY_LABELS,
  type TextCleanupCategory,
} from "../support/fixtures/text-cleanup-cases";
import { judgeCleanupOutput } from "../support/text-cleanup-judge";
import {
  detectSemanticDrift,
  SEMANTIC_DRIFT_MIN_OVERLAP,
} from "../../src/lib/hallucinationDetector";
import { IMPROVED_PROMPT_EXAMPLE_TRANSCRIPTS } from "../eval/prompt-variants";

/**
 * 文字整理回歸語料集的離線測試（wayfinder #33）。
 *
 * 三件事：
 *  1. 語料集本身結構完整（8 類、每案有可接受輸出與壞輸出範本）
 *  2. 斷言判定自洽（可接受輸出全過、壞輸出至少違反一條）
 *  3. 現行語意飄移守衛（bigram containment）對每個範本的表現
 *
 * 現行 bigram 0.2 門檻擋不住的壞輸出以 `it.fails` 標記：守衛本身不在這裡改（#30 的決策），
 * #30 調整守衛後，擋住了的範本會讓 `it.fails` 變紅，提醒把 `guard` 改回 "catches"。
 */

describe("文字整理回歸語料集", () => {
  describe("語料集結構", () => {
    it("案例 id 不重複", () => {
      const ids = TEXT_CLEANUP_CASES.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("約 30 個案例、8 類各至少 3 案", () => {
      expect(TEXT_CLEANUP_CASES.length).toBeGreaterThanOrEqual(30);
      const categories = Object.keys(
        TEXT_CLEANUP_CATEGORY_LABELS,
      ) as TextCleanupCategory[];
      expect(categories).toHaveLength(8);
      for (const category of categories) {
        const count = TEXT_CLEANUP_CASES.filter(
          (c) => c.category === category,
        ).length;
        expect(count, category).toBeGreaterThanOrEqual(3);
      }
    });

    it("每案都有輸入、斷言、可接受輸出與壞輸出範本", () => {
      for (const c of TEXT_CLEANUP_CASES) {
        expect(c.input.trim(), c.id).not.toBe("");
        expect(c.mustContain.length, c.id).toBeGreaterThan(0);
        expect(c.acceptableOutputs.length, c.id).toBeGreaterThan(0);
        expect(c.knownBadOutputs.length, c.id).toBeGreaterThan(0);
      }
    });

    it("改良版提示詞的 few-shot 範例不與語料集輸入相同（避免灌水通過率）", () => {
      const inputs = new Set(TEXT_CLEANUP_CASES.map((c) => c.input));
      for (const transcript of IMPROVED_PROMPT_EXAMPLE_TRANSCRIPTS) {
        expect(inputs.has(transcript), transcript).toBe(false);
      }
    });
  });

  describe("斷言判定自洽", () => {
    for (const c of TEXT_CLEANUP_CASES) {
      it(`${c.id}：可接受輸出全部通過斷言`, () => {
        for (const output of c.acceptableOutputs) {
          const result = judgeCleanupOutput(c, output);
          expect(result.failures, output).toEqual([]);
        }
      });

      it(`${c.id}：壞輸出範本至少違反一條斷言`, () => {
        for (const bad of c.knownBadOutputs) {
          const result = judgeCleanupOutput(c, bad.text);
          expect(result.passed, `${bad.text}（${bad.why}）`).toBe(false);
        }
      });
    }

    it("輸入原文本身對「已乾淨輸入」類案例是可接受的", () => {
      for (const c of TEXT_CLEANUP_CASES.filter(
        (x) => x.category === "already-clean",
      )) {
        expect(judgeCleanupOutput(c, c.input).failures, c.id).toEqual([]);
      }
    });
  });

  describe("現行語意飄移守衛（bigram containment）", () => {
    for (const c of TEXT_CLEANUP_CASES) {
      it(`${c.id}：可接受輸出不會被誤判成飄移`, () => {
        for (const output of c.acceptableOutputs) {
          const drift = detectSemanticDrift(c.input, output);
          expect(
            drift.isDrift,
            `${output}（overlap ${drift.overlapRatio.toFixed(2)}）`,
          ).toBe(false);
        }
      });

      c.knownBadOutputs.forEach((bad, index) => {
        const title = `${c.id}：壞輸出 #${index + 1} 被守衛擋下（${bad.why}）`;
        const assertCaught = () => {
          const drift = detectSemanticDrift(c.input, bad.text);
          expect(
            drift.isDrift,
            `overlap ${drift.overlapRatio.toFixed(2)}，門檻 ${SEMANTIC_DRIFT_MIN_OVERLAP}`,
          ).toBe(true);
        };
        if (bad.guard === "catches") {
          it(title, assertCaught);
        } else {
          // 現行 0.2 門檻擋不住；#30 調整守衛後這裡會轉紅，屆時改回 "catches"
          it.fails(`[守衛漏接] ${title}`, assertCaught);
        }
      });
    }
  });
});
