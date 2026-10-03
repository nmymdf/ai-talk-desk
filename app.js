/* AI 英文對話（桌機版）— core: helpers, storage, start page, conversation screen. */
"use strict";

const VERSION = "1.4";
const REFRESH_MS = window.__REFRESH_MS || 300000; // open a fresh connection every ~5 min (sessions went silent after ~7 min)
const WAITS = [1000, 1800, 2800];
const WAIT_NAMES = ["一般", "長一點（建議）", "很長"];
const SPEED_NAMES = ["正常", "慢", "更慢"];
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"];

// ================================================================ helpers

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "style") el.setAttribute("style", v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
  }
  return el;
}
const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, "0");
const mmss = (s) => pad2(Math.floor(s / 60)) + ":" + pad2(Math.floor(s % 60));
const fmtDate = (ts) => { const d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };

let toastTimer = null;
function toast(msg, ms) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms || 3200);
}

function modal(title, body, buttons) {
  const bg = h("div", { class: "modal" });
  const close = () => bg.remove();
  const btns = h("div", { class: "btns" }, (buttons || [{ text: "關閉" }]).map(b =>
    h("button", { class: b.primary ? "pill gold" : "pill", text: b.text, on: { click: () => { if (!b.onClick || b.onClick() !== false) close(); } } })));
  bg.appendChild(h("div", { class: "box" }, h("h3", { text: title }), body, btns));
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
  return close;
}

function card(title, ...kids) { return h("div", { class: "card" }, title ? h("h2", { text: title }) : null, kids); }
const note = (s) => h("div", { class: "note", text: s });
const gap = (n) => h("div", { class: "gap" + n });

function sw(title, sub, checked, onChange) {
  const input = h("input", { type: "checkbox", checked: !!checked, on: { change: () => onChange(input.checked) } });
  return h("div", { class: "swrow" },
    h("div", { class: "grow" }, h("div", { class: "t", text: title }), sub ? h("div", { class: "s", text: sub }) : null),
    h("label", { class: "switch" }, input, h("span")));
}

function copyText(s) {
  const done = () => toast("已複製");
  const fallback = () => {
    const ta = h("textarea", { style: "position:fixed;opacity:0" }); ta.value = s;
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("複製失敗，請手動選取文字"); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done).catch(fallback); else fallback();
}

function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  } catch (e) {}
}

// ================================================================ storage (all keys start with desk_)

const DEFAULTS = {
  key: "", liveModel: "", persona: "random", topicId: "random", level: 3, style: "chatty",
  userName: "", speed: 0, wait: 1, goalMin: 15, bargeIn: false, manual: false, customTopics: []
};
let P = Object.assign({}, DEFAULTS);
try { Object.assign(P, JSON.parse(localStorage.getItem("desk_prefs") || "{}")); } catch (e) {}
function savePrefs() { try { localStorage.setItem("desk_prefs", JSON.stringify(P)); } catch (e) {} }

const Calls = {
  all() { try { return JSON.parse(localStorage.getItem("desk_calls") || "[]"); } catch (e) { return []; } },
  put(l) { try { localStorage.setItem("desk_calls", JSON.stringify(l.slice(0, 50))); } catch (e) {} },
  add(rec) { const l = this.all(); l.unshift(rec); this.put(l); },
  clear() { try { localStorage.removeItem("desk_calls"); } catch (e) {} }
};

const Errs = {
  all() { try { return JSON.parse(localStorage.getItem("desk_errors") || "[]"); } catch (e) { return []; } },
  put(l) { try { localStorage.setItem("desk_errors", JSON.stringify(l.slice(0, 600))); } catch (e) {} },
  addMany(items) { const l = this.all(); this.put(items.concat(l)); },
  setDone(id, v) { const l = this.all(); const r = l.find(x => x.id === id); if (r) { r.done = v; this.put(l); } },
  remove(id) { this.put(this.all().filter(x => x.id !== id)); },
  clear() { try { localStorage.removeItem("desk_errors"); } catch (e) {} }
};

const Diag = {
  lastError() { return localStorage.getItem("desk_lasterr") || ""; },
  setError(s) { try { localStorage.setItem("desk_lasterr", s); } catch (e) {} },
  logs() { try { return JSON.parse(localStorage.getItem("desk_logs") || "[]"); } catch (e) { return []; } },
  addLog(entry) { const l = this.logs(); l.unshift(entry); try { localStorage.setItem("desk_logs", JSON.stringify(l.slice(0, 10))); } catch (e) {} },
  clear() { try { localStorage.removeItem("desk_lasterr"); localStorage.removeItem("desk_logs"); } catch (e) {} }
};

