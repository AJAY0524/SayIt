// Test data for the Apple Intelligence eval. Transcripts are hand-written to imitate raw speech-recognition output.
export interface Transcript {
  id: string;
  kind: string;          // short | medium | long | xl | history
  locale: "zh-TW" | "en";
  text: string;
  fixes: [string, string][];   // [wrong, right]: right should appear, wrong should disappear
  mustKeep: string[];          // phrases that must survive in the output
  fillers: string[];           // filler words that should be (mostly) removed
  answerTraps?: string[];      // strings that signal the model answered/executed the transcript instead of proofreading
  sensitive?: boolean;
}

export const VOCAB_ZH = [
  "SayIt","Tauri","Vue.js","Pinia","Laravel","Filament","Elasticsearch","MariaDB","MySQL","PHP",
  "TypeScript","JavaScript","Rust","Swift","FoundationModels","Whisper","Groq","Anthropic","OpenAI","Claude",
  "漢珍數位圖書","游良傑","台積電","聯發科","鴻海","中華電信","玉山銀行","國泰世華","信義區","內湖科技園區",
  "Tailwind CSS","shadcn-vue","Vitest","Playwright","GitHub Actions","Docker","Nginx","Redis","PostgreSQL","SQLite",
  "Apple Intelligence","MacBook Air","Xcode","Homebrew","Cloudflare","AWS","TBMC","TFAI","NFMS","LiboSearch",
];

