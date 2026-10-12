/* 一分鐘獨白: speak alone on a prompt three times (each round shorter), then compare the rounds.
   The audio is recorded in the browser and sent to Gemini once per round for a transcript and the key mistakes. */
"use strict";

const MONO_ROUNDS = window.__MONO_ROUNDS || [60, 45, 30];
const MONO_PREP = window.__MONO_PREP === undefined ? 15 : window.__MONO_PREP;

const Mono = {
  all() { try { return JSON.parse(localStorage.getItem("desk_mono") || "[]"); } catch (e) { return []; } },
  add(s) { try { const l = this.all(); l.unshift(s); localStorage.setItem("desk_mono", JSON.stringify(l.slice(0, 30))); } catch (e) {} },
  clear() { try { localStorage.removeItem("desk_mono"); } catch (e) {} }
};

let M = null;            // the session in progress
let monoPrompt = null;   // the prompt on screen
let monoBox = null;      // where the page paints itself

function monoDraw() {
  const pick = Bag.next("mono", MONO_PROMPTS.map((_, i) => String(i)));
  return MONO_PROMPTS[parseInt(pick, 10)] || MONO_PROMPTS[0];
}

/** Called when leaving the page: stop recording and save what was finished. */
function monoFlush() {
  if (!M) return;
  clearInterval(M.timer);
  if (M.rec) { try { M.rec.stop(); } catch (e) {} M.rec = null; }
  const s = M;
  M = null;
  const done = s.results.filter(r => r && !r.failed && !r.empty);
  if (done.length) {
    const total = s.results.reduce((a, r) => a + (r ? r.sec : 0), 0);
    try { if (total >= 10) Stats.add(Math.round(total), s.ts, "獨白練習", "一分鐘獨白", P.level); } catch (e) {}
    Mono.add({ ts: s.ts, prompt: s.prompt.en, rounds: done.map(r => ({ sec: r.sec, words: r.words, wpm: r.wpm, share: r.share, pauses: r.pauses, fillers: r.fillers, fixes: r.errors.length })) });
  }
}

function buildMono(root) {
  M = null;
  if (!monoPrompt) monoPrompt = monoDraw();
  root.appendChild(h("div", { class: "pagehead" }, h("h1", { text: "一分鐘獨白" }), h("span", { class: "sub", text: "自己對著麥克風說，同一題連說三次，一次比一次短" })));
  monoBox = h("div", { id: "monobox" });
  root.appendChild(monoBox);
  paintMono();
}

function monoPromptCard() {
  return h("div", { class: "monoq" }, h("div", { class: "en", text: monoPrompt.en }), h("div", { class: "zh", text: monoPrompt.zh }));
}