// ================================================================ audio + wake lock

let AC = null;
function ensureAC() {
  if (!AC || AC.state === "closed") AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state !== "running") AC.resume().catch(() => {});
  return AC;
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on) { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } }
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}

// ================================================================ navigation

let page = "start";
function go(name) {
  if (D && !D.ended) { toast("對話進行中，請先按「結束對話」"); return; }
  page = name;
  closeTalk();
  renderSide();
  const root = $("page");
  root.replaceChildren();
  root.scrollTop = 0;
  const wrap = h("div", { class: "wrap" });
  root.appendChild(wrap);
  ({ start: buildStart, review: buildReview, stats: buildStatsPage, system: buildSystemPage }[name])(wrap);
}

function renderSide() {
  const items = [["start", "💬", "開始對話"], ["review", "📒", "錯誤複習"], ["stats", "📈", "統計"], ["system", "⚙", "系統"]];
  $("side").replaceChildren(
    h("div", { class: "brand" }, h("img", { src: "img/logo.jpg", alt: "" }), h("div", {}, h("b", { text: "AI 英文對話" }), h("span", { text: "作者：ArchieKuo" }))),
    ...items.map(([id, ic, t]) => h("button", { class: "nav" + (page === id ? " on" : ""), on: { click: () => go(id) } }, h("span", { text: ic }), h("span", { text: t }))),
    h("div", { class: "spacer" }),
    h("button", { class: "nav", on: { click: toggleFullscreen } }, h("span", { text: "⛶" }), h("span", { text: "全螢幕" })),
    h("div", { class: "ver", text: "桌機版 v" + VERSION }));
}

// ================================================================ start page

function resolvePersona(id) { return PERSONAS.find(p => p.id === id) || PERSONAS[Math.floor(Math.random() * PERSONAS.length)]; }