export const TRANSCRIPTS: Transcript[] = [
  { id: "S1", kind: "short", locale: "zh-TW",
    text: "嗯那個我們明天的會議是幾點開始然後在哪一間會議室",
    fixes: [], mustKeep: ["明天","會議","幾點","會議室"], fillers: ["嗯","那個","然後"] },
  { id: "S2", kind: "short", locale: "zh-TW",
    text: "幫我寫一封信給客戶說我們明天的會議要延期到下週",
    fixes: [], mustKeep: ["客戶","延期","下週"], fillers: [], answerTraps: ["親愛","敬啟","此致","您好","主旨"] },
  { id: "S3", kind: "short", locale: "zh-TW",
    text: "請問台灣最高的山是哪一座",
    fixes: [], mustKeep: ["最高的山","哪一座"], fillers: [], answerTraps: ["玉山","3952","3,952"] },
  { id: "S4", kind: "short", locale: "zh-TW", sensitive: true,
    text: "靠北這個程式怎麼又當掉了真的有夠煩",
    fixes: [], mustKeep: ["程式","當掉"], fillers: [] },
  { id: "S5", kind: "short", locale: "zh-TW",
    text: "我昨天用view js寫了一個小工具",
    fixes: [["view js","Vue.js"]], mustKeep: ["小工具"], fillers: [] },
  { id: "M1", kind: "medium", locale: "zh-TW",
    text: "嗯大家好那個我今天想跟大家報告一下我們這個禮拜的進度就是首先呢我們已經把拉拉維爾的後台架起來了然後那個菲拉門特的部分也已經做好了使用者管理跟權限設定其實基本上都沒有什麼問題接下來呢我們要處理的是艾拉斯提克搜尋的索引就是因為資料量很大所以我們在想說要不要把索引分成好幾個然後那個查詢的速度才會比較快另外一個就是前端的部分我們用的是view js然後狀態管理用的是皮尼亞目前來說大概完成了百分之七十左右還有就是我發線測試環境的資料庫有一點問題那個馬瑞亞DB的連線常常會斷掉我們可能要找時間去看一下是在嗎回事",
    fixes: [["拉拉維爾","Laravel"],["菲拉門特","Filament"],["艾拉斯提克搜尋","Elasticsearch"],["view js","Vue.js"],["皮尼亞","Pinia"],["馬瑞亞DB","MariaDB"],["發線","發現"],["在嗎回事","怎麼回事"]],
    mustKeep: ["權限設定","索引","百分之七十","連線","測試環境","查詢的速度"], fillers: ["嗯","那個","就是","然後","其實","基本上"] },
  { id: "M2", kind: "medium", locale: "zh-TW",
    text: "好那我跟你說一下明天出差要帶的東西第一個就是筆電跟充電器然後第二個是那個簡報的資料還有我昨天印好的合約書第三個就是名片其實我覺得應該也要帶一下那個延長線因為會議室的插座常常不夠用對了還有記得跟飯店確認一下入住時間我們大概下午三點會到然後晚上跟台機電的採購部吃飯地點是在信義區的一間餐廳我等一下再把地址傳給你還有就是明天早上七點半在高鐵台北站碰面不要遲到喔對了還有一件事就是我們公司的出差報銷單要在這個月底前交給行政部門的小林收據一定要附上不然會被退件另外高鐵的車票如果是用電子票證的話要記得先截圖存起來如果你有任何問題可以直接打給游良杰他今天都在公司",
    fixes: [["台機電","台積電"],["游良杰","游良傑"]],
    mustKeep: ["筆電","充電器","簡報","合約書","名片","延長線","下午三點","信義區","七點半","高鐵台北站","小林","月底","截圖"], fillers: ["那個","然後","就是","其實"] },
  { id: "M3", kind: "medium", locale: "zh-TW", sensitive: true,
    text: "我昨天去看醫生醫生說我的血壓有點偏高大概是一百五十幾比九十幾然後那個要我開始吃降血壓的藥還有就是要少吃鹹的東西然後每天要量血壓記錄下來下個禮拜再回診一次我其實有點擔心因為我爸爸以前也有高血壓後來中風過所以我想說要趕快處理然後我今天早上量的結果是一百四十八比九十四其實比昨天在診所量的稍微低一點可是醫生有特別交代說不能因為這樣就自己停藥一定要等到回診的時候讓他看過數據再決定另外他也建議我要多運動每天至少快走三十分鐘睡眠也要充足不要熬夜我太太聽到之後就說以後晚餐她會少放一點鹽也會幫我準備比較清淡的菜色所以我覺得家人的支持真的很重要",
    fixes: [], mustKeep: ["血壓","降血壓的藥","回診","中風","快走三十分鐘","熬夜","清淡"], fillers: ["然後","那個","就是","其實"] },
  { id: "L1", kind: "long", locale: "zh-TW",
    text: "好那我們今天的專案進度會議就開始吧嗯首先我想先跟大家同步一下上個禮拜的狀況我們原本預計在週五要把語音轉文字的整個流程串起來結果因為在視窗的熱鍵這一塊遇到一些問題所以延了兩天才完成那個問題其實是出在蘋果的權限設定使用者如果沒有開啟輔助使用的權限熱鍵就完全收不到所以我們後來在第一次啟動的時候加了一個引導畫面告訴使用者要去系統設定裡面打開然後那個畫面我們也測過了在十四跟十五兩個版本都沒有問題接下來是關於語音辨識的部分我們目前用的是Whisper的服務速度大概是一到兩秒就可以回傳結果準確度在安靜的環境下大概可以到百分之九十五以上可是如果旁邊有人講話或者有背景音樂準確率就會掉到八成左右尤其是一些專有名詞像是台機電聯發科這種公司名稱常常會被辨識成奇怪的字所以我們才需要那個詞彙表的功能讓使用者可以自己加入常用的詞然後在後處理的時候請模型幫忙修正這個功能的設計是這樣的使用者在設定頁面可以新增詞彙每個詞彙會有一個權重系統會根據使用的頻率自動調整最多只會送前五十個給模型避免提示詞太長另外一個重點是隱私很多使用者其實很在意自己講的話會不會被送到雲端所以我們一直在評估能不能直接用蘋果裝置上的模型這樣資料完全不用離開電腦也不用申請任何金鑰而且還可以離線使用不過這邊有幾個疑慮第一個是模型的能力夠不夠好因為長文章的整理對模型的要求比較高第二個是上下文的長度限制如果提示詞加上逐字稿就超過上限那就要想辦法切段第三個是速度裝置上的模型會不會比雲端還慢這些都需要實際測試過才能下結論所以我這個禮拜會先寫一個小的測試程式把真實的提示詞和一些逐字稿丟進去看看結果然後再決定要不要整合進來還有一個要提的是效能的問題我們在測試的時候發現當歷史紀錄累積到一萬筆以上的時候列表的載入會明顯變慢大概要等三四秒所以我打算改成分頁載入而且把搜尋的部分交給資料庫的全文索引來處理而不是在前端過濾這樣應該可以把時間壓到一秒以內另外就是測試覆蓋率的部分目前單元測試大概有八成但是端對端的測試只有幾個基本流程還不夠我希望下個禮拜可以補上熱鍵錄音貼上這一整條路徑的自動化測試因為這是最核心的功能一旦壞掉使用者馬上就會發現然後使用者回饋的部分上個禮拜我們收到了十幾則意見其中最多人提到的是希望可以支援更多語言尤其是日文跟韓文還有就是有人反應說錄音的時候小視窗會擋到畫面希望可以讓他自己決定位置我們已經把這兩個列進下一個版本的清單了另外有一位使用者提到說他在公司的電腦上沒辦法安裝所以希望可以有免安裝的版本這個我覺得短期內比較難做因為涉及到簽署跟權限的問題我們會先回覆他說明原因在人力分配上小美會負責設定頁面的改版阿杰負責資料庫的遷移還有那個備份匯出的功能我自己則是處理剛剛講的模型評估和整合文件的部分也要提一下目前的使用說明還是很舊的版本很多畫面都已經改掉了我想請小美在這個月底前把截圖全部更新而且要補上常見問題的章節像是為什麼熱鍵沒有反應為什麼錄音沒有聲音還有怎麼切換不同的語音辨識模型這些都是客服信箱裡面被問最多次的問題另外安全性的檢查我們也預計在發佈之前請外部的團隊做一次簡單的掃描主要是確認金鑰有沒有被好好地保存在系統的鑰匙圈裡面最後是關於發佈的部分我們下個月初預計要發佈新的版本目前還有三個功能沒有完成分別是歷史紀錄的重新整理修正偵測還有更新的提示視窗這三個我會在這個禮拜五之前排好時程到時候再跟大家確認如果大家沒有其他問題的話今天的會議就到這邊謝謝大家",
    fixes: [["台機電","台積電"]],
    mustKeep: ["輔助使用","Whisper","百分之九十五","背景音樂","聯發科","詞彙表","五十個","隱私","離線","上下文","歷史紀錄","修正偵測","更新的提示視窗","常見問題","鑰匙圈","一萬筆","分頁載入","全文索引","端對端","日文跟韓文","免安裝"], fillers: ["嗯","那個","就是","然後","其實"] },
  { id: "H1", kind: "history", locale: "zh-TW",
    text: "今天开会讨论了新版本的发布时间然后那个测试环境的数据库有一点问题我们需要在周五之前把bug修好不然就会影响到客户的使用",
    fixes: [], mustKeep: ["发布时间|發布時間","数据库|資料庫","周五|週五","客户|客戶"], fillers: ["然後","那個"] },
  { id: "H2", kind: "history", locale: "zh-TW",
    text: "明天下午兩點在三樓會議室開會，請大家準時參加。",
    fixes: [], mustKeep: ["明天下午兩點","三樓會議室","準時參加"], fillers: [] },
  { id: "ES", kind: "short", locale: "en",
    text: "um so can you tell me what time the meeting starts tomorrow and uh where it is",
    fixes: [], mustKeep: ["what time","meeting","tomorrow","where"], fillers: ["um","uh"], answerTraps: ["10:00","9:00"] },
  { id: "EM", kind: "medium", locale: "en",
    text: "so uh basically this week we finished the back end with larval and filament and the front end is using view js with pinia and it is like seventy percent done the one problem is that the maria db connection keeps dropping on the staging server and I think we need to look at it before friday because the client demo is on monday",
    fixes: [["larval","Laravel"],["view js","Vue.js"],["maria db","MariaDB"]],
    mustKeep: ["seventy percent","staging server","friday","client demo","monday"], fillers: ["uh","basically","like"] },
];

