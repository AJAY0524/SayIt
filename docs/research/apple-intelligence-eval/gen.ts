import { writeFileSync, readFileSync } from "node:fs";
import { getPromptForModeAndLocale, getAutoLanguagePrompt, getEditModePromptForLocale } from "/Users/ajay0524/Documents/AJ/Tools/SayIt/src/src/i18n/prompts";
import { TRANSCRIPTS, VOCAB_ZH, EDIT_CASES, CORR_CASES } from "./data";

// Same as enhancer.ts buildSystemPrompt (copied verbatim; enhancer.ts itself imports Tauri plugins).
function buildSystemPrompt(basePrompt: string, vocab?: string[]): string {
  let prompt = basePrompt;
  if (vocab && vocab.length > 0) {
    prompt += `\n\n<vocabulary>\n${vocab.slice(0, 50).join(", ")}\n</vocabulary>`;
  }
  return prompt;
}

// vocabularyAnalyzer.ts SYSTEM_PROMPT is a non-exported const: extract from source text to stay verbatim.
const vaSrc = readFileSync("/Users/ajay0524/Documents/AJ/Tools/SayIt/src/src/lib/vocabularyAnalyzer.ts", "utf8");
const m = vaSrc.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/);
if (!m) throw new Error("analyzer prompt not found");
const ANALYZER_PROMPT = m[1];

const VOCAB_EN = ["SayIt","Tauri","Vue.js","Pinia","Laravel","Filament","Elasticsearch","MariaDB","MySQL","PHP","TypeScript","JavaScript","Rust","Swift","Whisper","Groq","Anthropic","OpenAI","Claude","Tailwind CSS","Vitest","Playwright","GitHub Actions","Docker","Nginx","Redis","PostgreSQL","SQLite","Apple Intelligence","MacBook Air","Xcode","Homebrew","Cloudflare","AWS","staging server","client demo","back end","front end","API","SDK","CI","CLI","JSON","OAuth","Kubernetes","Terraform","Datadog","Sentry","Slack","Notion"];

const cases: any[] = [];
const T = Object.fromEntries(TRANSCRIPTS.map((t) => [t.id, t]));
const RUNS = 3;

function enh(id: string, tid: string, mode: "minimal" | "active", opts: { vocab?: boolean; guard?: string; auto?: boolean; usePoint?: string } = {}) {
  const t = T[tid];
  const vocab = opts.vocab === false ? undefined : t.locale === "en" ? VOCAB_EN : VOCAB_ZH;
  const base = opts.auto ? getAutoLanguagePrompt(mode, t.locale === "en" ? "en" : "zh-TW") : getPromptForModeAndLocale(mode, t.locale === "en" ? "en" : "zh-TW");
  cases.push({
    id, usePoint: opts.usePoint ?? "1-enhance", tid, locale: t.locale, promptMode: opts.auto ? mode + "-auto" : mode,
    vocab: !!vocab, kind: "text", guardrails: opts.guard ?? "permissive",
    instructions: buildSystemPrompt(base, vocab), prompt: t.text, temperature: 0.1, maxTokens: null, runs: RUNS,
  });
}

// ⑤ first so the cold-start latency is captured on the first model call of the process.
cases.push({ id: "P1", usePoint: "5-ping", tid: "ping", locale: "en", promptMode: "ping", vocab: false, kind: "text", guardrails: "permissive",
  instructions: "Reply with the word OK only.", prompt: "ping", temperature: 0.1, maxTokens: 50, runs: 6 });

// ① enhanceText, default prompt mode (minimal), explicit zh-TW
for (const tid of ["S1","S2","S3","S4","S5","M1","M2","M3","L1"]) enh(`E-min-${tid}`, tid, "minimal");
enh("E-min-ES", "ES", "minimal"); enh("E-min-EM", "EM", "minimal");
enh("E-min-M1-novocab", "M1", "minimal", { vocab: false });
enh("E-min-M1-auto", "M1", "minimal", { auto: true });
for (const tid of ["S2","S3","M1","L1"]) enh(`E-act-${tid}`, tid, "active");
// guardrail comparison: default guardrails on the sensitive samples
for (const tid of ["S4","M3"]) enh(`E-min-${tid}-guardDefault`, tid, "minimal", { guard: "default" });
// context stress: L1 repeated 3x (and 2x)
(function () {
  const L = T["L1"].text;
  for (const [name, n] of [["XL2", 2], ["XL3", 3]] as const) {
    cases.push({ id: `E-min-${name}`, usePoint: "1-enhance-stress", tid: name, locale: "zh-TW", promptMode: "minimal", vocab: true, kind: "text", guardrails: "permissive",
      instructions: buildSystemPrompt(getPromptForModeAndLocale("minimal", "zh-TW"), VOCAB_ZH), prompt: L.repeat(n), temperature: 0.1, maxTokens: null, runs: 2 });
  }
})();
// ③ history re-enhance (same call as ①); extra history-specific samples
enh("H-min-H1", "H1", "minimal", { usePoint: "3-history" });
enh("H-min-H2", "H2", "minimal", { usePoint: "3-history" });
// ② selected-text voice rewrite
for (const e of EDIT_CASES) {
  cases.push({ id: `V-${e.id}`, usePoint: "2-edit", tid: e.id, locale: "zh-TW", promptMode: "edit", vocab: false, kind: "text", guardrails: "permissive",
    instructions: buildSystemPrompt(`${getEditModePromptForLocale("zh-TW")}\n\n<instruction>\n${e.instruction}\n</instruction>`),
    prompt: e.selected, temperature: 0.1, maxTokens: 4096, runs: RUNS });
}
// ② stress: summarize the 1500-char text
cases.push({ id: "V-E7", usePoint: "2-edit", tid: "E7", locale: "zh-TW", promptMode: "edit", vocab: false, kind: "text", guardrails: "permissive",
  instructions: buildSystemPrompt(`${getEditModePromptForLocale("zh-TW")}\n\n<instruction>\n摘要成三個重點\n</instruction>`),
  prompt: T["L1"].text, temperature: 0.1, maxTokens: 4096, runs: RUNS });
// ④ correction detection
for (const c of CORR_CASES) {
  const user = `<original>${c.original}</original>\n<corrected>${c.corrected}</corrected>`;
  cases.push({ id: `C-plain-${c.id}`, usePoint: "4-correction", tid: c.id, locale: "zh-TW", promptMode: "plain-json", vocab: false, kind: "json-plain", guardrails: "permissive",
    instructions: ANALYZER_PROMPT, prompt: user, temperature: 0, maxTokens: 256, runs: RUNS });
  cases.push({ id: `C-schema-${c.id}`, usePoint: "4-correction", tid: c.id, locale: "zh-TW", promptMode: "schema", vocab: false, kind: "json-schema", guardrails: "permissive",
    instructions: ANALYZER_PROMPT, prompt: user, temperature: 0, maxTokens: 256, runs: RUNS });
}
writeFileSync("cases.json", JSON.stringify(cases, null, 1));
writeFileSync("meta.json", JSON.stringify({ transcripts: TRANSCRIPTS, edit: EDIT_CASES, corr: CORR_CASES, vocabZh: VOCAB_ZH, analyzerPrompt: ANALYZER_PROMPT }, null, 1));
console.log("cases:", cases.length, "calls:", cases.reduce((a, c) => a + c.runs, 0));
for (const t of TRANSCRIPTS) console.log(t.id, [...t.text].length);
console.log("sysprompt zh min chars", getPromptForModeAndLocale("minimal","zh-TW").length, "active", getPromptForModeAndLocale("active","zh-TW").length);