function buildStart(root) {
  root.appendChild(h("div", { class: "pagehead" }, h("h1", { text: "開始對話" }), h("span", { class: "sub", text: "選好主題與對象，按下開始就能直接說英文" })));

  if (!P.key) {
    root.appendChild(h("div", { class: "card warn" }, h("h2", { text: "還差一步就能使用" }),
      h("div", { class: "sub", text: "需要貼上免費的 Gemini 金鑰，才能開始對話。" }), gap(10),
      h("div", { class: "row", style: "max-width:460px" },
        h("div", { class: "grow" }, h("button", { class: "btn gold", text: "去設定金鑰", on: { click: () => go("system") } })),
        h("div", { class: "grow" }, h("button", { class: "btn outline", text: "如何申請 key？", on: { click: showKeyGuide } })))));
  }

  // topic
  const topicSel = h("select", { class: "field" });
  const addOpt = (v, t) => topicSel.appendChild(h("option", { value: v, text: t }));
  addOpt("random", "隨機");
  TOPICS.forEach(t => addOpt(t.id, t.label));
  P.customTopics.forEach(c => addOpt(c.id, "★ " + c.name));
  if (![...topicSel.options].some(o => o.value === P.topicId)) { P.topicId = "random"; savePrefs(); }
  topicSel.value = P.topicId;
  const delBtn = h("button", { class: "btn outline", text: "刪除這個主題", style: P.topicId.startsWith("c:") ? "" : "display:none", on: { click: deleteTopic } });
  topicSel.addEventListener("change", () => { P.topicId = topicSel.value; savePrefs(); delBtn.style.display = P.topicId.startsWith("c:") ? "" : "none"; });
  const topicCard = card("對話主題", topicSel, gap(8),
    h("div", { class: "row" }, h("div", { class: "grow" }, h("button", { class: "btn outline", text: "＋ 新增主題", on: { click: addTopic } })), h("div", { class: "grow" }, delBtn)));

  // level
  const levelDesc = h("div", { class: "note", style: "font-size:13px;margin-top:10px" });
  const lvBtns = [4, 10, 18, 28, 40].map((hh, i) => h("button", { on: { click: () => { P.level = i + 1; savePrefs(); paintLevel(); } } },
    h("div", { class: "bar", style: "height:" + hh + "px" }), h("div", { class: "num", text: String(i + 1) })));
  function paintLevel() { lvBtns.forEach((b, i) => b.classList.toggle("sel", P.level === i + 1)); levelDesc.textContent = LEVEL_TEXTS[P.level - 1]; }
  paintLevel();
  const levelCard = card("英文難度", h("div", { class: "level" }, lvBtns), levelDesc);

  // persona + style + name
  const grid = h("div", { class: "personas" });
  PERSONAS.map(p => ({ id: p.id, name: p.name, photo: p.photo })).concat([{ id: "random", name: "隨機" }]).forEach(e => {
    const el = h("button", { class: "persona" + (P.persona === e.id ? " sel" : ""), on: { click: () => {
      P.persona = e.id; savePrefs(); grid.querySelectorAll(".persona").forEach(x => x.classList.toggle("sel", x === el));
    } } }, h("div", { class: "ring" }, e.photo ? h("img", { src: e.photo, alt: e.name }) : h("div", { class: "q", text: "?" })), h("span", { text: e.name }));
    grid.appendChild(el);
  });
  const styleSel = h("select", { class: "field" },
    h("option", { value: "chatty", text: "活潑親切（愛笑、愛開玩笑）" }),
    h("option", { value: "focused", text: "簡潔直接（比較正經）" }));
  styleSel.value = P.style;
  styleSel.addEventListener("change", () => { P.style = styleSel.value; savePrefs(); });
  const speedSel = h("select", { class: "field" }, SPEED_NAMES.map((n, i) => h("option", { value: String(i), text: n })));
  speedSel.value = String(P.speed);
  speedSel.addEventListener("change", () => { P.speed = parseInt(speedSel.value, 10) || 0; savePrefs(); });
  const waitSel = h("select", { class: "field" }, WAIT_NAMES.map((n, i) => h("option", { value: String(i), text: n })));
  waitSel.value = String(P.wait);
  waitSel.addEventListener("change", () => { P.wait = parseInt(waitSel.value, 10) || 0; savePrefs(); });
  const nameIn = h("input", { class: "field", type: "text", placeholder: "你的名字（對方偶爾會叫你）", value: P.userName,
    on: { input: () => { P.userName = nameIn.value.trim(); savePrefs(); } } });
  const personaCard = card("對話對象", grid, note("每位的臉、聲音、名字都是固定的。選「隨機」每次會換一位。"), gap(10),
    h("div", { class: "flabel", text: "對方說話風格" }), styleSel, gap(10),
    h("div", { class: "flabel", text: "對方說話速度（對話中也能隨時調整）" }), speedSel, gap(10),
    h("div", { class: "flabel", text: "你停頓多久，對方才開始回答" }), waitSel, gap(10),
    h("div", { class: "flabel", text: "你的稱呼" }), nameIn);

  const startCard = h("div", {},
    sw("說完後由我按鈕，對方才回答", "開啟後，你要按「開始說話」，說完再按「說完了」（或空白鍵）；不會因為你停頓一下就被搶話。", P.manual, (v) => { P.manual = v; savePrefs(); }),
    gap(8),
    h("button", { class: "btn gold big", text: "開始對話", on: { click: beginTalk } }),
    note("建議戴耳機，避免喇叭的聲音被麥克風收回去。第一次使用瀏覽器會詢問麥克風權限，請按「允許」。"));
  root.appendChild(h("div", { class: "grid2" }, h("div", {}, topicCard, levelCard, startCard), h("div", {}, personaCard)));

  root.appendChild(h("div", { class: "footer", text: "AI 英文對話  ·  ArchieKuo  ·  v" + VERSION }));
}

function addTopic() {
  const ta = h("textarea", { class: "field", rows: 3, placeholder: "例如：點一份外帶披薩、跟老闆請假、聊我的新工作" });
  modal("新增主題", ta, [{ text: "取消" }, { text: "儲存", primary: true, onClick: () => {
    const text = ta.value.trim();
    if (!text) { toast("請先輸入主題"); return false; }
    const t = { id: "c:" + Date.now(), name: text.slice(0, 16), text };
    P.customTopics.push(t); P.topicId = t.id; savePrefs();
    go("start"); toast("已新增，在選單最下面（★）");
  } }]);
  setTimeout(() => ta.focus(), 50);
}
function deleteTopic() {
  const t = P.customTopics.find(x => x.id === P.topicId);
  if (!t) return;
  modal("刪除「" + t.name + "」？", h("div"), [{ text: "取消" }, { text: "刪除", primary: true, onClick: () => {
    P.customTopics = P.customTopics.filter(x => x.id !== t.id); P.topicId = "random"; savePrefs(); go("start");
  } }]);
}

