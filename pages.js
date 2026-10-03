/* AI 英文對話（桌機版）— review, stats and system pages, plus startup. */
"use strict";

// ================================================================ review

let reviewTab = "todo";

function buildReview(root) {
  const all = Errs.all();
  const todo = all.filter(e => !e.done), done = all.filter(e => e.done);
  root.appendChild(h("div", { class: "pagehead" }, h("h1", { text: "錯誤複習" }), h("span", { class: "sub", text: "每次對話結束後挑出的重點，都會存在這裡" })));

  const tabBtn = (id, t) => h("button", { class: "pill" + (reviewTab === id ? " on" : ""), text: t, on: { click: () => { reviewTab = id; go("review"); } } });
  root.appendChild(h("div", { class: "tabs" },
    tabBtn("todo", "待複習 " + todo.length), tabBtn("done", "已學會 " + done.length), tabBtn("hist", "對話紀錄"),
    h("div", { class: "grow" }),
    reviewTab === "todo" && todo.length ? h("button", { class: "pill gold", text: "開始小測驗", on: { click: () => startQuiz(todo) } }) : null));

  if (reviewTab === "hist") { buildHistory(root); return; }
  const list = reviewTab === "todo" ? todo : done;
  if (!list.length) {
    root.appendChild(card(null, h("div", { class: "sub", style: "padding:14px 4px;line-height:1.7", text: reviewTab === "todo"
      ? "目前沒有待複習的項目。\n結束一次對話後，如果有值得注意的地方，會自動存到這裡。" : "還沒有標記為「已學會」的項目。" })));
    root.lastChild.firstChild.style.whiteSpace = "pre-line";
    return;
  }
  list.forEach(e => root.appendChild(errCard(e)));
  root.appendChild(h("div", { style: "max-width:240px;margin-top:8px" }, h("button", { class: "btn danger", text: "清除全部錯誤紀錄", on: { click: () =>
    modal("清除全部錯誤紀錄？", h("div", { class: "sub", text: "待複習和已學會的都會刪除，無法復原。" }), [{ text: "取消" }, { text: "清除", primary: true, onClick: () => { Errs.clear(); go("review"); } }]) } })));
}

function errCard(e) {
  return h("div", { class: "err" },
    h("div", { class: "meta", text: fmtDate(e.ts) + "　" + e.persona + " · " + e.topic }),
    h("div", { class: "said", text: e.said }),
    h("div", { class: "better", text: e.better }),
    e.why ? h("div", { class: "why", text: e.why }) : null,
    h("div", { class: "acts" },
      h("button", { class: "pill", text: e.done ? "移回待複習" : "✓ 已學會", on: { click: () => { Errs.setDone(e.id, !e.done); go("review"); } } }),
      h("button", { class: "pill", text: "複製", on: { click: () => copyText(e.said + " → " + e.better + (e.why ? "（" + e.why + "）" : "")) } }),
      h("button", { class: "pill", text: "刪除", on: { click: () => { Errs.remove(e.id); go("review"); } } })));
}

function startQuiz(items) {
  const list = items.slice().sort(() => Math.random() - 0.5);
  let i = 0, revealed = false;
  const box = h("div", { class: "quiz" });
  let close = null;
  function paint() {
    const e = list[i];
    box.replaceChildren(
      h("div", { class: "sub", text: (i + 1) + " / " + list.length }),
      h("div", { class: "sub", style: "margin-top:12px", text: "你當時說：" }),
      h("div", { class: "q", text: e.said }),
      revealed ? h("div", {}, h("div", { class: "sub", text: "更好的說法：" }), h("div", { class: "a", text: e.better }), e.why ? h("div", { class: "note", style: "font-size:14px", text: e.why }) : null) : h("div", { class: "sub", text: "先想想看，怎麼說比較好？" }),
      gap(14),
      h("div", { class: "row" },
        !revealed ? h("button", { class: "pill gold", text: "看答案", on: { click: () => { revealed = true; paint(); } } }) : [
          h("button", { class: "pill gold", text: "記住了", on: { click: () => { Errs.setDone(e.id, true); next(); } } }),
          h("button", { class: "pill", text: "再看看", on: { click: next } })]));
  }
  function next() { i++; revealed = false; if (i >= list.length) { close && close(); go("review"); toast("這一輪完成了"); } else paint(); }
  paint();
  close = modal("錯誤小測驗", box, [{ text: "結束", onClick: () => { setTimeout(() => go("review"), 0); } }]);
}

