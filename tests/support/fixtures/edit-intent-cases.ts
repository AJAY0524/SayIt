/**
 * 選取文字語音改寫的意圖判斷語料（#36，決議來源 #28）。
 *
 * 與文字整理語料集（`text-cleanup-cases.ts`）分開存放，不加進 #34 的案例。
 *  - 離線：`tests/unit/edit-intent.test.ts` 檢查語料結構（3 個指令型＋3 個重講型、不重複）
 *  - 實打：`tests/eval/edit-intent.eval.ts` 手動打 Haiku 5.5，每案跑 N 次，量測意圖判斷準確度
 *
 * 全部是合成句，真實聽寫內容一律不進 repo（repo 是公開的）。
 */

import type { EditIntent } from "../../../src/lib/editIntent";

export interface EditIntentCase {
  id: string;
  /** instruction＝對選取文字下指令；retype＝選取的內容有誤、使用者重講正確內容 */
  kind: "instruction" | "retype";
  /** 使用者選取的文字 */
  selectedText: string;
  /** 語音辨識出的口述內容 */
  voiceInput: string;
  /** 期望的意圖 */
  expectedIntent: EditIntent;
  /** 設計這個案例想測什麼 */
  note: string;
}

export const EDIT_INTENT_CASES: EditIntentCase[] = [
  {
    id: "instruction-translate",
    kind: "instruction",
    selectedText: "我們預計下週三完成系統上線，屆時會再通知各部門。",
    voiceInput: "幫我翻成英文",
    expectedIntent: "edit",
    note: "最典型的翻譯指令",
  },
  {
    id: "instruction-tone",
    kind: "instruction",
    selectedText: "這個功能還有一些問題，請你們盡快處理一下。",
    voiceInput: "語氣改得客氣一點，不要那麼直接",
    expectedIntent: "edit",
    note: "調整語氣的改寫指令",
  },
  {
    id: "instruction-summarize",
    kind: "instruction",
    selectedText:
      "專案進度落後，原因有三個：人力不足、需求中途變更、測試時間被壓縮，預計要延後兩週。",
    voiceInput: "縮成一句話就好",
    expectedIntent: "edit",
    note: "摘要指令，輸出會明顯比選取文字短",
  },
  {
    id: "retype-meeting-time",
    kind: "retype",
    selectedText: "明天下午三點在會議室開會，請大家準時出席。",
    voiceInput: "明天下午兩點在三樓會議室開會，請大家準時出席",
    expectedIntent: "replace",
    note: "選取的是講錯的版本，重講時只改時間與地點，句型與原文高度相似",
  },
  {
    id: "retype-deadline",
    kind: "retype",
    selectedText: "這份報告麻煩你週五前交給我。",
    voiceInput: "這份報告請在下週一之前寄給我",
    expectedIntent: "replace",
    note: "整句換成另一種說法，不含任何對選取文字的要求",
  },
  {
    id: "retype-opinion",
    kind: "retype",
    selectedText: "我覺得這個方案可以先試試看。",
    voiceInput: "我覺得這個方案風險太高，還是先不要做比較好",
    expectedIntent: "replace",
    note: "意思相反的重講，口述內容含評論語氣但不是指令",
  },
];