// ================================================================ conversation

let D = null;      // the current / last conversation
let uid = 0;
let msgEls = new Map();

function logLine(msg) { if (D) D.log.push("[" + ((Date.now() - D.t0) / 1000).toFixed(1).padStart(5) + "s] " + msg); }

async function beginTalk() {
  if (!P.key) { toast("還沒有 Gemini 金鑰，請先到「系統」頁設定"); go("system"); return; }
  const ctx = ensureAC();
  const persona = resolvePersona(P.persona), topic = resolveTopic(P.topicId, P.customTopics);
  D = { persona, topic, level: P.level, manual: P.manual, t0: Date.now(), startMs: Date.now(), msgs: [], muted: false, live: null, stream: null,
    ended: false, failed: false, log: [], timer: null, tab: "fix", analysis: null, err: "", endMs: 0, retries: 0, nudges: 0, sessionMs: Date.now(), lastSrvMs: Date.now(), lastTextMs: Date.now(), stuck: false, note: "" };
  msgEls = new Map();
  logLine("對話開始 " + persona.name + " / " + topic.label + " / 難度 " + P.level + (P.manual ? " / 手動結束發言" : ""));
  buildTalk();
  keepAwake(true);
  D.timer = setInterval(tick, 300);
  const mine = D;

  try {
    D.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    logLine("麥克風已開啟");
  } catch (e) { failTalk(new Error("沒有麥克風權限，或麥克風被佔用。請按網址列左邊的鎖頭，允許麥克風後再試一次。\n" + (e.message || e))); return; }
  if (mine.ended) { stopStream(mine); return; }

  startLive(false);
}

/** Open (or re-open after a drop) the live voice connection for the current conversation. */
function startLive(recover) {
  const mine = D;
  const hist = recover ? mine.msgs.filter(m => m.text.trim()).slice(-14).map(m => (m.who === "me" ? "Learner: " : "You: ") + m.text.trim()).join("\n") : "";
  const system = deskPrompt(mine.topic, P.style, P.userName, mine.level, mine.persona, P.speed) +
    (recover === "refresh"
      ? "\n\nThe conversation is already in progress and you are continuing it on a fresh connection. What was said so far (the \"You\" lines are yours):\n" + hist + "\nDo NOT greet, do not mention any interruption, and do not speak first: stay silent until the learner speaks, then reply naturally to what they say, as if nothing happened."
      : recover ? "\n\nThe conversation was just interrupted by a short connection problem and you are resuming it. What was said so far (the \"You\" lines are yours):\n" + hist + "\nContinue naturally from there." : "");
  const cue = recover === "refresh" ? null : recover
    ? "(The connection dropped for a moment and is back. Say one very short line such as \"Sorry, I lost you for a second.\" and then carry on with the conversation naturally from where it was.)"
    : DESK_CUE;
  mine.lastSrvMs = Date.now();
  mine.sessionMs = Date.now();
  const L = new LiveSession({
    apiKey: P.key, savedModel: P.liveModel, voice: mine.persona.voice,
    system, cue, ctx: ensureAC(), stream: mine.stream, manual: mine.manual,
    silenceMs: WAITS[P.wait] || 1800,
    isMuted: () => mine.muted,
    allowBargeIn: () => P.bargeIn,
    onModelChosen: (m) => { P.liveModel = m; savePrefs(); },
    onLog: (m) => { if (D === mine) logLine(m); },
    onServer: () => { mine.lastSrvMs = Date.now(); },
    onModelText: (t) => {
      if (D !== mine || mine.live !== L) return;
      if (t === "\u0000") { const m = lastMsg(); if (m && m.who === "ai") m.closed = true; paintMsgs(); return; }
      pushText("ai", t);
    },
    onUserText: (t) => { if (D === mine && mine.live === L) pushText("me", t); },
    onFail: (e) => {
      if (D !== mine || mine.live !== L || mine.ended) return;
      if (L.ready && mine.retries < 3) { mine.retries++; logLine("連線中斷，自動重連（第 " + mine.retries + " 次）：" + ((e && e.message) || e)); reconnectTalk(true, "drop"); }
      else failTalk(e);
    }
  });
  mine.live = L;
  L.start();
}