function paintMono() {
  if (!monoBox) return;
  const phase = M ? M.phase : "idle";
  const kids = [];
  if (phase === "idle") {
    kids.push(card("怎麼練", h("div", { class: "sub", style: "line-height:1.8", text:
      "1. 先想 " + MONO_PREP + " 秒（可以跳過）。\n2. 對著麥克風說 " + MONO_ROUNDS[0] + " 秒，說不下去也盡量不要停。\n3. 同一題再說 " + MONO_ROUNDS.slice(1).join(" 秒、") + " 秒：時間變短，逼自己說得更順。\n每一輪結束後，會看到你說了什麼、說得多順、哪些地方可以更好。" })));
    kids.push(card("今天的題目", monoPromptCard(), gap(10),
      h("div", { class: "row" },
        h("div", { class: "grow" }, h("button", { class: "btn gold", id: "monostart", text: "開始第 1 輪", on: { click: monoBegin } })),
        h("div", { class: "grow" }, h("button", { class: "btn outline", id: "monoswap", text: "換一題", on: { click: () => { monoPrompt = monoDraw(); paintMono(); } } })))));
    const hist = Mono.all().slice(0, 5);
    if (hist.length) kids.push(card("最近的獨白練習", h("div", {}, hist.map(s => h("div", { class: "hist" },
      h("div", { text: s.prompt }),
      h("div", { class: "s", text: fmtDate(s.ts) + "　每分鐘字數：" + s.rounds.map(r => r.wpm).join(" → ") }))))));
    if (!P.key) kids.unshift(h("div", { class: "card warn" }, h("div", { class: "sub", text: "需要先到「系統」頁貼上 Gemini 金鑰，才能分析你說的內容。" })));
  } else if (phase === "prep") {
    kids.push(card("第 " + (M.round + 1) + " 輪　準備", monoPromptCard(), gap(10),
      h("div", { class: "monotime", id: "monotime", text: String(M.prepLeft) }),
      h("div", { class: "sub", style: "text-align:center", text: "想想要說哪幾件事，時間到會自動開始錄音" }), gap(10),
      h("button", { class: "btn gold", id: "monogo", text: "不用準備，現在開始", on: { click: () => monoRecord() } })));
  } else if (phase === "rec") {
    kids.push(card("第 " + (M.round + 1) + " 輪　錄音中（" + MONO_ROUNDS[M.round] + " 秒）", monoPromptCard(), gap(10),
      h("div", { class: "monotime rec", id: "monotime", text: mmss(MONO_ROUNDS[M.round]) }),
      h("div", { class: "monometer" }, h("div", { class: "fill", id: "monolevel" })), gap(10),
      h("button", { class: "btn outline", id: "monostop", text: "說完了（提前結束）", on: { click: () => monoStop() } })));
  } else if (phase === "analyzing") {
    kids.push(card("第 " + (M.round + 1) + " 輪", h("div", { class: "empty", style: "padding:30px 0", text: "正在分析你說的內容…" })));
  } else if (phase === "result") {
    const r = M.results[M.round];
    const last = M.round >= MONO_ROUNDS.length - 1;
    kids.push(monoResultCard(r, M.round));
    const acts = [];
    if (r.failed) acts.push(h("div", { class: "grow" }, h("button", { class: "btn gold", id: "monoretry", text: "重新分析", on: { click: monoAnalyze } })));
    acts.push(h("div", { class: "grow" }, h("button", { class: "btn gold", id: "mononext", text: last ? "看三輪比較" : "第 " + (M.round + 2) + " 輪（" + MONO_ROUNDS[M.round + 1] + " 秒）", on: { click: () => { if (last) { M.phase = "done"; monoSave(); paintMono(); } else { M.round++; monoRecord(); } } } })));
    kids.push(h("div", { class: "row", style: "margin-top:12px" }, acts));
  } else if (phase === "done") {
    kids.push(monoSummaryCard());
    kids.push(h("div", { class: "row", style: "margin-top:12px" },
      h("div", { class: "grow" }, h("button", { class: "btn gold", id: "monoagain", text: "同一題再來一次", on: { click: () => { monoFlush(); M = null; monoBegin(); } } })),
      h("div", { class: "grow" }, h("button", { class: "btn outline", id: "mononew", text: "換一題", on: { click: () => { monoFlush(); monoPrompt = monoDraw(); paintMono(); } } }))));
  }
  monoBox.replaceChildren(...kids);
}

function monoBegin() {
  if (!P.key) { toast("還沒有 Gemini 金鑰，請先到「系統」頁設定"); go("system"); return; }
  M = { ts: Date.now(), prompt: monoPrompt, round: 0, results: [], phase: "prep", prepLeft: MONO_PREP, rec: null, timer: null, keys: new Set() };
  if (MONO_PREP <= 0) { monoRecord(); return; }
  paintMono();
  M.timer = setInterval(monoTick, 250);
  M.prepEnd = Date.now() + MONO_PREP * 1000;
}

async function monoRecord() {
  if (!M) return;
  clearInterval(M.timer);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
  catch (e) { toast("沒有麥克風權限，或麥克風被佔用"); monoFlush(); paintMono(); return; }
  if (!M) { stream.getTracks().forEach(t => t.stop()); return; }
  const rec = new MonoRecorder(stream, ensureAC());
  try { await rec.start(); } catch (e) { stream.getTracks().forEach(t => t.stop()); toast("無法開始錄音：" + (e.message || e)); monoFlush(); paintMono(); return; }
  M.rec = rec; M.phase = "rec"; M.recStart = Date.now();
  paintMono();
  M.timer = setInterval(monoTick, 150);
}

