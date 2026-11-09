/**
 * 選取文字語音改寫的意圖判斷（#36，決議來源 #28）。
 *
 * 模型先輸出 `<intent>edit|replace</intent>` 再輸出結果：
 *  - edit：口述內容是對選取文字下的指令
 *  - replace：口述內容是使用者重講的正確內容，應取代選取文字
 * 標籤缺漏當作 edit；edit 的輸出若與選取文字相同（正規化後），也視為 replace（兜底）。
 */

export type EditIntent = "edit" | "replace";

export interface ParsedEditResponse {
  intent: EditIntent;
  /** 移除意圖標籤與模型抄回的輸入標籤後的文字 */
  body: string;
  /** 回應中是否找到合法的意圖標籤 */
  hasIntentTag: boolean;
}

const INTENT_TAG_PATTERN = /<intent>\s*(edit|replace)\s*<\/intent>/i;
const INPUT_TAG_PATTERN = /<\/?(?:selected_text|voice_input)>/gi;

/** 組成選取文字語音改寫的 user 訊息；結構說明在 `EDIT_MODE_PROMPTS`。 */
export function buildEditUserMessage(
  selectedText: string,
  voiceInput: string,
): string {
  return `<selected_text>\n${selectedText}\n</selected_text>\n\n<voice_input>\n${voiceInput}\n</voice_input>`;
}

/** 解析改寫回應：取出意圖與內文。標籤缺漏時 intent 為 edit、內文為整段回應。 */
export function parseEditResponse(responseText: string): ParsedEditResponse {
  const match = INTENT_TAG_PATTERN.exec(responseText);
  const withoutIntent = match
    ? responseText.replace(INTENT_TAG_PATTERN, "")
    : responseText;
  const body = withoutIntent.replace(INPUT_TAG_PATTERN, "").trim();
  return {
    intent: match ? (match[1].toLowerCase() as EditIntent) : "edit",
    body,
    hasIntentTag: match !== null,
  };
}

/** 比對用的正規化：全半形、大小寫與所有空白、標點符號都不算差異。 */
export function normalizeForComparison(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/** 兩段文字正規化後是否相同（兩邊都空白不算相同）。 */
export function isSameTextIgnoringFormat(a: string, b: string): boolean {
  const normalizedA = normalizeForComparison(a);
  return normalizedA !== "" && normalizedA === normalizeForComparison(b);
}

/**
 * 最終意圖：
 *  - 模型判為 replace → replace
 *  - 模型判為 edit（或標籤缺漏），但輸出為空或與選取文字相同（原樣回傳＝沒有可執行的指令）→ replace
 *  - 其餘 → edit
 */
export function resolveEditIntent(
  parsed: ParsedEditResponse,
  selectedText: string,
): { intent: EditIntent; viaFallback: boolean } {
  if (parsed.intent === "replace") {
    return { intent: "replace", viaFallback: false };
  }
  if (
    parsed.body === "" ||
    isSameTextIgnoringFormat(parsed.body, selectedText)
  ) {
    return { intent: "replace", viaFallback: true };
  }
  return { intent: "edit", viaFallback: false };
}