/** Drop the current connection and open a new one, keeping the conversation on screen. */
function reconnectTalk(auto, mode) {
  if (!D || D.ended) return;
  mode = mode || "drop";
  const old = D.live;
  D.live = null;
  try { old && old.close(); } catch (e) {}
  const m = lastMsg(); if (m) m.closed = true;
  D.stuck = false;
  setNote(mode === "refresh" ? "已自動更新連線，可以繼續說" : auto ? "連線中斷，正在重新連線…" : "正在重新連線…");
  setTimeout(() => { if (D && !D.ended) { startLive(mode); setTimeout(() => { if (D && !D.ended && D.live && D.live.ready) setNote(""); }, mode === "refresh" ? 2500 : 3500); } }, 700);
  paintBar();
}

function setNote(s) { if (!D) return; D.note = s; paintHeader(); }

function nudgeTalk() {
  if (!D || D.ended || !D.live) return;
  D.live.nudge();
  D.lastSrvMs = Date.now();
  logLine("叫對方回答");
  paintBar();
}

function lastMsg() { return D && D.msgs[D.msgs.length - 1]; }

function pushText(who, t) {
  if (!t || !D) return;
  D.lastTextMs = Date.now();
  if (who === "ai") D.nudges = 0;
  let m = lastMsg();
  if (!m || m.who !== who || m.closed) { m = { id: ++uid, who, text: "", closed: false }; D.msgs.push(m); if (who === "me") { const a = D.msgs[D.msgs.length - 2]; if (a && a.who === "ai") a.closed = true; } }
  m.text += m.text ? t : t.replace(/^\s+/, "");
  paintMsgs();
}

function stopStream(d) { if (d && d.stream) { d.stream.getTracks().forEach(t => t.stop()); d.stream = null; } }

function failTalk(e) {
  if (!D || D.failed) return;
  D.failed = true;
  const msg = (e && e.message) || String(e);
  D.err = msg;
  logLine("對話失敗：" + msg);
  Diag.setError(new Date().toLocaleString() + "\n" + msg);
  endTalk();
}

function endTalk() {
  if (!D || D.ended) return;
  const d = D;
  d.ended = true; d.endMs = Date.now();
  clearInterval(d.timer);
  try { d.live && d.live.close(); } catch (e) {}
  stopStream(d);
  keepAwake(false);
  const dur = Math.round((d.endMs - d.startMs) / 1000);
  const text = d.msgs.filter(m => m.text.trim()).map(m => (m.who === "me" ? "You: " : "Partner: ") + m.text.trim()).join("\n");
  const myMsgs = d.msgs.filter(m => m.who === "me" && m.text.trim());
  const myWords = myMsgs.reduce((n, m) => n + m.text.trim().split(/\s+/).filter(Boolean).length, 0);
  d.dur = dur; d.myCount = myMsgs.length; d.myWords = myWords;
  try {
    if (dur >= 10 && d.live && d.live.ready) Stats.add(dur, d.startMs, d.persona.name, d.topic.label, d.level);
    Diag.addLog({ ts: d.startMs, persona: d.persona.name, topic: d.topic.label, lines: d.log.slice(-150) });
  } catch (e) {}
  const rec = { ts: d.startMs, durationSec: dur, persona: d.persona.name, topic: d.topic.label, level: d.level, transcript: text, feedback: "" };
  if (dur >= 20 && myMsgs.length) { try { Calls.add(rec); } catch (e) {} }
  if (myMsgs.length >= 2 && myWords >= 12 && P.key) {
    d.analysis = "loading";
    geminiGenerate(P.key, MODELS, DESK_FEEDBACK_PROMPT + "\n" + text, true).then(t => {
      t = t.trim().replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
      const o = JSON.parse(t);
      const errors = (Array.isArray(o.errors) ? o.errors : []).filter(x => x && x.said && x.better).slice(0, 4)
        .map(x => ({ said: String(x.said), better: String(x.better), why: String(x.why || "") }));
      d.analysis = { praise: String(o.praise || ""), errors, word: String(o.word || "") };
      if (errors.length) Errs.addMany(errors.map((x, i) => Object.assign({ id: d.startMs + "-" + i, ts: d.startMs, persona: d.persona.name, topic: d.topic.label, done: false }, x)));
      try { const l = Calls.all(); const r = l.find(x => x.ts === d.startMs); if (r) { r.feedback = JSON.stringify(d.analysis); Calls.put(l); } } catch (e) {}
      paintPanel(); paintBar();
    }).catch((e) => { d.analysis = { failed: true, msg: (e && e.message) || String(e) }; paintPanel(); });
  } else {
    d.analysis = { short: true };
  }
  paintHeader(); paintBar(); paintPanel();
}