function buildHistory(root) {
  const recs = Calls.all();
  const box = h("div");
  recs.forEach(r => box.appendChild(h("div", { class: "hist", on: { click: () => showCallDetail(r) } },
    h("div", { text: r.persona + " · " + r.topic }),
    h("div", { class: "s", text: fmtDate(r.ts) + "　" + Math.floor(r.durationSec / 60) + "分" + (r.durationSec % 60) + "秒" }))));
  root.appendChild(card("對話紀錄", recs.length ? box : note("還沒有對話紀錄。只存文字（不存聲音），保留最近 50 次。"),
    recs.length ? h("div", { style: "max-width:200px;margin-top:10px" }, h("button", { class: "btn danger", text: "全部清除", on: { click: () =>
      modal("清除全部對話紀錄？", h("div"), [{ text: "取消" }, { text: "清除", primary: true, onClick: () => { Calls.clear(); go("review"); } }]) } })) : null));
}

function showCallDetail(r) {
  let fb = "";
  try { const o = JSON.parse(r.feedback || "null"); if (o) {
    fb = (o.praise ? "👍 " + o.praise + "\n\n" : "") + (o.errors || []).map(x => "✏️ " + x.said + " → " + x.better + (x.why ? "（" + x.why + "）" : "")).join("\n") + (o.word ? "\n\n📚 " + o.word : "");
  } } catch (e) {}
  const body = (fb ? fb + "\n\n────────\n\n" : "") + r.transcript;
  modal(r.persona + " · " + r.topic, h("div", { class: "fb", text: body }), [
    { text: "複製", onClick: () => { copyText(body); return false; } }, { text: "關閉", primary: true }]);
}

// ================================================================ stats

let charts = [];
function barRows(items) {
  const max = Math.max(0, ...items.map(i => i[1]));
  if (max <= 0) return [note("還沒有資料")];
  return items.map(([name, sec]) => h("div", { class: "brow" },
    h("div", { class: "name", text: name }),
    h("div", { class: "track" }, h("div", { class: "fill" + (sec === max ? " hot" : ""), style: "width:" + (sec / max * 100) + "%" })),
    h("div", { class: "val", text: Stats.shortFmt(sec) })));
}

