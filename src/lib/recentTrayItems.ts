import type { TranscriptionRecord } from "../types/transcription";

/** 系統匣「最近紀錄」最多幾筆（Rust 端 MAX_RECENT_ITEMS 也擋同樣上限） */
export const RECENT_TRAY_LIMIT = 5;
/** 選單上預覽的字數上限，超過加刪節號 */
export const RECENT_TRAY_PREVIEW_CHARS = 28;

export interface RecentTrayItem {
  label: string;
  text: string;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function buildPreview(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  const charList = Array.from(singleLine);
  return charList.length > RECENT_TRAY_PREVIEW_CHARS
    ? `${charList.slice(0, RECENT_TRAY_PREVIEW_CHARS).join("")}…`
    : singleLine;
}

/**
 * 把最近的轉錄紀錄轉成系統匣選單項目（fork 自訂）：
 * 取整理後文字（沒有就用原文），略過失敗與空白紀錄，最多 RECENT_TRAY_LIMIT 筆。
 */
export function buildRecentTrayItems(
  recordList: TranscriptionRecord[],
): RecentTrayItem[] {
  const itemList: RecentTrayItem[] = [];
  for (const record of recordList) {
    if (record.status !== "success") continue;
    const text = (record.processedText ?? record.rawText).trim();
    if (!text) continue;
    itemList.push({
      label: `${formatTime(record.timestamp)}  ${buildPreview(text)}`,
      text,
    });
    if (itemList.length >= RECENT_TRAY_LIMIT) break;
  }
  return itemList;
}