function closeTalk() { $("talk").classList.add("hidden"); $("talk").replaceChildren(); }

function leaveTalk() {
  if (D && !D.ended) return;
  closeTalk();
  go("start");
}

function toggleTalk() {
  if (!D || D.ended || !D.live || !D.manual) return;
  if (D.live.talking) D.live.endTalk(); else D.live.startTalk();
  paintBar();
}

function buildTalk() {
  const root = $("talk");
  root.classList.remove("hidden");
  root.replaceChildren(
    h("div", { class: "th", id: "th" }),
    h("div", { class: "tb" },
      h("div", { class: "panel" }, h("div", { id: "banner" }), h("div", { id: "msgs" }), h("div", { class: "cbar", id: "bar" })),
      h("div", { class: "panel" }, h("div", { class: "ptabs", id: "ptabs" }), h("div", { id: "pbody" }))));
  paintHeader(); paintBar(); paintPanel(); paintMsgs();
}

function paintHeader() {
  const th = $("th"); if (!th || !D) return;
  th.replaceChildren(
    h("img", { src: D.persona.photo, alt: "" }),
    h("div", { class: "who" }, h("b", { text: D.persona.name }), h("span", { text: D.topic.label + "　·　難度 " + D.level })),
    h("div", { class: "grow" }),
    h("div", { class: "timer", id: "timer", text: mmss(((D.ended ? D.endMs : Date.now()) - D.startMs) / 1000) }),
    h("button", { class: "btn outline", text: "⛶ 全螢幕", on: { click: toggleFullscreen } }),
    D.ended
      ? h("button", { class: "btn gold", text: "‹ 回到首頁", on: { click: leaveTalk } })
      : h("button", { class: "btn gold", text: "結束對話", on: { click: () => endTalk() } }));
  const bn = $("banner");
  if (bn) { bn.className = D.err ? "banner" : (D.note ? "banner note" : ""); bn.textContent = D.err || D.note || ""; }
}

function statusText() {
  if (!D) return ["", ""];
  if (D.ended) return ["", D.failed ? "對話已中斷" : "對話已結束，可以看右邊的更正"];
  const L = D.live;
  if (!L || !L.ready) return ["", "連線中…"];
  if (!L.gotAudio && !D.msgs.length) return ["ai", "對方準備開口…"];
  if (D.stuck) return ["", "對方好像沒有回應，可以按右邊的按鈕"];
  if (D.muted) return ["", "麥克風已靜音"];
  if (D.manual) return L.talking ? ["me", "正在收音…說完請按「說完了」"] : (L.speaking() ? ["ai", "對方說話中…"] : ["", "輪到你：按「開始說話」或空白鍵"]);
  return L.speaking() ? ["ai", "對方說話中…"] : ["me", "輪到你說話了"];
}

function paintBar() {
  const bar = $("bar"); if (!bar || !D) return;
  const [dot, txt] = statusText();
  const kids = [h("div", { class: "status" }, h("span", { class: "dot " + dot }), h("span", { id: "stext", text: txt }))];
  if (!D.ended && D.stuck) {
    kids.push(h("button", { class: "pill gold", text: "叫對方回答", on: { click: (e) => { e.currentTarget.blur(); nudgeTalk(); } } }),
      h("button", { class: "pill", text: "重新連線", on: { click: (e) => { e.currentTarget.blur(); logLine("手動重新連線"); reconnectTalk(false, "drop"); } } }));
  }
  if (!D.ended) {
    kids.push(h("div", { class: "row", style: "gap:4px" }, h("span", { class: "sub", style: "font-size:13px;margin-right:2px", text: "語速" }),
      SPEED_NAMES.map((n, i) => h("button", { class: "pill" + (P.speed === i ? " on" : ""), style: "height:34px;padding:0 12px", text: n, on: { click: (e) => {
        e.currentTarget.blur(); P.speed = i; savePrefs(); logLine("語速：" + n); if (D.live) D.live.setPace(i); paintBar(); } } }))));
    if (D.manual) kids.push(h("button", { class: "talkbtn" + (D.live && D.live.talking ? " on" : ""), id: "talkbtn", text: D.live && D.live.talking ? "✓ 說完了" : "🎤 開始說話", on: { click: (e) => { e.currentTarget.blur(); toggleTalk(); } } }));
    kids.push(h("button", { class: "pill mute" + (D.muted ? " on" : ""), text: D.muted ? "取消靜音" : "靜音", on: { click: (e) => { e.currentTarget.blur(); D.muted = !D.muted; logLine(D.muted ? "靜音" : "取消靜音"); paintBar(); } } }));
  }
  bar.replaceChildren(...kids);
}