function buildStatsPage(root) {
  charts = [];
  root.appendChild(h("div", { class: "pagehead" }, h("h1", { text: "統計" }), h("span", { class: "sub", text: "只計算超過 10 秒的對話，資料只存在這台電腦的瀏覽器" })));
  const st = Stats.summary();
  const goalSec = () => P.goalMin * 60;

  const [last7, prev7] = Stats.weekCompare();
  let changeEl;
  if (prev7 > 0) {
    const pct = Math.trunc((last7 - prev7) * 100 / prev7);
    changeEl = h("div", { class: pct >= 0 ? "up" : "down", text: (pct >= 0 ? "▲ " + pct : "▼ " + (-pct)) + "%  較前 7 天" });
  } else changeEl = h("div", { class: "sub", text: last7 > 0 ? "本週開始累積" : "最近 7 天還沒有練習" });
  const avg = st.totalCalls > 0 ? Math.floor(st.totalSec / st.totalCalls) : 0;
  const weekAvg = st.totalSec > 0 ? Math.floor(st.totalSec / Stats.weeksSinceFirst()) : 0;
  const overview = card("累積總覽",
    h("div", { class: "ov" },
      h("div", { class: "grow" }, h("div", { class: "big", text: st.totalSec > 0 ? Stats.fmt(st.totalSec) : "0 分" }), changeEl),
      h("div", { class: "r" }, h("div", { class: "k", text: "練習天數" }), h("div", { class: "v", text: Stats.activeDays() + " 天" }),
        h("div", { class: "k", text: "每週平均" }), h("div", { class: "v", text: Stats.shortFmt(weekAvg) }))),
    h("div", { class: "tiles" },
      h("div", { class: "tile" }, h("div", { class: "k", text: "對話次數" }), h("div", { class: "v", text: st.totalCalls + " 次" })),
      h("div", { class: "tile" }, h("div", { class: "k", text: "平均每次" }), h("div", { class: "v", text: Stats.shortFmt(avg) }))));

  const readout = h("div", { style: "font-size:13px;margin-top:6px", text: "點一下長條，看詳細時間" });
  const sumText = h("div", { class: "note", style: "margin-top:4px" });
  const legend = h("div", { class: "note", text: "金＝當天　綠＝達標　白線＝7 天平均" });
  let range = 0;
  const chart = createBarChart((i, b) => { readout.textContent = (range === 2 ? b.label + " 結束的那一週　" : b.label + "　") + Stats.fmt(b.sec); });
  charts.push(chart);
  const btns = ["週", "月", "季", "年", "全部"].map((n, i) => h("button", { text: n, on: { click: () => { range = i; load(); } } }));
  function load() {
    const bars = [() => Stats.daily(7), () => Stats.daily(30), () => Stats.weekly(13), () => Stats.monthly(12),
      () => Stats.monthly(Math.min(60, Math.max(3, Stats.monthsSinceFirst())))][range]();
    const daily = range <= 1;
    chart.set(bars, { showAverage: daily, goalSec: daily ? goalSec() : 0 });
    legend.style.display = daily ? "" : "none";
    readout.textContent = "點一下長條，看詳細時間";
    const total = bars.reduce((a, b) => a + b.sec, 0);
    sumText.textContent = "區間合計 " + Stats.shortFmt(total) + (daily ? "　日均 " + Stats.shortFmt(Math.floor(total / bars.length)) : "");
    btns.forEach((b, i) => b.classList.toggle("on", i === range));
  }
  const trend = card("走勢圖", h("div", { class: "ranges" }, btns), chart.el, readout, sumText, legend);

  const ring = createRing();
  const goalTitle = h("div", { style: "font-weight:700;font-size:15px" });
  const streakEl = h("div", { class: "sub", style: "font-size:13px;margin-top:4px" });
  const weekEl = h("div", { class: "sub", style: "font-size:13px;margin-top:2px" });
  const goalVal = h("div", { class: "val" });
  function updateGoal() {
    const g = goalSec(), today = st.todaySec;
    ring.set(g > 0 ? today / g : 0, String(Math.floor(today / 60)), "/ " + P.goalMin + " 分");
    goalTitle.textContent = today >= g ? "今天達標 ✓" : "今天還差 " + Math.ceil((g - today) / 60) + " 分";
    const s = Stats.goalStreak(g);
    streakEl.textContent = s > 0 ? "連續達標 " + s + " 天" : "連續達標：尚未開始";
    weekEl.textContent = "最近 7 天達標 " + Stats.daily(7).filter(b => b.sec >= g).length + " / 7 天";
    goalVal.textContent = P.goalMin + " 分";
  }
  const step = (t, d) => h("button", { class: "pill", text: t, on: { click: () => { P.goalMin = Math.min(180, Math.max(5, P.goalMin + d)); savePrefs(); updateGoal(); load(); } } });
  const goal = card("目標",
    h("div", { class: "goalrow" }, ring.el, h("div", { class: "grow" }, goalTitle, streakEl, weekEl)),
    h("div", { class: "stepper" }, h("div", { class: "grow", text: "每天目標" }), step("−5", -5), goalVal, step("＋5", 5)));

  const hours = Stats.dim("hour");
  const bucket = (from, to) => Object.entries(hours).reduce((s, [k, v]) => {
    const hh = parseInt(k, 10);
    return s + ((from < to ? (hh >= from && hh < to) : (hh >= from || hh < to)) ? v : 0);
  }, 0);
  const wk = Stats.weekday(), wkNames = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];
  const dist = card("練習分布",
    h("div", { class: "subhead", text: "時段" }),
    h("div", { class: "bars" }, barRows([["早上 5–11", bucket(5, 11)], ["下午 11–17", bucket(11, 17)], ["晚上 17–23", bucket(17, 23)], ["深夜 23–5", bucket(23, 5)]])),
    h("div", { class: "subhead", text: "星期" }),
    h("div", { class: "bars" }, barRows(wkNames.map((n, i) => [n, wk[i]]))));

  const pers = Object.entries(Stats.dim("persona")).sort((a, b) => b[1] - a[1]);
  const tops = Object.entries(Stats.dim("topic")).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const rank = card("對象與主題排行",
    h("div", { class: "subhead", text: "對象" }), h("div", { class: "bars" }, barRows(pers)),
    h("div", { class: "subhead", text: "主題 前 5 名" }), h("div", { class: "bars" }, barRows(tops)));

  const lv = Stats.dim("level");
  const diff = card("難度趨勢", h("div", { class: "bars" }, barRows([1, 2, 3, 4, 5].map(i => ["第 " + i + " 級", lv[String(i)] || 0]))), note("看你多半在哪個難度練習；慢慢往上調。"));

  root.appendChild(h("div", { class: "grid2" }, h("div", {}, overview, goal, rank), h("div", {}, trend, dist, diff)));
  updateGoal(); load();
  root.appendChild(h("div", { style: "max-width:240px" }, h("button", { class: "btn danger", text: "清除全部統計", on: { click: () =>
    modal("清除全部統計？", h("div", { class: "sub", text: "累積時間、走勢與排行都會歸零，無法復原。" }), [{ text: "取消" }, { text: "清除", primary: true, onClick: () => { Stats.clear(); go("stats"); } }]) } })));
  setTimeout(() => charts.forEach(c => c.redraw && c.redraw()), 0);
}
window.addEventListener("resize", () => { if (page === "stats") charts.forEach(c => c.redraw && c.redraw()); });

