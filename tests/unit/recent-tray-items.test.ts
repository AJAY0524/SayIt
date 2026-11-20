import { describe, expect, it } from "vitest";
import {
  buildRecentTrayItems,
  RECENT_TRAY_LIMIT,
  RECENT_TRAY_PREVIEW_CHARS,
} from "../../src/lib/recentTrayItems";
import type { TranscriptionRecord } from "../../src/types/transcription";

function makeRecord(overrides: Partial<TranscriptionRecord>): TranscriptionRecord {
  return {
    id: "id",
    timestamp: new Date(2026, 10, 20, 9, 5).getTime(),
    rawText: "原文",
    processedText: null,
    recordingDurationMs: 0,
    transcriptionDurationMs: 0,
    enhancementDurationMs: null,
    charCount: 0,
    triggerMode: "hold",
    wasEnhanced: false,
    wasModified: null,
    createdAt: "",
    audioFilePath: null,
    status: "success",
    isEditMode: false,
    editSourceText: null,
    ...overrides,
  } as TranscriptionRecord;
}

describe("recentTrayItems（系統匣最近紀錄）", () => {
  it("[P0] 優先用整理後文字，標籤帶 HH:mm", () => {
    const [item] = buildRecentTrayItems([
      makeRecord({ rawText: "原文", processedText: "整理後" }),
    ]);
    expect(item).toEqual({ label: "09:05  整理後", text: "整理後" });
  });

  it("[P0] 略過失敗與空白紀錄，最多 RECENT_TRAY_LIMIT 筆", () => {
    const recordList = [
      makeRecord({ status: "failed", rawText: "失敗" }),
      makeRecord({ rawText: "   " }),
      ...Array.from({ length: RECENT_TRAY_LIMIT + 2 }, (_, i) =>
        makeRecord({ rawText: `第${i}筆` }),
      ),
    ];
    const itemList = buildRecentTrayItems(recordList);
    expect(itemList).toHaveLength(RECENT_TRAY_LIMIT);
    expect(itemList[0].text).toBe("第0筆");
  });

  it("[P0] 標籤壓成單行並截斷，複製用的 text 保留完整原文", () => {
    const longText = `第一行\n${"字".repeat(RECENT_TRAY_PREVIEW_CHARS + 5)}`;
    const [item] = buildRecentTrayItems([makeRecord({ rawText: longText })]);
    const preview = item.label.slice("09:05  ".length);
    expect(preview).not.toContain("\n");
    expect(preview.endsWith("…")).toBe(true);
    expect(Array.from(preview)).toHaveLength(RECENT_TRAY_PREVIEW_CHARS + 1);
    expect(item.text).toBe(longText);
  });
});