function monoTick() {
  if (!M) return;
  const now = Date.now();
  if (M.phase === "prep") {
    const left = Math.max(0, Math.ceil((M.prepEnd - now) / 1000));
    const el = $("monotime"); if (el) el.textContent = String(left);
    if (left <= 0) monoRecord();
  } else if (M.phase === "rec") {
    const limit = MONO_ROUNDS[M.round], left = Math.max(0, limit - (now - M.recStart) / 1000);
    const el = $("monotime"); if (el) el.textContent = mmss(Math.ceil(left));
    const lv = $("monolevel"); if (lv && M.rec) lv.style.width = Math.min(100, Math.round(M.rec.level * 400)) + "%";
    if (left <= 0) monoStop();
  }
}

function monoStop() {
  if (!M || M.phase !== "rec" || !M.rec) return;
  clearInterval(M.timer);
  M.cur = M.rec.stop();
  M.rec = null;
  monoAnalyze();
}

const EMPTY_WORDS = /^(um+|uh+|er+|erm|hmm+|mm+)$/i;

async function monoAnalyze() {
  const s = M;
  if (!s) return;
  const cur = s.cur, round = s.round;
  const st = cur.meter.stats(0, 1);
  const base = { sec: Math.round(cur.seconds), speechSec: st.speechSec, share: cur.seconds > 0 ? Math.round(st.speechSec / cur.seconds * 100) : 0, pauses: st.pauses, longest: st.longest };
  if (st.speechSec < 3) {
    s.results[round] = Object.assign(base, { empty: true, words: 0, wpm: 0, fillers: 0, errors: [], transcript: "" });
    s.phase = "result"; paintMono(); return;
  }
  s.phase = "analyzing"; paintMono();
  try {
    const prompt = DESK_MONO_PROMPT.replace("SECONDS", String(Math.round(cur.seconds))).replace("TOPIC", s.prompt.en);
    const o = parseJson(await geminiGenerateParts(P.key, MODELS, [{ text: prompt }, { inlineData: { mimeType: "audio/wav", data: pcm16ToWavBase64(cur.chunks) } }], true));
    const transcript = String(o.transcript || "").trim();
    const toks = transcript.split(/\s+/).filter(w => /[A-Za-z]/.test(w) && !/^\[/.test(w) && !EMPTY_WORDS.test(w.replace(/[^A-Za-z]/g, "")));
    const words = toks.length;
    const mine = normText(transcript);
    const errors = [];
    for (const x of (Array.isArray(o.errors) ? o.errors : [])) {
      if (!x || !x.said || !x.better) continue;
      const said = normText(x.said);
      if (said.length < 3 || !mine.includes(said) || said === normText(x.better)) continue;
      errors.push({ said: String(x.said).trim(), better: String(x.better).trim(), why: String(x.why || "").trim(), sev: Number(x.sev) >= 3 ? 3 : 2 });
    }
    errors.sort((a, b) => b.sev - a.sev);
    const fillers = Math.max(0, Math.min(99, Math.round(Number(o.fillers) || (transcript.match(/\b(um+|uh+|er+|erm|hmm+)\b/gi) || []).length)));
    const fresh = errors.slice(0, 5).filter(x => { const k = Errs.key(x.better); if (!k || s.keys.has(k)) return false; s.keys.add(k); return true; });
    if (fresh.length) Errs.addMany(fresh.map((x, i) => Object.assign({ id: s.ts + "-m" + round + "-" + i, ts: Date.now(), persona: "獨白練習", topic: s.prompt.en.slice(0, 24), done: false }, x)));
    s.results[round] = Object.assign(base, { words, wpm: cur.seconds >= 5 ? Math.round(words / (cur.seconds / 60)) : 0, fillers, errors: errors.slice(0, 5), transcript, praise: String(o.praise || ""), tip: String(o.tip || "") });
  } catch (e) {
    s.results[round] = Object.assign(base, { failed: true, msg: ((e && e.message) || String(e)).slice(0, 160), words: 0, wpm: 0, fillers: 0, errors: [], transcript: "" });
  }
  if (M === s) { s.phase = "result"; paintMono(); }
}

function monoSave() {
  // stats and history are saved when the session is flushed (new round / leaving the page)
}

function kv(label, value) { return h("div", { class: "kv" }, h("span", { text: label }), h("b", { text: value })); }

function monoResultCard(r, i) {
  const kids = [];
  if (r.empty) {
    kids.push(h("div", { class: "empty", style: "padding:20px 0;white-space:pre-line", text: "這一輪幾乎沒有偵測到說話。\n檢查麥克風、靠近一點再試一次。" }));
  } else if (r.failed) {
    kids.push(h("div", { class: "sub", style: "color:#FF9C9C;line-height:1.6", text: "這一輪的分析沒有成功：" + r.msg }));
    kids.push(h("div", { class: "sub", style: "margin-top:8px", text: "錄音還在，可以按「重新分析」。" }));
  } else {
    kids.push(h("div", { class: "kvs" }, kv("字數", r.words + " 字"), kv("每分鐘字數", String(r.wpm)), kv("說話占比", r.share + "%"), kv("明顯停頓", r.pauses + " 次"), kv("嗯、呃", r.fillers + " 次")));
    if (r.praise) kids.push(h("div", { class: "praise", style: "margin-top:12px", text: "👍 " + r.praise }));
    kids.push(h("div", { class: "ptitle", style: "margin-top:12px", text: "你說的內容（辨識結果）" }), h("div", { class: "monotr", text: r.transcript || "（沒有辨識到內容）" }));
    if (r.errors.length) {
      kids.push(h("div", { class: "ptitle", style: "margin-top:14px", text: "值得注意的地方（已存到「錯誤複習」）" }));
      r.errors.forEach(x => kids.push(h("div", { class: "fix" }, x.sev === 3 ? h("span", { class: "tag", text: "重要" }) : null, h("div", { class: "said", text: x.said }), h("div", { class: "better", text: x.better }), x.why ? h("div", { class: "why", text: x.why }) : null)));
    } else kids.push(h("div", { class: "sub", style: "margin-top:12px", text: "這一輪沒有需要特別提醒的錯誤。" }));
    if (r.tip) kids.push(h("div", { class: "note", style: "margin-top:10px", text: "💡 " + r.tip }));
  }
  return card("第 " + (i + 1) + " 輪結果（" + r.sec + " 秒）", ...kids);
}

function monoSummaryCard() {
  const rs = M.results.filter(r => r && !r.failed && !r.empty);
  const head = ["", "時間", "字數", "每分鐘字數", "說話占比", "停頓", "嗯呃", "重點"];
  const rows = M.results.map((r, i) => r && !r.failed && !r.empty
    ? [String(i + 1), r.sec + " 秒", String(r.words), String(r.wpm), r.share + "%", String(r.pauses), String(r.fillers), String(r.errors.length)]
    : [String(i + 1), r ? r.sec + " 秒" : "—", "—", "—", "—", "—", "—", "—"]);
  const table = h("table", { class: "monotable" }, h("tr", {}, head.map(t => h("th", { text: t }))), rows.map(row => h("tr", {}, row.map(t => h("td", { text: t })))));
  let verdict = "";
  if (rs.length >= 2) {
    const a = rs[0], b = rs[rs.length - 1], dw = b.wpm - a.wpm;
    verdict = dw > 0 ? "最後一輪每分鐘比第一輪多說了 " + dw + " 個字，同一題說第二、三次會越來越順，這就是這個練習的目的。"
      : "每分鐘字數沒有增加也沒關係，看看停頓和嗯呃有沒有變少，下次再試一次。";
    if (b.pauses < a.pauses) verdict += " 停頓從 " + a.pauses + " 次降到 " + b.pauses + " 次。";
  } else verdict = "至少完成兩輪，才看得出同一題越說越順的變化。";
  return card("三輪比較", h("div", { class: "sub", style: "margin-bottom:10px;line-height:1.6", text: M.prompt.en }), table, h("div", { class: "note", style: "margin-top:12px", text: verdict }),
    note("字數來自語音辨識，停頓和說話占比是用麥克風音量估計的，拿來和你自己之前的結果比較就好。"));
}
