import { readFileSync, writeFileSync } from "node:fs";
import { detectEnhancementAnomaly, detectSemanticDrift } from "/Users/ajay0524/Documents/AJ/Tools/SayIt/src/src/lib/hallucinationDetector";
import { convertSimplifiedToTraditional } from "/Users/ajay0524/Documents/AJ/Tools/SayIt/src/src/lib/simplifiedToTraditional";
import { TRANSCRIPTS, EDIT_CASES, CORR_CASES } from "./data";

const rows: any[] = readFileSync(process.argv[2] ?? "results.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const T: Record<string, any> = Object.fromEntries(TRANSCRIPTS.map((t) => [t.id, t]));
const L1 = T["L1"].text;
const has = (out: string, alt: string) => alt.split("|").some((a) => out.includes(a));

// ported verbatim from vocabularyAnalyzer.ts
function isTermTooShort(term: string) {
  const trimmed = term.trim();
  const c = (trimmed.match(/[一-鿿]/g) ?? []).length;
  if (c > 0) return c < 2;
  return trimmed.length < 2;
}
const validTerm = (i: unknown): i is string => typeof i === "string" && i.trim().length > 0 && !isTermTooShort(i);
function parseTerms(content: string): { terms: string[]; parsedClean: boolean } {
  try {
    const p = JSON.parse(content.trim());
    if (Array.isArray(p)) return { terms: p.filter(validTerm), parsedClean: true };
  } catch {
    const m = content.match(/\[[\s\S]*?\]/);
    if (m) { try { const p = JSON.parse(m[0]); if (Array.isArray(p)) return { terms: p.filter(validTerm), parsedClean: false }; } catch {} }
  }
  return { terms: [], parsedClean: false };
}

const PREAMBLE = /^(好的|當然|以下|這是|校對後|處理後|已為您|Here is|Sure|Certainly|Proofread|以下是)/;

for (const r of rows) {
  r.eval = {};
  if (!r.ok) continue;
  let out: string = r.output;
  if (r.kind === "json-text-schema") { try { r.outputRaw = r.output; out = JSON.parse(r.output).text ?? ""; r.output = out; } catch { r.eval.badJson = true; } }
  const e = r.eval;
  const trimmed = out.trim();
  e.chars = [...trimmed].length;
  e.preamble = PREAMBLE.test(trimmed);
  e.hasMarkdown = /(\*\*|^#{1,6}\s|```)/m.test(trimmed);
  const simp = convertSimplifiedToTraditional(trimmed);
  const FP = new Set(["台","游","只","裡","里","著","后","麵","麽"]); // OpenCC cn->tw false positives (legit Traditional chars)
  e.simplifiedChars = [...trimmed].filter((ch, i) => ch !== [...simp][i] && !FP.has(ch)).length;

  if (r.usePoint.startsWith("1-") || r.usePoint === "3-history") {
    const t = T[r.tid] ?? { text: r.tid.startsWith("XL") ? L1.repeat(Number(r.tid[2])) : "", fixes: [], mustKeep: [], fillers: [] };
    const raw = t.text;
    e.rawChars = [...raw].length;
    e.lengthRatio = +(e.chars / e.rawChars).toFixed(2);
    e.anomaly = detectEnhancementAnomaly({ rawText: raw, enhancedText: out }).isAnomaly;
    const d = detectSemanticDrift(raw, out);
    e.drift = d.isDrift; e.overlap = +d.overlapRatio.toFixed(3);
    e.missingKeep = (t.mustKeep ?? []).filter((k: string) => !has(out, k));
    e.fixesTotal = (t.fixes ?? []).length;
    e.fixesOk = (t.fixes ?? []).filter(([w, rt]: string[]) => out.includes(rt) && !out.includes(w)).length;
    e.fixesMissed = (t.fixes ?? []).filter(([w, rt]: string[]) => !out.includes(rt)).map(([w, rt]: string[]) => `${w}->${rt}`);
    e.fillerRemain = (t.fillers ?? []).reduce((n: number, f: string) => n + (out.split(f).length - 1), 0);
    e.fillerRaw = (t.fillers ?? []).reduce((n: number, f: string) => n + (raw.split(f).length - 1), 0);
    e.trap = (t.answerTraps ?? []).filter((x: string) => out.includes(x));
    e.endsPeriod = /[。.]$/.test(trimmed);
    e.halfPunct = t.locale === "zh-TW" ? (trimmed.match(/[,?!;:](?=\S|$)/g) ?? []).length : 0;
    e.translated = t.locale === "zh-TW" && !/[一-鿿]/.test(trimmed);
    e.lines = trimmed.split("\n").length;
  }
  if (r.usePoint === "2-edit") {
    const c = EDIT_CASES.find((x) => x.id === r.tid);
    const sel = c ? c.selected : L1;
    e.selChars = [...sel].length; e.lengthRatio = +(e.chars / e.selChars).toFixed(2);
    if (r.tid === "E1") e.check = /[A-Za-z]{3,}/.test(trimmed) && !/[一-鿿]/.test(trimmed) ? "pass: pure English" : "FAIL";
    if (r.tid === "E4") e.check = /[぀-ヿ]/.test(trimmed) ? "pass: has kana" : "FAIL: no kana";
    if (r.tid === "E5") e.check = trimmed.includes("測試") && trimmed.includes("連線") && !trimmed.includes("測式") && !trimmed.includes("連現") ? "pass" : "FAIL: " + ["測試","連線"].filter(x=>!trimmed.includes(x)).join(",");
    if (r.tid === "E3") e.check = (trimmed.match(/[。！？.!?]/g) ?? []).length <= 1 && !trimmed.includes("\n") ? "pass: one sentence" : "FAIL: multi";
    if (r.tid === "E6") e.check = /(^|\n)\s*(-|\d\.|•|\*)\s/.test(trimmed) ? "pass: list" : "FAIL: no list";
    if (r.tid === "E7") e.check = (trimmed.match(/(^|\n)\s*(-|\d\.|•|\*)\s/g) ?? []).length === 3 ? "pass: 3 points" : `n=${(trimmed.match(/(^|\n)\s*(-|\d\.|•|\*)\s/g) ?? []).length} points`;
    if (r.tid === "E2") e.check = "manual";
    if (r.tid !== "E1" && r.tid !== "E4") e.simplifiedChars = e.simplifiedChars;
  }
  if (r.usePoint === "4-correction") {
    const c = CORR_CASES.find((x) => x.id === r.tid)!;
    let terms: string[] = [], clean = true;
    if (r.kind === "json-schema") {
      try { terms = (JSON.parse(out).terms ?? []).filter(validTerm); } catch { clean = false; }
    } else { const p = parseTerms(out); terms = p.terms; clean = p.parsedClean; }
    e.terms = terms; e.cleanJson = clean;
    e.expected = c.expect;
    e.missing = c.expect.filter((x) => !terms.includes(x));
    e.extra = terms.filter((x) => !c.expect.includes(x));
    e.exact = e.missing.length === 0 && e.extra.length === 0;
  }
  if (r.usePoint === "5-ping") e.check = trimmed === "OK" ? "exact OK" : /ok/i.test(trimmed) ? "contains OK" : "FAIL";
}
writeFileSync("analysis.json", JSON.stringify(rows, null, 1));

// ---- summary ----
const groups = new Map<string, any[]>();
for (const r of rows) { const k = r.id; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const f = (n: number, d = 0) => Number.isFinite(n) ? n.toFixed(d) : "-";
const lines: string[] = [];
for (const [id, g] of groups) {
  const ok = g.filter((r) => r.ok);
  const errs = g.filter((r) => !r.ok).map((r) => r.errorKind);
  const lat = ok.map((r) => r.latencyMs);
  const ev = ok.map((r) => r.eval);
  const bits: string[] = [];
  bits.push(`n=${g.length} ok=${ok.length}${errs.length ? " err=" + errs.join("/") : ""}`);
  bits.push(`lat avg=${f(avg(lat))} min=${f(Math.min(...lat))} max=${f(Math.max(...lat))}ms`);
  bits.push(`tok instr=${g[0].instrTokens} prompt=${g[0].promptTokens}${g[0].schemaTokens > 0 ? " schema=" + g[0].schemaTokens : ""} usageIn=${f(avg(ok.map((r) => r.usageIn)))} usageOut=${f(avg(ok.map((r) => r.usageOut)))}`);
  if (ev[0]?.lengthRatio !== undefined) bits.push(`ratio=${ev.map((x) => x.lengthRatio).join("/")}`);
  if (ev[0]?.fixesTotal) bits.push(`fixes=${ev.map((x) => x.fixesOk + "/" + x.fixesTotal).join(",")}`);
  if (ev[0]?.missingKeep && ev.some((x) => x.missingKeep.length)) bits.push(`missingKeep=${JSON.stringify(ev.map((x) => x.missingKeep))}`);
  if (ev[0]?.fillerRaw) bits.push(`filler ${ev[0].fillerRaw}->${ev.map((x) => x.fillerRemain).join("/")}`);
  if (ev.some((x) => x.trap?.length)) bits.push(`TRAP=${JSON.stringify(ev.map((x) => x.trap))}`);
  if (ev.some((x) => x.anomaly)) bits.push(`ANOMALY x${ev.filter((x) => x.anomaly).length}`);
  if (ev.some((x) => x.drift)) bits.push(`DRIFT x${ev.filter((x) => x.drift).length}`);
  if (ev[0]?.overlap !== undefined) bits.push(`overlap=${ev.map((x) => x.overlap).join("/")}`);
  if (ev.some((x) => x.simplifiedChars)) bits.push(`simp=${ev.map((x) => x.simplifiedChars).join("/")}`);
  if (ev.some((x) => x.preamble)) bits.push(`PREAMBLE x${ev.filter((x) => x.preamble).length}`);
  if (ev.some((x) => x.endsPeriod)) bits.push(`endsPeriod x${ev.filter((x) => x.endsPeriod).length}`);
  if (ev.some((x) => x.halfPunct)) bits.push(`halfPunct=${ev.map((x) => x.halfPunct).join("/")}`);
  if (ev.some((x) => x.hasMarkdown)) bits.push(`MD x${ev.filter((x) => x.hasMarkdown).length}`);
  if (ev[0]?.check) bits.push(`check=${ev.map((x) => x.check).join(" | ")}`);
  if (ev[0]?.exact !== undefined) bits.push(`exact=${ev.filter((x) => x.exact).length}/${ev.length} cleanJson=${ev.filter((x) => x.cleanJson).length}/${ev.length} terms=${JSON.stringify(ev.map((x) => x.terms))}`);
  lines.push(`${id}: ${bits.join("; ")}`);
}
writeFileSync("summary.txt", lines.join("\n"));
console.log(lines.join("\n"));
