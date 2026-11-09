import { describe, it, expect } from "vitest";
import {
  buildEditUserMessage,
  isSameTextIgnoringFormat,
  parseEditResponse,
  resolveEditIntent,
} from "../../src/lib/editIntent";
import { EDIT_MODE_PROMPTS } from "../../src/i18n/prompts";
import { EDIT_INTENT_CASES } from "../support/fixtures/edit-intent-cases";
import { TEXT_CLEANUP_CASES } from "../support/fixtures/text-cleanup-cases";

describe("editIntent（#36 選取文字語音改寫意圖）", () => {
  describe("buildEditUserMessage", () => {
    it("選取文字與口述內容分別包進 <selected_text>、<voice_input>", () => {
      expect(buildEditUserMessage("選取", "口述")).toBe(
        "<selected_text>\n選取\n</selected_text>\n\n<voice_input>\n口述\n</voice_input>",
      );
    });
  });

  describe("parseEditResponse", () => {
    it("edit 標籤＋結果", () => {
      expect(parseEditResponse("<intent>edit</intent>\nHello")).toEqual({
        intent: "edit",
        body: "Hello",
        hasIntentTag: true,
      });
    });

    it("replace 標籤後沒有內容", () => {
      expect(parseEditResponse("<intent>replace</intent>")).toEqual({
        intent: "replace",
        body: "",
        hasIntentTag: true,
      });
    });

    it("標籤大小寫與內部空白寬鬆處理", () => {
      expect(parseEditResponse("<Intent> Replace </Intent>\n").intent).toBe(
        "replace",
      );
    });

    it("標籤缺漏當作 edit，整段回應當內文", () => {
      expect(parseEditResponse("  直接的結果  ")).toEqual({
        intent: "edit",
        body: "直接的結果",
        hasIntentTag: false,
      });
    });

    it("未知的意圖值視為標籤缺漏", () => {
      const parsed = parseEditResponse("<intent>delete</intent>\n結果");
      expect(parsed.intent).toBe("edit");
      expect(parsed.hasIntentTag).toBe(false);
    });

    it("剝除模型抄回來的輸入標籤", () => {
      expect(
        parseEditResponse(
          "<intent>edit</intent>\n<selected_text>\n結果\n</selected_text>",
        ).body,
      ).toBe("結果");
    });
  });

  describe("isSameTextIgnoringFormat", () => {
    it("標點、空白、全半形、大小寫不算差異", () => {
      expect(isSameTextIgnoringFormat("你好, World!", "你好，world")).toBe(true);
      expect(isSameTextIgnoringFormat("ＡＢＣ 123", "abc123")).toBe(true);
    });

    it("內容不同就不相同", () => {
      expect(isSameTextIgnoringFormat("我上心", "我傷心")).toBe(false);
    });

    it("兩邊都只有標點空白不算相同", () => {
      expect(isSameTextIgnoringFormat("。", " ")).toBe(false);
    });
  });

  describe("resolveEditIntent", () => {
    it("模型判 replace → replace（非兜底）", () => {
      expect(
        resolveEditIntent(parseEditResponse("<intent>replace</intent>"), "選取"),
      ).toEqual({ intent: "replace", viaFallback: false });
    });

    it("edit 且輸出等於選取文字 → replace（兜底）", () => {
      expect(
        resolveEditIntent(
          parseEditResponse("<intent>edit</intent>\n選取文字。"),
          "選取文字",
        ),
      ).toEqual({ intent: "replace", viaFallback: true });
    });

    it("標籤缺漏且輸出等於選取文字 → replace（兜底）", () => {
      expect(
        resolveEditIntent(parseEditResponse("選取文字"), "選取文字").intent,
      ).toBe("replace");
    });

    it("edit 但輸出為空 → replace（兜底）", () => {
      expect(
        resolveEditIntent(parseEditResponse("<intent>edit</intent>"), "選取")
          .intent,
      ).toBe("replace");
    });

    it("edit 且輸出不同 → edit", () => {
      expect(
        resolveEditIntent(
          parseEditResponse("<intent>edit</intent>\nTranslated"),
          "選取",
        ),
      ).toEqual({ intent: "edit", viaFallback: false });
    });
  });

  describe("EDIT_MODE_PROMPTS", () => {
    it.each(Object.entries(EDIT_MODE_PROMPTS))(
      "%s：說明兩個輸入區塊與兩種意圖標籤，且不內嵌口述指令區塊",
      (_locale, prompt) => {
        expect(prompt).toContain("<selected_text>");
        expect(prompt).toContain("<voice_input>");
        expect(prompt).toContain("<intent>edit</intent>");
        expect(prompt).toContain("<intent>replace</intent>");
        expect(prompt).not.toContain("<instruction>");
      },
    );
  });

  describe("語料集（實打評測用）", () => {
    it("指令型 3 個、重講型 3 個，id 不重複", () => {
      const ids = EDIT_INTENT_CASES.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(EDIT_INTENT_CASES.filter((c) => c.kind === "instruction")).toHaveLength(3);
      expect(EDIT_INTENT_CASES.filter((c) => c.kind === "retype")).toHaveLength(3);
    });

    it("期望意圖與類型一致：指令型 edit、重講型 replace", () => {
      for (const c of EDIT_INTENT_CASES) {
        expect(c.expectedIntent).toBe(c.kind === "instruction" ? "edit" : "replace");
      }
    });

    it("重講型的口述內容與選取文字不同，且不與文字整理語料集的輸入重複", () => {
      const cleanupInputs = new Set(TEXT_CLEANUP_CASES.map((c) => c.input));
      for (const c of EDIT_INTENT_CASES) {
        expect(c.voiceInput.trim()).not.toBe("");
        expect(c.selectedText.trim()).not.toBe("");
        if (c.kind === "retype") {
          expect(isSameTextIgnoringFormat(c.voiceInput, c.selectedText)).toBe(false);
        }
        expect(cleanupInputs.has(c.voiceInput)).toBe(false);
        expect(cleanupInputs.has(c.selectedText)).toBe(false);
      }
    });
  });
});