// ================================================================ system

function buildSystemPage(root) {
  root.appendChild(h("div", { class: "pagehead" }, h("h1", { text: "系統" }), h("span", { class: "sub", text: "金鑰與對話方式設定" })));

  const keyIn = h("input", { class: "field", type: "password", placeholder: "Gemini API key", value: P.key, autocomplete: "off", spellcheck: false,
    on: { input: () => { P.key = keyIn.value.trim(); savePrefs(); } } });
  const result = h("div", { class: "note", style: "font-size:13px;white-space:pre-wrap;user-select:text" });
  const paste = h("button", { class: "btn outline", text: "貼上剪貼簿的 key", on: { click: async () => {
    try {
      const t = ((await navigator.clipboard.readText()) || "").trim();
      if (t.length < 20 || /\s/.test(t)) toast("剪貼簿裡沒有看起來像 key 的內容，請先複製 key");
      else { keyIn.value = t; P.key = t; savePrefs(); toast("已貼上，按「測試連線」確認"); }
    } catch (e) { toast("無法讀取剪貼簿，請直接在輸入框按 Ctrl+V 貼上"); }
  } } });
  const test = h("button", { class: "btn gold", text: "測試連線", on: { click: async () => {
    if (!P.key) { result.textContent = "還沒有填 key"; return; }
    result.textContent = "測試中…";
    try {
      const reply = await geminiGenerate(P.key, MODELS, "Reply with the single word: OK", false);
      let live = "";
      try { const ms = await new LiveSession({ apiKey: P.key }).discover(); live = ms.length ? "\n即時語音：可用（" + ms[0] + "）" : "\n即時語音：這組 key 找不到支援的模型"; }
      catch (e) { live = "\n即時語音：查詢失敗"; }
      result.textContent = "✓ 連線成功（" + String(reply).trim().slice(0, 20) + "）" + live;
    } catch (e) { result.textContent = "✗ 失敗：" + (e.message || e); }
  } } });
  root.appendChild(h("div", { class: "grid2" }, h("div", {},
    card("Gemini 金鑰", keyIn, gap(10),
      h("div", { class: "row" }, h("div", { class: "grow" }, paste), h("div", { class: "grow" }, test)),
      result,
      note("金鑰只存在這台電腦的瀏覽器裡，不會上傳到別處。")),
    card("如何申請 key（免費）", guideSteps(), gap(8),
      h("button", { class: "btn gold", text: "開啟申請頁", on: { click: () => window.open("https://aistudio.google.com/apikey", "_blank") } })),
    card("對話方式",
      sw("手動結束發言", "開啟後，你要按「開始說話」，說完再按「說完了」（或空白鍵），對方才會回答。關閉時由程式自動判斷你說完了沒。下一次對話開始生效。", P.manual, (v) => { P.manual = v; savePrefs(); toast("下一次對話生效"); }),
      h("div", { class: "flabel", style: "margin-top:8px", text: "你停頓多久，對方才開始回答（自動模式）" }),
      (() => { const s = h("select", { class: "field" }, WAIT_NAMES.map((n, i) => h("option", { value: String(i), text: n }))); s.value = String(P.wait); s.addEventListener("change", () => { P.wait = parseInt(s.value, 10) || 0; savePrefs(); toast("下一次對話生效"); }); return s; })(),
      gap(8),
      sw("允許插話（建議戴耳機）", "關閉時，對方說話那段時間不會收你的聲音，不會重複回應；開啟後可隨時打斷對方。", P.bargeIn, (v) => { P.bargeIn = v; savePrefs(); })),
    ), h("div", {},
    card("安裝成桌面 App（選用）", h("div", { class: "steps" },
      h("div", { text: "1.  用 Edge 或 Chrome 開這個網頁" }),
      h("div", { text: "2.  Edge：右上角「⋯」→「應用程式」→「將此網站安裝為應用程式」" }),
      h("div", { text: "3.  Chrome：網址列右側的「安裝」圖示，或「⋮」→「投放、儲存與分享」→「安裝頁面為應用程式」" }),
      h("div", { text: "4.  之後桌面就有圖示，會用獨立視窗開啟，像一般程式" })),
      note("按左邊的「全螢幕」，或按 F11，可以佔滿整個螢幕。")),
    diagCard())));

  root.appendChild(h("div", { class: "footer", text: "AI 英文對話（桌機版）  ·  ArchieKuo  ·  v" + VERSION }));
}