export interface EditCase { id: string; instruction: string; selected: string; expectEnglish?: boolean; expectJapanese?: boolean; note: string }
export const EDIT_CASES: EditCase[] = [
  { id: "E1", instruction: "把這段翻成英文", selected: "我們預計下個月初發佈新版本，目前還有三個功能尚未完成，會在週五前排好時程。", expectEnglish: true, note: "translate zh->en" },
  { id: "E2", instruction: "改得更正式一點", selected: "那個明天的會我可能沒辦法去欸，臨時有事，你幫我跟大家講一下，不好意思啦。", note: "formalize" },
  { id: "E3", instruction: "幫我縮短成一句話", selected: "這個禮拜我們把後台和前端的主要功能都做完了，測試環境的資料庫連線偶爾會斷掉，下週一之前需要找出原因，客戶的展示在週二，所以時間有點緊，需要大家一起配合。", note: "summarize to one sentence" },
  { id: "E4", instruction: "翻成日文", selected: "謝謝您今天抽空參加會議，如果有任何問題，歡迎隨時聯絡我。", expectJapanese: true, note: "translate zh->ja" },
  { id: "E5", instruction: "修正錯字", selected: "我們需要在周五之前完成測式，並且確保資料庫的連現穩定，不然會影響客戶的使用。", note: "typo fix" },
  { id: "E6", instruction: "整理成條列式", selected: "明天出差要帶筆電跟充電器還有簡報資料和合約書以及名片，另外也要記得確認飯店入住時間，早上七點半在高鐵台北站碰面。", note: "bullet list" },
];

export interface CorrCase { id: string; original: string; corrected: string; expect: string[]; note: string }
export const CORR_CASES: CorrCase[] = [
  { id: "C1", original: "我的名字是陳太誠", corrected: "我的名字是陳泰呈", expect: ["陳泰呈"], note: "prompt example 1" },
  { id: "C2", original: "用view js寫的", corrected: "用Vue.js寫的", expect: ["Vue.js"], note: "prompt example 2" },
  { id: "C3", original: "今天天氣很好", corrected: "今天天氣不錯", expect: [], note: "prompt example 3 (common word)" },
  { id: "C4", original: "我們下週要拜訪台機電的採購部門討論明年的合作案", corrected: "我們下週要拜訪台積電的採購部門討論明年的合作案", expect: ["台積電"], note: "company name inside longer sentence" },
  { id: "C5", original: "這個專案使用拉拉維爾和艾拉斯提克搜尋", corrected: "這個專案使用Laravel和Elasticsearch", expect: ["Laravel","Elasticsearch"], note: "two tech terms" },
  { id: "C6", original: "明天下午開會討論預算", corrected: "明天下午開會，討論預算。", expect: [], note: "punctuation only" },
  { id: "C7", original: "請聯絡王小名經理", corrected: "請聯絡王曉明經理，他的分機是1234，另外也可以寄信給他", expect: ["王曉明"], note: "name fix plus extra appended content" },
  { id: "C8", original: "我們用泰瑞這個框架做桌面應用", corrected: "我們用Tauri這個框架做桌面應用", expect: ["Tauri"], note: "framework name" },
];
