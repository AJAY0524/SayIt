import { describe, it, expect } from "vitest";
import {
  TEXT_CLEANUP_CASES,
  TEXT_CLEANUP_CATEGORY_LABELS,
  type TextCleanupCategory,
} from "../support/fixtures/text-cleanup-cases";
import { judgeCleanupOutput } from "../support/text-cleanup-judge";
import { detectSemanticDrift } from "../../src/lib/hallucinationDetector";
import { ACTIVE_PROMPT_EXAMPLE_TRANSCRIPTS } from "../../src/i18n/prompts";

/**
 * 文字整理回歸語料集的離線測試（wayfinder #33）。
 *
 * 三件事：
 *  1. 語料集本身結構完整（8 類、每案有可接受輸出與壞輸出範本）
 *  2. 斷言判定自洽（可接受輸出全過、壞輸出至少違反一條）
 *  3. 語意飄移守衛（bigram containment＋#30 四個判準）對每個範本的表現
 *
 * 守衛擋不住的壞輸出以 `it.fails` 標記；之後調整守衛而擋住了的範本會讓 `it.fails` 變紅，
 * 提醒把 `guard` 改回 "catches"。可接受輸出被誤判是硬性失敗（#30 校準規則）。
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

    it("zh-TW 積極版的 few-shot 範例不與語料集輸入相同（避免灌水通過率）", () => {
      const inputs = new Set(TEXT_CLEANUP_CASES.map((c) => c.input));
      for (const transcript of ACTIVE_PROMPT_EXAMPLE_TRANSCRIPTS) {
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

  describe("語意飄移守衛（#43 bigram＋#30 新判準）", () => {
    for (const c of TEXT_CLEANUP_CASES) {
      it(`${c.id}：可接受輸出不會被誤判成飄移`, () => {
        for (const output of c.acceptableOutputs) {
          const drift = detectSemanticDrift(c.input, output);
          expect(
            drift.isDrift,
            `${output}（${drift.reasons.join("、")}）`,
          ).toBe(false);
        }
      });

      c.knownBadOutputs.forEach((bad, index) => {
        const title = `${c.id}：壞輸出 #${index + 1} 被守衛擋下（${bad.why}）`;
        const assertCaught = () => {
          const drift = detectSemanticDrift(c.input, bad.text);
          expect(
            drift.isDrift,
            `overlap ${drift.overlapRatio.toFixed(2)}、字元保留率 ${drift.charRetention.toFixed(2)}`,
          ).toBe(true);
        };
        if (bad.guard === "catches") {
          it(title, assertCaught);
        } else {
          // 守衛擋不住（多半要靠提示詞）；之後守衛擋住了這裡會轉紅，屆時改回 "catches"
          it.fails(`[守衛漏接] ${title}`, assertCaught);
        }
      });
    }
  });
});
