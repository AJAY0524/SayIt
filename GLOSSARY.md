# SayIt

按快捷鍵說話，SayIt 把語音轉成文字、經 AI 整理後貼到游標所在位置的 macOS／Windows 桌面應用。

## Language

**LLM 模型服務**：
提供文字整理與字典分析能力的服務，使用者在設定頁擇一使用；目前有 Groq、Google Gemini、OpenAI、Anthropic 與 Apple Intelligence。
_Avoid_: AI 服務商、LLM 供應商、引擎

**雲端模型服務**：
需要 API Key、把文字送到網路上第三方伺服器處理的 LLM 模型服務。
_Avoid_: 線上模型、遠端 API

**Apple Intelligence（裝置上）**：
使用 macOS 內建 Apple 模型、在本機處理文字的 LLM 模型服務；只在 Mac 上出現，不需要 API Key。
_Avoid_: Apple AI、本機 LLM、離線模式

**裝置上處理**：
文字只在使用者的 Mac 上處理、不送到任何外部伺服器；這是 Apple Intelligence 對使用者的核心承諾，失敗時也不會改用雲端模型服務。
_Avoid_: 離線處理、本地端運算

**文字整理**：
把語音轉錄結果交給 LLM 模型服務去贅詞、補標點、套用字典，再貼上的步驟；介面上的狀態為「整理中」，結果為「已整理」或「未整理」。
_Avoid_: AI 整理、潤飾、增強

**使用點**：
SayIt 會呼叫 LLM 模型服務的功能位置，共 5 個：錄音後文字整理、選取文字語音改寫、歷史紀錄重新整理、智慧字典學習、設定頁連線測試。
_Avoid_: 呼叫點、場景、功能點

**就緒狀態**：
目前選中的 LLM 模型服務此刻能否被使用；雲端模型服務看是否已填 API Key，Apple Intelligence 看系統是否回報可用。
_Avoid_: 連線狀態、API Key 狀態、健康狀態

**不可用原因**：
Apple Intelligence 未就緒時告訴使用者的具體理由，例如 Intel Mac、macOS 版本太舊、尚未開啟 Apple Intelligence、模型尚未就緒；每個原因都附使用者能採取的動作。
_Avoid_: 錯誤碼、失敗原因

**降級**：
某個使用點在特定 LLM 模型服務下只提供受限的功能（例如限制字數、不重試），並在介面上註明；不是停用該功能，也不是改用其他服務。
_Avoid_: 停用、備援、fallback

**既有失敗流程**：
LLM 呼叫失敗時 SayIt 原本就有的處理方式：錄音後整理改貼原文並提示「未整理」、選取文字改寫不貼上、歷史重新整理保留原結果、智慧字典學習靜默略過。
_Avoid_: 錯誤處理、退回雲端