let lastStatus = "";
function tick() {
  if (!D) return;
  const t = $("timer"); if (t && !D.ended) t.textContent = mmss((Date.now() - D.startMs) / 1000);
  if (!D.ended && D.live && D.live.ready) {
    const m = lastMsg(), now = Date.now();
    const quiet = !D.live.speaking() && !D.live.talking;
    const waiting = !!(m && m.who === "me" && !m.closed && quiet && now - D.lastTextMs > 9000 && now - D.lastSrvMs > 9000);
    if (waiting) {
      if (!D.stuck) { D.stuck = true; logLine("對方超過 9 秒沒有回應"); paintBar(); }
      if (D.nudges === 0) { D.nudges = 1; nudgeTalk(); }
      else { D.nudges = 0; logLine("叫了還是沒有回應，自動重新連線"); reconnectTalk(true, "drop"); }
    } else if (D.stuck) { D.stuck = false; paintBar(); }
    // sessions that run a long time stopped answering, so quietly swap in a fresh connection every few minutes
    if (!waiting && m && m.who === "ai" && m.closed && quiet && now - D.sessionMs > REFRESH_MS && now - D.lastTextMs > 3000) {
      logLine("連線已超過 " + Math.round((now - D.sessionMs) / 60000) + " 分鐘，趁安靜時換一條新連線");
      reconnectTalk(true, "refresh");
    }
  } else if (D.stuck) D.stuck = false;
  const key = statusText().join("|") + (D.live && D.live.talking ? "T" : "") + (D.stuck ? "S" : "");
  if (key !== lastStatus) { lastStatus = key; paintBar(); }
  if (D.tab === "sum" && !D.ended && Math.floor(Date.now() / 1000) % 3 === 0) paintPanel();
}

// ---- transcript

function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 120; }

function paintMsgs() {
  const box = $("msgs"); if (!box || !D) return;
  const stick = nearBottom(box);
  if (!D.msgs.length) {
    if (!box.querySelector(".empty")) box.replaceChildren(h("div", { class: "empty", text: "對話內容會即時出現在這裡。\n你說的和對方說的都會一邊說一邊跳字。" }));
    box.firstChild.style.whiteSpace = "pre-line";
    return;
  }
  const emp = box.querySelector(".empty"); if (emp) emp.remove();
  D.msgs.forEach((m, i) => {
    let e = msgEls.get(m.id);
    if (!e) {
      const textEl = h("div", { class: "t" });
      const trEl = h("div", { class: "tr hidden" });
      const bub = h("div", { class: "bub" }, textEl, trEl);
      let el;
      if (m.who === "ai") {
        const btn = h("button", { class: "tbtn", text: "譯", title: "翻譯這一句", on: { click: () => translateMsg(m) } });
        el = h("div", { class: "msg ai" }, h("img", { class: "av", src: D.persona.photo, alt: "" }), bub, btn);
      } else el = h("div", { class: "msg me" }, bub);
      box.appendChild(el);
      e = { el, textEl, trEl };
      msgEls.set(m.id, e);
    }
    e.textEl.textContent = m.text;
    e.el.classList.toggle("live", !m.closed && i === D.msgs.length - 1 && !D.ended);
  });
  if (stick) box.scrollTop = box.scrollHeight;
}

async function translateMsg(m) {
  const e = msgEls.get(m.id); if (!e) return;
  if (m.tr) { e.trEl.classList.toggle("hidden"); return; }
  if (!m.text.trim()) return;
  e.trEl.classList.remove("hidden"); e.trEl.textContent = "翻譯中…";
  try {
    const t = await geminiGenerate(P.key, MODELS, "Translate the following English into natural Traditional Chinese (Taiwan). Output only the translation, nothing else.\n\n" + m.text, false);
    m.tr = String(t).trim(); e.trEl.textContent = m.tr;
  } catch (err) { e.trEl.textContent = "翻譯失敗：" + ((err && err.message) || err).toString().slice(0, 120); }
}

