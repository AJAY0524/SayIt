import { describe, expect, it } from "vitest";
import {
  ACTIVE_PROMPTS,
  getAutoLanguagePrompt,
  getPromptForModeAndLocale,
  isKnownDefaultPrompt,
} from "../../src/i18n/prompts";
import { LEGACY_ACTIVE_PROMPTS_V0141 } from "../../src/i18n/legacyPrompts";
import { BUILTIN_PROMPTS_V0141 } from "../support/fixtures/builtin-prompts-v0.14.1";

// #83：辨識語言設為「自動」時整理不該翻譯。本檔守住「辨識語言明確設定的人什麼都沒變」。
describe("prompts — 輸出語言插槽（#83）", () => {
  const modes = ["minimal", "active"] as const;

  describe("[AC3] 明確語言：精簡版與 v0.14.1 逐字相同", () => {
    for (const [locale, expected] of Object.entries(BUILTIN_PROMPTS_V0141.minimal)) {
      it(`minimal × ${locale}`, () => {
        expect(
          getPromptForModeAndLocale("minimal", locale as keyof typeof BUILTIN_PROMPTS_V0141.minimal),
        ).toBe(expected);
      });
    }
  });

  // #31：積極版改版；v0.14.1 舊文字移到舊預設清單，升級遷移時仍視為「沒改過預設」
  describe("[#31] 積極版改版與舊預設遷移", () => {
    for (const [locale, expected] of Object.entries(BUILTIN_PROMPTS_V0141.active)) {
      const key = locale as keyof typeof BUILTIN_PROMPTS_V0141.active;
      it(`active × ${locale}：舊文字逐字保留在舊預設清單，isKnownDefaultPrompt 認得`, () => {
        expect(LEGACY_ACTIVE_PROMPTS_V0141[key]).toBe(expected);
        expect(isKnownDefaultPrompt(expected)).toBe(true);
      });

      it(`active × ${locale}：新版已換掉，且 isKnownDefaultPrompt 認得新版`, () => {
        const current = getPromptForModeAndLocale("active", key);
        expect(current).not.toBe(expected);
        expect(isKnownDefaultPrompt(current)).toBe(true);
      });
    }

    it("新版不要求 <cleaned> 輸出標籤，也不合併意思不同的子句（#31 第 1、2 條）", () => {
      for (const prompt of Object.values(ACTIVE_PROMPTS)) {
        expect(prompt).not.toContain("<cleaned>");
        expect(prompt).not.toMatch(/繞圈|绕圈|circular|回りくどい|장황한/);
      }
    });

    it("zh-TW 範例 3–5 組，放在 <example> 區塊（#31 第 5 條）", () => {
      const zhTW = ACTIVE_PROMPTS["zh-TW"];
      const count = zhTW.split("<example>").length - 1;
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(5);
    });
  });

  const count = (text: string, word: string) => text.split(word).length - 1;

  describe("[AC1] 自動＋英文介面：不再要求輸出英文", () => {
    for (const mode of modes) {
      it(mode, () => {
        const prompt = getAutoLanguagePrompt(mode, "en");
        expect(prompt).not.toContain("Use English");
        expect(prompt).not.toContain("in English");
        expect(prompt).toMatch(/same language as the input|Keep the input language/);
      });
    }
  });

  describe("[AC2] 自動＋中文介面：中文才統一繁簡，且只出現在條件句裡", () => {
    const cases = [
      { locale: "zh-TW", script: "繁體中文", condition: "若是中文，使用繁體中文" },
      { locale: "zh-CN", script: "简体中文", condition: "若是中文，使用简体中文" },
    ] as const;
    for (const mode of modes) {
      for (const { locale, script, condition } of cases) {
        it(`${mode} × ${locale}`, () => {
          const prompt = getAutoLanguagePrompt(mode, locale);
          expect(count(prompt, script)).toBe(1);
          expect(prompt).toContain(condition);
        });
      }
    }
  });

  describe("[AC5] 非中文介面沒有殘留的強制語言；積極版保留「直接輸出」", () => {
    const languageNames = { en: "English", ja: "日本語", ko: "한국어" } as const;
    for (const mode of modes) {
      for (const [locale, name] of Object.entries(languageNames)) {
        it(`${mode} × ${locale} 不含「${name}」`, () => {
          expect(getAutoLanguagePrompt(mode, locale as keyof typeof languageNames)).not.toContain(name);
        });
      }
    }

    const directOutput = {
      "zh-TW": "直接輸出處理後的文字",
      "zh-CN": "直接输出处理后的文字",
      en: "Output the processed text directly",
      ja: "直接出力してください",
      ko: "직접 출력하세요",
    } as const;
    for (const [locale, phrase] of Object.entries(directOutput)) {
      it(`active × ${locale} 保留直接輸出`, () => {
        expect(getAutoLanguagePrompt("active", locale as keyof typeof directOutput)).toContain(phrase);
      });
    }
  });
});
