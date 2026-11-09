/**
 * 文字整理實打評測的提示詞版本（#33 建立，#35 改成定案結構）。
 *
 * 所有版本都走真正的 `enhanceText`：
 *  - active：現行 zh-TW `active`（#31 改版），`wrapTranscript` 開啟（程式包 `<transcript>`、附結構說明、輸出純文字）
 *  - legacy-active-wrapped：v0.14.1 舊版 `active` 文字，同樣開啟包裝，用來看「只靠程式層包裝」能擋多少
 *  - legacy-active：v0.14.1 舊版 `active`、不包裝，等同改版前的線上行為（基準）
 *
 * zh-TW 積極版的 few-shot 範例是合成句（`ACTIVE_PROMPT_EXAMPLE_TRANSCRIPTS`），
 * 離線測試會檢查它們不與語料集案例輸入相同。
 */

import { getPromptForModeAndLocale } from "../../src/i18n/prompts";
import { LEGACY_ACTIVE_PROMPTS_V0141 } from "../../src/i18n/legacyPrompts";

export interface PromptVariant {
  id: string;
  label: string;
  systemPrompt: string;
  /** true 走 cleanupTranscript（#27 定案結構）；false 用 enhanceText 原文直送 */
  wrapTranscript: boolean;
}

export const PROMPT_VARIANTS: PromptVariant[] = [
  {
    id: "active",
    label: "改版 zh-TW active（定案結構）",
    systemPrompt: getPromptForModeAndLocale("active", "zh-TW"),
    wrapTranscript: true,
  },
  {
    id: "legacy-active-wrapped",
    label: "舊版 active＋程式層包裝",
    systemPrompt: LEGACY_ACTIVE_PROMPTS_V0141["zh-TW"],
    wrapTranscript: true,
  },
  {
    id: "legacy-active",
    label: "舊版 active（改版前線上行為）",
    systemPrompt: LEGACY_ACTIVE_PROMPTS_V0141["zh-TW"],
    wrapTranscript: false,
  },
];