function diagCard() {
  const logs = Diag.logs(), err = Diag.lastError();
  const body = (err ? "最後一次錯誤：\n" + err + "\n\n" : "") + logs.map(l =>
    "── " + new Date(l.ts).toLocaleString() + "  " + l.persona + " · " + l.topic + "\n" + l.lines.join("\n")).join("\n\n");
  return card("診斷紀錄",
    body ? h("pre", { class: "log", text: body }) : note("目前沒有紀錄（每次對話會留下過程，保留最近 10 次）。"),
    body ? [gap(10), h("div", { class: "row" },
      h("div", { class: "grow" }, h("button", { class: "btn outline", text: "複製", on: { click: () => copyText(body) } })),
      h("div", { class: "grow" }, h("button", { class: "btn outline", text: "清除", on: { click: () => { Diag.clear(); go("system"); } } })))] : null);
}

function guideSteps() {
  return h("div", { class: "steps" },
    h("div", { text: "1.  按「開啟申請頁」，用 Google 帳號登入（任何 Google 帳號都可以）" }),
    h("div", { text: "2.  按「Create API key」（建立 API 金鑰），選一個專案，不用信用卡" }),
    h("div", { text: "3.  按 key 旁邊的複製圖示，把 key 複製起來" }),
    h("div", { text: "4.  回到這個網頁，按「貼上剪貼簿的 key」（或在輸入框按 Ctrl+V）" }),
    h("div", { text: "5.  按「測試連線」，看到 ✓ 就完成" }),
    note("免費額度內不收費。免費層的內容可能被 Google 用來改進產品。key 等於密碼，不要分享給別人；它只存在這台電腦的瀏覽器裡。同一把 key 也可以用在你的其他裝置，額度是共用的。"));
}

function showKeyGuide() {
  modal("如何申請 Gemini key（免費）", guideSteps(), [
    { text: "關閉" },
    { text: "開啟申請頁", primary: true, onClick: () => { window.open("https://aistudio.google.com/apikey", "_blank"); return false; } }]);
}

// ================================================================ start
go("start");