// ---- right panel

function paintPanel() {
  const tabs = $("ptabs"), body = $("pbody"); if (!tabs || !body || !D) return;
  tabs.replaceChildren(
    h("button", { class: D.tab === "fix" ? "on" : "", text: "更正", on: { click: () => { D.tab = "fix"; paintPanel(); } } }),
    h("button", { class: D.tab === "sum" ? "on" : "", text: "本次摘要", on: { click: () => { D.tab = "sum"; paintPanel(); } } }));
  const a = D.analysis;
  if (D.tab === "fix") {
    if (!D.ended) body.replaceChildren(h("div", { class: "empty", style: "white-space:pre-line;margin-top:40px", text: "放心說，說錯也沒關係。\n對話中不會打斷你，\n結束後這裡會列出幾個值得注意的地方。" }));
    else if (a === "loading" || !a) body.replaceChildren(h("div", { class: "empty", style: "margin-top:40px", text: "正在整理這次的重點…" }));
    else if (a.short) body.replaceChildren(h("div", { class: "empty", style: "margin-top:40px;white-space:pre-line", text: "這次說的內容太少，\n沒有可以分析的地方。\n下次多聊幾句吧！" }));
    else if (a.failed) body.replaceChildren(h("div", { class: "empty", style: "margin-top:40px;white-space:pre-line", text: "這次的分析沒有成功。\n" + a.msg.slice(0, 200) }));
    else {
      const kids = [];
      if (a.praise) kids.push(h("div", { class: "praise", text: "👍 " + a.praise }));
      if (a.errors.length) {
        kids.push(h("div", { class: "ptitle", text: "值得注意的地方（已存到「錯誤複習」）" }));
        a.errors.forEach(x => kids.push(h("div", { class: "fix" }, h("div", { class: "said", text: x.said }), h("div", { class: "better", text: x.better }), x.why ? h("div", { class: "why", text: x.why }) : null)));
      } else kids.push(h("div", { class: "sub", style: "line-height:1.6", text: "這次沒有需要特別提醒的地方，說得很好！" }));
      body.replaceChildren(...kids);
    }
  } else {
    const secs = ((D.ended ? D.endMs : Date.now()) - D.startMs) / 1000;
    const mine = D.msgs.filter(m => m.who === "me" && m.text.trim());
    const words = mine.reduce((n, m) => n + m.text.trim().split(/\s+/).filter(Boolean).length, 0);
    const kids = [
      h("div", { class: "kv" }, h("span", { text: "對話時間" }), h("b", { text: mmss(secs) })),
      h("div", { class: "kv" }, h("span", { text: "你說了" }), h("b", { text: mine.length + " 句" })),
      h("div", { class: "kv" }, h("span", { text: "你說的字數" }), h("b", { text: words + " 字" })),
      h("div", { class: "kv" }, h("span", { text: "主題" }), h("b", { text: D.topic.label }))];
    if (a && a.word) kids.push(h("div", { class: "ptitle", style: "margin-top:16px", text: "這次可以學的字" }), h("div", { class: "fix" }, h("div", { class: "better", style: "color:var(--text);font-size:15px;font-weight:500", text: a.word })));
    body.replaceChildren(...kids);
  }
}

// ---- keyboard: Space = start/finish speaking in manual mode
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || !D || D.ended || !D.manual || $("talk").classList.contains("hidden")) return;
  const tg = e.target && e.target.tagName;
  if (tg === "INPUT" || tg === "TEXTAREA" || tg === "SELECT") return;
  e.preventDefault();
  if (!e.repeat) toggleTalk();
});
document.addEventListener("keyup", (e) => { if (e.code === "Space" && D && !D.ended && D.manual && !$("talk").classList.contains("hidden")) e.preventDefault(); });
document.addEventListener("visibilitychange", () => {
  if (D && !D.ended) { logLine(document.visibilityState === "visible" ? "回到前景" : "網頁被切到背景"); if (document.visibilityState === "visible") keepAwake(true); }
});
window.addEventListener("beforeunload", (e) => { if (D && !D.ended) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("error", (e) => { Diag.setError(new Date().toLocaleString() + "\n網頁錯誤：" + e.message); });
