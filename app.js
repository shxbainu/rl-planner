// RL Planner: renders schedule.json + homework.json, keeps check-offs and own items in localStorage.
(() => {
  "use strict";

  const STORE = "rlp-v1";
  const THEME = "rlp-theme";
  const STALE_HOURS = 36;
  const MAJOR = new Set(["quiz", "test", "essay", "project"]);
  const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let schedule = null, homework = null;
  let state = load();
  let quoteDeck = [], qFilter = "all"; // the quote deck (quotes.json) and the Quotes tab filter

  // ---------- storage ----------
  // localStorage is the store; the sync further down mirrors it to one shared copy online. So two devices can merge, every change
  // carries a time: done[k] is when it was checked, undone[k] when unchecked, removed[id] when an item or countdown was
  // deleted, lettersAt[date] when a day letter was set or cleared, prefs[name] = { v, t }. Quotes: quotes[id] is that quote's
  // practice progress { lv, step, due, seen, last, t }, myQuotes the ones Brian added, qlog[date] how many he practiced that day.
  function load() {
    const empty = { done: {}, undone: {}, manual: [], letters: {}, lettersAt: {}, countdowns: [], removed: {}, prefs: {}, notes: {}, quotes: {}, myQuotes: [], qlog: {} };
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || "null");
      return s ? { ...empty, ...s } : empty;
    } catch { return empty; }
  }
  let onSave = null; // set by the sync further down, on the live site
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
    onSave?.();
  }
  const stamp = () => new Date().toISOString();
  function setPref(name, v) { state.prefs = { ...state.prefs, [name]: { v, t: stamp() } }; save(); }

  // what syncs (the rest, like the open tab, stays per device), and how two copies merge: for each check-off, item,
  // countdown, day letter and pref, the newer change wins; a delete or uncheck newer than the item undoes it
  const SYNCED = ["done", "undone", "manual", "letters", "lettersAt", "countdowns", "removed", "prefs", "notes", "quotes", "myQuotes", "qlog"];
  const syncedPart = (s) => Object.fromEntries(SYNCED.map((k) => [k, s?.[k] ?? (Array.isArray(state[k]) ? [] : {})]));
  function mergeState(a, b) {
    const tm = (v) => (typeof v === "string" ? v : ""), max = (...xs) => xs.map(tm).sort().at(-1) || "";
    const out = { done: {}, undone: {}, manual: [], letters: {}, lettersAt: {}, countdowns: [], removed: {}, prefs: {}, notes: {}, quotes: {}, myQuotes: [], qlog: {} };
    for (const k of new Set([a.done, b.done, a.undone, b.undone].flatMap((m) => Object.keys(m || {})))) {
      const on = a.done?.[k] ?? b.done?.[k], onT = max(a.done?.[k], b.done?.[k]), offT = max(a.undone?.[k], b.undone?.[k]);
      if (on != null && onT >= offT) out.done[k] = onT || on; // a check-off from before times were kept counts as oldest
      else if (offT) out.undone[k] = offT;
    }
    for (const k of new Set([a.removed, b.removed].flatMap((m) => Object.keys(m || {})))) out.removed[k] = max(a.removed?.[k], b.removed?.[k]);
    const list = (xa = [], xb = [], id) => {
      const m = new Map(), t = (x) => tm(x.t) || tm(x.added);
      for (const x of [...xa, ...xb]) { const cur = m.get(x[id]); if (!cur || t(x) > t(cur)) m.set(x[id], x); }
      return [...m.values()].filter((x) => !(out.removed[x[id]] > t(x)));
    };
    out.manual = list(a.manual, b.manual, "uid");
    out.countdowns = list(a.countdowns, b.countdowns, "id");
    out.myQuotes = list(a.myQuotes, b.myQuotes, "id");
    for (const d of new Set([a.qlog, b.qlog].flatMap((m) => Object.keys(m || {})))) out.qlog[d] = Math.max(a.qlog?.[d] || 0, b.qlog?.[d] || 0);
    for (const d of new Set([a.letters, b.letters, a.lettersAt, b.lettersAt].flatMap((m) => Object.keys(m || {})))) {
      const ta = tm(a.lettersAt?.[d]), tb = tm(b.lettersAt?.[d]), from = tb > ta ? b : ta > tb ? a : a.letters?.[d] ? a : b;
      if (from.letters?.[d]) out.letters[d] = from.letters[d];
      if (ta || tb) out.lettersAt[d] = max(ta, tb);
    }
    // settings, each item's notes / steps / links, and each quote's progress go by the newer edit
    for (const f of ["prefs", "notes", "quotes"]) {
      for (const k of new Set([a[f], b[f]].flatMap((m) => Object.keys(m || {})))) {
        const pa = a[f]?.[k], pb = b[f]?.[k];
        out[f][k] = !pa ? pb : !pb ? pa : tm(pb.t) > tm(pa.t) ? pb : pa;
      }
    }
    return out;
  }

  // ---------- dates (all local, as YYYY-MM-DD) ----------
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const isWeekend = (s) => [0, 6].includes(parse(s).getDay());
  const offName = (s) => homework?.off?.[s] || null; // holidays from Muse
  const isSchoolDay = (s) => !isWeekend(s) && !offName(s);
  const nextSchoolDay = (s) => { let d = addDays(s, 1); while (!isSchoolDay(d)) d = addDays(d, 1); return d; };
  const fmt = (s, o = { weekday: "short", month: "short", day: "numeric" }) => parse(s).toLocaleDateString(undefined, o);
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);

  // ?date=YYYY-MM-DD&time=HH:MM previews another day; the preview clock runs on from page load
  const shift = (() => {
    const q = new URLSearchParams(location.search);
    const d = new Date(), t0 = d.getTime();
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get("date") || "")) {
      const [y, m, dd] = q.get("date").split("-").map(Number);
      d.setFullYear(y, m - 1, dd);
    }
    if (/^\d{1,2}:\d{2}$/.test(q.get("time") || "")) {
      const [h, mi] = q.get("time").split(":").map(Number);
      d.setHours(h, mi, 0, 0);
    }
    return d.getTime() - t0;
  })();
  const now = () => new Date(Date.now() + shift);
  const today = () => iso(now());
  // After 3:30 the planner looks ahead to the next school day
  const schoolDay = () => {
    const n = now(), t = today();
    return !isSchoolDay(t) || n.getHours() * 60 + n.getMinutes() >= 15 * 60 + 30 ? nextSchoolDay(t) : t;
  };

  function relDay(s) {
    const n = daysBetween(today(), s);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n === -1) return "Yesterday";
    if (n > 1 && n < 7) return fmt(s, { weekday: "long" });
    return fmt(s);
  }

  // School times are written 8:30 … 2:00; anything before 7 is afternoon.
  function minutes(t) {
    let [h, m] = t.split(":").map(Number);
    if (h < 7) h += 12;
    return h * 60 + m;
  }

  // ---------- day letters ----------
  function letterFor(date) {
    if (offName(date)) return { letter: null, from: "off" };
    if (state.letters[date]) return { letter: state.letters[date], from: "you" };
    const muse = homework?.days?.[date];
    if (muse) return { letter: muse, from: "blackbaud" };
    const g = schedule.weekday_guess?.[parse(date).getDay()];
    if (g) return { letter: g, from: "guess" };
    return { letter: null, from: null };
  }

  // ---------- assignments ----------
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  const keyOf = (a) => "h" + hash([a.class, a.title, a.due].map((x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ")).join("|"));

  function allItems() {
    const out = new Map();
    const alias = { "Math-Sci": "MSI", "Math-Sci Investigations": "MSI", FGC: "Forces", "Forces of Global Change": "Forces", Art: "Arts", "Health & Wellness": "Health" };
    for (const raw of homework?.assignments || []) {
      if (!raw?.title || !raw?.due) continue;
      const a = alias[raw.class] ? { ...raw, class: alias[raw.class] } : raw;
      const id = keyOf(a);
      out.set(id, { ...a, id, keys: [id], manual: false });
    }
    for (const m of state.manual) {
      const k = keyOf(m);
      if (out.has(k)) { out.get(k).keys.push(m.uid); continue; } // Blackbaud caught up: merge
      out.set(m.uid, { ...m, id: m.uid, keys: [m.uid], manual: true });
    }
    return [...out.values()].sort((a, b) => a.due.localeCompare(b.due) || (MAJOR.has(b.type) - MAJOR.has(a.type)) || a.class.localeCompare(b.class));
  }
  const isDone = (it) => it.keys.some((k) => state.done[k]);
  const pad4 = (id) => String(parseInt(hash(id), 36) % 10000).padStart(4, "0");

  // ---------- rendering ----------
  const cls = (name) => schedule.classes[name] || schedule.classes.Other;
  const cc = (name) => { const c = cls(name).color; return `--cc:var(--c-${c});--cp:var(--p-${c},var(--c-${c}));--ct:var(--t-${c},var(--surface))`; };

  // Next time a class meets, walking the day letters forward. "?" when a guessed or unknown letter is in the way.
  function nextMeeting(name) {
    const t = today(), mins = now().getHours() * 60 + now().getMinutes();
    let d = schoolDay(), unsure = false; // after school, start from tomorrow
    for (let i = 0; i < 21; i++, d = addDays(d, 1)) {
      if (!isSchoolDay(d)) continue;
      const { letter, from } = letterFor(d);
      if (!letter) { unsure = true; continue; }
      if (from === "guess") unsure = true;
      const p = schedule.rotations[letter]?.periods.find((x) => x[1] === name);
      if (!p || (d === t && mins >= minutes(p[0]))) continue;
      return { date: d, time: p[0], unsure };
    }
    return null;
  }

  function itemHTML(it, { showDue = false, overdue = false } = {}) {
    const done = isDone(it);
    const major = MAJOR.has(it.type);
    const meta = [
      `<span class="chip">${esc(it.class)}</span>`,
      major ? `<span class="tag">${esc(it.type)}</span>` : "",
      it.unconfirmed ? `<span class="tag unsure">Unconfirmed</span>` : "",
      overdue ? `<span class="tag bad">Overdue</span>` : "",
      showDue ? `<span>due ${esc(relDay(it.due))}</span>` : "",
      it.manual ? `<span class="mine">yours</span>` : "",
    ].filter(Boolean).join("");
    const nt = state.notes?.[it.id], steps = nt?.steps || [], ic = (d, label) => `<svg viewBox="0 0 24 24" aria-label="${label}" role="img"><path d="${d}"/></svg>`;
    const marks = [
      nt?.text?.trim() ? ic("M5 4h14v16H5zM8.5 9h7M8.5 13h7M8.5 17h4", "Has notes") : "",
      steps.length ? `<span class="mk-steps" title="Steps done">${steps.filter((x) => x.done).length}/${steps.length}</span>` : "",
      nt?.links?.length ? ic("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", "Has links") : "",
      imgCount[it.id] ? ic("M4 6h16v13H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01", "Has photos") : "",
    ].filter(Boolean).join("");
    const nm = !done && nextMeeting(it.class);
    const next = nm ? `<span class="next" title="${nm.unsure ? "Based on a guessed day letter" : ""}">next class ${esc(/^(Today|Tomorrow)$/.test(relDay(nm.date)) ? relDay(nm.date).toLowerCase() : relDay(nm.date))} ${esc(nm.time)}${nm.unsure ? "?" : ""}</span>` : "";
    return `<li class="item${done ? " done" : ""}${major && !done ? " major" : ""}${overdue ? " overdue" : ""}" style="${cc(it.class)}" data-id="${esc(it.id)}">
      <input type="checkbox" class="check" ${done ? "checked" : ""} aria-label="Done: ${esc(it.title)}">
      <div class="body" role="button" tabindex="0" aria-label="Open ${esc(it.title)}">
        <span class="title">${esc(it.title)}</span>
        <span class="meta">${meta}${next}${marks ? `<span class="marks">${marks}</span>` : ""}</span>
        ${it.details ? `<span class="det">${esc(it.details)}</span>` : ""}
      </div>
      ${it.manual ? `<button class="edit" type="button" data-edit="${esc(it.id)}">Edit</button>` : "<span></span>"}
    </li>`;
  }

  const phone = matchMedia("(max-width:759px)");
  phone.addEventListener("change", () => { if (schedule) renderBar(); });
  function renderBar() {
    const t = today(), day = schoolDay();
    const { letter, from } = letterFor(day);
    const sel = $("#letter-select");
    sel.innerHTML = `<option value="">?</option>` + LETTERS.map((l) => `<option ${l === letter ? "selected" : ""}>${l}</option>`).join("");
    sel.dataset.date = day;

    // phones share the top row with the theme icon, so the date is shortened there
    $("#bar-date").textContent = day === t
      ? fmt(t, phone.matches ? { weekday: "short", month: "short", day: "numeric" } : { weekday: "long", month: "long", day: "numeric" })
      : `Next up: ${fmt(day, { weekday: "short", month: "short", day: "numeric" })}`;
    const rot = letter && schedule.rotations[letter];
    const sub = [];
    if (!letter) sub.push("Tap ? to set the day letter");
    else {
      sub.push(`${letter} day`);
      if (from === "guess") sub.push("guessed, tap to fix");
      if (from === "you") sub.push("set by you");
      if (rot && !rot.confirmed) sub.push("<b>times unconfirmed</b>");
    }
    const sp = homework?.special?.[day];
    if (sp) sub.push(`<b>${esc(sp)}</b>`);
    $("#bar-sub").innerHTML = sub.join(" · ");

    const el = $("#updated");
    const at = homework?.updated_at ? new Date(homework.updated_at) : null;
    if (!at || isNaN(at)) {
      el.className = "bar-status stale";
      el.innerHTML = `<span class="pill"><span class="dot"></span>Homework hasn't loaded</span>`;
      return;
    }
    const hrs = (now() - at) / 36e5;
    const ago = hrs < 1 / 60 ? "just now" : hrs < 1 ? `${Math.round(hrs * 60)}m ago` : hrs < 24 ? `${Math.floor(hrs)}h ago` : `${Math.floor(hrs / 24)}d ago`;
    const when = at.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const stale = hrs > STALE_HOURS;
    el.className = "bar-status" + (stale ? " stale" : "");
    el.innerHTML = `<span class="pill" title="Homework last updated ${esc(when)}"><span class="dot"></span>${stale ? `Homework is ${ago.replace(" ago", "")} old · check Blackbaud` : `Homework updated ${ago}`}</span>`;
    skinBar();
  }

  // One row per bell slot; a class in a split slot (the 4th block) gets one segment per part.
  // Homeroom, lunch and the Tuesday hall block are events: not classes, but part of the day.
  const hallOn = (day) => schedule.hall && day && parse(day).getDay() === schedule.hall.weekday;
  function dayRows(letter, day) {
    const rot = letter && schedule.rotations[letter];
    if (!rot) return [];
    const at = Object.fromEntries(rot.periods);
    const ev = (kind, b, label) => ({ kind, bell: b, segs: [{ start: b.start, end: b.end, label, ev: true, edge: kind !== "lunch" }] });
    return schedule.bells.map((b) => {
      if (b.lunch) return ev("lunch", b, "Lunch");
      if (b.homeroom) return ev("homeroom", b, "Homeroom");
      const name = at[b.start];
      if (!name && hallOn(day) && schedule.hall.start === b.start) return ev("hall", schedule.hall, "Hall");
      const label = name ? cls(name).name : "Free";
      const parts = b.parts || [[b.start, b.end]];
      return {
        kind: name ? "class" : "free", name, bell: b,
        segs: parts.map(([s, e], i) => ({ start: s, end: e, label: parts.length > 1 ? `${label} (part ${i + 1} of 2)` : label, name })),
      };
    });
  }

  const passing = () => schedule.passing || 5;
  // the card counts down to the second: m:ss, or h:mm:ss over an hour
  const clock = (minsLeft) => {
    const sec = Math.max(0, Math.ceil(minsLeft * 60 - 1e-6)), h = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60);
    return h ? `${h}:${pad(mm)}:${pad(sec % 60)}` : `${mm}:${pad(sec % 60)}`;
  };
  const where = (name) => (name ? cls(name).room || "" : "");
  // A free has no bell to beat: its split parts, the passing time around it and back-to-back frees
  // are all one stretch that runs right up to the next class or event.
  const isFree = (s) => !s.name && !s.ev;
  function mergeFree(segs) {
    const out = [];
    segs.forEach((s, i) => {
      const nx = segs[i + 1], prev = out.at(-1);
      if (isFree(s) && prev && isFree(prev)) prev.end = s.end;
      else out.push(isFree(s) ? { ...s, label: "Free" } : { ...s });
      if (isFree(out.at(-1)) && nx) out.at(-1).end = nx.start; // the gap after a free is free too
    });
    return out;
  }

  // a special schedule shifts the times, so the normal ones for that letter are never shown
  const special = (day) => homework?.special?.[day] || "";

  function nowCard(rows, isToday, day, letter) {
    const after = schedule.after_school;
    if (special(day)) {
      return `<div class="big"><span class="lbl">${isToday ? "Special schedule today" : `${esc(fmt(day, { weekday: "long" }))} is a special schedule`}</span></div>
        <div class="sub"><b>${esc(special(day))}</b> · check the portal for times</div>`;
    }
    if (!rows.length) return `<div class="big"><span class="lbl">Set the day letter to see your classes</span></div>`;
    const firstClass = rows.flatMap((r) => r.segs).find((s) => s.name);
    if (!isToday) {
      return `<div class="big"><span class="lbl">${esc(fmt(day, { weekday: "long" }))} is ${/^[AEFH]/.test(letter) ? "an" : "a"} ${letter} day</span></div>
        <div class="sub">First class: <b>${esc(firstClass ? cls(firstClass.name).name : "none")}</b>${firstClass ? ` at ${firstClass.start} in ${esc(where(firstClass.name))}` : ""}</div>`;
    }
    // ignore free time before the first class and after the last
    const segs = rows.flatMap((r) => r.segs);
    const firstI = segs.findIndex((s) => s.name || s.edge), lastI = segs.length - 1 - [...segs].reverse().findIndex((s) => s.name);
    const day_ = mergeFree(segs.slice(firstI, lastI + 1));
    const t_ = now(), m = t_.getHours() * 60 + t_.getMinutes() + (t_.getSeconds() + t_.getMilliseconds() / 1000) / 60;
    const nextAfter = (i) => day_.slice(i + 1).find((s) => s.name || s.ev);
    const nextLine = (n) => n ? `Then <b>${esc(n.label)}</b> at ${n.start}${n.name ? ` in ${esc(where(n.name))}` : ""}` : "Last one today";

    if (m < minutes(day_[0].start)) {
      return `<div class="big"><span class="num">${clock(minutes(day_[0].start) - m)}</span><span class="lbl">until school</span></div>
        <div class="sub">First: <b>${esc(day_[0].label)}</b> at ${day_[0].start}${day_[0].name ? ` in ${esc(where(day_[0].name))}` : ""}</div>`;
    }
    if (m >= minutes(day_.at(-1).end)) {
      return `<div class="big"><span class="lbl">Done with classes for today</span></div>${after ? `<div class="sub">Next: <b>${esc(after.name)}</b></div>` : ""}`;
    }
    for (let i = 0; i < day_.length; i++) {
      const s = day_[i], a = minutes(s.start), b = minutes(s.end);
      if (m >= a && m < b) {
        const pct = Math.round(((m - a) / (b - a)) * 100);
        const nx = day_[i + 1], gap = nx ? minutes(nx.start) - b : 0;
        const gapTxt = gap > 0 && gap <= passing() ? `${gap} min ${nx.name && nx.name === s.name ? "break" : "passing"} · ` : "";
        return `<div class="big" style="${s.name ? cc(s.name) : ""}"><span class="num">${clock(b - m)}</span><span class="lbl">left in ${esc(s.label)}</span></div>
          <div class="prog" style="${s.name ? cc(s.name) : ""}"><i style="width:${pct}%"></i></div>
          <div class="sub">Ends ${s.end} · ${gapTxt}${nextLine(nextAfter(i))}</div>`;
      }
      const n = day_[i + 1];
      if (n && m >= b && m < minutes(n.start)) {
        return `<div class="big" style="${n.name ? cc(n.name) : ""}"><span class="num">${clock(minutes(n.start) - m)}</span><span class="lbl">until ${esc(n.label)}</span></div>
          <div class="sub">${n.name && n.name === s.name ? "Short break · same room" : `Passing time${n.name ? ` · head to <b>${esc(where(n.name))}</b>` : ""}`}</div>`;
      }
    }
    return "";
  }

  // Where today stands, for study mode and the scoreboard clock: in a block, passing between blocks,
  // before the first bell, or outside school hours. `day` is the day's blocks from first to last; `i` indexes it.
  function periodNow() {
    const t = today();
    if (!isSchoolDay(t)) return { mode: "off" };
    if (special(t)) return { mode: "special", note: special(t) };
    const segs = dayRows(letterFor(t).letter, t).flatMap((r) => r.segs);
    if (!segs.some((s) => s.name)) return { mode: "off" };
    const firstI = segs.findIndex((s) => s.name || s.edge), lastI = segs.length - 1 - [...segs].reverse().findIndex((s) => s.name);
    const day = mergeFree(segs.slice(firstI, lastI + 1));
    const n = now(), m = n.getHours() * 60 + n.getMinutes() + (n.getSeconds() + n.getMilliseconds() / 1000) / 60;
    const start = minutes(day[0].start), end = minutes(day.at(-1).end);
    const base = { day, m, start, end };
    if (m >= end) return { ...base, mode: "after" };
    if (m < start) return { ...base, mode: m < start - 60 ? "off" : "before", left: start - m, next: day[0], i: -1 };
    for (let i = 0; i < day.length; i++) {
      const s = day[i], a = minutes(s.start), b = minutes(s.end), nx = day[i + 1];
      if (m >= a && m < b) return { ...base, mode: "class", seg: s, i, left: b - m, pct: (m - a) / (b - a), next: day.slice(i + 1).find((x) => x.name || x.ev), gap: nx ? minutes(nx.start) - b : 0 };
      if (nx && m >= b && m < minutes(nx.start)) return { ...base, mode: "passing", seg: s, i, left: minutes(nx.start) - m, next: nx };
    }
    return { ...base, mode: "off" };
  }

  // once a second: update the number and bar in place; redraw the card when the block changes
  function tickNow() {
    renderScoreboard();
    const day = schoolDay(), { letter } = letterFor(day);
    const num = $("#now-card .num");
    if (!num) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = nowCard(dayRows(letter, day), day === today(), day, letter);
    const fresh = tmp.querySelector(".num"), bar = tmp.querySelector(".prog i");
    if (!fresh) return;
    if (tmp.querySelector(".lbl")?.textContent !== $("#now-card .lbl")?.textContent) { renderSchedule(); return; }
    if (fresh.textContent === (num.dataset.t || num.textContent)) return;
    num.textContent = fresh.textContent;
    num.dataset.t = fresh.textContent;
    const old = $("#now-card .prog i");
    if (old && bar) old.style.width = bar.style.width;
    skinSchedule();
  }

  function renderSchedule() {
    const t = today(), day = schoolDay(), isToday = day === t;
    const { letter } = letterFor(day);
    const rows = dayRows(letter, day);
    const classes = rows.filter((r) => r.kind === "class").length;
    $("#sched-h").textContent = isToday ? "Today" : relDay(day);
    $("#sched-meta").textContent = letter ? (special(day) ? "Special schedule" : `${classes} classes`) : "";
    $("#now-card").innerHTML = nowCard(rows, isToday, day, letter);
    if (special(day)) {
      $("#timeline").innerHTML = `<li class="empty">Times for this special schedule aren't posted yet.</li>`;
      skinSchedule();
      $("#after").innerHTML = "";
      return;
    }

    const m = now().getHours() * 60 + now().getMinutes();
    const first = rows.findIndex((r) => r.kind === "class");
    const last = rows.length - 1 - [...rows].reverse().findIndex((r) => r.kind === "class");
    const shown = rows.filter((r, i) => !(r.kind === "free" && (i < first || i > last))); // no class yet / already out
    $("#timeline").innerHTML = !rows.length
      ? `<li class="empty">Set the day letter to see classes.</li>`
      : shown.map((r, i) => {
          const nx = shown[i + 1], gap = nx ? minutes(nx.bell.start) - minutes(r.bell.end) : 0;
          const a = minutes(r.bell.start), b = minutes(r.bell.end);
          const live = isToday && r.segs.find((s) => m >= minutes(s.start) && m < minutes(s.end));
          const st = !isToday ? "" : m >= b ? "past" : live ? "now" : "";
          const pct = live ? Math.round(((m - minutes(live.start)) / (minutes(live.end) - minutes(live.start))) * 100) : 0;
          const c = r.name && cls(r.name);
          const isEv = ["lunch", "homeroom", "hall"].includes(r.kind);
          const badge = { lunch: "L", homeroom: "HR", hall: "HL" }[r.kind] || (c ? c.block : "·");
          const tm = r.bell.parts ? r.bell.parts.map((p) => p.join("–")).join("<br>") : `${r.bell.start}–${r.bell.end}`;
          const label = isEv ? r.segs[0].label : c ? c.name : "Free";
          const who = c ? [c.teacher && `<span class="tch">${esc(c.teacher)}</span>`, c.room && `<span class="rm">${esc(c.room)}</span>`].filter(Boolean).join(" · ") : "";
          return `<li class="${r.kind}${isEv ? " ev" : ""} ${st}" style="${r.name ? cc(r.name) : ""}">
            <span class="blk">${badge}</span>
            <span class="cn">${esc(label)}${r.bell.parts && c ? `<span class="split">25 + 15</span>` : ""}${who ? `<span class="who">${who}</span>` : ""}</span>
            <span class="tm">${tm}${gap > 0 && gap <= passing() ? `<small class="pass">+${gap} passing</small>` : ""}</span>
            ${live ? `<span class="prog"><i style="width:${pct}%"></i></span>` : ""}
          </li>`;
        }).join("");
    skinSchedule();
    const af = schedule.after_school;
    $("#after").innerHTML = af ? `After school: <b>${esc(af.name)}</b>, ${esc(af.coach)}` : "";
    renderScoreboard();
    if (`${day}|${letter}` !== schedKey) { schedKey = `${day}|${letter}`; rowsIn(); }
  }

  function renderRotation() {
    const view = state.view === "letters" ? "letters" : "week";
    document.querySelectorAll(".p-week .seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    const day = schoolDay();
    let cols;
    if (view === "week") {
      const d = parse(day);
      const mon = addDays(day, 1 - d.getDay());
      cols = [0, 1, 2, 3, 4].map((i) => {
        const date = addDays(mon, i), { letter, from } = letterFor(date);
        const off = offName(date);
        return { key: date, cur: date === day, top: fmt(date, { weekday: "short" }), letter, off, sp: !off && special(date), q: !off && (!letter || from === "guess") };
      });
    } else {
      const { letter: curL } = letterFor(day);
      cols = LETTERS.map((l) => ({ key: l, cur: l === curL, top: "", letter: l, q: !schedule.rotations[l]?.confirmed }));
    }
    const head = `<colgroup><col class="tmc">${cols.map(() => "<col>").join("")}</colgroup><thead><tr><th></th>${cols.map((c) =>
      `<th class="${c.cur ? "cur" : ""}"${c.off || c.sp ? ` title="${esc(c.off || c.sp)}"` : ""}>${esc(c.top)}<small>${c.off ? "Off" : c.letter || ""}${c.sp ? `<span class="q">*</span>` : ""}${c.q ? `<span class="q">?</span>` : ""}</small></th>`).join("")}</tr></thead>`;
    // a special day's column says so once, at the top, instead of the normal times
    const firstClassBell = schedule.bells.find((b) => !b.lunch && !b.homeroom);
    const rows = schedule.bells.map((b) => {
      if (b.lunch || b.homeroom) return `<tr><td class="tm">${b.start}</td><td class="ev" colspan="${cols.length}">${b.lunch ? "Lunch" : "Homeroom"}</td></tr>`;
      return `<tr><td class="tm">${b.start}</td>${cols.map((c) => {
        if (c.sp) return b === firstClassBell ? `<td class="ev" title="${esc(c.sp)}">Special</td>` : `<td class="x"></td>`;
        const p = c.letter && schedule.rotations[c.letter]?.periods.find((x) => x[0] === b.start);
        if (!p) return view === "week" && hallOn(c.key) && schedule.hall.start === b.start ? `<td class="ev">Hall</td>` : `<td class="x"></td>`;
        return `<td class="${c.cur ? "cur" : ""}" style="${cc(p[1])}" title="${esc(cls(p[1]).name)}">${esc(cls(p[1]).short)}</td>`;
      }).join("")}</tr>`;
    }).join("");
    $("#rot").className = "rot " + view;
    $("#rot").innerHTML = head + `<tbody>${rows}</tbody>`;
    const sps = view === "week" ? cols.filter((c) => c.sp) : [];
    $("#rot-note").textContent = view === "week"
      ? "? = guessed day letter" + sps.map((c) => ` · * ${c.top}: ${c.sp}`).join("")
      : "? = B, E and G times aren't confirmed";
  }

  function groupBy(items) {
    const g = new Map();
    for (const it of items) { if (!g.has(it.due)) g.set(it.due, []); g.get(it.due).push(it); }
    return g;
  }

  // Two school weeks (Mon–Fri) of chips by due date; the picked day's full checklist sits underneath.
  let calWeek = 0, selDay = null, showOverdue = false;
  let notesOpen = false;
  $("#hw-notes").addEventListener("toggle", (e) => { notesOpen = e.target.open; }, true);
  function renderHomework() {
    const t = today();
    const items = allItems();
    const open = items.filter((i) => !isDone(i));
    const overdue = open.filter((i) => i.due < t);
    const byDay = groupBy(items);
    if (!selDay) selDay = schoolDay();

    const anchor = addDays(schoolDay(), 7 * calWeek);
    const mon = addDays(anchor, 1 - (parse(anchor).getDay() || 7));
    const days = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((n) => addDays(mon, n));
    $("#cal-range").textContent = `${fmt(days[0], { month: "short", day: "numeric" })} – ${fmt(days.at(-1), { month: "short", day: "numeric" })}`;
    $("#cal-range").title = calWeek ? "Back to this week" : "";

    const cap = 4;
    $("#cal").innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => `<span class="dow">${d}</span>`).join("") + days.map((d) => {
      const off = offName(d);
      const num = parse(d).getDate();
      if (off) return `<div class="cell off"><div class="top"><b>${num}</b></div><span class="offn">${esc(off)}</span></div>`;
      const list = (byDay.get(d) || []).sort((a, b) => isDone(a) - isDone(b) || MAJOR.has(b.type) - MAJOR.has(a.type));
      const { letter } = letterFor(d);
      const chips = list.slice(0, cap).map((i) => `<span class="chip2${MAJOR.has(i.type) ? " major" : ""}${isDone(i) ? " done" : ""}" style="${cc(i.class)}" data-no="${pad4(i.id)}" title="${esc(i.class)}: ${esc(i.title)}">${esc(i.title)}</span>`).join("");
      const more = list.length > cap ? `<span class="more">+${list.length - cap} more</span>` : "";
      const openList = list.filter((i) => !isDone(i)), big = openList.find((i) => MAJOR.has(i.type));
      const cnt = `<span class="cnt">${openList.length ? `<b>${openList.length}</b> due` : list.length ? "all done" : ""}${big ? `<i style="${cc(big.class)}">${esc(cls(big.class).short || big.class)} ${esc(big.type)}</i>` : ""}</span>`;
      return `<button type="button" class="cell${d === t ? " today" : ""}${d === selDay && !showOverdue ? " sel" : ""}${d < t ? " past" : ""}" data-day="${d}" aria-label="${esc(fmt(d, { weekday: "long", month: "long", day: "numeric" }))}, ${list.length} due">
        <div class="top"><b>${num}</b><span class="lt">${letter || ""}</span></div>${chips}${more}${cnt}</button>`;
    }).join("");

    $("#overdue-bar").innerHTML = overdue.length
      ? `<button type="button" class="overdue-strip" data-overdue>${overdue.length} overdue · tap to see</button>` : "";

    // the checklist for the picked day (or the overdue list)
    let list, head;
    if (showOverdue && overdue.length) { list = overdue; head = "Overdue"; }
    else { showOverdue = false; list = (byDay.get(selDay) || []); head = `${relDay(selDay)}${daysBetween(t, selDay) >= 2 && daysBetween(t, selDay) < 7 ? `, ${fmt(selDay, { month: "short", day: "numeric" })}` : ""}`; }
    list = [...list].sort((a, b) => isDone(a) - isDone(b) || MAJOR.has(b.type) - MAJOR.has(a.type));
    const openN = list.filter((i) => !isDone(i)).length;
    $("#ag-h").textContent = head;
    $("#hw-meta").textContent = list.length ? `${openN} of ${list.length} left` : "";
    $("#agenda").innerHTML = list.length
      ? list.map((i) => itemHTML(i, { overdue: showOverdue, showDue: showOverdue })).join("")
      : `<li class="empty-state">Nothing due${offName(selDay) ? ` (${esc(offName(selDay))})` : ""}.</li>`;
    const notes = homework?.notes || [];
    // closed by default, one line like "Done"; stays open across re-renders once opened
    $("#hw-notes").innerHTML = notes.length ? `<details class="hw-notes"${notesOpen ? " open" : ""}><summary>Notes <span class="count">${notes.length}</span></summary><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>` : "";

    const done = items.filter(isDone).sort((a, b) => b.due.localeCompare(a.due));
    $("#done-count").textContent = done.length;
    const doneToday = Object.values(state.done).filter((v) => typeof v === "string" && iso(new Date(v)) === today()).length;
    $("#done-count").dataset.stage = Math.min(4, doneToday);
    $("#done").innerHTML = done.length ? done.map((i) => itemHTML(i, { showDue: true })).join("") : `<li class="empty-state">Checked-off assignments land here.</li>`;
    renderSeasonal();
    renderTests();
    ring($("#cal .cell.sel"));
  }

  // ---------- tests: tests, quizzes, essays and projects for the next 4 weeks ----------
  // One dense row each in the Tests tab, grouped by week, and the next three as a slim line in Today. Checked off is
  // done, as in the homework list, so it leaves both.
  const tqLeft = (n) => (n === 0 ? "Today" : `${n}d`);
  const tqDay = (d, n) => (n === 0 ? "Today" : n === 1 ? "Tmrw" : n < 7 ? fmt(d, { weekday: "short" }) : fmt(d, { month: "short", day: "numeric" }));
  const tqTag = (i) => `${esc(cls(i.class).short || i.class)} ${esc(i.type)}`;
  function renderTests() {
    // today's are over once the planner has rolled on to the next school day (after 3:30)
    const t = today(), list = testsAhead();
    const nu = $("#nextup");
    nu.hidden = !list.length;
    nu.innerHTML = `<span class="nu-k">Next up</span>${list.slice(0, 3).map((i) => {
      const n = daysBetween(t, i.due);
      return `<span class="nu" style="${cc(i.class)}" data-id="${esc(i.id)}" title="${esc(i.title)}"><b>${tqTag(i)}</b> · ${esc(tqDay(i.due, n))}${n > 1 ? ` · ${n}d` : ""}</span>`;
    }).join("")}`;
    nuFit();
    const monday = (d) => addDays(d, -((parse(d).getDay() + 6) % 7)), wk0 = monday(t), weeks = new Map();
    for (const i of list) { const w = monday(i.due); if (!weeks.has(w)) weeks.set(w, []); weeks.get(w).push(i); }
    const wkName = (w) => (w === wk0 ? "This week" : w === addDays(wk0, 7) ? "Next week" : `Week of ${fmt(w, { month: "short", day: "numeric" })}`);
    $("#tq").innerHTML = list.length ? [...weeks].map(([w, items]) => `<div class="sub-h">${wkName(w)}</div><ul class="tq">${items.map((i) => {
      const n = daysBetween(t, i.due);
      return `<li style="${cc(i.class)}" data-id="${esc(i.id)}"${n === 0 ? ' class="today"' : ""}><span class="tq-n">${tqLeft(n)}</span><span class="tq-c">${tqTag(i)}</span><span class="tq-t" title="${esc(i.title)}">${esc(i.title)}</span><span class="tq-d">${esc(fmt(i.due, { weekday: "short", month: "numeric", day: "numeric" }))}</span></li>`;
    }).join("")}</ul>`).join("")
      : `<p class="empty-state">No tests, quizzes, essays or projects in the next 4 weeks.</p>`;
  }
  function testsAhead() {
    const t = today(), from = schoolDay() === t ? t : addDays(t, 1);
    return allItems().filter((i) => MAJOR.has(i.type) && !isDone(i) && i.due >= from && i.due <= addDays(t, 28));
  }
  // as many chips as fit on the one line (at least one)
  function nuFit() {
    const nu = $("#nextup");
    if (nu.hidden || !nu.clientWidth) return;
    const chips = nu.querySelectorAll(".nu");
    chips.forEach((c) => { c.hidden = false; });
    for (let k = chips.length - 1; k > 0 && nu.scrollWidth > nu.clientWidth; k--) chips[k].hidden = true;
  }
  addEventListener("resize", () => requestAnimationFrame(nuFit));
  $("#nextup").addEventListener("click", (e) => {
    const chip = e.target.closest(".nu[data-id]");
    if (chip) return openItem(chip.dataset.id);
    showPane("tests");
    showTab("more");
    if (matchMedia("(min-width:760px)").matches) $(".p-more").scrollIntoView({ block: "nearest" });
    else window.scrollTo({ top: 0, behavior: "auto" });
  });
  $("#cal").addEventListener("click", (e) => {
    const c = e.target.closest("[data-day]");
    if (!c) return;
    const d = c.dataset.day, dir = showOverdue ? 0 : Math.sign(d.localeCompare(selDay));
    if (!dir && !showOverdue) return;
    ring(c, true);
    swapIn([$("#ag-h"), $("#agenda")], dir, () => { selDay = d; showOverdue = false; renderHomework(); });
  });
  $("#overdue-bar").addEventListener("click", (e) => {
    if (e.target.closest("[data-overdue]")) { showOverdue = !showOverdue; renderHomework(); }
  });
  document.querySelector(".cal-nav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cal]");
    if (!b) return;
    const n = Number(b.dataset.cal), dir = n === 0 ? Math.sign(-calWeek) : n;
    ringHide();
    swapIn([$("#cal")], dir, () => {
      calWeek = n === 0 ? 0 : calWeek + n * 2;
      if (n === 0) selDay = schoolDay();
      renderHomework();
    }, 28);
  });

  // ---------- teams (ESPN's public schedule feed) ----------
  const teamData = {};
  let teamTimer;
  const gameTime = (iso_) => new Date(iso_).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  async function loadTeams() {
    clearTimeout(teamTimer);
    await Promise.all((schedule.teams || []).map(async (t) => {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${t.sport}/${t.league}/teams/${t.id}/schedule`);
        if (r.ok) teamData[t.id] = await r.json();
      } catch {}
    }));
    renderTeams();
    const live = Object.values(teamData).some((d) => d.events?.some((e) => e.competitions[0].status.type.state === "in"));
    teamTimer = setTimeout(loadTeams, live ? 60_000 : 20 * 60_000);
  }
  function renderTeams() {
    const html = (schedule.teams || []).map((t) => {
      const d = teamData[t.id];
      if (!d) return `<div class="team"><span></span><div><div class="tn">${esc(t.name)}</div><div class="ln">Scores unavailable right now</div></div></div>`;
      const me = d.team, evs = d.events || [];
      const st = (e) => e.competitions[0].status.type;
      const live = evs.find((e) => st(e).state === "in");
      const last = [...evs].reverse().find((e) => st(e).completed);
      const next = evs.find((e) => st(e).state === "pre");
      const sides = (e) => {
        // the schedule feed has no live scores; the scoreboard does
        const fresh = boards[t.league]?.events?.find((x) => x.id === e.id);
        const c = (fresh || e).competitions[0].competitors;
        const us = c.find((x) => x.team.abbreviation === me.abbreviation) || c[0], them = c.find((x) => x !== us);
        return { us, them, at: us.homeAway === "home" ? "vs" : "@" };
      };
      const lines = [];
      if (live) {
        const { us, them, at } = sides(live);
        lines.push(`<div class="ln click" data-game="${esc(live.id)}" data-lg="${t.league}"><span class="live-dot"></span><b>${esc(st(live).shortDetail)}</b> <span class="score">${esc(us.score?.displayValue ?? us.score ?? 0)}–${esc(them.score?.displayValue ?? them.score ?? 0)}</span> ${at} ${esc(them.team.abbreviation)}</div>`);
      }
      if (last && last !== live) {
        const { us, them, at } = sides(last);
        lines.push(`<div class="ln click" data-game="${esc(last.id)}" data-lg="${t.league}"><span class="${us.winner ? "w" : "l"}">${us.winner ? "W" : "L"}</span> <span class="score">${esc(us.score?.displayValue)}–${esc(them.score?.displayValue)}</span> ${at} ${esc(them.team.abbreviation)} · ${esc(new Date(last.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</div>`);
      }
      if (next) {
        const { them, at } = sides(next);
        const tv = next.competitions[0].broadcasts?.map((b) => b.media?.shortName).filter(Boolean)[0];
        lines.push(`<div class="ln click" data-game="${esc(next.id)}" data-lg="${t.league}">Next <b>${at} ${esc(them.team.shortDisplayName || them.team.abbreviation)}</b> ${esc(gameTime(next.date))}${tv ? ` · ${esc(tv)}` : ""}</div>`);
      } else if (!live) lines.push(`<div class="ln">No upcoming games listed</div>`);
      return `<div class="team${live ? " live" : ""}"><img src="${esc(me.logo)}" alt="" loading="lazy">
        <div><div class="tn">${esc(t.name)} <span class="rec">${esc(me.recordSummary || "")}${me.standingSummary ? ` · ${esc(me.standingSummary.replace(/ Division$/, ""))}` : ""}</span></div>${lines.join("")}</div></div>`;
    }).join("");
    $("#teams").innerHTML = html;
    renderGameNight();
    const liveT = (schedule.teams || []).map((t) => {
      const ev = boards[t.league]?.events?.find((e) => evState(e).state === "in" && e.competitions[0].competitors.some((c) => c.team.abbreviation === t.id.toUpperCase()));
      if (!ev) return "";
      const c = ev.competitions[0].competitors, us = c.find((x) => x.team.abbreviation === t.id.toUpperCase()), them = c.find((x) => x !== us);
      return `<span class="live-dot"></span>${esc(t.name)} ${esc(us.score)}–${esc(them.score)} · ${esc(evState(ev).shortDetail)}`;
    }).filter(Boolean);
    const nextT = (schedule.teams || []).map((t) => {
      const n = teamData[t.id]?.events?.find((e) => evState(e).state === "pre");
      return n ? `${t.name} ${new Date(n.date).toLocaleDateString(undefined, { weekday: "short" })}` : "";
    }).filter(Boolean);
    tease("t-teams", liveT.length ? liveT.join(" · ") : nextT.length ? `Next: ${esc(nextT.join(", "))}` : "");
  }

  // ---------- countdowns (yours, saved in this browser) ----------
  function schoolDaysUntil(d) {
    let n = 0;
    for (let x = addDays(today(), 1); x <= d; x = addDays(x, 1)) if (isSchoolDay(x)) n++;
    return n;
  }
  function renderCounts() {
    const t = today();
    const list = (state.countdowns || []).filter((c) => c.date >= t).sort((a, b) => a.date.localeCompare(b.date));
    tease("t-count", list[0] ? `${esc(list[0].title)} · ${daysBetween(t, list[0].date)}d` : "Add one");
    $("#counts").innerHTML = list.length
      ? list.map((c) => {
          const n = daysBetween(t, c.date);
          return `<li class="${n <= 3 ? "soon" : ""}"><span class="n">${n === 0 ? "Today" : n}${n ? `<small>day${n === 1 ? "" : "s"}</small>` : ""}</span>
            <span class="t">${esc(c.title)}<small>${esc(fmt(c.date, { weekday: "short", month: "short", day: "numeric" }))}${n > 1 ? ` · ${schoolDaysUntil(c.date)} school days` : ""}</small></span>
            <button class="x" type="button" data-count="${esc(c.id)}" aria-label="Remove ${esc(c.title)}">×</button></li>`;
        }).join("")
      : `<li class="empty-state" style="display:block">Add a break, a game, a trip, anything with a date.</li>`;
  }
  $("#count-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#c-title").value.trim(), date = $("#c-date").value;
    if (!title || !date) return;
    (state.countdowns ||= []).push({ id: "c" + Date.now().toString(36), title, date, t: stamp() });
    save();
    $("#c-title").value = "";
    $("#c-date").value = "";
    renderCounts();
  });
  $("#counts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-count]");
    if (!b) return;
    const i = state.countdowns.findIndex((c) => c.id === b.dataset.count);
    const [gone] = state.countdowns.splice(i, 1);
    state.removed[gone.id] = stamp();
    save();
    renderCounts();
    toast("Removed", () => { state.countdowns.splice(i, 0, gone); delete state.removed[gone.id]; gone.t = stamp(); save(); renderCounts(); });
  });

  // ---------- fantasy (fantasy.json, posted by Muse; moves from Muse and Claude) ----------
  let fantasy = null;
  // positions keep fixed colors; bench and IR stay plain
  const POS_C = { QB: "fgc", RB: "msi", WR: "eng", TE: "latin", FLEX: "fr", "W/R/T": "fr", OP: "fr", K: "glee", DST: "arts", DEF: "arts", "D/ST": "arts" };
  const pos = (slot) => `<span class="pos" style="${POS_C[(slot || "").toUpperCase()] ? tintOf(POS_C[slot.toUpperCase()]) : "--cc:var(--muted);--ct:var(--surface)"}">${esc(slot || "–")}</span>`;
  const MOVE_C = { add: "msi", pickup: "msi", waiver: "msi", drop: "fgc", start: "eng", sit: "other", bench: "other", trade: "fr" };
  const logo = (abbr) => abbr ? `<img class="tlogo" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/${encodeURIComponent(abbr.toLowerCase())}.png&w=40&h=40" alt="" loading="lazy" onerror="this.remove()">` : "";
  function renderFantasy() {
    const f = fantasy;
    if (!f || !f.lineup?.length) {
      $("#ff-meta").textContent = "";
      tease("t-ff", "Waiting on Muse");
      // an empty lineup card, so the box shows its shape until Muse posts
      $("#ff").innerHTML = `<div class="ff-match"><div class="side"><b>–</b>You</div><span class="vs">VS</span><div class="side"><b>–</b>Opponent</div></div>
        <div class="sub-h">Starters</div>
        <table class="ff-table ff-skel">${["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST"].map((s) => `<tr><td class="slot">${pos(s)}</td><td class="pl"><span class="ph"></span></td><td class="pj">–</td></tr>`).join("")}</table>
        <p class="empty-state">Waiting on Muse to post your lineup. Suggested moves from Muse and Claude will show here too.</p>`;
      return;
    }
    const at = f.updated_at ? new Date(f.updated_at) : null;
    $("#ff-meta").textContent = [f.week ? `Week ${f.week}` : "", f.record, at ? `updated ${at.toLocaleDateString(undefined, { weekday: "short" })}` : ""].filter(Boolean).join(" · ");
    // a 0–0 score saved before any of the week's games kicked off is not a live score: show projections
    const kicked = [...(f.lineup || []), ...(f.bench || [])].some((p) => p.kickoff && at && new Date(p.kickoff) <= at);
    const m = f.matchup && (kicked || +f.matchup.my_score || +f.matchup.opp_score ? f.matchup : { ...f.matchup, my_score: null, opp_score: null });
    tease("t-ff", esc([f.week ? `Wk ${f.week}` : "", m ? `${m.my_score ?? m.my_proj}–${m.opp_score ?? m.opp_proj}${m.my_score != null ? "" : " proj"}` : "", f.moves?.length ? `${f.moves.length} moves` : ""].filter(Boolean).join(" · ")));
    const score = (a, b) => (a ?? b ?? "–");
    // your share of the combined score, for the bar under the matchup
    const share = (m) => { const a = +(m.my_score ?? m.my_proj), b = +(m.opp_score ?? m.opp_proj); return a + b > 0 ? Math.round((a / (a + b)) * 100) : null; };
    const row = (p) => {
      const out = /^(O|IR|OUT)$/i.test(p.status || "");
      return `<tr><td class="slot">${pos(p.slot)}</td><td class="pl">${logo(p.team)}${esc(p.player)}${p.status ? `<span class="st${out ? " out" : ""}">${esc(p.status)}</span>` : ""}<small>${esc([p.team, p.opp, p.kickoff ? gameTime(p.kickoff) : ""].filter(Boolean).join(" · "))}</small></td><td class="pj">${p.points ?? p.proj ?? ""}</td></tr>`;
    };
    $("#ff").innerHTML = `
      ${m ? `<div class="ff-match"><div class="side"><b>${score(m.my_score, m.my_proj)}</b>${esc(f.team || "You")}</div><span class="vs">${m.my_score != null ? "LIVE" : "PROJ"}</span><div class="side"><b>${score(m.opp_score, m.opp_proj)}</b>${esc(m.opponent || "")}</div>${share(m) != null ? `<div class="ff-bar"><i style="width:${share(m)}%"></i></div>` : ""}</div>` : ""}
      ${f.moves?.length ? `<div class="sub-h">Suggested moves</div><ul class="moves">${f.moves.map((x) => `<li style="${tintOf(MOVE_C[(x.kind || "").toLowerCase()] || "other")}"><span class="by"><i>${esc(x.by || "")}</i>${x.kind ? ` · ${esc(x.kind)}` : ""}</span>${esc(x.text)}${x.why ? `<span class="why">${esc(x.why)}</span>` : ""}</li>`).join("")}</ul>` : ""}
      <div class="sub-h">Starters</div><table class="ff-table">${f.lineup.map(row).join("")}</table>
      ${f.bench?.length ? `<details><summary>Bench <span class="count">${f.bench.length}</span></summary><table class="ff-table">${f.bench.map(row).join("")}</table></details>` : ""}`;
  }

  // ---------- music: Spotify or Lofi Girl ----------
  // One card, the same height for either source: a 16:9 stage over a slim bar. Spotify's stage is what Brian is
  // playing on his account (once connected), else the link he pasted, else an empty state; nothing plays until he
  // picks something. Lofi Girl is the 24/7 YouTube stream. Each skin dresses the card; --sp-embed (dark | art)
  // picks the embed's own look.
  const SP = "rlp-spotify", SRC = "rlp-music-src", SPA = "rlp-sp-auth";
  const SP_OLD_DEFAULT = "37i9dQZF1DWWQRwui0ExPn"; // the playlist the card used to start on; saved copies of it load as nothing picked
  // "lofi hip hop radio 📚 beats to relax/study to", live since Aug 19 2026 (checked Nov 3; the 2022 stream ended in May).
  // Lofi Girl runs several streams at once and the channel's live link currently points at the Christmas one, so
  // the stream is pinned by id; if it restarts again, put the new id here (youtube.com/@LofiGirl/streams).
  const LOFI = { id: "rFZHOHl-L8A", title: "lofi hip hop radio", sub: "Lofi Girl · live" };
  // School networks often block YouTube, so the Lofi tab can also play plain audio streams (no YouTube involved).
  // "auto" plays the video unless a YouTube image fails to load on this network; the bar switches by hand.
  const RADIO = [
    { id: "chillhop", name: "Chillhop Radio", sub: "Chillhop Music on FluxFM", url: "https://streams.fluxfm.de/Chillhop/mp3-128/audio/" },
    { id: "laut", name: "Lofi Radio", sub: "laut.fm", url: "https://stream.laut.fm/lofi", now: "https://api.laut.fm/station/lofi/current_song" },
  ];
  const LOFI_MODE = "rlp-lofi-mode", RADIO_ST = "rlp-radio";
  // ?ytblocked previews the Lofi tab as it looks on a network that blocks YouTube
  let lofiMode = ["video", "radio"].includes(jgetRaw(LOFI_MODE)) ? jgetRaw(LOFI_MODE) : "auto", ytBlocked = new URLSearchParams(location.search).has("ytblocked") || null;
  let radioSt = RADIO.find((r) => r.id === jgetRaw(RADIO_ST)) || RADIO[0], radioOn = false, radioMsg = "", radioNow = "";
  function jgetRaw(k) { try { return localStorage.getItem(k); } catch { return null; } }
  const lofiRadio = () => lofiMode === "radio" || (lofiMode === "auto" && ytBlocked === true);
  const spParse = (s) => {
    const m = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?|spotify:)(playlist|album|track|episode|show|artist)[/:]([A-Za-z0-9]{22})/.exec(s || "");
    return m && { type: m[1], id: m[2] };
  };
  const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  let sp = (() => { const v = jget(SP, null); return v && v.id !== SP_OLD_DEFAULT && spParse(`spotify:${v.type}:${v.id}`) ? { type: v.type, id: v.id } : null; })();
  let musicSrc = jget(SRC, "spotify") === "lofi" ? "lofi" : "spotify";
  let spA = jget(SPA, {}); // { client, access, refresh, exp, noControl } — this browser only, never in the repo
  let np = null, npAt = 0, spMsg = "", spSetup = false, spPasting = false, spBad = false;
  const spSave = () => jset(SP, sp);
  // ?npdemo previews the now-playing card with a made-up track, no account needed
  const NP_DEMO = new URLSearchParams(location.search).has("npdemo");
  const spConnected = () => NP_DEMO || !!(spA.access && spA.refresh);
  // the now-playing card stays up for a paused track too; only "nothing on the account" falls back to the player
  const npShown = () => musicSrc === "spotify" && spConnected() && !!np?.item;
  const mmss = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}:${pad(t % 60)}`; };

  function spRender(load) {
    const f = $("#sp-frame");
    if (!f) return;
    const de = document.documentElement, v = getComputedStyle(de).getPropertyValue("--sp-embed").trim();
    const lofi = musicSrc === "lofi", live = npShown(), embed = !lofi && !live && !!sp, empty = !lofi && !live && !sp;
    document.querySelectorAll("[data-src]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.src === musicSrc)));
    const card = $("#sp");
    card.classList.toggle("np", live);
    card.classList.toggle("lofi", lofi);
    card.classList.toggle("empty", empty);
    card.classList.toggle("setup", empty && spSetup);
    $("#sp-np").hidden = !live;
    $("#sp-embed").hidden = !embed;
    const radio = lofi && lofiRadio();
    card.classList.toggle("radio", radio);
    $("#sp-yt").hidden = !lofi || radio;
    $("#sp-radio").hidden = !radio;
    if (lofi && ytBlocked === null && lofiMode === "auto") ytProbe();
    if (!radio && radioOn) radioStop();
    $("#sp-empty").hidden = !empty;
    // only one player makes sound: the hidden one is unloaded (the Spotify one stays loaded under now playing,
    // since what it plays may be what now playing shows)
    const yt = $("#yt-frame"), ytSrc = `https://www.youtube-nocookie.com/embed/${LOFI.id}?rel=0&playsinline=1&modestbranding=1`;
    if (lofi) { if (radio) { if (yt.src) yt.removeAttribute("src"); } else if (load && yt.src !== ytSrc) yt.src = ytSrc; if (f.src) f.removeAttribute("src"); }
    else {
      if (yt.src) yt.removeAttribute("src");
      const src = sp && `https://open.spotify.com/embed/${sp.type}/${sp.id}?utm_source=generator${(v ? v === "dark" : de.dataset.mode === "dark") ? "&theme=0" : ""}`;
      if (!src) { if (f.src) f.removeAttribute("src"); }
      else if ((load || f.src) && f.src !== src) f.src = src;
    }
    spRenderEmpty(empty);
    spRenderBar(lofi, live, embed);
    radioRender();
    spRenderNP();
  }
  const spForm = () => `<form class="sp-form" data-sp-paste><input id="sp-url" inputmode="url" placeholder="Paste a Spotify link" aria-label="Spotify playlist, album or song link" spellcheck="false" autocomplete="off"><button class="btn primary" type="submit">Play</button></form>`;
  function spFocusPaste() { requestAnimationFrame(() => $("#sp-url")?.focus()); }
  // nothing picked: connect, or paste a link (the box opens only when he asks for it)
  function spRenderEmpty(empty) {
    const el = $("#sp-empty");
    if (!empty) { el.innerHTML = ""; return; }
    const err = spMsg ? `<p class="sp-err">${esc(spMsg)}</p>` : "";
    if (spSetup && !spConnected()) { el.innerHTML = spSetupHTML() + err; return; }
    const icon = `<span class="sp-empty-i" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 17.5a3 3 0 1 1-2-2.83V5l11-2v11.5a3 3 0 1 1-2-2.83V7.4l-7 1.27z"/></svg></span>`;
    if (spPasting) {
      el.innerHTML = `${icon}<b>Paste a link</b>${spForm()}
        <p class="${spBad ? "sp-err" : "sp-hint"}">${spBad ? "That isn't a Spotify link. " : ""}In Spotify, tap Share, then Copy link.</p>
        <button class="link" type="button" data-sp="cancel">Cancel</button>`;
      return;
    }
    el.innerHTML = spConnected()
      ? `${icon}<b>Nothing playing on Spotify</b><p>Start something on any device and it shows up here.</p>
        <div class="sp-acts"><button class="btn" type="button" data-sp="paste">Paste a link</button></div>
        <button class="link" type="button" data-sp="disconnect">Disconnect</button>${err}`
      : `${icon}<b>Nothing playing</b><p>Connect to see what you're playing, or paste a playlist, album or song.</p>
        <div class="sp-acts"><button class="btn primary" type="button" data-sp="connect">Connect Spotify</button><button class="btn" type="button" data-sp="paste">Paste a link</button></div>${err}`;
  }
  // the slim bar under the player: what it is on the left, a couple of quiet controls on the right
  function spRenderBar(lofi, live, embed) {
    const el = $("#sp-bar"), dis = spConnected() ? `<button type="button" data-sp="disconnect">Disconnect</button>` : "";
    el.classList.toggle("pasting", embed && spPasting);
    if (embed && spPasting) { el.innerHTML = `${spForm()}<button class="sp-x" type="button" data-sp="cancel" aria-label="Cancel">✕</button>`; return; }
    if (lofi) {
      const radio = lofiRadio(), why = radio && lofiMode === "auto" ? "YouTube's blocked here · " : "";
      el.innerHTML = `<span class="sp-k own">${radio ? `${why}radio` : LOFI.sub}</span><span class="sp-bar-acts"><button type="button" data-lofi="${radio ? "video" : "radio"}">${radio ? "Try video" : "Radio"}</button></span>`;
      return;
    }
    const k = live ? `<span class="sp-k own" id="np-k"></span>`
      : spMsg ? `<span class="sp-k own sp-err" title="${esc(spMsg)}">${esc(spMsg)}</span>` : `<span class="sp-k"></span>`;
    const acts = lofi ? "" : live ? dis : `<button type="button" data-sp="paste">Change</button><button type="button" data-sp="clear">Clear</button>${dis}`;
    el.innerHTML = `${k}<span class="sp-bar-acts">${acts}</span>`;
  }
  // ---------- Lofi radio ----------
  // One <img> load from YouTube tells whether this network blocks it (a filter's block page isn't an image).
  function ytProbe() {
    ytBlocked = false; // probing; the video shows meanwhile
    const img = new Image(), done = (blocked) => { clearTimeout(t); img.onload = img.onerror = null; if (blocked) { ytBlocked = true; if (musicSrc === "lofi") spRender(); } };
    const t = setTimeout(() => done(true), 8000);
    img.onload = () => done(false);
    img.onerror = () => done(true);
    img.src = `https://www.youtube-nocookie.com/favicon.ico?${Date.now()}`;
  }
  function radioRender() {
    const el = $("#sp-radio");
    if (el.hidden) return;
    el.innerHTML = `<button type="button" class="rd-play" data-radio="toggle" aria-label="${radioOn ? "Pause" : "Play"} ${esc(radioSt.name)}"><svg viewBox="0 0 24 24" aria-hidden="true">${radioOn ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 4.5v15l12-7.5z"/>'}</svg></button>
      <div class="rd-main"><span class="sp-k own">${radioOn ? "On air" : "Radio"}</span><b class="rd-name">${esc(radioSt.name)}</b><span class="rd-sub">${esc(radioOn && radioNow ? radioNow : radioSt.sub)}</span></div>
      <div class="rd-st" role="group" aria-label="Station">${RADIO.map((r) => `<button type="button" data-radio="${r.id}" aria-pressed="${r === radioSt}">${esc(r.name)}</button>`).join("")}</div>
      ${radioMsg ? `<p class="sp-err rd-err">${esc(radioMsg)}</p>` : ""}`;
    el.classList.toggle("on", radioOn);
  }
  let radioNowTimer;
  async function radioPollNow() {
    clearTimeout(radioNowTimer);
    radioNow = "";
    if (!radioOn || !radioSt.now) return;
    try { const d = await (await fetch(radioSt.now)).json(); radioNow = [d.title, d.artist?.name].filter(Boolean).join(" · "); } catch {}
    radioRender();
    radioNowTimer = setTimeout(radioPollNow, 30_000);
  }
  function radioPlay() {
    const a = $("#radio");
    radioMsg = "";
    a.src = radioSt.url;
    a.play().then(() => { radioOn = true; radioRender(); radioPollNow(); }).catch(() => { radioOn = false; radioMsg = "That station didn't start. Press play again, or try the other station."; radioRender(); });
    radioOn = true;
    radioRender();
  }
  function radioStop() {
    const a = $("#radio");
    radioOn = false;
    clearTimeout(radioNowTimer);
    a.pause();
    a.removeAttribute("src"); // stops the download too
    a.load();
    radioRender();
  }
  $("#radio").addEventListener("error", () => { if (!radioOn) return; radioOn = false; radioMsg = `Couldn't reach ${radioSt.name} on this network. Try the other station.`; radioRender(); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-radio], [data-lofi]");
    if (!b) return;
    // radio sticks; "try video" lasts this visit and then it's back to auto, so school still falls back to radio
    if (b.dataset.lofi) { lofiMode = b.dataset.lofi; try { lofiMode === "radio" ? localStorage.setItem(LOFI_MODE, "radio") : localStorage.removeItem(LOFI_MODE); } catch {} spRender(true); return; }
    const v = b.dataset.radio;
    if (v === "toggle") return radioOn ? radioStop() : radioPlay();
    const st = RADIO.find((r) => r.id === v);
    if (!st || st === radioSt) return;
    const was = radioOn;
    if (was) radioStop();
    radioSt = st;
    try { localStorage.setItem(RADIO_ST, st.id); } catch {}
    if (was) radioPlay(); else { radioMsg = ""; radioRender(); }
  });

  document.addEventListener("submit", (e) => {
    if (!e.target.matches("[data-sp-paste]")) return;
    e.preventDefault();
    const got = spParse($("#sp-url").value.trim());
    if (!got) {
      if (sp) toast("That isn't a Spotify link. In Spotify, tap Share, then Copy link.");
      else { spBad = true; spRenderEmpty(true); spFocusPaste(); }
      return;
    }
    sp = got;
    spPasting = spBad = false;
    spSave();
    spRender(true);
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-src]");
    if (!b || b.dataset.src === musicSrc) return;
    musicSrc = b.dataset.src;
    spPasting = spBad = false;
    jset(SRC, musicSrc);
    spRender(true);
    if (musicSrc === "spotify") spPoll();
    if (st.open) setTimeout(stPlaceMusic, 50);
  });

  // ---------- Spotify account: Authorization Code with PKCE (no client secret, so it works from GitHub Pages) ----------
  // Brian makes the Spotify app and pastes its Client ID; tokens stay in this browser's localStorage.
  const SP_SCOPES = "user-read-currently-playing user-read-playback-state user-modify-playback-state";
  const spRedirect = () => location.origin + location.pathname;
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const spSaveAuth = () => jset(SPA, spA);
  async function spConnect(client) {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
    sessionStorage.setItem("rlp-sp-pkce", JSON.stringify({ verifier, state: nonce, client, back: location.search }));
    spA = { ...spA, client };
    setPref("spClient", client); // the Client ID only; the sign-in tokens never leave this browser
    spSaveAuth();
    location.href = `https://accounts.spotify.com/authorize?${new URLSearchParams({ response_type: "code", client_id: client, scope: SP_SCOPES, redirect_uri: spRedirect(), code_challenge_method: "S256", code_challenge: challenge, state: nonce })}`;
  }
  async function spTokenCall(body) {
    const r = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
    return r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
  }
  // back from Spotify's consent page with ?code=…: trade it for tokens, then put the address back the way it was
  async function spCallback() {
    const q = new URLSearchParams(location.search), code = q.get("code"), err = q.get("error");
    if (!code && !err) return;
    let p = null;
    try { p = JSON.parse(sessionStorage.getItem("rlp-sp-pkce")); } catch {}
    sessionStorage.removeItem("rlp-sp-pkce");
    history.replaceState(null, "", location.pathname + (p?.back || ""));
    if (err || !p || p.state !== q.get("state")) { spMsg = err === "access_denied" ? "Spotify connection cancelled." : "Spotify connection didn't finish. Try Connect again."; return; }
    try {
      const d = await spTokenCall({ grant_type: "authorization_code", code, redirect_uri: spRedirect(), client_id: p.client, code_verifier: p.verifier });
      spA = { client: p.client, access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in - 60) * 1000 };
      spSaveAuth();
      spMsg = "";
    } catch (e) { spMsg = `Spotify wouldn't finish connecting (${e.message}). Check that the redirect URI matches exactly.`; }
  }
  async function spToken() {
    if (!spConnected()) return null;
    if (Date.now() < spA.exp) return spA.access;
    try {
      const d = await spTokenCall({ grant_type: "refresh_token", refresh_token: spA.refresh, client_id: spA.client });
      spA = { ...spA, access: d.access_token, refresh: d.refresh_token || spA.refresh, exp: Date.now() + (d.expires_in - 60) * 1000 };
      spSaveAuth();
      return spA.access;
    } catch (e) {
      if (e.message === "400" || e.message === "401") spDisconnect("Spotify signed you out. Connect again.");
      return null;
    }
  }
  async function spApi(path, opts = {}) {
    let tok = await spToken();
    if (!tok) return null;
    let r = await fetch(`https://api.spotify.com/v1${path}`, { ...opts, headers: { Authorization: `Bearer ${tok}` } });
    if (r.status === 401) { spA.exp = 0; tok = await spToken(); if (tok) r = await fetch(`https://api.spotify.com/v1${path}`, { ...opts, headers: { Authorization: `Bearer ${tok}` } }); }
    return r;
  }
  function spDisconnect(msg = "") {
    spA = { client: spA.client };
    spSaveAuth();
    np = null;
    spMsg = msg;
    spRender();
  }
  let npTimer;
  async function spPoll() {
    clearTimeout(npTimer);
    if (!spConnected() || musicSrc !== "spotify" || document.hidden) return;
    if (NP_DEMO) { np = np || { is_playing: new URLSearchParams(location.search).get("npdemo") !== "paused", progress_ms: 61000, device: { name: "Brian's iPhone" }, item: { name: "Snowman", duration_ms: 165000, artists: [{ name: "WYS" }], album: { images: [{ url: "https://i.scdn.co/image/ab67706f00000002266beb50b0032b0f140a749e" }] } } }; npAt = npAt || Date.now(); spRender(); return; }
    try {
      const r = await spApi("/me/player?additional_types=episode");
      if (r?.status === 200) { np = await r.json(); npAt = Date.now(); spMsg = ""; }
      else if (r?.status === 204) np = null;
      else if (r?.status === 403) { np = null; spMsg = "Spotify said no. In your Spotify app's settings, add your account under User Management."; }
    } catch {}
    spRender();
    npTimer = setTimeout(spPoll, 5000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) spPoll(); });
  // the bar moves every second between polls
  setInterval(() => { if (npShown() && np.is_playing) spRenderNP(); }, 1000);

  function spRenderNP() {
    if (!npShown()) return;
    const it = np.item, dur = it.duration_ms || 1, at = Math.min(dur, (np.progress_ms || 0) + (np.is_playing ? Date.now() - npAt : 0));
    const art = it.album?.images?.[0]?.url || it.images?.[0]?.url || it.show?.images?.[0]?.url || "";
    if ($("#np-art").getAttribute("src") !== art) $("#np-art").src = art;
    $("#sp-np").classList.toggle("paused", !np.is_playing);
    $("#np-k").textContent = `${np.is_playing ? "Playing" : "Paused"}${np.device?.name ? ` · ${np.device.name}` : ""}`;
    $("#np-track").textContent = it.name;
    $("#np-artist").textContent = (it.artists || []).map((a) => a.name).join(", ") || it.show?.name || "";
    $("#np-t0").textContent = mmss(at);
    $("#np-t1").textContent = mmss(dur);
    $("#np-bar").style.width = `${(at / dur) * 100}%`;
    $("#np-ctl").hidden = !!spA.noControl;
    const play = $("#np-ctl .np-play");
    play.setAttribute("aria-label", np.is_playing ? "Pause" : "Play");
    $("#np-icon").innerHTML = np.is_playing ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 4.5v15l12-7.5z"/>';
  }
  async function spControl(what) {
    const paths = { prev: ["POST", "/me/player/previous"], next: ["POST", "/me/player/next"], toggle: np?.is_playing ? ["PUT", "/me/player/pause"] : ["PUT", "/me/player/play"] };
    const [method, path] = paths[what];
    const r = await spApi(path, { method });
    if (r?.status === 403) { spA.noControl = true; spSaveAuth(); spRender(); toast("Play controls need Spotify Premium"); return; }
    if (what === "toggle" && np && r?.ok) { np = { ...np, progress_ms: np.progress_ms + (np.is_playing ? Date.now() - npAt : 0), is_playing: !np.is_playing }; npAt = Date.now(); spRenderNP(); }
    setTimeout(spPoll, 400);
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-np]"); if (b) spControl(b.dataset.np); });

  // connecting takes a Spotify app of his own, once; the steps replace the empty state until he's done
  const spSetupHTML = () => `<div class="sp-setup">
      <p><b>Connect Spotify</b> to see what you're playing on any device. Make a free Spotify app once (about two minutes):</p>
      <ol><li>Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a>, log in, and press <b>Create app</b>.</li>
        <li>Any name and description. Under <b>Redirect URIs</b> add exactly <code>${esc(spRedirect())}</code> <button class="link" type="button" data-sp="copy">Copy</button>. Tick <b>Web API</b>, agree, and save.</li>
        <li>In the app's <b>Settings → User Management</b>, add your name and your Spotify account's email.</li>
        <li>Paste the app's <b>Client ID</b> here and press Connect.</li></ol>
      <form class="sp-form" data-sp-form><input id="sp-client" value="${esc(spA.client || "")}" placeholder="Client ID" aria-label="Spotify Client ID" spellcheck="false" autocomplete="off"><button class="btn primary" type="submit">Connect</button></form>
      <p class="sp-hint">Play, pause and skip need Premium. The Client ID and sign-in stay in this browser.</p>
      <button class="link" type="button" data-sp="back">Back</button></div>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sp]");
    if (!b) return;
    const a = b.dataset.sp;
    // a Client ID from before goes straight to Spotify; otherwise the setup steps
    if (a === "connect") { if (/^[0-9a-f]{32}$/i.test(spA.client || "")) return spConnect(spA.client); spSetup = true; spMsg = ""; spRender(); }
    if (a === "back") { spSetup = false; spMsg = ""; spRender(); }
    if (a === "paste") { spPasting = true; spBad = false; spRender(); spFocusPaste(); }
    if (a === "cancel") { spPasting = spBad = false; spRender(); }
    if (a === "clear") { sp = null; spPasting = false; spSave(); spRender(); }
    if (a === "disconnect") spDisconnect();
    if (a === "copy") navigator.clipboard?.writeText(spRedirect()).then(() => toast("Redirect URI copied"));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && spPasting && e.target.closest?.("#sp")) { spPasting = spBad = false; spRender(); } });
  document.addEventListener("submit", (e) => {
    if (!e.target.matches("[data-sp-form]")) return;
    e.preventDefault();
    const id = $("#sp-client").value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) { spMsg = "That doesn't look like a Client ID (32 letters and numbers)."; spRender(); return; }
    spConnect(id);
  });
  spRender();
  // the embed loads once the card is on screen, not on every page load
  new IntersectionObserver((es, io) => { if (es.some((x) => x.isIntersecting)) { spRender(true); io.disconnect(); } }).observe($("#sp"));

  // ---------- expanded view: a side box opens big; its contents move into the dialog and back ----------
  const xdlg = $("#xdlg");
  let xHome = null;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-expand]");
    if (!b) return;
    xHome = b.closest("[data-xhome]");
    $("#x-dlg-h").textContent = xHome.dataset.xname;
    xdlg.dataset.x = xHome.dataset.xname.toLowerCase().replace(/\s+/g, "");
    $("#x-dlg-body").append(xHome.querySelector(".x-body"));
    xdlg.showModal();
    wake($("#x-dlg-body"));
    $("#x-dlg-body").scrollTop = 0;
  });
  xdlg.addEventListener("close", () => {
    if (xHome) xHome.append($("#x-dlg-body .x-body"));
    // sections live in the big view only; the side box goes back to top stories
    if (xHome?.dataset.pane === "news" && newsTab !== "top") { newsTab = "top"; renderNews(); }
    xHome = null;
  });
  $("#x-close").onclick = () => xdlg.close();
  xdlg.addEventListener("click", (e) => { if (e.target === xdlg) xdlg.close(); });

  // ---------- league scoreboards (ESPN) ----------
  const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
  const LEAGUES = { nba: "basketball", nfl: "football" };
  const boards = {};
  let sbLeague = "nba", sbTimer;
  const evState = (e) => e.competitions[0].status.type;
  async function loadBoards() {
    clearTimeout(sbTimer);
    await Promise.all(Object.entries(LEAGUES).map(async ([lg, sp]) => {
      try { const r = await fetch(`${ESPN}/${sp}/${lg}/scoreboard`); if (r.ok) boards[lg] = await r.json(); } catch {}
    }));
    renderBoard();
    renderTeams();
    const live = Object.values(boards).some((b) => b.events?.some((e) => evState(e).state === "in"));
    sbTimer = setTimeout(loadBoards, live ? 30_000 : 10 * 60_000);
  }
  const myAbbrs = () => new Set((schedule.teams || []).map((t) => t.id.toUpperCase()));
  function renderBoard() {
    document.querySelectorAll("[data-league]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.league === sbLeague)));
    const b = boards[sbLeague];
    if (!b) { $("#scoreboard").innerHTML = `<li class="empty-state">Scores unavailable right now.</li>`; return; }
    const mine = myAbbrs();
    const label = b.week?.number ? `Week ${b.week.number}` : b.day?.date ? fmt(b.day.date.slice(0, 10), { weekday: "long", month: "short", day: "numeric" }) : "";
    $("#sb-meta").textContent = [label, `${b.events.length} games`].filter(Boolean).join(" · ");
    const liveN = (lg) => boards[lg]?.events?.filter((e) => evState(e).state === "in").length || 0;
    tease("t-scores", ["nba", "nfl"].map((lg) => boards[lg] ? `${lg.toUpperCase()} ${boards[lg].events.length}${liveN(lg) ? ` (${liveN(lg)} live)` : ""}` : "").filter(Boolean).join(" · "));
    const order = { in: 0, pre: 1, post: 2 };
    const evs = [...b.events].sort((x, y) => order[evState(x).state] - order[evState(y).state] || x.date.localeCompare(y.date));
    $("#scoreboard").innerHTML = evs.length ? evs.map((e) => {
      const c = e.competitions[0], st = evState(e);
      const teams = [...c.competitors].sort((x) => (x.homeAway === "away" ? -1 : 1));
      const isMine = teams.some((t) => mine.has(t.team.abbreviation));
      const rows = teams.map((t) => {
        const rec = t.records?.[0]?.summary;
        const lost = st.completed && !t.winner;
        return `<div class="row${lost ? " lost" : ""}"><img src="${esc(t.team.logo)}" alt="" loading="lazy"><span class="ab">${esc(t.team.shortDisplayName || t.team.abbreviation)}${rec ? `<span class="rc">${esc(rec)}</span>` : ""}</span><span class="sc">${st.state === "pre" ? "" : esc(t.score ?? "")}</span></div>`;
      }).join("");
      const status = st.state === "in" ? `<b>${esc(st.shortDetail)}</b>` : st.state === "pre" ? esc(gameTime(e.date)) : esc(st.shortDetail);
      const tv = st.state === "pre" ? c.broadcasts?.flatMap((x) => x.names || [])[0] : "";
      return `<li class="${st.state === "in" ? "live" : ""}${isMine ? " mine" : ""}" data-game="${esc(e.id)}" data-lg="${sbLeague}" tabindex="0" role="button" aria-label="${esc(e.name)}"><div class="tm2">${rows}</div><div class="st2">${status}${tv ? `<br>${esc(tv)}` : ""}</div></li>`;
    }).join("") : `<li class="empty-state">No games today.</li>`;
  }
  document.querySelector(".seg:has([data-league])").addEventListener("click", (e) => {
    const b = e.target.closest("[data-league]");
    if (b) { sbLeague = b.dataset.league; renderBoard(); }
  });

  // ---------- game details (box score, plays, team stats) ----------
  const gdlg = $("#game");
  let game = null, gTab = "box", gTimer, scoringOnly = false;
  async function openGame(lg, id) {
    game = { lg, id, d: null, fresh: true };
    gTab = "box";
    $("#g-score").innerHTML = `<p class="note">Loading…</p>`;
    $("#g-body").innerHTML = "";
    if (!gdlg.open) gdlg.showModal();
    await refreshGame();
  }
  async function refreshGame() {
    clearTimeout(gTimer);
    if (!game || !gdlg.open) return;
    try {
      const r = await fetch(`${ESPN}/${LEAGUES[game.lg]}/${game.lg}/summary?event=${game.id}`);
      if (!r.ok) throw new Error(r.status);
      game.d = await r.json();
    } catch {
      $("#g-score").innerHTML = `<p class="note">Couldn't load this game.</p>`;
      return;
    }
    renderGame();
    game.fresh = false;
    if (evState(game.d.header).state === "in") gTimer = setTimeout(refreshGame, 30_000);
  }
  gdlg.addEventListener("close", () => clearTimeout(gTimer));
  $("#g-close").onclick = () => gdlg.close();
  gdlg.addEventListener("click", (e) => { if (e.target === gdlg) gdlg.close(); });
  $("#g-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) { gTab = b.dataset.tab; renderGame(); }
  });
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-game]");
    if (g) openGame(g.dataset.lg, g.dataset.game);
  });
  document.addEventListener("keydown", (e) => {
    const g = e.target.closest?.("[data-game]");
    if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openGame(g.dataset.lg, g.dataset.game); }
  });

  const hex = (c, fb) => (/^[0-9a-f]{6}$/i.test(c || "") ? `#${c}` : fb);
  // ESPN's primary color is sometimes near-black; fall back to the alternate so it reads on dark backgrounds too
  function teamColor(team) {
    const p = hex(team.color, "#888888"), a = hex(team.alternateColor, p);
    const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
    return lum(p) < 0.12 && lum(a) > lum(p) ? a : p;
  }
  function renderGame() {
    const d = game.d, comp = d.header.competitions[0], st = comp.status.type;
    const teams = [...comp.competitors].sort((x) => (x.homeAway === "away" ? -1 : 1));
    game.colors = Object.fromEntries(teams.map((t) => [t.team.id, teamColor(t.team)]));
    game.abbr = Object.fromEntries(teams.map((t) => [t.team.id, t.team.abbreviation]));
    const [away, home] = teams;
    const lead = st.state !== "pre" && Number(away.score) !== Number(home.score) ? (Number(away.score) > Number(home.score) ? away : home) : null;
    const side = (t) => `<div class="g-team ${t.homeAway}${lead === t ? " lead" : ""}" style="--tc:${game.colors[t.team.id]}"><img src="${esc(t.team.logos?.[0]?.href || t.team.logo || "")}" alt=""><div><b>${esc(t.team.displayName)}</b><small>${esc(t.record?.[0]?.displayValue || t.record?.[0]?.summary || "")}</small></div><span class="pts" data-pts="${esc(t.score ?? "")}">${st.state === "pre" ? "" : esc(t.score ?? "")}</span></div>`;
    const periods = Math.max(...teams.map((t) => t.linescores?.length || 0));
    const pName = (i) => (i < 4 ? `Q${i + 1}` : `OT${i > 4 ? i - 3 : ""}`);
    const pv = (t, i) => Number(t.linescores?.[i]?.displayValue ?? t.linescores?.[i]?.value ?? 0);
    const lines = periods ? `<table class="lines"><tr><th></th>${Array.from({ length: periods }, (_, i) => `<th>${pName(i)}</th>`).join("")}<th>T</th></tr>${teams.map((t) => {
      const other = t === away ? home : away;
      return `<tr style="--tc:${game.colors[t.team.id]}"><td>${esc(t.team.abbreviation)}</td>${Array.from({ length: periods }, (_, i) => `<td class="${pv(t, i) > pv(other, i) ? "won" : ""}">${t.linescores?.[i] ? pv(t, i) : ""}</td>`).join("")}<td>${esc(t.score ?? "")}</td></tr>`;
    }).join("")}</table>` : "";
    const venue = d.gameInfo?.venue?.fullName;
    const mid = `<div class="g-mid"><b class="${st.state === "in" ? "live" : ""}">${st.state === "in" ? `<span class="live-dot"></span>` : ""}${esc(st.state === "pre" ? gameTime(comp.date) : st.shortDetail || st.detail)}</b>${venue ? esc(venue) : ""}${d.gameInfo?.attendance ? `<br>${Number(d.gameInfo.attendance).toLocaleString()} fans` : ""}</div>`;
    const head = $(".g-head");
    head.style.setProperty("--ac", game.colors[away.team.id]);
    head.style.setProperty("--hc", game.colors[home.team.id]);
    $("#g-score").innerHTML = `<div class="g-sc">${side(away)}${mid}${side(home)}</div>${lines}`;
    document.querySelectorAll("#g-tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === gTab)));
    const body = $("#g-body");
    body.innerHTML = gTab === "box" ? winProbHTML(d, away, home) + boxHTML(d) : gTab === "plays" ? playsHTML(d) : teamStatsHTML(d);
    if (gTab === "box") wireWinProb(d, away, home);
  }

  // win probability: home team's chance after every play, shaded by who's ahead
  function winProbHTML(d, away, home) {
    const wp = d.winprobability || [];
    if (wp.length < 3) return "";
    const W = 600, H = 110, n = wp.length - 1;
    const pts = wp.map((p, i) => [(i / n) * W, (1 - p.homeWinPercentage) * H]);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const area = `${line}L${W},${H / 2}L0,${H / 2}Z`;
    const last = wp.at(-1).homeWinPercentage;
    const pct = (v) => `${Math.round(v * 100)}%`;
    return `<div class="wp" style="--ac:${game.colors[away.team.id]};--hc:${game.colors[home.team.id]}">
      <div class="wp-h"><h3>Win probability</h3><span class="wp-now"><b class="tt" style="--tc:var(--hc)">${esc(home.team.abbreviation)} ${pct(last)}</b> · <b class="tt" style="--tc:var(--ac)">${esc(away.team.abbreviation)} ${pct(1 - last)}</b></span></div>
      <div class="wp-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Win probability over the game">
        <defs><clipPath id="wp-top"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath><clipPath id="wp-bot"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath></defs>
        <path d="${area}" fill="var(--hc)" opacity=".28" clip-path="url(#wp-top)"/>
        <path d="${area}" fill="var(--ac)" opacity=".28" clip-path="url(#wp-bot)"/>
        <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="wp-mid"/>
        <path d="${line}" class="wp-line" pathLength="1"/>
        <line class="wp-cursor" x1="0" x2="0" y1="0" y2="${H}" style="display:none"/>
      </svg><div class="wp-tip" hidden></div>
      <span class="wp-lbl top tt" style="--tc:var(--hc)">${esc(home.team.abbreviation)}</span><span class="wp-lbl bot tt" style="--tc:var(--ac)">${esc(away.team.abbreviation)}</span></div></div>`;
  }
  function wireWinProb(d, away, home) {
    const box = $("#g-body .wp-chart");
    if (!box) return;
    const wp = d.winprobability, plays = Object.fromEntries((d.plays || d.drives?.previous?.flatMap((x) => x.plays || []) || []).map((p) => [p.id, p]));
    const cur = box.querySelector(".wp-cursor"), tip = box.querySelector(".wp-tip");
    box.addEventListener("pointermove", (e) => {
      const r = box.getBoundingClientRect(), k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const i = Math.round(k * (wp.length - 1)), p = wp[i], play = plays[p.playId];
      cur.setAttribute("x1", k * 600); cur.setAttribute("x2", k * 600); cur.style.display = "";
      const h = Math.round(p.homeWinPercentage * 100);
      tip.hidden = false;
      tip.style.left = `${Math.min(r.width - 180, Math.max(0, e.clientX - r.left - 90))}px`;
      tip.innerHTML = `<b>${esc(home.team.abbreviation)} ${h}% · ${esc(away.team.abbreviation)} ${100 - h}%</b>${play ? `<span>${esc(play.period?.displayValue || (play.period?.number ? `Q${play.period.number}` : ""))} ${esc(play.clock?.displayValue || "")}${play.awayScore != null ? ` · ${play.awayScore}–${play.homeScore}` : ""}</span><span>${esc((play.text || "").trim().slice(0, 90))}</span>` : ""}`;
    });
    box.addEventListener("pointerleave", () => { cur.style.display = "none"; tip.hidden = true; });
  }

  function leadersHTML(d) {
    if (!d.leaders?.length) return "";
    return `<div><h3>Leaders</h3><div class="ldrs">${d.leaders.flatMap((t) => (t.leaders || []).slice(0, 3).map((c) => {
      const l = c.leaders?.[0];
      if (!l) return "";
      const big = l.mainStat?.value ?? (/^\d+$/.test(l.displayValue) ? l.displayValue : "");
      return `<div class="ldr" style="--tc:${game.colors?.[t.team.id] || "var(--accent)"}">${l.athlete.headshot?.href ? `<img src="${esc(l.athlete.headshot.href)}" alt="" loading="lazy">` : `<span class="ph"></span>`}
        <div><span>${esc(t.team.abbreviation)} · ${esc(c.displayName)}</span><b>${esc(l.athlete.shortName || l.athlete.displayName)}</b>${big !== "" ? `<em>${esc(big)}</em>` : `<small>${esc(l.displayValue)}</small>`}</div></div>`;
    })).join("")}</div></div>`;
  }

  // numeric value of a stat cell for sorting/shading ("8-16" sorts by makes)
  const num = (v) => { const m = String(v).match(/^[+-]?\d+(\.\d+)?/); return m ? Number(m[0]) : NaN; };
  const HEAT = { nba: ["PTS", "REB", "AST", "STL", "BLK"], nfl: ["YDS", "TD", "REC", "SACKS", "INT"] };
  function boxHTML(d) {
    const groups = d.boxscore?.players || [];
    if (!groups.length) return `${leadersHTML(d)}<p class="empty-state">Box score shows up once the game starts.</p>`;
    const tables = groups.map((g) => g.statistics.map((s, si) => {
      if (!s.athletes?.length) return "";
      const tc = game.colors?.[g.team.id] || "var(--accent)";
      const title = `${g.team.displayName}${s.name ? ` · ${s.name[0].toUpperCase() + s.name.slice(1)}` : ""}`;
      const played = s.athletes.filter((a) => !a.didNotPlay && a.stats?.length);
      const maxes = s.labels.map((_, c) => Math.max(0, ...played.map((a) => num(a.stats[c])).filter(Number.isFinite)));
      const heatCols = new Set(s.labels.map((l, c) => (HEAT[game.lg].includes(l) ? c : -1)).filter((c) => c >= 0));
      let benchMarked = false;
      const rows = s.athletes.map((a, ri) => {
        const bench = game.lg === "nba" && a.starter === false && !benchMarked;
        if (bench) benchMarked = true;
        const dnp = a.didNotPlay || !a.stats?.length;
        const ath = a.athlete;
        const name = `<td><span class="pl">${ath.headshot?.href ? `<img src="${esc(ath.headshot.href)}" alt="" loading="lazy">` : `<span class="ph"></span>`}<span>${esc(ath.shortName || ath.displayName)}<small>${ath.jersey ? `#${esc(ath.jersey)} ` : ""}${esc(ath.position?.abbreviation || "")}</small></span></span></td>`;
        if (dnp) return `<tr class="dnp" data-i="${ri}">${name}<td colspan="${s.labels.length}" class="why">${esc((a.reason || "DNP").toLowerCase())}</td></tr>`;
        const cells = a.stats.map((v, c) => {
          const n = num(v), lbl = s.labels[c];
          const pm = lbl === "+/-" ? (n > 0 ? " pos" : n < 0 ? " neg" : "") : "";
          const heat = heatCols.has(c) && maxes[c] > 0 && Number.isFinite(n) ? ` style="--h:${Math.round((n / maxes[c]) * 100)}%"` : "";
          const top = heatCols.has(c) && n > 0 && n === maxes[c] ? " top" : "";
          return `<td class="${heat ? "heat" : ""}${pm}${top}" data-v="${Number.isFinite(n) ? n : ""}"${heat}>${esc(v)}</td>`;
        }).join("");
        return `<tr class="${bench ? "bench-start" : ""}" data-i="${ri}">${name}${cells}</tr>`;
      }).join("");
      const totals = s.totals?.length ? `<tfoot><tr><td>Team</td>${s.totals.map((v) => `<td>${esc(v)}</td>`).join("")}</tr></tfoot>` : "";
      return `<div class="bx-card" style="--tc:${tc}"><h3><span class="sw"></span>${esc(title)}</h3><div class="bx-wrap"><table class="bx"><thead><tr><th>Player</th>${s.labels.map((l, c) => `<th data-col="${c + 1}" title="Sort by ${esc(l)}">${esc(l)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>${totals}</table></div></div>`;
    }).join("")).join("");
    return leadersHTML(d) + `<p class="hint">Tap a column to sort.</p>` + tables;
  }
  // click a box-score header to sort that table (again to flip, third time back to the lineup order)
  $("#g-body").addEventListener("click", (e) => {
    const th = e.target.closest(".bx th[data-col]");
    if (!th) return;
    const table = th.closest("table"), col = Number(th.dataset.col), tbody = table.tBodies[0];
    const dir = th.dataset.sort === "desc" ? "asc" : th.dataset.sort === "asc" ? "" : "desc";
    table.querySelectorAll("th").forEach((x) => delete x.dataset.sort);
    if (dir) th.dataset.sort = dir;
    const rows = [...tbody.rows];
    rows.sort((a, b) => {
      if (!dir) return a.dataset.i - b.dataset.i;
      const va = a.cells[col]?.dataset.v, vb = b.cells[col]?.dataset.v;
      const x = va === undefined || va === "" ? -Infinity : Number(va), y = vb === undefined || vb === "" ? -Infinity : Number(vb);
      return dir === "desc" ? y - x : x - y;
    });
    table.classList.toggle("sorted", !!dir);
    rows.forEach((r) => tbody.append(r));
  });

  function playsHTML(d) {
    const filter = `<label class="g-filter"><input type="checkbox" id="g-scoring" ${scoringOnly ? "checked" : ""}> Scoring plays only</label>`;
    const tcol = (p) => game.colors?.[p.team?.id] || "var(--line)";
    const row = (p, clk) => `<li class="${p.scoringPlay ? "scoring" : ""}" style="--tc:${tcol(p)}"><span class="clk">${clk}</span><span>${p.scoringPlay && p.scoreValue ? `<em class="pts-badge">+${p.scoreValue}</em>` : ""}${p.team?.id && game.abbr?.[p.team.id] && game.lg === "nfl" ? `<b>${esc(game.abbr[p.team.id])}</b> ` : ""}${esc((p.text || "").trim())}</span><span class="scr">${p.awayScore ?? ""}–${p.homeScore ?? ""}</span></li>`;
    if (game.lg === "nba") {
      let plays = [...(d.plays || [])].reverse();
      if (scoringOnly) plays = plays.filter((p) => p.scoringPlay);
      if (!plays.length) return filter + `<p class="empty-state">No plays yet.</p>`;
      let per = null;
      const items = plays.slice(0, 400).map((p) => {
        const head = p.period?.number !== per ? `<li class="per">${esc(p.period?.displayValue || `Period ${p.period?.number}`)}</li>` : "";
        per = p.period?.number;
        return head + row(p, esc(p.clock?.displayValue || ""));
      }).join("");
      return filter + `<ul class="plays">${items}</ul>`;
    }
    if (scoringOnly) {
      const sp = d.scoringPlays || [];
      return filter + (sp.length ? `<ul class="plays">${[...sp].reverse().map((p) => row({ ...p, scoringPlay: true }, `Q${p.period?.number} ${esc(p.clock?.displayValue || "")}`)).join("")}</ul>` : `<p class="empty-state">No scores yet.</p>`);
    }
    const drives = [...(d.drives?.previous || []), ...(d.drives?.current ? [d.drives.current] : [])].reverse();
    if (!drives.length) return filter + `<p class="empty-state">No drives yet.</p>`;
    return filter + drives.map((dr, i) => `<details class="drive" style="--tc:${game.colors?.[dr.team?.id] || "var(--line)"}"${i === 0 ? " open" : ""}><summary><span class="sw"></span>${esc(dr.team?.abbreviation || dr.team?.shortDisplayName || "")} · ${esc(dr.result || dr.displayResult || "In progress")}<small>${esc(dr.description || "")}</small></summary><ul class="plays">${[...(dr.plays || [])].reverse().map((p) =>
      row(p, `Q${p.period?.number} ${esc(p.clock?.displayValue || "")}`)).join("")}</ul></details>`).join("");
  }

  // team stats as face-off bars
  function teamStatsHTML(d) {
    const bt = d.boxscore?.teams || [];
    if (bt.length < 2) return `<p class="empty-state">Team stats show up once the game starts.</p>`;
    const away = bt.find((t) => t.homeAway === "away") || bt[0], home = bt.find((t) => t !== away);
    const ac = game.colors?.[away.team.id], hc = game.colors?.[home.team.id];
    const homeBy = Object.fromEntries((home.statistics || []).map((s) => [s.label || s.name, s.displayValue]));
    const rows = (away.statistics || []).map((s) => {
      const k = s.label || s.name, av = s.displayValue, hv = homeBy[k] ?? "";
      const a = num(av), h = num(hv);
      const tot = (Number.isFinite(a) ? Math.abs(a) : 0) + (Number.isFinite(h) ? Math.abs(h) : 0);
      const aw = tot ? (Math.abs(a) / tot) * 100 : 50;
      return `<div class="fo"><span class="v${a > h ? " win" : ""}">${esc(av)}</span><div class="fo-mid"><span class="lbl">${esc(k)}</span><div class="fo-bar"><i style="width:${aw}%;background:${ac}"></i><i style="width:${100 - aw}%;background:${hc}"></i></div></div><span class="v${h > a ? " win" : ""}">${esc(hv)}</span></div>`;
    }).join("");
    return `<div class="fo-head"><b class="tt" style="--tc:${ac}">${esc(away.team.displayName)}</b><b class="tt" style="--tc:${hc}">${esc(home.team.displayName)}</b></div><div class="fos">${rows}</div>`;
  }
  $("#g-body").addEventListener("change", (e) => {
    if (e.target.id === "g-scoring") { scoringOnly = e.target.checked; renderGame(); }
  });

  // ---------- news ----------
  const ago = (iso_) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso_)) / 60000));
    return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  };
  let news = null, newsTab = null;
  // each outlet (and league) keeps one color from the class palette, so every skin already has it
  const PAL = ["eng", "fgc", "msi", "fr", "glee", "arts", "latin", "health"];
  const tintOf = (c) => `--cc:var(--c-${c});--ct:var(--t-${c},var(--surface))`;
  const tint = (key) => tintOf(PAL[parseInt(hash(key), 36) % PAL.length]);
  const SECTION_C = { top: "fgc", politics: "eng", world: "msi", business: "latin", tech: "fr", science: "glee", health: "health" };
  const initials = (s) => s.split(/\s+/).filter((w) => !/^the$/i.test(w)).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
  // first story leads with a big picture; the rest get thumbnails (or the outlet's initials)
  const story = (x, lead) => `<li class="${lead ? "lead" : ""}"><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer" style="${tint(x.chip)}">
      <span class="pic" data-i="${esc(initials(x.chip))}">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>
      <span class="txt"><span class="hl">${esc(x.title)}</span>${x.summary ? `<span class="sum">${esc(x.summary)}</span>` : ""}<span class="meta"><span class="chip-src">${esc(x.chip)}</span>${x.when ? `<span class="ago">${ago(x.when)} ago</span>` : ""}</span></span>
    </a></li>`;
  // a lazy picture inside a box that starts closed doesn't always load once it opens (Safari), so load them when it's open
  const wake = (el) => { if (el && !el.closest("[hidden]") && (!el.closest("dialog") || el.closest("dialog[open]"))) el.querySelectorAll('img[loading="lazy"]').forEach((im) => { im.loading = "eager"; }); };
  // ESPN photos come full-size (up to 2 MB); its resizer serves a small copy
  const espnImg = (u, w) => { const m = /^https:\/\/a\.espncdn\.com(\/photo\/[^?#]+)$/.exec(u || ""); return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${w}` : u; };
  function renderNews() {
    const secs = news?.sections ? Object.keys(news.sections) : [];
    if (!secs.length) {
      $("#news-tabs").innerHTML = "";
      $("#news").innerHTML = `<li class="empty-state">Headlines refresh every hour on the live site.</li>`;
      $("#news-foot").textContent = "";
      return;
    }
    if (!secs.includes(newsTab)) newsTab = secs[0];
    $("#news-tabs").innerHTML = secs.map((k) => `<button type="button" data-news="${esc(k)}" aria-pressed="${k === newsTab}" style="${tintOf(SECTION_C[k] || "other")}">${esc(k[0].toUpperCase() + k.slice(1))}</button>`).join("");
    $("#news").innerHTML = news.sections[newsTab].slice(0, 40).map((n, i) =>
      story({ link: n.link, title: n.title, summary: n.summary, chip: n.source, img: n.image, when: n.published }, i === 0)).join("");
    wake($("#news"));
    tease("t-news", esc(news.sections[newsTab][0]?.title || ""));
    $("#news-meta").textContent = `Top stories${news.updated_at ? ` · ${ago(news.updated_at)} ago` : ""}`;
    $("#news-foot").textContent = news.updated_at ? `Updated ${ago(news.updated_at)} ago · ${[...new Set(news.sections[newsTab].map((n) => n.source))].join(", ")}` : "";
  }
  $("#news-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-news]");
    if (b) { newsTab = b.dataset.news; renderNews(); }
  });
  async function loadSportsNews() {
    const lists = await Promise.all(Object.entries(LEAGUES).map(async ([lg, sp]) => {
      try {
        const r = await fetch(`${ESPN}/${sp}/${lg}/news?limit=15`);
        return r.ok ? (await r.json()).articles.map((a) => ({ ...a, lg })) : [];
      } catch { return []; }
    }));
    const mine = (schedule.teams || []).map((t) => t.name.toLowerCase());
    const all = lists.flat().filter((a) => a.links?.web?.href && a.type !== "Media")
      .sort((a, b) => (mine.some((m) => b.headline.toLowerCase().includes(m)) - mine.some((m) => a.headline.toLowerCase().includes(m))) || b.published.localeCompare(a.published));
    tease("t-snews", esc(all[0]?.headline || ""));
    const teamOf = (a) => (schedule.teams || []).find((t) => a.headline.toLowerCase().includes(t.name.toLowerCase()))?.name;
    $("#snews").innerHTML = all.length ? all.slice(0, 20).map((a, i) =>
      story({ link: a.links.web.href, title: a.headline, summary: a.description, chip: teamOf(a) || a.lg.toUpperCase(), img: espnImg(a.images?.[0]?.url, i === 0 ? 800 : 400), when: a.published }, i === 0)).join("")
      : `<li class="empty-state">Sports news unavailable right now.</li>`;
    wake($("#snews"));
  }

  const tease = (id, html) => { const el = $("#" + id); if (el) el.innerHTML = html; };

  function render() {
    renderBar();
    renderSchedule();
    renderHomework();
    renderRotation();
    renderCounts();
    renderFantasy();
    renderNews();
    renderQuotes();
    placeFeed();
    inkWatch();
  }

  // ---------- interactions ----------
  let toastTimer;
  function toast(msg, undo) {
    const el = $("#toast");
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button">Undo</button>` : ""}`;
    if (undo) el.querySelector("button").onclick = () => { undo(); el.classList.remove("show"); };
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
  }

  function setDone(id, on) {
    const it = allItems().find((i) => i.id === id);
    if (!it) return;
    const t = stamp();
    if (on) { state.done[it.keys[0]] = t; it.keys.forEach((k) => delete state.undone[k]); }
    else it.keys.forEach((k) => { delete state.done[k]; state.undone[k] = t; });
    save();
  }

  document.addEventListener("change", (e) => {
    if (e.target.matches(".check")) {
      const li = e.target.closest(".item");
      const id = li.dataset.id, on = e.target.checked;
      li.classList.toggle("done", on);
      setDone(id, on);
      if (mo()) checkOff(li, e.target);
      else {
        li.style.setProperty("--rnd", (Math.random() * 2 - 1).toFixed(2));
        li.classList.add("leaving");
        setTimeout(renderHomework, leaveMs());
      }
      if (on) {
        toast("Moved to Done", () => { setDone(id, false); renderHomework(); });
        // finished everything due that day? celebrate a little
        const day = allItems().find((i) => i.id === id)?.due;
        const left = allItems().filter((i) => i.due === day && !isDone(i)).length;
        if (day && !left) toast(`Everything due ${relDay(day).toLowerCase()} is done`);
      }
    }
    if (e.target.id === "letter-select") {
      const d = e.target.dataset.date;
      if (e.target.value) state.letters[d] = e.target.value; else delete state.letters[d];
      state.lettersAt[d] = stamp();
      save();
      render();
      const m = mo(), sel = e.target;
      if (m) settle(m.animate(sel, { rotateX: [-85, 0], rotate: -4, transformPerspective: 500 }, spring(0.45, 0.3)), () => { sel.style.transform = ""; });
    }
  });

  document.querySelector(".p-week .seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    state.view = b.dataset.view;
    save();
    renderRotation();
  });

  // ---------- one assignment, opened: notes, steps, links and photos ----------
  // Tap a row (not its checkbox), a Tests row or a Next up chip: a drawer on laptops, a sheet from the bottom on phones.
  // Notes, steps and links live in state.notes[item id], so they sync and outlast Muse's refreshes; photos are big, so
  // they're shrunk and kept in this browser's IndexedDB only.
  const noteOf = (id) => ({ text: "", steps: [], links: [], ...(state.notes?.[id] || {}) });
  function setNote(id, patch) {
    state.notes = { ...state.notes, [id]: { ...noteOf(id), ...patch, t: stamp() } };
    save();
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // photos: IndexedDB "rlp-img", one record per photo { id, item, blob, w, h, t }; every call can fail (private mode,
  // storage off), and then photos just aren't available
  let imgDB = null, imgCount = {};
  const idb = () => (imgDB ||= new Promise((ok, no) => {
    const r = indexedDB.open("rlp-img", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("img", { keyPath: "id" }).createIndex("item", "item");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  }));
  async function imgDo(mode, fn) {
    const db = await idb();
    return new Promise((ok, no) => {
      const tx = db.transaction("img", mode), req = fn(tx.objectStore("img"));
      tx.oncomplete = () => ok(req?.result);
      tx.onerror = tx.onabort = () => no(tx.error);
    });
  }
  const imgFor = (item) => imgDo("readonly", (s) => s.index("item").getAll(item)).catch(() => []);
  // how many photos each item has, for the little marker on its row (a key cursor reads no photo data)
  async function imgCounts() {
    try {
      const db = await idb();
      imgCount = await new Promise((ok) => {
        const out = {}, cur = db.transaction("img").objectStore("img").index("item").openKeyCursor();
        cur.onsuccess = () => { const c = cur.result; if (!c) return ok(out); out[c.key] = (out[c.key] || 0) + 1; c.continue(); };
        cur.onerror = () => ok(out);
      });
    } catch { imgCount = {}; }
  }
  // shrink to 1600px on the long side; WebP where the browser can make it (Safari can't), JPEG otherwise
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
      const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(im, 0, 0, w, h);
      const webp = await new Promise((ok) => c.toBlob(ok, "image/webp", 0.8));
      const blob = webp?.type === "image/webp" ? webp : await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.82));
      return { blob, w, h };
    } finally { URL.revokeObjectURL(url); }
  }
  async function addPhotos(files) {
    const id = adId, imgs = [...files].filter((f) => f.type.startsWith("image/"));
    if (!id || !imgs.length) return;
    let n = 0;
    for (const f of imgs) {
      try {
        const { blob, w, h } = await shrink(f);
        if (!blob) continue;
        await imgDo("readwrite", (s) => s.put({ id: "p" + uid(), item: id, blob, w, h, t: stamp() }));
        n++;
      } catch (e) { console.warn("photo not saved", e); }
    }
    if (!n) return toast("Couldn't save that photo in this browser");
    imgCount[id] = (imgCount[id] || 0) + n;
    if (adId === id) renderPhotos();
    renderHomework();
  }

  const ad = $("#ad"), adv = $("#adv");
  let adId = null, adUrls = [], noteTimer;
  const linkify = (text) => [...new Set(String(text).match(/https?:\/\/[^\s<>"')]+/g) || [])];
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  function openItem(id) {
    if (!allItems().some((i) => i.id === id)) return;
    adId = id;
    renderItem();
    if (!ad.open) {
      ad.showModal();
      history.pushState({ ad: id }, ""); // the phone's back gesture closes it
    }
    ad.querySelector(".ad-sheet").scrollTop = 0;
  }
  function closeItem() {
    if (!ad.open) return;
    if (history.state?.ad) history.back(); else ad.close();
  }
  addEventListener("popstate", () => { if (adv.open) adv.close(); if (ad.open) ad.close(); });
  ad.addEventListener("cancel", (e) => { e.preventDefault(); if (!adv.open) closeItem(); });
  ad.addEventListener("close", () => {
    clearTimeout(noteTimer);
    flushNote();
    adUrls.forEach(URL.revokeObjectURL);
    adUrls = [];
    adId = null;
    renderHomework();
  });
  ad.addEventListener("click", (e) => { if (e.target === ad) closeItem(); });

  function renderItem() {
    const it = allItems().find((i) => i.id === adId);
    if (!it) return closeItem();
    const n = noteOf(adId), d = daysBetween(today(), it.due), done = isDone(it), link = classLinks[it.class];
    const when = d < -1 ? `${-d} days ago` : d === -1 ? "yesterday" : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
    const touch = matchMedia("(pointer:coarse)").matches;
    ad.innerHTML = `<div class="ad-sheet" style="${cc(it.class)}">
      <header class="ad-head">
        <div class="ad-top"><span class="chip">${esc(it.class)}</span>${MAJOR.has(it.type) ? `<span class="tag">${esc(it.type)}</span>` : it.type ? `<span class="ad-type">${esc(it.type)}</span>` : ""}
          <button type="button" class="icon-btn ad-x" data-ad="close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
        <h2 id="ad-title">${esc(it.title)}</h2>
        <p class="ad-due">Due ${esc(fmt(it.due, { weekday: "long", month: "long", day: "numeric" }))} · <b>${when}</b></p>
        ${it.details ? `<p class="ad-det">${esc(it.details)}</p>` : ""}
        <div class="ad-acts">
          <label class="ad-done"><input type="checkbox" class="check" data-ad="done"${done ? " checked" : ""}><span>${done ? "Done" : "Mark done"}</span></label>
          ${link ? `<a class="btn" href="${esc(link.url)}" target="_blank" rel="noopener">${link.topics ? "Topics" : "Bulletin board"} ↗</a>` : ""}
          ${it.manual ? `<button type="button" class="btn" data-edit="${esc(it.id)}">Edit</button>` : ""}
        </div>
      </header>
      <section class="ad-sec"><h3 class="ad-k">Notes</h3>
        <textarea class="ad-notes" id="ad-notes" rows="5" placeholder="Anything to remember: what to study, page numbers, questions for class…">${esc(n.text)}</textarea>
        <div class="ad-found" id="ad-found"></div></section>
      <section class="ad-sec"><h3 class="ad-k">Steps <span id="ad-stepn"></span></h3>
        <ul class="ad-steps" id="ad-steps"></ul>
        <form class="ad-add" data-ad-form="step"><input name="text" placeholder="Add a step, like “read pp. 1–20”" aria-label="New step" autocomplete="off"><button class="btn" type="submit">Add</button></form></section>
      <section class="ad-sec"><h3 class="ad-k">Links</h3>
        <ul class="ad-links" id="ad-links"></ul>
        <form class="ad-add ad-add-link" data-ad-form="link"><input name="url" type="text" inputmode="url" placeholder="Paste a link (the Doc you're writing in…)" aria-label="Link" autocomplete="off" required><input name="label" placeholder="Label (optional)" aria-label="Label" autocomplete="off"><button class="btn" type="submit">Add</button></form></section>
      <section class="ad-sec ad-photos"><h3 class="ad-k">Photos</h3>
        <div class="ad-imgs" id="ad-imgs"></div>
        <div class="ad-img-acts">
          <label class="btn">Add photo<input type="file" accept="image/*" multiple hidden data-ad-file></label>
          ${touch ? `<label class="btn">Take photo<input type="file" accept="image/*" capture="environment" hidden data-ad-file></label>` : ""}
        </div>
        <p class="ad-cap">${touch ? "" : "Paste or drop images here too. "}Photos stay on this device.</p></section>
    </div>`;
    renderFound(n.text);
    renderSteps();
    renderLinks();
    renderPhotos();
  }
  function renderFound(text) {
    const urls = linkify(text);
    $("#ad-found").innerHTML = urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(hostOf(u))} ↗</a>`).join("");
  }
  function renderSteps() {
    const steps = noteOf(adId).steps;
    $("#ad-stepn").textContent = steps.length ? `${steps.filter((x) => x.done).length}/${steps.length}` : "";
    $("#ad-steps").innerHTML = steps.map((x) => `<li class="${x.done ? "done" : ""}"><label><input type="checkbox" class="check" data-step="${esc(x.id)}"${x.done ? " checked" : ""}><span>${esc(x.text)}</span></label>
      <button type="button" class="ad-del" data-step-del="${esc(x.id)}" aria-label="Remove step">×</button></li>`).join("");
  }
  function renderLinks() {
    $("#ad-links").innerHTML = noteOf(adId).links.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.label || hostOf(x.url))}</b><small>${esc(hostOf(x.url))}</small></a>
      <button type="button" class="ad-del" data-link-del="${esc(x.id)}" aria-label="Remove link">×</button></li>`).join("");
  }
  async function renderPhotos() {
    const id = adId, list = (await imgFor(id)).sort((a, b) => a.t.localeCompare(b.t));
    if (adId !== id) return;
    adUrls.forEach(URL.revokeObjectURL);
    adUrls = list.map((p) => URL.createObjectURL(p.blob));
    $("#ad-imgs").innerHTML = list.map((p, i) => `<button type="button" class="ad-thumb" data-photo="${esc(p.id)}" aria-label="Open photo ${i + 1}"><img src="${adUrls[i]}" alt=""></button>`).join("");
  }
  function flushNote() {
    const ta = $("#ad-notes");
    if (!ta || !adId) return;
    if (ta.value !== noteOf(adId).text) setNote(adId, { text: ta.value });
  }
  ad.addEventListener("input", (e) => {
    if (e.target.id !== "ad-notes") return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { flushNote(); renderFound(e.target.value); }, 500);
  });
  ad.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.ad === "done") {
      setDone(adId, t.checked);
      t.nextElementSibling.textContent = t.checked ? "Done" : "Mark done";
      renderHomework();
      if (t.checked) toast("Moved to Done", () => { setDone(adId, false); renderHomework(); if (ad.open) renderItem(); });
    }
    if (t.dataset.step) {
      setNote(adId, { steps: noteOf(adId).steps.map((x) => (x.id === t.dataset.step ? { ...x, done: t.checked } : x)) });
      renderSteps();
    }
    if (t.matches("[data-ad-file]")) { addPhotos(t.files); t.value = ""; }
  });
  ad.addEventListener("submit", (e) => {
    const f = e.target.closest("[data-ad-form]");
    if (!f) return;
    e.preventDefault();
    const v = (k) => f.elements[k]?.value.trim() || "";
    if (f.dataset.adForm === "step" && v("text")) {
      setNote(adId, { steps: [...noteOf(adId).steps, { id: "s" + uid(), text: v("text"), done: false }] });
      renderSteps();
    }
    if (f.dataset.adForm === "link" && v("url")) {
      const url = /^https?:\/\//i.test(v("url")) ? v("url") : `https://${v("url")}`;
      setNote(adId, { links: [...noteOf(adId).links, { id: "l" + uid(), url, label: v("label") }] });
      renderLinks();
    }
    f.reset();
    f.elements[0].focus();
  });
  ad.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.ad === "close") closeItem();
    if (b.dataset.stepDel) { setNote(adId, { steps: noteOf(adId).steps.filter((x) => x.id !== b.dataset.stepDel) }); renderSteps(); }
    if (b.dataset.linkDel) { setNote(adId, { links: noteOf(adId).links.filter((x) => x.id !== b.dataset.linkDel) }); renderLinks(); }
    if (b.dataset.photo) openPhoto(b.dataset.photo);
  });
  // paste a screenshot or drop files anywhere on the drawer
  ad.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); addPhotos(files); }
  });
  ad.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); ad.classList.add("drop"); } });
  ad.addEventListener("dragleave", (e) => { if (e.target === ad || !ad.contains(e.relatedTarget)) ad.classList.remove("drop"); });
  ad.addEventListener("drop", (e) => { e.preventDefault(); ad.classList.remove("drop"); addPhotos(e.dataTransfer.files); });

  // a photo full screen, with delete
  let advId = null, advUrl = "";
  async function openPhoto(id) {
    const p = (await imgFor(adId)).find((x) => x.id === id);
    if (!p) return;
    advId = id;
    advUrl = URL.createObjectURL(p.blob);
    adv.innerHTML = `<img src="${advUrl}" alt="Photo for this assignment">
      <div class="adv-bar"><button type="button" class="btn" data-adv="del">Delete photo</button><button type="button" class="btn primary" data-adv="close">Close</button></div>`;
    adv.showModal();
  }
  adv.addEventListener("close", () => { URL.revokeObjectURL(advUrl); advId = null; });
  adv.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-adv]");
    if (!b && e.target.tagName !== "IMG") return adv.close();
    if (b?.dataset.adv === "close") adv.close();
    if (b?.dataset.adv === "del") {
      const item = adId;
      try { await imgDo("readwrite", (s) => s.delete(advId)); } catch { return toast("Couldn't delete that photo"); }
      imgCount[item] = Math.max(0, (imgCount[item] || 1) - 1);
      adv.close();
      renderPhotos();
      renderHomework();
    }
  });

  // open from a homework row (anywhere but the checkbox and buttons), a Tests row, or the keyboard
  document.addEventListener("click", (e) => {
    if (e.target.closest(".check, button, a, input, label, select, textarea")) return;
    const row = e.target.closest(".item[data-id], .tq li[data-id]");
    if (row && !row.closest("dialog")) openItem(row.dataset.id);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".item .body")) { e.preventDefault(); openItem(e.target.closest(".item").dataset.id); }
  });
  imgCounts().then(() => { if (schedule) renderHomework(); });


  // ---------- quotes: lines to memorize for speaking and debate, a few each day ----------
  // A deck from quotes.json plus Brian's own. Each quote climbs four hint levels (0: every 4th key word blank, 1: every
  // other word, 2: first letters only, 3: nothing but the author) and a review ladder of 1, 3, 7, 14, 30, 60 days.
  const Q_STEPS = [1, 3, 7, 14, 30, 60], Q_NEW_PER_DAY = 2;
  const allQuotes = () => [...quoteDeck, ...(state.myQuotes || []).filter((q) => !(state.removed?.[q.id] > q.t))];
  const qById = (id) => allQuotes().find((q) => q.id === id);
  const qProg = (id) => state.quotes?.[id];
  const qMastered = (p) => !!p && p.lv >= 3 && Q_STEPS[p.step] >= 30;
  // what's due (most overdue first), then up to two unseen ones; the same pick on every device for the same day
  function qQueue() {
    const t = today(), qs = allQuotes();
    const due = qs.filter((q) => qProg(q.id)?.due && qProg(q.id).due <= t)
      .sort((a, b) => qProg(a.id).due.localeCompare(qProg(b.id).due) || a.id.localeCompare(b.id));
    const introduced = qs.filter((q) => qProg(q.id)?.seen === t).length;
    const fresh = qs.filter((q) => !qProg(q.id)).sort((a, b) => hash(t + a.id).localeCompare(hash(t + b.id)) || a.id.localeCompare(b.id));
    return { due, fresh: fresh.slice(0, Math.max(0, Q_NEW_PER_DAY - introduced)) };
  }
  function qOfDay() {
    const { due, fresh } = qQueue(), t = today();
    if (due[0] || fresh[0]) return due[0] || fresh[0];
    const qs = allQuotes(), todays = qs.filter((q) => qProg(q.id)?.last === t);
    const pool = todays.length ? todays : qs;
    return [...pool].sort((a, b) => hash(t + a.id).localeCompare(hash(t + b.id)))[0] || null;
  }
  function qStreak() {
    let d = today(), n = 0;
    if (!state.qlog?.[d]) d = addDays(d, -1);
    while (state.qlog?.[d]) { n++; d = addDays(d, -1); }
    return n;
  }
  // 0 Again: back to 1 day, a level down. 1 Almost: same interval again. 2 Got it: a level up and the next interval.
  function qGrade(id, g) {
    const t = today(), p = qProg(id) || { lv: 0, step: -1, seen: t };
    let { lv, step } = p;
    if (g === 2) { lv = Math.min(3, lv + 1); step = Math.min(Q_STEPS.length - 1, step + 1); }
    else if (g === 1) step = Math.max(0, step);
    else { lv = Math.max(0, lv - 1); step = 0; }
    state.quotes = { ...state.quotes, [id]: { lv, step, due: addDays(t, Q_STEPS[step]), seen: p.seen || t, last: t, t: stamp() } };
    state.qlog = { ...state.qlog, [t]: (state.qlog?.[t] || 0) + 1 };
    save();
  }

  // the quote with some words hidden: words keep their punctuation; a blank is as wide as the word it hides
  const Q_STOP = new Set("a an the and or but nor of to in on at by for with as is are was were be been am it its it's that this these those from not no so if than then we you he she they i me my our your his her their them us do does did has have had will would can could shall should may might must".split(" "));
  function qHint(text, lv) {
    let wi = 0, ci = 0;
    return text.split(/(\s+)/).map((tok) => {
      if (!tok.trim()) return tok;
      const m = tok.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’-]*)?(.*)$/u);
      const [, pre, w, post] = m || ["", "", "", tok];
      if (!w) return esc(tok);
      const i = wi++, content = w.length > 2 && !Q_STOP.has(w.toLowerCase().replace(/’/g, "'"));
      const hide = lv === 0 ? content && ci++ % 4 === 1 : lv === 1 ? i % 2 === 1 : false;
      if (lv === 2) return `${esc(pre)}<span class="q1">${esc(w[0])}</span>${esc(post)}`;
      return hide ? `${esc(pre)}<span class="qb" style="--n:${Math.min(w.length, 14)}" aria-label="blank"></span>${esc(post)}` : esc(tok);
    }).join("");
  }
  // "Type it": compare word by word, ignoring case and punctuation; missed words are marked, extra words struck
  const qKey = (w) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  function qDiff(orig, typed) {
    const A = orig.split(/\s+/).filter(Boolean), B = typed.split(/\s+/).filter((w) => qKey(w));
    const a = A.map(qKey), b = B.map(qKey), n = a.length, m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = !a[i] ? L[i + 1][j] : a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0, j = 0, hit = 0;
    while (i < n || j < m) {
      if (i < n && !a[i]) { out.push(esc(A[i++])); continue; } // a lone dash or the like
      if (i < n && j < m && a[i] === b[j]) { out.push(`<span class="q-ok">${esc(A[i])}</span>`); i++; j++; hit++; }
      else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) out.push(`<s class="q-extra" title="You typed this">${esc(B[j++])}</s>`);
      else out.push(`<mark class="q-miss" title="Missed">${esc(A[i++])}</mark>`);
    }
    return { html: out.join(" "), hit, total: a.filter(Boolean).length };
  }

  // the slim line under the schedule: today's quote, or how many are due
  function renderQuoteLine() {
    const el = $("#qline"), q = qOfDay();
    el.hidden = !q;
    if (!q) return;
    const { due } = qQueue(), p = qProg(q.id), short = q.text.length > 90 ? q.text.slice(0, 88).replace(/\s+\S*$/, "") + "…" : q.text;
    const k = due.length ? `${due.length} ${due.length === 1 ? "quote" : "quotes"} due` : !p ? "New quote" : "Quote";
    el.setAttribute("aria-label", `${k}: open quote practice`);
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.2 6C4.9 7.3 3.5 9.6 3.5 12.6V18h6v-6H6.6c.1-1.9 1.1-3.3 2.6-4.2zm10 0c-2.3 1.3-3.7 3.6-3.7 6.6V18h6v-6h-2.9c.1-1.9 1.1-3.3 2.6-4.2z"/></svg><b class="ql-k${due.length ? " due" : ""}">${esc(k)}</b><span class="ql-t">${esc(short)}</span><span class="ql-by">${esc(q.by || "")}</span>`;
  }

  // the Quotes tab: the deck, a filter, progress, and a form to add your own
  function renderQuotes() {
    renderQuoteLine();
    const qs = allQuotes(), t = today();
    if (!qs.length) { $("#qlist").innerHTML = `<li class="empty-state">The quote deck hasn't loaded.</li>`; return; }
    const { due, fresh } = qQueue(), mastered = qs.filter((q) => qMastered(qProg(q.id))).length, streak = qStreak();
    $("#q-stats").textContent = `${mastered} of ${qs.length} mastered · ${streak ? `${streak}-day streak` : "no streak yet"}`;
    const go = due.length + fresh.length;
    $("#q-go").textContent = due.length ? `Practice ${due.length} due` : fresh.length ? `Learn ${fresh.length} new` : "Practice";
    $("#q-go").classList.toggle("primary", go > 0);
    const tags = new Map();
    for (const q of qs) for (const g of q.tags || []) tags.set(g, (tags.get(g) || 0) + 1);
    const opts = [["all", `All quotes · ${qs.length}`], ["due", `Due now · ${due.length}`], ["new", `Not started · ${qs.filter((q) => !qProg(q.id)).length}`], ["mastered", `Mastered · ${mastered}`]];
    if (state.myQuotes?.length) opts.push(["mine", `Mine · ${qs.filter((q) => q.id.startsWith("u-")).length}`]);
    const tagOpts = [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g, n]) => [`tag:${g}`, `${g[0].toUpperCase() + g.slice(1)} · ${n}`]);
    if (![...opts, ...tagOpts].some(([v]) => v === qFilter)) qFilter = "all";
    $("#q-tag").innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("") +
      `<optgroup label="Tags">${tagOpts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</optgroup>`;
    $("#q-tag").value = qFilter;
    const show = qs.filter((q) => {
      const p = qProg(q.id);
      return qFilter === "all" ? true : qFilter === "due" ? p?.due && p.due <= t : qFilter === "new" ? !p : qFilter === "mastered" ? qMastered(p)
        : qFilter === "mine" ? q.id.startsWith("u-") : (q.tags || []).includes(qFilter.slice(4));
    });
    const when = (p) => !p ? "New" : qMastered(p) ? "Mastered" : p.due <= t ? "Due" : `In ${daysBetween(t, p.due)}d`;
    $("#qlist").innerHTML = show.map((q) => {
      const p = qProg(q.id), lv = p ? p.lv : -1;
      return `<li class="q-row${p?.due && p.due <= t ? " is-due" : ""}" data-qid="${esc(q.id)}" tabindex="0" role="button" aria-label="Practice: ${esc(q.text.slice(0, 60))}">
        <span class="q-lv" title="${p ? `Level ${lv} of 3` : "Not started"}">${[0, 1, 2].map((k) => `<i${lv > k ? ' class="on"' : ""}></i>`).join("")}</span>
        <span class="q-main"><span class="q-txt">${esc(q.text)}</span><span class="q-by">${esc(q.by || "Unattributed")}${q.note ? ` <span class="q-flag" title="${esc(q.note)}">attribution</span>` : ""}</span></span>
        <span class="q-when">${when(p)}</span>
        ${q.id.startsWith("u-") ? `<button class="q-del" type="button" data-qdel="${esc(q.id)}" aria-label="Delete this quote">×</button>` : ""}
      </li>`;
    }).join("") || `<li class="empty-state">Nothing here yet.</li>`;
  }
  $("#q-tag").addEventListener("change", (e) => { qFilter = e.target.value; renderQuotes(); });
  $("#q-go").addEventListener("click", () => qStart());
  $("#qline").addEventListener("click", () => qStart());
  $("#qlist").addEventListener("click", (e) => {
    const del = e.target.closest("[data-qdel]");
    if (del) {
      const id = del.dataset.qdel, q = qById(id);
      state.removed = { ...state.removed, [id]: stamp() };
      state.myQuotes = state.myQuotes.filter((x) => x.id !== id);
      save(); renderQuotes();
      toast("Quote deleted", () => { state.myQuotes = [...state.myQuotes, { ...q, t: stamp() }]; save(); renderQuotes(); });
      return;
    }
    const row = e.target.closest("[data-qid]");
    if (row) qStart([row.dataset.qid]);
  });
  $("#qlist").addEventListener("keydown", (e) => {
    const row = e.target.closest("[data-qid]");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); qStart([row.dataset.qid]); }
  });
  $("#q-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#q-text").value.trim();
    if (!text) return;
    const q = { id: "u-" + uid(), text, by: $("#q-by").value.trim() || "Unattributed", source: $("#q-source").value.trim(), use: $("#q-use").value.trim(),
      tags: $("#q-tags").value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean), note: "", t: stamp() };
    state.myQuotes = [...(state.myQuotes || []), q];
    save();
    e.target.reset();
    $("#q-add").open = false;
    qFilter = "mine";
    renderQuotes();
    toast("Quote added");
  });

  // practice, one quote at a time: read it (new ones), recall it with hints, reveal, grade
  const qp = $("#qp");
  let qs_ = { list: [], i: 0, stage: "recall", done: 0, typed: "" };
  function qStart(ids) {
    let list = ids;
    if (!list) { const { due, fresh } = qQueue(); list = [...due, ...fresh].map((q) => q.id); }
    if (!list.length) { const q = qOfDay(); list = q ? [q.id] : []; }
    if (!list.length) return;
    qs_ = { list, i: 0, done: 0, stage: qProg(list[0]) ? "recall" : "read", typed: "" };
    renderPractice();
    if (!qp.open) qp.showModal();
  }
  const qTyping = () => state.qType === true;
  function renderPractice() {
    const id = qs_.list[qs_.i], q = id && qById(id);
    if (!q) {
      qp.innerHTML = `<div class="qp-in"><div class="qp-h"><span class="qp-k">Practice</span><button class="icon-btn" type="button" data-qp="close" aria-label="Close">×</button></div>
        <div class="qp-body qp-end"><p class="qp-big">All caught up.</p><p class="qp-sub">${qs_.done} practiced${qStreak() ? ` · ${qStreak()}-day streak` : ""}. More come due over the next days.</p></div>
        <div class="qp-f"><button class="btn primary" type="button" data-qp="close">Done</button></div></div>`;
      qp.querySelector(".qp-f .btn")?.focus();
      return;
    }
    const p = qProg(q.id), lv = p ? p.lv : 0, st = qs_.stage;
    const meta = `${esc(q.by || "Unattributed")}${q.source ? `, <cite>${esc(q.source)}</cite>` : ""}`;
    const full = st === "read" || st === "reveal";
    let body;
    if (st === "reveal" && qs_.typed.trim()) {
      const d = qDiff(q.text, qs_.typed);
      body = `<blockquote class="qp-q diff">${d.html}</blockquote><p class="qp-score">${d.hit} of ${d.total} words${d.hit === d.total ? " · word for word" : ""}</p>`;
    } else if (full) body = `<blockquote class="qp-q">${esc(q.text)}</blockquote>`;
    else body = lv >= 3 ? `<div class="qp-q qp-hidden"><span>Say it from memory</span><small>${q.text.split(/\s+/).length} words</small></div>` : `<blockquote class="qp-q hint l${lv}">${qHint(q.text, lv)}</blockquote>`;
    const extra = full ? `${q.note ? `<p class="qp-attr"><b>Attribution</b> ${esc(q.note)}</p>` : ""}${q.use ? `<p class="qp-use"><b>Use it</b> ${esc(q.use)}</p>` : ""}` : "";
    const typeBox = st === "recall" && qTyping() ? `<textarea class="qp-type" id="qp-type" rows="3" placeholder="Type it from memory, then Enter to check" aria-label="Type the quote">${esc(qs_.typed)}</textarea>` : "";
    const levelTxt = p ? `Level ${lv} of 3` : "New";
    const foot = st === "read" ? `<button class="btn primary" type="button" data-qp="start">Hide words and recall <kbd>Space</kbd></button>`
      : st === "recall" ? `<label class="qp-tg"><input type="checkbox" data-qp="type"${qTyping() ? " checked" : ""}> Type it</label><button class="btn" type="button" data-qp="peek">Read it</button><button class="btn primary" type="button" data-qp="reveal">Reveal <kbd>Space</kbd></button>`
      : `<div class="qp-grade"><button class="btn g0" type="button" data-qg="0">Again <kbd>1</kbd></button><button class="btn g1" type="button" data-qg="1">Almost <kbd>2</kbd></button><button class="btn g2 primary" type="button" data-qg="2">Got it <kbd>3</kbd></button></div>`;
    qp.innerHTML = `<div class="qp-in">
      <div class="qp-h"><span class="qp-k">${qs_.list.length > 1 ? `${qs_.i + 1} of ${qs_.list.length} · ` : ""}${levelTxt}</span><button class="icon-btn" type="button" data-qp="close" aria-label="Close">×</button></div>
      <div class="qp-body">
        <p class="qp-step">${st === "read" ? "Read it out loud" : st === "recall" ? (lv >= 3 ? "Say the whole quote" : "Say it out loud, filling the blanks") : "How did it go?"}</p>
        ${body}
        <p class="qp-by">— ${lv >= 3 || full ? meta : esc(q.by || "Unattributed")}</p>
        ${extra}${typeBox}
      </div>
      <div class="qp-f">${foot}</div></div>`;
    const ta = qp.querySelector("#qp-type");
    if (ta && !matchMedia("(pointer:coarse)").matches) ta.focus();
    else qp.querySelector(".qp-f .primary")?.focus();
  }
  function qNext() {
    qs_.i++;
    qs_.typed = "";
    const id = qs_.list[qs_.i];
    qs_.stage = id && !qProg(id) ? "read" : "recall";
    renderPractice();
  }
  function qReveal() {
    qs_.typed = qp.querySelector("#qp-type")?.value || "";
    qs_.stage = "reveal";
    renderPractice();
  }
  function qDoGrade(g) {
    qGrade(qs_.list[qs_.i], g);
    qs_.done++;
    renderQuotes();
    qNext();
  }
  qp.addEventListener("click", (e) => {
    if (e.target === qp) return qp.close();
    const g = e.target.closest("[data-qg]");
    if (g) return qDoGrade(+g.dataset.qg);
    const a = e.target.closest("[data-qp]")?.dataset.qp;
    if (a === "close") qp.close();
    else if (a === "start") { qs_.stage = "recall"; renderPractice(); }
    else if (a === "peek") { qs_.stage = "read"; renderPractice(); }
    else if (a === "reveal") qReveal();
  });
  qp.addEventListener("change", (e) => {
    if (e.target.matches('[data-qp="type"]')) { state.qType = e.target.checked; save(); qs_.typed = ""; renderPractice(); }
  });
  qp.addEventListener("keydown", (e) => {
    if (e.target.id === "qp-type") {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); qReveal(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches("input,select,textarea")) return;
    if (e.key === " " && qs_.stage !== "reveal" && qs_.list[qs_.i]) { e.preventDefault(); qs_.stage === "read" ? (qs_.stage = "recall", renderPractice()) : qReveal(); }
    else if (qs_.stage === "reveal" && ["1", "2", "3"].includes(e.key)) { e.preventDefault(); qDoGrade(+e.key - 1); }
  });

  // ---------- tabs: one strip for the secondary panes; on phones a bottom bar picks the section ----------
  const PANES = ["week", "tests", "quotes", "sports", "news", "fantasy", "count"], TABS = ["today", "homework", "music", "more"];
  function showPane(name) {
    if (!PANES.includes(name)) name = "week";
    document.querySelectorAll("[data-tab-pane]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tabPane === name)));
    document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.dataset.pane !== name; });
    wake($(`.pane[data-pane="${name}"]`));
    if (state.pane !== name) { state.pane = name; save(); }
  }
  function showTab(name) {
    if (!TABS.includes(name)) name = "today";
    document.documentElement.dataset.tab = name;
    document.querySelectorAll("#tabbar [data-tab]").forEach((b) => b.toggleAttribute("aria-current", b.dataset.tab === name));
    if (name === "music") spRender(true);
    if (name === "today") requestAnimationFrame(nuFit);
    if (name === "more") wake($(".pane:not([hidden])"));
    if (state.tab !== name) { state.tab = name; save(); }
  }
  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-tab-pane]");
    if (p) showPane(p.dataset.tabPane);
    const t = e.target.closest("#tabbar [data-tab]");
    if (t) { showTab(t.dataset.tab); window.scrollTo({ top: 0, behavior: "auto" }); }
  });
  showPane(state.pane);
  showTab(state.tab);

  // add / edit dialog
  const dlg = $("#dlg"), form = $("#form");
  let editing = null;
  function openForm(item) {
    editing = item || null;
    $("#f-class").innerHTML = Object.keys(schedule.classes).map((k) => `<option value="${esc(k)}">${esc(schedule.classes[k].name)}</option>`).join("");
    $("#f-class").value = item?.class || "Latin";
    $("#f-title").value = item?.title || "";
    $("#f-due").value = item?.due || nextSchoolDay(today());
    $("#f-type").value = item?.type || "homework";
    $("#f-details").value = item?.details || "";
    $("#dlg-h").textContent = item ? "Edit assignment" : "Add assignment";
    $("#f-save").textContent = item ? "Save" : "Add";
    $("#f-delete").hidden = !item;
    dlg.showModal();
    if (!matchMedia("(pointer:coarse)").matches) $("#f-title").focus();
  }
  $("#add-btn").onclick = () => openForm();
  $("#f-cancel").onclick = () => dlg.close();
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit]");
    if (b) openForm(state.manual.find((m) => m.uid === b.dataset.edit));
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = {
      class: $("#f-class").value,
      title: $("#f-title").value.trim(),
      due: $("#f-due").value,
      type: $("#f-type").value,
      details: $("#f-details").value.trim(),
    };
    if (!data.title || !data.due) return;
    if (editing) Object.assign(editing, data, { t: stamp() });
    else state.manual.push({ uid: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), added: stamp(), ...data });
    save();
    dlg.close();
    renderHomework();
    toast(editing ? "Saved" : "Added to your list");
  });
  $("#f-delete").onclick = () => {
    if (!editing) return;
    const removed = editing, idx = state.manual.indexOf(removed);
    state.manual.splice(idx, 1);
    delete state.done[removed.uid];
    state.removed[removed.uid] = stamp();
    save();
    dlg.close();
    renderHomework();
    toast("Deleted", () => { state.manual.splice(idx, 0, removed); delete state.removed[removed.uid]; removed.t = stamp(); save(); renderHomework(); });
  };

  // light / dark
  const icons = {
    dark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
    light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  };
  const root = document.documentElement;
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme:dark)").matches;
  // data-mode always says which one is showing, so skins only need one dark selector
  const paintThemeBtn = () => { $("#theme-btn").innerHTML = isDark() ? icons.light : icons.dark; root.dataset.mode = isDark() ? "dark" : "light"; };
  try { const t = localStorage.getItem(THEME); if (t) root.dataset.theme = t; } catch {}
  $("#theme-btn").onclick = () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem(THEME, next); } catch {}
    setPref("theme", next);
    paintThemeBtn();
    spRender();
  };
  matchMedia("(prefers-color-scheme:dark)").addEventListener("change", () => { paintThemeBtn(); spRender(); });
  paintThemeBtn();

  // ---------- skins: optional looks from themes/, picked in the top bar (index.html applies the saved one before paint) ----------
  const SKIN = "rlp-skin";
  const SKINS = { original: "Ink & Paper", herbarium: "Herbarium", moss: "Moss", departure: "Departure board", blueprint: "Blueprint", catalog: "Card catalog", nautical: "Nautical chart", almanac: "Seed almanac", arcade: "Arcade", chess: "Chess club", hardwood: "Hardwood" };
  const V = new URL(document.currentScript.src).searchParams.get("v") || "";
  const skinNow = () => root.dataset.skin || "original";
  function setSkin(name, remember = true) {
    if (!SKINS[name]) name = "original";
    document.getElementById("skin-css")?.remove();
    if (name === "original") delete root.dataset.skin;
    else {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.id = "skin-css";
      l.href = `themes/${name}.css${V ? `?v=${V}` : ""}`;
      l.onload = () => spRender(); // the player's dark or artwork-colored look comes from the skin
      document.head.append(l);
      root.dataset.skin = name;
    }
    if (remember) { try { localStorage.setItem(SKIN, name); } catch {} setPref("skin", name); }
    if (schedule) { renderBar(); renderSchedule(); renderHomework(); placeFeed(); }
    spRender();
    inkWatch(true);
  }
  // a saved skin that's since been retired (Riso zine, Star chart) is forgotten; index.html already showed the original
  try { const s = localStorage.getItem(SKIN); if (s && !SKINS[s]) localStorage.removeItem(SKIN); } catch {}
  const skinSels = document.querySelectorAll(".skin-select");
  skinSels.forEach((sel) => {
    sel.innerHTML = Object.entries(SKINS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    sel.value = skinNow();
    sel.onchange = () => { setSkin(sel.value); skinSels.forEach((o) => { o.value = sel.value; }); };
  });
  // the Nov 2026 redesign lives in Ink & Paper, so every device lands there once (any skin can be picked again after);
  // run after start-up so everything setSkin redraws exists. The pref it saves is newer, so sync carries it to other devices.
  setTimeout(() => {
    try {
      if (localStorage.getItem("rlp-ink-paper-1")) return;
      localStorage.setItem("rlp-ink-paper-1", "1");
      if (skinNow() !== "original") { setSkin("original"); skinSels.forEach((o) => { o.value = "original"; }); }
    } catch {}
  }, 0);

  const reduced = () => matchMedia("(prefers-reduced-motion:reduce)").matches;
  // a skin can hold a checked row on screen a moment for its stamp (--leave-ms in its CSS)
  const leaveMs = () => reduced() ? 220 : parseInt(getComputedStyle(root).getPropertyValue("--leave-ms")) || 220;

  // split text into one tile per character; tiles whose character changed since `prev` get .flip
  function flaps(el, text, prev) {
    el.setAttribute("aria-label", text);
    el.innerHTML = [...text].map((ch, i) => ch === " " ? `<i class="gap" aria-hidden="true"></i>`
      : `<i class="flap${prev && prev[i] !== ch ? " flip" : ""}" aria-hidden="true">${esc(ch)}</i>`).join("");
    return text;
  }

  // Departure board: a station clock beside the homework pill
  let clockTimer;
  function skinBar() {
    clearInterval(clockTimer);
    $("#almanac").innerHTML = skinNow() === "almanac" ? almanacHTML() : "";
    if (skinNow() !== "departure") return;
    const c = document.createElement("span");
    c.className = "skin-clock";
    $("#updated").append(c);
    let shown = "";
    const tick = () => { const n = now(), t = `${pad(n.getHours())}:${pad(n.getMinutes())}`; if (t !== shown) shown = flaps(c, t, shown); };
    tick();
    clockTimer = setInterval(tick, 1000);
  }
  // Departure board: the countdown in split-flap tiles that flip when the minute changes
  let lastNum = "";
  function skinSchedule() {
    const num = $("#now-card .num");
    if (skinNow() !== "departure" || !num) { lastNum = ""; return; }
    lastNum = flaps(num, num.textContent, lastNum);
  }

  // Seed almanac: moon phase and the school days left before the next day off
  function almanacHTML() {
    const n = now();
    const p = (((n - Date.UTC(2000, 0, 6, 18, 14)) / 864e5 / 29.530588853) % 1 + 1) % 1;
    const names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
    const k = Math.cos(2 * Math.PI * p), rx = Math.abs(k) * 7, wax = p < 0.5;
    const lit = `M8 1A7 7 0 0 ${wax ? 1 : 0} 8 15A${rx.toFixed(2)} 7 0 0 ${wax ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0)} 8 1Z`;
    const moon = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" class="m-dark"/><path d="${lit}" class="m-lit"/></svg>`;
    const t = today();
    const off = Object.keys(homework?.off || {}).sort().find((d) => d > t);
    let line = "";
    if (off) {
      const n2 = schoolDaysUntil(addDays(off, -1));
      line = `${n2} school day${n2 === 1 ? "" : "s"} to ${esc(homework.off[off])}`;
    }
    return `${moon}<span><b>${names[Math.round(p * 8) % 8]}</b>${line ? `<small>${line}</small>` : ""}</span>`;
  }

  // ?font=Some+Family tries another Google font without editing the CSS
  const tryFont = new URLSearchParams(location.search).get("font");
  if (tryFont && /^[\w ]{2,40}$/.test(tryFont)) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(tryFont).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
    document.head.append(l);
    document.documentElement.style.setProperty("--sans", `"${tryFont}",system-ui,sans-serif`);
  }

  // ---------- study mode: full screen, one thing at a time ----------
  // The clock follows the bell during school and becomes a focus timer outside it. The Music card isn't moved
  // (moving an iframe restarts it); it's pinned over a slot in the layout, or docked at the bottom on phones.
  const study = $("#study");
  const ST_PRESETS = { "25/5": [25, 5], "50/10": [50, 10] };
  const st = { open: false, t0: 0, done: 0, pick: null, key: "", lock: null, nudged: 0,
    focus: { preset: (() => { try { return localStorage.getItem("rlp-focus") || "25/5"; } catch { return "25/5"; } })(), phase: "focus", endsAt: 0, left: 25 * 60e3, round: 1 } };

  // tonight's list: what's due on the next school day (today's, during school), tests and projects first,
  // then anything left over from before; if that's all done, the next few coming up
  function stQueue() {
    const t = today(), by = isSchoolDay(t) && now().getHours() < 15 ? t : nextSchoolDay(t);
    const open = allItems().filter((i) => !isDone(i));
    const main = open.filter((i) => i.due === by).sort((a, b) => MAJOR.has(b.type) - MAJOR.has(a.type));
    const late = open.filter((i) => i.due < by).sort((a, b) => b.due.localeCompare(a.due));
    const q = [...main, ...late];
    return q.length ? q : open.filter((i) => i.due > by).slice(0, 4);
  }
  const stCurrent = (q) => q.find((i) => i.id === st.pick) || q[0];

  // what the subject helper can honestly show: the item's own details, plus a few fixed facts for topics on the list
  const romanNum = (s) => [...s.toUpperCase()].reduce((n, c, i, a) => { const v = { I: 1, V: 5, X: 10, L: 50 }[c], w = { I: 1, V: 5, X: 10, L: 50 }[a[i + 1]] || 0; return n + (v < w ? -v : v); }, 0);
  function stHelp(it) {
    if (!it) return "";
    const text = `${it.details || ""} ${it.title}`, out = []; // details first: they carry the line and page numbers
    const od = /Odyssey\s+([IVXL]+)\b(?:[.,]\s*([\d\-–, ]+(?:end)?))?/i.exec(text);
    if (od) {
      const ranges = (od[2] || "").split(",").map((r) => r.trim()).filter(Boolean);
      const count = ranges.every((r) => /^\d+[-–]\d+$/.test(r)) ? ranges.reduce((n, r) => { const [a, b] = r.split(/[-–]/).map(Number); return n + b - a + 1; }, 0) : 0;
      out.push(`<div class="st-fact"><b>Odyssey, Book ${esc(od[1].toUpperCase())}</b> (book ${romanNum(od[1])} of 24)${ranges.length ? `<br>Lines ${esc(ranges.join(", "))}${count ? ` · about ${count} lines` : ""}` : ""}</div>`);
    }
    if (/ohm/i.test(text)) out.push(`<div class="st-fact"><b>Ohm's law</b><span class="st-f">V = I × R</span><span class="st-f">I = V ÷ R</span><span class="st-f">R = V ÷ I</span><small>V volts · I amps · R ohms (Ω) · power P = V × I watts</small></div>`);
    if (/binary|bitRead/i.test(text)) out.push(`<div class="st-fact"><b>Binary place values</b><span class="st-bits">${[128, 64, 32, 16, 8, 4, 2, 1].map((v) => `<i>${v}</i>`).join("")}</span><small>bitRead(x, n) gives bit n of x, counting from 0 at the right</small></div>`);
    if (/ut clause/i.test(text)) out.push(`<div class="st-fact"><b>Ut clauses</b><small><b>Purpose:</b> ut / nē + subjunctive, "so that, in order to"<br><b>Result:</b> ut / ut nōn + subjunctive, set up by tam, ita, sīc, tantus, tot: "so … that"</small></div>`);
    if (/participle/i.test(text)) out.push(`<div class="st-fact"><b>Participles</b><small>Present active -ns, -ntis: "___ing"<br>Perfect passive -tus, -a, -um: "having been ___ed"<br>Future active -tūrus, -a, -um: "about to ___"</small></div>`);
    if (/punic/i.test(text) || /fabius/i.test(text)) out.push(`<div class="st-fact"><b>Second Punic War</b><small>218–201 BC, Rome against Hannibal of Carthage. Cannae 216 BC; Fabius Maximus "Cunctator" wears Hannibal down by avoiding battle; Scipio wins at Zama, 202 BC.</small></div>`);
    if (/heure/i.test(text)) out.push(`<div class="st-fact"><b>L'heure</b><small>Il est une heure, deux heures… · et quart :15 · et demie :30 · moins le quart :45 · midi, minuit</small></div>`);
    const pg = /p(?:p|ages?)?\.?\s*(\d+)\s*[-–]\s*(\d+)/i.exec(it.details || it.pages || "");
    if (pg && it.class === "Forces") out.push(`<div class="st-fact"><b>Pages ${pg[1]}–${pg[2]}</b><small>${+pg[2] - +pg[1] + 1} pages${it.pages && it.pages.includes(",") ? `, plus ${esc(it.pages.split(",").slice(1).join(", ").trim())}` : ""}</small></div>`);
    return out.join("");
  }

  // the background follows the subject: drawn scenes, kept dim so the cards stay easy to read
  function stScene(name) {
    const W = 1600, H = 900, svg = (body) => `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
    const rnd = ((s) => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
    const stars = (n, h) => Array.from({ length: n }, () => `<circle cx="${(rnd() * W) | 0}" cy="${(rnd() * h) | 0}" r="${(0.6 + rnd() * 1.2).toFixed(1)}" fill="#fff" opacity="${(0.25 + rnd() * 0.5).toFixed(2)}"/>`).join("");
    if (name === "English") {
      const waves = Array.from({ length: 16 }, (_, i) => { const y = 560 + i * 22 + i * i; let d = `M0 ${y}`; for (let x = 0; x < W + 160; x += 80) d += ` q40 ${-4 - i * 0.5} 80 0`; return `<path d="${d}" stroke="#9fb1cf" stroke-opacity="${(0.05 + i * 0.008).toFixed(3)}" fill="none" stroke-width="1.4" style="animation-duration:${(34 - i * 1.6).toFixed(1)}s"/>`; }).join("");
      return { label: "The wine-dark sea", svg: svg(`<defs><linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="#101729"/><stop offset=".55" stop-color="#2a2c46"/><stop offset="1" stop-color="#5a3a47"/></linearGradient><linearGradient id="w" x2="0" y2="1"><stop offset="0" stop-color="#3a2a3c"/><stop offset=".25" stop-color="#1b2136"/><stop offset="1" stop-color="#0c111d"/></linearGradient><radialGradient id="g"><stop offset="0" stop-color="#efe6cf" stop-opacity=".18"/><stop offset="1" stop-color="#efe6cf" stop-opacity="0"/></radialGradient></defs>
        <rect width="${W}" height="540" fill="url(#s)"/>${stars(70, 420)}<circle cx="1180" cy="230" r="150" fill="url(#g)"/><circle cx="1180" cy="230" r="42" fill="#ece3cc" opacity=".9"/>
        <rect y="540" width="${W}" height="${H - 540}" fill="url(#w)"/><rect class="fx-shim" x="1150" y="545" width="60" height="300" fill="#ece3cc" opacity=".05"/><g class="fx-wave">${waves}</g>
        <g class="fx-bob" fill="#0a0d16"><path d="M380 548h150l-22 16H404z"/><rect x="452" y="470" width="4" height="80"/><path d="M420 482h68l-6 48h-56z" opacity=".92"/></g>`) };
    }
    if (name === "Latin") {
      const cols = [180, 260, 340, 420, 980, 1060, 1300].map((x, i) => { const h = [300, 300, 300, 300, 230, 160, 270][i]; return `<rect x="${x}" y="${720 - h}" width="38" height="${h}"/><rect x="${x - 7}" y="${720 - h - 14}" width="52" height="14"/><rect x="${x - 9}" y="704" width="56" height="16"/>`; }).join("");
      return { label: "The Forum at dusk", svg: svg(`<defs><linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="#1f2034"/><stop offset=".55" stop-color="#5a4152"/><stop offset=".85" stop-color="#b9805f"/><stop offset="1" stop-color="#cf9a6c"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(30, 260)}<circle class="fx-glow" cx="760" cy="640" r="70" fill="#f1c08a" opacity=".55"/>
        <path d="M0 650 C200 600 380 640 560 610 S900 590 1100 620 1450 600 1600 630V900H0z" fill="#3a2b36"/>
        <g fill="#1a1520">${cols}<rect x="166" y="392" width="300" height="26"/><path d="M1130 720V520a110 110 0 0 1 220 0v200h-46V530a64 64 0 0 0-128 0v190z"/><rect y="718" width="${W}" height="${H - 718}"/></g>`) };
    }
    if (name === "French") {
      let roofs = "M0 900V640", win = "";
      for (let x = 0; x < W; x += 0) { const w = 90 + ((rnd() * 90) | 0), top = 560 + ((rnd() * 90) | 0); roofs += ` L${x} ${top + 30} L${x + 14} ${top} L${x + w - 14} ${top} L${x + w} ${top + 30}`; if (rnd() > 0.5) roofs += ` L${x + w - 30} ${top + 30} L${x + w - 30} ${top - 22} L${x + w - 18} ${top - 22} L${x + w - 18} ${top + 30}`;
        for (let r = 0; r < 4; r++) for (let c = 0; c < Math.floor(w / 28); c++) if (rnd() > 0.62) win += `<rect${rnd() > 0.86 ? ` class="fx-win" style="animation-delay:-${(rnd() * 30).toFixed(1)}s;animation-duration:${(16 + rnd() * 22).toFixed(1)}s"` : ""} x="${x + 10 + c * 28}" y="${top + 48 + r * 54}" width="12" height="20" rx="1"/>`; x += w; }
      roofs += ` L${W} 640 V900z`;
      return { label: "Paris at night", svg: svg(`<defs><linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="#0d1326"/><stop offset="1" stop-color="#232b47"/></linearGradient><radialGradient id="l"><stop offset="0" stop-color="#f3cd86" stop-opacity=".45"/><stop offset="1" stop-color="#f3cd86" stop-opacity="0"/></radialGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#s)"/>${stars(90, 520)}
        <path d="M1150 150l7 70h-14zM1143 220h14l22 170h-58zM1121 390h58l40 140h-138zM1081 530h138l60 200h-60c-10-70-40-110-69-110s-59 40-69 110h-60z" fill="#0a0e1b"/><circle cx="1150" cy="148" r="4" fill="#f3cd86"/>
        <path d="${roofs}" fill="#0b0f1c"/><g fill="#e9bb6e" opacity=".75">${win}</g>
        <rect x="300" y="560" width="6" height="340" fill="#06080f"/><circle class="fx-glow" cx="303" cy="560" r="90" fill="url(#l)"/><circle cx="303" cy="556" r="9" fill="#f6d79c"/>`) };
    }
    if (name === "MSI") {
      let traces = "", nodes = "";
      const pts = [];
      for (let i = 0; i < 26; i++) { let x = ((rnd() * 16) | 0) * 100, y = ((rnd() * 9) | 0) * 100, d = `M${x} ${y}`; const tr = [[x, y]]; for (let k = 0; k < 5; k++) { if (rnd() > 0.5) x += (rnd() > 0.5 ? 1 : -1) * 100; else y += (rnd() > 0.5 ? 1 : -1) * 100; d += ` L${x} ${y}`; tr.push([x, y]); } pts.push(tr); traces += `<path d="${d}"/>`; nodes += `<circle cx="${x}" cy="${y}" r="5"/>`; }
      return { label: "Circuit board", data: { traces: pts }, svg: svg(`<defs><radialGradient id="b" cx=".7" cy=".4" r=".9"><stop offset="0" stop-color="#14302a"/><stop offset="1" stop-color="#0a1311"/></radialGradient><filter id="f"><feGaussianBlur stdDeviation="6"/></filter></defs>
        <rect width="${W}" height="${H}" fill="url(#b)"/><g fill="none" stroke="#5fc4a4" stroke-width="2" opacity=".18" filter="url(#f)">${traces}</g><g fill="none" stroke="#5fc4a4" stroke-width="1.6" opacity=".28">${traces}</g><g fill="#7fdcbf" opacity=".45">${nodes}</g>
        <g fill="#0d1b18" stroke="#5fc4a4" stroke-opacity=".35"><rect x="1080" y="300" width="240" height="240" rx="10"/></g><g stroke="#5fc4a4" stroke-opacity=".3" stroke-width="3">${Array.from({ length: 8 }, (_, i) => `<path d="M${1100 + i * 28} 300v-30M${1100 + i * 28} 540v30M1080 ${320 + i * 28}h-30M1320 ${320 + i * 28}h30"/>`).join("")}</g>`) };
    }
    if (name === "Forces") {
      const par = Array.from({ length: 7 }, (_, i) => { const y = 470 + (i - 3) * 112, w = Math.sqrt(Math.max(0, 400 ** 2 - (y - 470) ** 2)); return `<path d="M${800 - w} ${y}H${800 + w}"/>`; }).join("");
      return { label: "The world at night", data: { globe: { cx: 800, cy: 470, r: 400 } }, svg: svg(`<defs><radialGradient id="b" cx=".5" cy=".52" r=".8"><stop offset="0" stop-color="#18263b"/><stop offset="1" stop-color="#0c121d"/></radialGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#b)"/>${stars(60, H)}<circle cx="800" cy="470" r="400" fill="#122036" stroke="#6f8fb8" stroke-opacity=".35"/><g fill="none" stroke="#6f8fb8" stroke-opacity=".22">${par}</g>`) };
    }
    return { label: "", svg: "" };
  }

  // ---------- study mode: ambient motion over the drawn scene ----------
  // One canvas at about 30 frames a second, drawn in the scene's own 1600×900 space so it lines up with the SVG
  // (same "slice" fit). Slow and dim on purpose: it slows further on a break, sleeps in a hidden tab, and the
  // Motion button turns it off (off by default with reduced motion). The SVG bits (waves, windows) are CSS, gated by .fx.
  const fx = { raf: 0, on: false, ctx: null, dpr: 1, k: 1, ox: 0, oy: 0, last: 0, t: 0, speed: 1, p: null };
  function stMotionPref() {
    let v = null;
    try { v = localStorage.getItem("rlp-st-motion"); } catch {}
    return v ? v === "on" : !matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function fxSize() {
    const cv = $("#st-fx"), r = cv.getBoundingClientRect();
    fx.dpr = Math.min(1.5, devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(r.width * fx.dpr));
    cv.height = Math.max(1, Math.round(r.height * fx.dpr));
    fx.k = Math.max(r.width / 1600, r.height / 900);
    fx.ox = (r.width - 1600 * fx.k) / 2;
    fx.oy = (r.height - 900 * fx.k) / 2;
    fx.ctx = cv.getContext("2d");
  }
  // a theme color as r,g,b, whatever syntax the theme wrote it in
  function fxRGB(cssVar) {
    const probe = document.createElement("i");
    probe.style.color = `var(${cssVar})`;
    study.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    const x = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    x.fillStyle = c; x.fillRect(0, 0, 1, 1);
    return [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }
  const fxEmber = (rnd, scatter) => ({ x: 380 + rnd() * 840, y: scatter ? 420 + rnd() * 420 : 700 + rnd() * 140, vy: -(9 + rnd() * 16), ph: rnd() * 6.28, r: 1 + rnd() * 1.7, top: 260 + rnd() * 240 });
  function fxSetup(name, data) {
    const rnd = ((s) => () => (s = (s * 16807) % 2147483647) / 2147483647)(11);
    const sky = { English: 420, Latin: 260, French: 520, Forces: 900 }[name] || 0;
    const p = { name, data, sky, rnd, stars: [], parts: [], shoot: null, nextShoot: 5 + rnd() * 8 };
    for (let i = 0; i < (sky ? 46 : 0); i++) p.stars.push({ x: rnd() * 1600, y: rnd() * sky, r: 0.7 + rnd() * 1.3, ph: rnd() * 6.28, sp: 0.4 + rnd() * 1.1 });
    if (name === "Latin") for (let i = 0; i < 40; i++) p.parts.push(fxEmber(rnd, true));
    if (name === "English") for (let i = 0; i < 28; i++) p.parts.push({ x: 1120 + rnd() * 120, y: 560 + rnd() * 320, w: 8 + rnd() * 26, ph: rnd() * 6.28, sp: 0.5 + rnd() * 1.3 });
    if (name === "MSI" && data?.traces) for (let i = 0; i < 16; i++) p.parts.push({ tr: (rnd() * data.traces.length) | 0, at: rnd(), sp: 0.05 + rnd() * 0.07 });
    if (name === "Forces") for (let i = 0; i < 110; i++) p.parts.push({ lat: Math.asin(2 * rnd() - 1) * 0.85, lon: rnd() * 6.283, r: 0.8 + rnd() * 1.5 });
    if (!name) { // no subject scene: soft washes of the theme's own colors drifting, and a little dust
      p.blobs = ["--accent", "--c-latin", "--c-fr", "--c-msi"].map((v) => {
        const [r, g, b] = fxRGB(v), img = document.createElement("canvas");
        img.width = img.height = 256;
        const x = img.getContext("2d"), gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
        gr.addColorStop(0, `rgba(${r},${g},${b},.2)`); gr.addColorStop(0.6, `rgba(${r},${g},${b},.07)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
        return { img, ax: 300 + rnd() * 1000, ay: 200 + rnd() * 500, rx: 180 + rnd() * 260, ry: 120 + rnd() * 160, sx: 0.025 + rnd() * 0.03, sy: 0.02 + rnd() * 0.03, ph: rnd() * 6.28, r: 380 + rnd() * 240 };
      });
      p.ink = `rgb(${fxRGB("--fg").join(",")})`;
      for (let i = 0; i < 36; i++) p.parts.push({ x: rnd() * 1600, y: rnd() * 900, r: 0.8 + rnd() * 1.7, vy: -(4 + rnd() * 8), ph: rnd() * 6.28 });
    }
    fx.p = p;
  }
  function fxAlong(tr, f) {
    const n = tr.length - 1, at = Math.min(n - 1e-6, Math.max(0, f * n)), i = Math.floor(at), u = at - i;
    return [tr[i][0] + (tr[i + 1][0] - tr[i][0]) * u, tr[i][1] + (tr[i + 1][1] - tr[i][1]) * u];
  }
  function fxDot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
  function fxDraw(dt) {
    const { ctx, p } = fx, t = fx.t;
    if (!ctx || !p) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(fx.k * fx.dpr, 0, 0, fx.k * fx.dpr, fx.ox * fx.dpr, fx.oy * fx.dpr);
    if (p.blobs) {
      for (const b of p.blobs) { ctx.globalAlpha = 1; ctx.drawImage(b.img, b.ax + Math.sin(t * b.sx + b.ph) * b.rx - b.r, b.ay + Math.cos(t * b.sy + b.ph * 1.3) * b.ry - b.r, b.r * 2, b.r * 2); }
      ctx.fillStyle = p.ink;
      for (const m of p.parts) {
        m.y += m.vy * dt; m.x += Math.sin(t * 0.5 + m.ph) * 4 * dt;
        if (m.y < -10) { m.y = 910; m.x = p.rnd() * 1600; }
        ctx.globalAlpha = 0.1 + 0.07 * Math.sin(t + m.ph); fxDot(ctx, m.x, m.y, m.r);
      }
      return;
    }
    // twinkling stars and, now and then, a shooting star
    ctx.fillStyle = "#fff";
    for (const s of p.stars) { ctx.globalAlpha = 0.1 + 0.5 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph)); fxDot(ctx, s.x, s.y, s.r); }
    if (p.stars.length && p.name !== "Forces") {
      p.nextShoot -= dt;
      if (p.nextShoot <= 0 && !p.shoot) { p.shoot = { x: 400 + p.rnd() * 1100, y: 30 + p.rnd() * p.sky * 0.45, life: 0 }; p.nextShoot = 12 + p.rnd() * 18; }
      if (p.shoot) {
        const s = p.shoot, k = (s.life += dt / fx.speed) / 1.1;
        if (k >= 1) p.shoot = null;
        else {
          const hx = s.x - k * 360, hy = s.y + k * 140, g = ctx.createLinearGradient(hx, hy, hx + 130, hy - 50);
          g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.globalAlpha = Math.sin(k * Math.PI); ctx.strokeStyle = g; ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + 130, hy - 50); ctx.stroke();
        }
      }
    }
    if (p.name === "Latin") { // embers drifting up out of the sunset
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#ffb26b";
      for (const e of p.parts) {
        e.y += e.vy * dt; e.x += Math.sin(t * 0.7 + e.ph) * 7 * dt;
        if (e.y < e.top) Object.assign(e, fxEmber(p.rnd));
        const a = Math.max(0, Math.min(0.7, (e.y - e.top) / 260)) * (0.75 + 0.25 * Math.sin(t * 3 + e.ph));
        ctx.globalAlpha = a * 0.18; fxDot(ctx, e.x, e.y, e.r * 3.2);
        ctx.globalAlpha = a; fxDot(ctx, e.x, e.y, e.r);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    if (p.name === "English") { // moonlight glinting on the water
      ctx.fillStyle = "#f3ead2";
      for (const g of p.parts) { ctx.globalAlpha = Math.max(0, Math.sin(t * g.sp + g.ph)) * 0.32; ctx.fillRect(g.x + Math.sin(t * 0.3 + g.ph) * 10, g.y, g.w * (0.6 + (0.4 * (g.y - 560)) / 320), 1.6); }
    }
    if (p.name === "MSI") { // pulses of current running along the traces
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#86ffd8";
      for (const q of p.parts) {
        const tr = p.data.traces[q.tr];
        q.at += q.sp * dt;
        if (q.at >= 1) { q.at = 0; q.tr = (p.rnd() * p.data.traces.length) | 0; }
        const a = Math.sin(q.at * Math.PI);
        for (let j = 3; j >= 0; j--) { const [x, y] = fxAlong(tr, q.at - j * 0.012); ctx.globalAlpha = a * (j ? 0.18 / j : 0.85); fxDot(ctx, x, y, j ? 2.4 : 3.2); }
        const [x, y] = fxAlong(tr, q.at); ctx.globalAlpha = a * 0.14; fxDot(ctx, x, y, 13);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    if (p.name === "Forces") { // the globe turns: meridians and city lights
      const { cx, cy, r } = p.data.globe, ph = t * 0.05;
      ctx.strokeStyle = "#8fb0d8"; ctx.lineWidth = 1.2;
      for (let i = 0; i < 12; i++) {
        const lon = ph + (i * Math.PI) / 6, c = Math.cos(lon), sn = Math.sin(lon);
        if (c <= 0) continue;
        ctx.globalAlpha = 0.06 + 0.2 * c;
        ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.5, Math.abs(sn) * r), r, 0, -Math.PI / 2, Math.PI / 2, sn < 0); ctx.stroke();
      }
      ctx.fillStyle = "#ffd28a";
      for (const d of p.parts) {
        const lon = d.lon + ph, z = Math.cos(d.lat) * Math.cos(lon);
        if (z <= 0) continue;
        ctx.globalAlpha = (0.2 + 0.6 * z) * (0.8 + 0.2 * Math.sin(t * 2 + d.lon * 9));
        fxDot(ctx, cx + r * Math.cos(d.lat) * Math.sin(lon), cy - r * Math.sin(d.lat), d.r);
      }
    }
  }
  function fxFrame(ts) {
    fx.raf = requestAnimationFrame(fxFrame);
    if (document.hidden || ts - fx.last < 32) return;
    const dt = Math.min(0.1, (ts - fx.last) / 1000) * fx.speed;
    fx.last = ts;
    fx.t += dt;
    fxDraw(dt);
  }
  function fxRun() {
    const want = st.open && fx.on;
    study.classList.toggle("fx", want);
    $("#st-motion").setAttribute("aria-pressed", String(fx.on));
    if (want && !fx.raf) { fxSize(); fx.last = 0; fx.raf = requestAnimationFrame(fxFrame); }
    if (!want && fx.raf) {
      cancelAnimationFrame(fx.raf); fx.raf = 0;
      fx.ctx?.setTransform(1, 0, 0, 1, 0, 0); fx.ctx?.clearRect(0, 0, fx.ctx.canvas.width, fx.ctx.canvas.height);
    }
  }
  $("#st-motion").onclick = () => {
    fx.on = !fx.on;
    try { localStorage.setItem("rlp-st-motion", fx.on ? "on" : "off"); } catch {}
    fxRun();
  };

  // the Music card sits over its slot (laptop) or docks along the bottom (phone, or a phone held sideways)
  const stDockMQ = matchMedia("(max-width:759px), (max-height:520px)");
  function stPlaceMusic() {
    const card = $(".p-music");
    if (!st.open) { card.removeAttribute("style"); document.documentElement.classList.remove("st-dock"); return; }
    const dock = stDockMQ.matches;
    document.documentElement.classList.toggle("st-dock", dock);
    if (dock) { card.removeAttribute("style"); return; }
    const slot = $("#st-music");
    slot.style.height = card.offsetHeight + "px";
    const r = slot.getBoundingClientRect();
    Object.assign(card.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px` });
  }

  function stClockState() {
    const p = periodNow();
    if (p.mode === "class" || p.mode === "passing" || p.mode === "before") return p;
    return { mode: "focus", note: p.mode === "special" ? p.note : "" };
  }
  function stFocusLeft() { const f = st.focus; return f.endsAt ? Math.max(0, f.endsAt - Date.now()) : f.left; }
  function stRenderClock() {
    const s = stClockState(), f = st.focus;
    if (s.mode === "focus" && f.endsAt && stFocusLeft() <= 0) { // a round ended: switch focus and break
      const [fo, br] = ST_PRESETS[f.preset];
      f.phase = f.phase === "focus" ? "break" : "focus";
      if (f.phase === "focus") f.round++;
      f.left = (f.phase === "focus" ? fo : br) * 60e3;
      f.endsAt = Date.now() + f.left;
      stNudge(f.phase === "break" ? `Round ${f.round} done. Take ${br} minutes: stand up, water, look away from the screen.` : "Break's over. Back to it.");
    }
    const label = s.mode === "class" ? (s.seg.name ? cls(s.seg.name).name : s.seg.label) : s.mode === "passing" ? `Passing · next ${s.next.name ? cls(s.next.name).name : s.next.label}` : s.mode === "before" ? "Until school" : f.phase;
    const key = `${s.mode}|${label}|${f.preset}`;
    const el = $("#st-clock");
    fx.speed = s.mode === "focus" && f.phase === "break" ? 0.4 : 1;
    if (key !== st.key) {
      st.key = key;
      const room = (seg) => seg?.name ? where(seg.name) : "";
      el.style.cssText = s.mode === "class" && s.seg.name ? cc(s.seg.name) : s.mode === "passing" && s.next.name ? cc(s.next.name) : "";
      if (s.mode === "focus") {
        el.innerHTML = `<div class="st-k">${s.note ? `Special schedule today · ${esc(s.note)}` : f.phase === "focus" ? `Focus · round ${f.round}` : "Break"}</div>
          <div class="st-row"><div class="num st-num" id="st-num"></div>${f.phase === "break" ? `<div class="st-breathe" aria-hidden="true"><i></i><span>Breathe in</span><span>Breathe out</span></div>` : ""}</div><div class="prog"><i id="st-bar"></i></div>
          <div class="st-ctrl"><button class="btn primary" type="button" data-st="go"></button><button class="btn" type="button" data-st="reset">Reset</button>
          <div class="seg" role="group" aria-label="Focus length">${Object.keys(ST_PRESETS).map((k) => `<button type="button" data-preset="${k}" aria-pressed="${k === f.preset}">${k}</button>`).join("")}</div></div>`;
      } else {
        const n = s.next;
        el.innerHTML = `<div class="st-k">${s.mode === "class" ? "Left in" : s.mode === "passing" ? "Passing time" : "Until school"}</div>
          <div class="lbl">${esc(s.mode === "class" ? (s.seg.name ? cls(s.seg.name).name : s.seg.label) : s.mode === "passing" ? `Next: ${n.name ? cls(n.name).name : n.label}` : `First: ${n.name ? cls(n.name).name : n.label}`)}${s.mode === "class" && room(s.seg) ? `<small>${esc(room(s.seg))}</small>` : ""}</div>
          <div class="num st-num" id="st-num"></div><div class="prog"><i id="st-bar"></i></div>
          <div class="sub">${s.mode === "class" ? `Ends ${s.seg.end}${s.gap > 0 && s.gap <= passing() ? ` · ${s.gap} min passing` : ""}${n ? ` · then ${esc(n.name ? cls(n.name).name : n.label)} at ${n.start}${n.name ? ` in ${esc(where(n.name))}` : ""}` : " · last one today"}` : `${esc(n.name ? cls(n.name).name : n.label)} at ${n.start}${n.name ? ` in ${esc(where(n.name))}` : ""}`}</div>`;
      }
    }
    const left = s.mode === "focus" ? stFocusLeft() / 60e3 : s.left;
    const pct = s.mode === "focus" ? 1 - stFocusLeft() / (ST_PRESETS[f.preset][f.phase === "focus" ? 0 : 1] * 60e3) : s.mode === "class" ? s.pct : 0;
    const num = $("#st-num"), txt = clock(left);
    if (num.textContent !== txt) num.textContent = txt;
    $("#st-bar").style.width = `${Math.round(Math.min(1, Math.max(0, pct)) * 100)}%`;
    const go = el.querySelector('[data-st="go"]');
    if (go) go.textContent = f.endsAt ? "Pause" : f.left < ST_PRESETS[f.preset][f.phase === "focus" ? 0 : 1] * 60e3 ? "Resume" : "Start";
  }
  $("#st-clock").addEventListener("click", (e) => {
    const f = st.focus, b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.preset) {
      f.preset = b.dataset.preset;
      try { localStorage.setItem("rlp-focus", f.preset); } catch {}
      setPref("focus", f.preset);
      Object.assign(f, { phase: "focus", endsAt: 0, left: ST_PRESETS[f.preset][0] * 60e3, round: 1 });
    } else if (b.dataset.st === "go") {
      if (f.endsAt) { f.left = stFocusLeft(); f.endsAt = 0; } else f.endsAt = Date.now() + f.left;
    } else if (b.dataset.st === "reset") Object.assign(f, { phase: "focus", endsAt: 0, left: ST_PRESETS[f.preset][0] * 60e3 });
    st.key = "";
    stRenderClock();
  });

  function stNudge(msg) {
    const el = $("#st-nudge");
    el.innerHTML = `<span>${esc(msg)}</span><button type="button" class="link">OK</button>`;
    el.hidden = false;
    el.querySelector("button").onclick = () => { el.hidden = true; };
  }

  let stSceneName = null;
  function stRenderWork() {
    const q = stQueue(), it = stCurrent(q);
    const scene = it?.class || periodNow().seg?.name || "";
    if (scene !== stSceneName) {
      stSceneName = scene;
      const sc = stScene(scene);
      $("#st-scene").innerHTML = sc.svg;
      study.classList.toggle("has-scene", !!sc.svg);
      fxSetup(sc.svg ? scene : "", sc.data);
      $("#st-where").textContent = sc.label || "Study mode";
    }
    $("#st-work").innerHTML = it ? `<div class="st-k">Now working on</div>
      <label class="st-now" style="${cc(it.class)}"><input type="checkbox" class="st-check" data-id="${esc(it.id)}"><span class="st-title">${esc(it.title)}</span></label>
      <div class="meta"><span class="chip" style="${cc(it.class)}">${esc(it.class)}</span>${MAJOR.has(it.type) ? `<span class="tag" style="${cc(it.class)}">${esc(it.type)}</span>` : ""}${it.unconfirmed ? `<span class="tag unsure">Unconfirmed</span>` : ""}<span>due ${esc(relDay(it.due).toLowerCase())}</span></div>
      ${it.details ? `<p class="st-det">${esc(it.details)}</p>` : ""}`
      : `<div class="st-k">Now working on</div><p class="st-empty">Nothing left for tonight. Pick something from Homework to get ahead on, or call it a night.</p>`;
    const help = stHelp(it);
    $("#st-help").hidden = !help;
    $("#st-help").innerHTML = help ? `<div class="st-k">${esc(it.class)} helper</div>${help}` : "";
    const rest = q.filter((i) => i !== it);
    $("#st-queue").innerHTML = `<div class="st-k">Up next${rest.length ? ` · ${rest.length}` : ""}</div>${rest.length ? `<ul>${rest.slice(0, 6).map((i) => `<li style="${cc(i.class)}"><button type="button" data-pick="${esc(i.id)}"><span class="st-dot"></span><span class="st-qt">${esc(i.title)}</span><small>${esc(i.class)} · ${esc(relDay(i.due))}</small></button></li>`).join("")}</ul>${rest.length > 6 ? `<p class="st-more">+ ${rest.length - 6} more</p>` : ""}` : `<p class="st-empty">That's the last one.</p>`}`;
  }
  study.addEventListener("change", (e) => {
    if (!e.target.matches(".st-check")) return;
    const id = e.target.dataset.id;
    const redraw = () => { stRenderWork(); stRenderStats(); renderHomework(); };
    setDone(id, true);
    st.done++;
    st.pick = null;
    e.target.closest(".st-now").classList.add("done");
    setTimeout(redraw, 450);
    toast("Done. Next one up.", () => { setDone(id, false); st.done--; redraw(); });
  });
  study.addEventListener("click", (e) => {
    const p = e.target.closest("[data-pick]");
    if (p) { st.pick = p.dataset.pick; stRenderWork(); }
  });

  function stRenderStats() {
    const mins = Math.floor((Date.now() - st.t0) / 60e3);
    $("#st-stats").textContent = `Session ${clock(mins)} · ${st.done} done`;
    // a nudge every 50 minutes of school-clock studying (the focus timer brings its own breaks)
    if (mins >= 50 && Math.floor(mins / 50) > st.nudged && stClockState().mode !== "focus") { st.nudged = Math.floor(mins / 50); stNudge(`${mins} minutes in. Take five: stand up, water, look away from the screen.`); }
  }

  async function stWake() {
    try { if (st.open && "wakeLock" in navigator && !st.lock) { st.lock = await navigator.wakeLock.request("screen"); st.lock.addEventListener("release", () => { st.lock = null; }); } } catch {}
  }
  let stTimer;
  function stTick() {
    clearTimeout(stTimer);
    if (!st.open) return;
    stRenderClock();
    stRenderStats();
    stTimer = setTimeout(stTick, 1000 - (now().getTime() % 1000) + 15);
  }
  function openStudy() {
    if (st.open) return;
    Object.assign(st, { open: true, t0: Date.now(), done: 0, key: "", nudged: 0, pick: null });
    stSceneName = null;
    fx.on = stMotionPref();
    study.hidden = false;
    document.documentElement.classList.add("studying");
    spRender(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
    stRenderWork();
    stTick();
    requestAnimationFrame(() => { stPlaceMusic(); fxRun(); });
    setTimeout(stPlaceMusic, 400); // once the player has its height
    stWake();
    $("#st-close").focus();
  }
  function closeStudy() {
    if (!st.open) return;
    st.open = false;
    clearTimeout(stTimer);
    fxRun();
    study.hidden = true;
    document.documentElement.classList.remove("studying");
    stPlaceMusic();
    $("#st-nudge").hidden = true;
    st.lock?.release().catch(() => {});
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $("#study-btn").focus();
  }
  $("#study-btn").onclick = openStudy;
  $("#st-close").onclick = closeStudy;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.open) closeStudy(); });
  addEventListener("resize", () => { if (st.open) { stPlaceMusic(); if (fx.raf) fxSize(); } });
  stDockMQ.addEventListener("change", stPlaceMusic);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && st.open) { stWake(); stTick(); } });

  // ---------- scoreboard clock: the school day as a game. Classes are quarters, passing is a timeout, lunch is halftime ----------
  let sbcKey = "";
  function renderScoreboard() {
    const el = $("#sbc"), p = periodNow();
    if (!p.day || p.mode === "off") { el.hidden = true; sbcKey = ""; return; }
    el.hidden = false;
    let q = 0;
    const quarters = p.day.map((s) => (s.name ? ++q : 0));
    const cur = p.mode === "class" ? p.seg : null;
    const call = p.mode === "before" ? ["PRE", "Pregame"] : p.mode === "after" ? ["FINAL", `${q} quarters played`] : p.mode === "passing" ? ["T/O", "Timeout"]
      : cur.name ? [`Q${quarters[p.i]}`, cls(cur.name).name] : /lunch/i.test(cur.label) ? ["HALF", "Halftime"] : ["WARM", `Warmups · ${cur.label}`];
    const key = `${p.mode}|${p.i}`;
    if (key !== sbcKey) {
      sbcKey = key;
      const span = p.end - p.start, at = (t) => ((minutes(t) - p.start) / span) * 100;
      el.innerHTML = `<span class="sbc-q">${call[0]}</span><span class="sbc-n">${esc(call[1])}</span><span class="sbc-t" id="sbc-t"></span>
        <div class="sbc-bar" aria-hidden="true">${p.day.map((s, i) => `<i class="${s.name ? "" : "ev"}${i < p.i || p.mode === "after" ? " gone" : ""}" style="left:${at(s.start).toFixed(2)}%;width:${(at(s.end) - at(s.start)).toFixed(2)}%;${s.name ? cc(s.name) : ""}" title="${esc(s.name ? `Q${quarters[i]} · ${cls(s.name).name}` : s.label)}"></i>`).join("")}<b class="sbc-mk" id="sbc-mk"></b></div>`;
      el.setAttribute("aria-label", `${call[1]}`);
    }
    $("#sbc-t").textContent = p.left != null ? clock(p.left) : "";
    $("#sbc-mk").style.left = `${(Math.min(Math.max(p.m, p.start), p.end) - p.start) / (p.end - p.start) * 100}%`;
  }

  // ---------- the season: each day with homework due is a W if all of it got done, an L if not ----------
  // Computed from check-offs in this browser; nothing personal goes into the repo.
  const PTS = { homework: 2, reading: 2, quiz: 4, test: 6, essay: 8, project: 8 };
  function season() {
    const mp = schedule.marking_period, t = today(), items = allItems(), byDay = groupBy(items);
    const ended = mp?.ends && t > mp.ends;
    const from = ended ? addDays(mp.ends, 1) : items.reduce((m, i) => (i.due < m ? i.due : m), t);
    const days = [...byDay.keys()].filter((d) => d >= from && d < t && isSchoolDay(d) && (!mp?.ends || ended || d <= mp.ends)).sort();
    const res = days.map((d) => (byDay.get(d).every(isDone) ? "W" : "L"));
    if (byDay.get(t)?.length && byDay.get(t).every(isDone)) { days.push(t); res.push("W"); } // today counts once it's all done
    let streak = 0, best = 0, run = 0;
    for (const r of res) { run = r === "W" ? run + 1 : 0; best = Math.max(best, run); }
    for (let i = res.length - 1; i >= 0 && res[i] === res.at(-1); i--) streak++;
    return { name: ended ? "Next season" : mp?.name || "Season", days, res, w: res.filter((r) => r === "W").length, l: res.filter((r) => r === "L").length, streak: res.length ? `${res.at(-1)}${streak}` : "", best };
  }
  function renderSeason() {
    const s = season(), t = today(), by = isSchoolDay(t) && now().getHours() < 15 ? t : nextSchoolDay(t);
    const tonight = allItems().filter((i) => i.due === by);
    const proj = tonight.reduce((n, i) => n + (PTS[i.type] || 2), 0), scored = tonight.filter(isDone).reduce((n, i) => n + (PTS[i.type] || 2), 0);
    $("#season").innerHTML = `<span class="ss-rec" title="${esc(s.name)} so far: a day counts as a win when everything due that day got done"><b>${s.w}–${s.l}</b> record${s.streak ? ` · ${s.streak[0] === "W" ? "win" : "loss"} streak ${s.streak.slice(1)}` : ""}</span>
      ${tonight.length ? `<span class="ss-pts" title="Points: homework 2, quiz 4, test 6, essay or project 8"><span>${esc(relDay(by))}</span> <b>${scored}</b>/${proj} pts<span class="ss-bar"><i style="width:${proj ? Math.round((scored / proj) * 100) : 0}%"></i></span></span>` : ""}`;
  }

  function renderSeasonal() { renderSeason(); }

  // ---------- snow day odds: Open-Meteo (no key) for West Roxbury; the box shows itself only when snow is forecast ----------
  async function loadSnow() {
    let days = [];
    const force = new URLSearchParams(location.search).get("snow"); // ?snow=cm previews the meter
    if (force) days = [{ date: nextSchoolDay(today()), cm: +force || 0, low: -4 }];
    else try {
      const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=42.2793&longitude=-71.1495&daily=snowfall_sum,temperature_2m_min&timezone=America%2FNew_York&forecast_days=4");
      const d = await r.json();
      days = d.daily.time.map((date, i) => ({ date, cm: d.daily.snowfall_sum[i] || 0, low: d.daily.temperature_2m_min[i] })).filter((x) => x.date > today() && isSchoolDay(x.date));
    } catch {}
    const best = days.filter((x) => x.cm > 0).sort((a, b) => b.cm - a.cm)[0];
    $("#snow-box").hidden = !best;
    if (!best) return;
    const inch = best.cm / 2.54;
    // a rough local rule of thumb: under 2 inches rarely closes school, 6+ often does, a foot almost always
    const odds = Math.round(Math.min(95, Math.max(3, inch < 2 ? inch * 4 : inch < 6 ? 8 + (inch - 2) * 9 : 44 + (inch - 6) * 8.5)));
    const say = odds < 10 ? "Do the homework." : odds < 30 ? "Do the homework anyway." : odds < 55 ? "Coin flip. Pajamas inside out." : odds < 80 ? "Looking good. Still pack your bag." : "Start planning the sledding.";
    $("#snow").innerHTML = `<div class="snow-day">${esc(relDay(best.date))}: about ${inch < 1 ? "<1" : Math.round(inch)} in of snow</div>
      <div class="snow-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${odds}" aria-label="Snow day odds"><i style="width:${odds}%"></i><b style="left:${odds}%">❄</b></div>
      <div class="snow-odds"><b>${odds}%</b> ${say}</div><p class="vy-note">Forecast from Open-Meteo. The odds are a guess from the snowfall, not anything the school said.</p>`;
    tease("t-snow", `${esc(relDay(best.date))} · ${odds}%`);
  }

  // ---------- weather: a slim strip under the schedule (Open-Meteo, West Roxbury, °F) ----------
  // During the school day it looks ahead to after school (practice); after 3:30, to tomorrow morning.
  const WX_SVG = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    part: '<path d="M8 3.5v1.2M3.3 8.5h1.2M4.8 5.3l.9.9M11.2 5.3l-.9.9"/><path d="M5.6 11a3 3 0 0 1 5.3-2.6"/><path d="M9 20h8a3.6 3.6 0 0 0 .5-7.2 5.2 5.2 0 0 0-9.9 1.4A2.9 2.9 0 0 0 9 20z"/>',
    cloud: '<path d="M7 19h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 10.5 4.3 4.3 0 0 0 7 19z"/>',
    fog: '<path d="M4 8h16M3 12h18M4 16h16M7 20h10"/>',
    rain: '<path d="M7 15h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15z"/><path d="m9 18-1 3M13 18l-1 3M17 18l-1 3"/>',
    snow: '<path d="M7 15h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15z"/><path d="M8 18.5h.01M12 19.5h.01M16 18.5h.01M10 22h.01M14 22h.01" stroke-width="2.6"/>',
    storm: '<path d="M7 15h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15z"/><path d="m12.5 15-2 3.5h3L11.5 22"/>',
  };
  // WMO weather codes, as Open-Meteo reports them
  const wxKind = (c, day = 1) => c === 0 ? [day ? "sun" : "moon", "Clear"] : c <= 2 ? [day ? "part" : "moon", "Partly cloudy"] : c === 3 ? ["cloud", "Cloudy"]
    : c <= 48 ? ["fog", "Fog"] : c <= 57 ? ["rain", "Drizzle"] : c <= 67 ? ["rain", "Rain"] : c <= 77 ? ["snow", "Snow"] : c <= 82 ? ["rain", "Showers"]
    : c <= 86 ? ["snow", "Snow showers"] : ["storm", "Thunderstorms"];
  const isSnowCode = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
  let wx = null;
  async function loadWeather() {
    try {
      const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=42.2793&longitude=-71.1495&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,precipitation_probability,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=3");
      if (r.ok) wx = await r.json();
    } catch {}
    renderWeather();
  }
  function renderWeather() {
    const el = $("#wx");
    if (!wx?.hourly || !wx.current) { el.hidden = true; return; }
    const H = wx.hourly, D = wx.daily, n = now(), t = today();
    const at = (d, h) => H.time.indexOf(`${d}T${pad(h)}:00`);
    // the outlook for some hours of a day: temperature at the middle one, the worst chance of rain (or snow)
    const span = (d, hours) => {
      const ix = hours.map((h) => at(d, h)).filter((i) => i >= 0);
      if (!ix.length) return null;
      const p = Math.max(...ix.map((i) => H.precipitation_probability[i] ?? 0));
      return { temp: Math.round(H.temperature_2m[ix[Math.floor(ix.length / 2)]]), p, what: ix.some((i) => isSnowCode(H.weather_code[i])) ? "snow" : "rain" };
    };
    const wet = (o) => (o.p >= 40 ? `<b class="wx-wet">${o.what} ${o.p}%</b>` : o.p >= 20 ? `${o.what} ${o.p}%` : "dry");
    const day = (d) => { const i = D.time.indexOf(d); return i < 0 ? null : { hi: Math.round(D.temperature_2m_max[i]), lo: Math.round(D.temperature_2m_min[i]) }; };
    const [icon, label] = wxKind(wx.current.weather_code, wx.current.is_day);
    let text = "";
    if (n.getHours() * 60 + n.getMinutes() < 15 * 60 + 30) {
      const after = span(t, [15, 16, 17]), dd = day(t);
      if (after && dd) text = `${label} · H ${dd.hi}° L ${dd.lo}° · <b>${schedule.after_school ? "After school" : "3–6 PM"}</b> ${after.temp}°, ${wet(after)}`;
    } else {
      const tm = addDays(t, 1), morning = span(tm, [7, 8]), dd = day(tm);
      if (morning && dd) text = `${label} · <b>${esc(relDay(tm))}</b> ${morning.temp}° at 7, high ${dd.hi}°, ${wet(span(tm, [7, 8, 9, 10, 11, 12, 13, 14, 15]))}`;
    }
    el.hidden = !text;
    el.title = "Forecast from Open-Meteo; opens the National Weather Service forecast";
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WX_SVG[icon]}</svg><b class="wx-t">${Math.round(wx.current.temperature_2m)}°</b><span class="wx-s">${text}</span>`;
  }

  // ---------- game night: on a Warriors or 49ers game day, a band under the top bar with the matchup and the countdown ----------
  let gnTimer;
  function renderGameNight() {
    clearInterval(gnTimer);
    const t = today(), el = $("#gn");
    const games = (schedule.teams || []).map((tm) => {
      const d = teamData[tm.id], e = d?.events?.find((x) => iso(new Date(x.date)) === t && x.competitions[0].status.type.state !== "post");
      if (!e) return null;
      const fresh = boards[tm.league]?.events?.find((x) => x.id === e.id) || e, c = fresh.competitions[0].competitors;
      const us = c.find((x) => x.team.abbreviation === d.team.abbreviation) || c[0], them = c.find((x) => x !== us);
      return { tm, e: fresh, us, them, color: d.team.color ? `#${d.team.color}` : "", alt: d.team.alternateColor ? `#${d.team.alternateColor}` : "" };
    }).filter(Boolean);
    document.documentElement.classList.toggle("gamenight", !!games.length);
    el.hidden = !games.length;
    if (!games.length) return;
    const g = games[0];
    // the darker team color is the band, the other its stripe; dark text if even the darker one is light
    const lum = (h) => { const n = parseInt(h.slice(1), 16), f = (v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
    const [bg, stripe] = [g.color, g.alt || g.color].filter(Boolean).sort((a, b) => lum(a) - lum(b)).concat("");
    el.style.cssText = bg ? `--gn1:${bg};--gn2:${stripe || bg};color:${lum(bg) > 0.18 ? "#111" : "#fff"}` : "";
    const tick = () => {
      const st = g.e.competitions[0].status.type, live = st.state === "in";
      const left = (new Date(g.e.date) - now()) / 60e3;
      el.innerHTML = `<span class="gn-tag">${live ? "Live" : "Game night"}</span><b>${esc(g.tm.name)}</b> ${g.us.homeAway === "home" ? "vs" : "@"} ${esc(g.them.team.shortDisplayName || g.them.team.abbreviation)}
        <span class="gn-when">${live ? `${esc(st.shortDetail)} · ${esc(g.us.score?.displayValue ?? g.us.score ?? 0)}–${esc(g.them.score?.displayValue ?? g.them.score ?? 0)}` : `${g.tm.league === "nba" ? "Tip-off" : "Kickoff"} ${esc(gameTime(g.e.date))}${left > 0 ? ` · <span class="gn-cd">${clock(left)}</span>` : ""}`}</span>`;
    };
    tick();
    gnTimer = setInterval(tick, 1000);
  }

  // ---------- quick links: a row of chips for each class's Topics page (links.json, from Muse) ----------
  // Only links Muse posted are shown; a class without one is left out, never guessed. Only school-site addresses.
  let classLinks = {};
  function renderClassLinks(data) {
    const el = $("#dock-classes"), ok = (u) => typeof u === "string" && /^https:\/\/roxburylatin\.myschoolapp\.com\//.test(u);
    const order = Object.keys(schedule.classes), alias = { "Math-Sci": "MSI", FGC: "Forces", Art: "Arts" };
    const rows = (data?.class_links || []).map((c) => ({ c: alias[c.class] || c.class, topics: ok(c.topics), url: ok(c.topics) ? c.topics : ok(c.bulletin) ? c.bulletin : "" }))
      .filter((r) => r.url && schedule.classes[r.c]).sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c));
    classLinks = Object.fromEntries(rows.map((r) => [r.c, r]));
    el.hidden = !rows.length;
    // a class with no Topics tab (Latin, Forces, Health) opens its bulletin board instead
    el.innerHTML = rows.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener" style="${cc(r.c)}" title="${esc(cls(r.c).name || r.c)}: ${r.topics ? "Topics" : "bulletin board"}">${esc(cls(r.c).short || r.c)}</a>`).join("");
  }

  // ---------- lunch: SAGE Dining's menu (menu.json, fetched on every deploy by tools/fetch_menu.py) ----------
  // Shows today's lunch until lunch is over, then the next school day's; the arrows step through the posted days.
  let menu = null, lunchPick = null;
  const lunchDays = () => Object.keys(menu?.days || {}).filter(isSchoolDay).sort();
  function lunchDefault(days) {
    const t = today(), bell = schedule.bells.find((b) => b.lunch), n = now();
    const over = bell && n.getHours() * 60 + n.getMinutes() >= minutes(bell.end);
    const from = isSchoolDay(t) && !over ? t : nextSchoolDay(t);
    return days.find((d) => d >= from) || days.at(-1);
  }
  // The card leads with the main dishes, one per line; soup and specials get a short line each; the deli, salads,
  // sides and dessert fold under one line that opens on tap.
  const LUNCH_MAIN = ["Featured", "Entrées"], LUNCH_LINE = ["Specials", "Soup"], LUNCH_MAIN_SHOW = 4;
  const DIET = { V: "Vegetarian", VG: "Vegan", GF: "Gluten-free" };
  const lunchDish = (it) => `<span class="dish"${it.allergens?.length ? ` title="Contains ${esc(it.allergens.join(", "))}"` : ""}>${esc(it.name)}${(it.diet || []).map((d) => `<i class="diet" title="${DIET[d] || d}">${d}</i>`).join("")}</span>`;
  let lunchOpen = false;
  function renderLunch() {
    const days = lunchDays(), el = $("#lunch");
    if (!days.length) {
      $("#lunch-day").textContent = "";
      el.innerHTML = `<p class="empty-state">SAGE hasn't posted the next menus yet.</p>`;
      return;
    }
    const day = days.includes(lunchPick) ? lunchPick : lunchDefault(days), i = days.indexOf(day);
    $("#lunch-day").textContent = `${relDay(day)}${daysBetween(today(), day) > 1 ? ` ${fmt(day, { month: "short", day: "numeric" })}` : ""}`;
    document.querySelector('[data-lunch="-1"]').disabled = i <= 0;
    document.querySelector('[data-lunch="1"]').disabled = i >= days.length - 1;
    const stations = menu.days[day].stations, by = (names) => stations.filter((st) => names.includes(st.name));
    const mains = by(LUNCH_MAIN).flatMap((st) => st.items), lines = by(LUNCH_LINE), rest = stations.filter((st) => ![...LUNCH_MAIN, ...LUNCH_LINE].includes(st.name));
    const extra = mains.length - LUNCH_MAIN_SHOW > 1 ? mains.length - LUNCH_MAIN_SHOW : 0;
    const row = (st) => `<div class="lunch-line"><span class="lunch-k">${esc(st.name)}</span><span class="lunch-v">${st.items.map(lunchDish).join("")}</span></div>`;
    const restName = rest.map((st) => st.name.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " & $1");
    el.innerHTML = `${mains.length ? `<ul class="lunch-mains">${mains.slice(0, extra ? LUNCH_MAIN_SHOW : mains.length).map((it) => `<li>${lunchDish(it)}</li>`).join("")}</ul>
        ${extra ? `<button class="lunch-more" type="button" data-more="mains">+${extra} more</button>` : ""}` : ""}
      ${lines.map(row).join("")}
      ${rest.length ? `<details class="lunch-rest"${lunchOpen ? " open" : ""}><summary>${esc(restName[0].toUpperCase() + restName.slice(1))}</summary>${rest.map(row).join("")}</details>` : ""}`;
  }
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-lunch]");
    if (nav) {
      const days = lunchDays(), cur = days.includes(lunchPick) ? lunchPick : lunchDefault(days);
      lunchPick = days[Math.min(days.length - 1, Math.max(0, days.indexOf(cur) + +nav.dataset.lunch))];
      renderLunch();
    }
    const more = e.target.closest('[data-more="mains"]');
    if (more) {
      const days = lunchDays(), day = days.includes(lunchPick) ? lunchPick : lunchDefault(days);
      const mains = menu.days[day].stations.filter((st) => LUNCH_MAIN.includes(st.name)).flatMap((st) => st.items);
      $(".lunch-mains").innerHTML = mains.map((it) => `<li>${lunchDish(it)}</li>`).join("");
      more.remove();
    }
  });
  // the folded stations stay open (or shut) as the day changes and the card redraws
  $("#lunch").addEventListener("toggle", (e) => { if (e.target.matches(".lunch-rest")) lunchOpen = e.target.open; }, true);

  // ---------- the morning briefing: an AI summary of today's headlines, written by tools/summarize_news.py ----------
  let brief = null;
  function renderBrief() {
    const el = $("#brief"), peek = $("#brief-peek");
    if (!brief?.stories?.length) {
      // not set up yet (the README has the steps): leave the room to the headlines
      el.innerHTML = "";
      el.hidden = true;
      peek.hidden = true;
      return;
    }
    el.hidden = false;
    const isToday = brief.date === today(), at = new Date(brief.generated_at);
    const label = isToday ? "Today's briefing" : `Briefing from ${fmt(brief.date, { weekday: "long" })}`;
    const when = isNaN(at) ? "" : at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const link = (x) => /^https?:\/\//.test(x.link || "") ? `<a href="${esc(x.link)}" target="_blank" rel="noopener" title="${esc(x.title || "")}">${esc(x.source || "Source")}</a>` : "";
    el.innerHTML = `<div class="brief-h"><span class="brief-k">${esc(label)}</span>${when ? `<span class="brief-when">written ${esc(when)}</span>` : ""}</div>
      <p class="brief-day">${esc(brief.day)}</p>
      <ol class="brief-list">${brief.stories.map((s) => `<li><b class="brief-hl">${esc(s.headline)}</b><p>${esc(s.summary)}</p><p class="brief-why"><span>Why it matters</span>${esc(s.why)}</p>
        <div class="brief-src">${(s.sources || []).map(link).join("")}</div></li>`).join("")}</ol>
      <p class="brief-note">AI summary of today's headlines, may contain mistakes. The sources open the original stories.</p>`;
    peek.hidden = false;
    peek.innerHTML = `<span class="brief-k">${esc(label)}</span><span class="brief-peek-day">${esc(brief.day)}</span><span class="brief-go">Read the briefing →</span>`;
  }
  $("#brief-peek").onclick = () => {
    showPane("news");
    showTab("more");
    $('.pane[data-pane="news"]').scrollTop = 0;
    $(".p-more").scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
  };

  // ---------- command bar: press / to add homework by typing, or to jump somewhere ----------
  const cmdDlg = $("#cmd");
  const CLASS_WORDS = { latin: "Latin", lat: "Latin", english: "English", eng: "English", odyssey: "English", msi: "MSI", math: "MSI", mathsci: "MSI", "math-sci": "MSI", sci: "MSI",
    french: "French", fr: "French", francais: "French", forces: "Forces", fgc: "Forces", history: "Forces", hist: "Forces", art: "Arts", arts: "Arts", glee: "Glee", choir: "Glee", health: "Health" };
  const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  function cmdDate(words) {
    const t = today(), w = words.map((x) => x.toLowerCase());
    for (let i = 0; i < w.length; i++) {
      const x = w[i].replace(/[.,]$/, ""), next = w[i - 1] === "next";
      if (x === "today" || x === "tonight") return [t, i];
      if (x === "tomorrow" || x === "tmrw" || x === "tmr") return [addDays(t, 1), i];
      const di = DOW.findIndex((d) => x.startsWith(d) && x.length <= 9);
      // "next fri" on a Tuesday is the Friday after this one; "next mon" on a Thursday is just the coming Monday
      if (di >= 0) { let d = addDays(t, 1); while (parse(d).getDay() !== di) d = addDays(d, 1); return [next && di > parse(t).getDay() ? addDays(d, 7) : d, i]; }
      const md = /^(\d{1,2})\/(\d{1,2})$/.exec(x);
      if (md) { const y = now().getFullYear(), d = iso(new Date(y, +md[1] - 1, +md[2])); return [d < t ? iso(new Date(y + 1, +md[1] - 1, +md[2])) : d, i]; }
      const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].findIndex((m) => x.startsWith(m));
      if (mon >= 0 && /^\d{1,2}$/.test(w[i + 1] || "")) { const y = now().getFullYear(), d = iso(new Date(y, mon, +w[i + 1])); return [d < t ? iso(new Date(y + 1, mon, +w[i + 1])) : d, i, 2]; }
    }
    return [null, -1];
  }
  function cmdParse(text) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const ci = words.findIndex((x) => CLASS_WORDS[x.toLowerCase().replace(/[.,:]$/, "")]);
    if (ci < 0 || words.length < 2) return null;
    const klass = CLASS_WORDS[words[ci].toLowerCase().replace(/[.,:]$/, "")];
    const rest = words.filter((_, i) => i !== ci);
    let [due, di, len = 1] = cmdDate(rest);
    // drop the date words, with a "next" or "due" in front of them
    let from = di;
    if (from > 0 && rest[from - 1].toLowerCase() === "next") from--;
    if (from > 0 && rest[from - 1].toLowerCase() === "due") from--;
    const body = di < 0 ? rest.filter((x, i) => !(i === rest.length - 1 && x.toLowerCase() === "due")) : [...rest.slice(0, from), ...rest.slice(di + len)];
    if (!body.length) return null;
    if (!due) due = nextMeeting(klass)?.date || nextSchoolDay(today());
    const type = ["test", "quiz", "essay", "project"].find((k) => body.some((x) => x.toLowerCase().startsWith(k))) || "homework";
    let title = body.join(" ").replace(/\bp(\d+)/gi, "p. $1").replace(/\bex\.?\s*([a-z])\b/gi, (_, l) => `Ex. ${l.toUpperCase()}`).replace(/\s+due$/i, "");
    if (!/^p\. /.test(title)) title = title[0].toUpperCase() + title.slice(1);
    return { class: klass, title, due, type, details: "" };
  }
  const go = (tab, pane) => () => { if (pane) showPane(pane); showTab(tab); return pane ? $(".p-more") : { today: $(".p-sched"), homework: $(".p-hw"), music: $(".p-music") }[tab]; };
  const JUMPS = [
    ["Study mode", "study focus", () => openStudy()], ["Homework", "homework calendar hw", go("homework")], ["Today's schedule", "schedule today bell", go("today")],
    ["Music", "music spotify lofi", go("music")], ["Rotation", "rotation week letters", go("more", "week")],
    ["Sports: Warriors, 49ers, scores", "sports warriors 49ers teams scores nba nfl", go("more", "sports")], ["News", "news", go("more", "news")], ["Lunch menu", "lunch menu food sage", () => { showTab("today"); return $(".p-lunch"); }], ["Today's briefing", "briefing summary ai news today", () => { $("#brief-peek").click(); }],
    ["Tests", "tests quizzes essays projects", go("more", "tests")], ["Quotes", "quotes practice memorize speech debate", go("more", "quotes")], ["Practice quotes", "quote drill review", () => qStart()], ["Fantasy", "fantasy lineup", go("more", "fantasy")], ["Countdowns", "countdowns", go("more", "count")], ["Light / dark", "dark light mode", () => $("#theme-btn").click()],
    ...Object.entries(SKINS).map(([k, v]) => [`Theme: ${v}`, `theme ${k} ${v.toLowerCase()}`, () => { setSkin(k); document.querySelectorAll(".skin-select").forEach((o) => { o.value = k; }); }]),
  ];
  let cmdSel = 0, cmdItems = [];
  function cmdRender() {
    const v = $("#cmd-in").value.trim(), add = cmdParse(v), lw = v.toLowerCase();
    cmdItems = [];
    if (add) cmdItems.push({ html: `<b>Add</b> ${esc(add.class)} · ${esc(add.title)} <small>${add.title.toLowerCase().includes(add.type) ? "" : `${esc(add.type)} · `}due ${esc(fmt(add.due, { weekday: "long", month: "short", day: "numeric" }))}</small>`, run: () => {
      state.manual.push({ uid: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), added: new Date().toISOString(), ...add });
      save(); renderHomework(); toast(`Added: ${add.title}`);
    } });
    if (lw) JUMPS.filter(([label, keys]) => keys.split(" ").some((k) => k.startsWith(lw.split(" ")[0])) || label.toLowerCase().includes(lw)).slice(0, 6)
      .forEach(([label, , jump]) => cmdItems.push({ html: `<b>Go</b> ${esc(label)}`, run: () => { const el = jump(); if (el instanceof Element) el.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" }); } }));
    cmdSel = Math.min(cmdSel, Math.max(0, cmdItems.length - 1));
    $("#cmd-list").innerHTML = cmdItems.map((c, i) => `<li role="option" aria-selected="${i === cmdSel}" data-i="${i}">${c.html}</li>`).join("") || (v ? `<li class="cmd-none">Start with a class (latin, eng, msi, fr, fgc, art…) to add homework, or a section name to jump.</li>` : "");
  }
  function cmdRun(i) { const c = cmdItems[i]; if (!c) return; cmdDlg.close(); c.run(); }
  function openCmd() { $("#cmd-in").value = ""; cmdSel = 0; cmdRender(); cmdDlg.showModal(); $("#cmd-in").focus(); }
  $("#cmd-in").addEventListener("input", () => { cmdSel = 0; cmdRender(); });
  $("#cmd-in").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); cmdSel = (cmdSel + (e.key === "ArrowDown" ? 1 : -1) + cmdItems.length) % Math.max(1, cmdItems.length); cmdRender(); }
  });
  $("#cmd-form").addEventListener("submit", (e) => { e.preventDefault(); cmdRun(cmdSel); });
  $("#cmd-list").addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (li) cmdRun(+li.dataset.i); });
  cmdDlg.addEventListener("click", (e) => { if (e.target === cmdDlg) cmdDlg.close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || st.open || document.querySelector("dialog[open]")) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    openCmd();
  });

  // ---------- sync: one shared copy for every device that opens the site (the planner is Brian's alone) ----------
  // A JSON blob on jsonblob.com holds the synced part of the state, no sign-in. Each visit merges it in; each change
  // merges and writes it back a moment later; while the page is open it picks up the other device's changes every
  // 20 seconds. localStorage stays the real store, so offline (or if the blob were ever gone) nothing is lost.
  // Only the live site syncs, so a local preview's test check-offs never reach it.
  const SYNC_URL = ""; // https://jsonblob.com/api/jsonBlob/<id>
  const syncURL = (() => {
    const q = new URLSearchParams(location.search).get("syncurl"); // a local stand-in, for testing the preview
    if (q && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return q;
    return location.hostname === "shxbainu.github.io" ? SYNC_URL : "";
  })();
  // a stable string for comparing two copies (key order doesn't matter)
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
  // take a merged copy: save it here, redraw, and apply settings picked on the other device
  function syncApply(next) {
    const before = state.prefs || {};
    state = { ...state, ...next };
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
    const changed = (k) => state.prefs?.[k] && state.prefs[k].t !== before[k]?.t;
    if (changed("skin") && SKINS[state.prefs.skin.v]) {
      setSkin(state.prefs.skin.v, false);
      try { localStorage.setItem(SKIN, state.prefs.skin.v); } catch {}
      document.querySelectorAll(".skin-select").forEach((o) => { o.value = state.prefs.skin.v; });
    }
    if (changed("theme")) { root.dataset.theme = state.prefs.theme.v; try { localStorage.setItem(THEME, state.prefs.theme.v); } catch {} paintThemeBtn(); spRender(); }
    if (changed("focus") && ST_PRESETS[state.prefs.focus.v]) {
      try { localStorage.setItem("rlp-focus", state.prefs.focus.v); } catch {}
      if (!st.focus.endsAt) Object.assign(st.focus, { preset: state.prefs.focus.v, phase: "focus", left: ST_PRESETS[state.prefs.focus.v][0] * 60e3, round: 1 });
    }
    if (changed("spClient") && !spConnected()) { spA = { ...spA, client: state.prefs.spClient.v }; spSaveAuth(); }
    if (schedule) render();
  }
  let syncTimer, syncBusy = false, syncAgain = false, lastCloud = null;
  async function syncNow() {
    clearTimeout(syncTimer);
    if (!syncURL) return;
    if (syncBusy) { syncAgain = true; return; }
    syncBusy = true;
    try {
      const r = await fetch(syncURL, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`sync read ${r.status}`);
      const got = await r.json(), remote = got && typeof got.done === "object" && Array.isArray(got.manual) ? got : null;
      const local = syncedPart(state), merged = remote ? mergeState(local, remote) : local;
      if (canon(merged) !== canon(local)) syncApply(merged);
      if (!remote || canon(merged) !== canon(remote)) {
        const w = await fetch(syncURL, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(merged) });
        if (!w.ok) throw new Error(`sync write ${w.status}`);
      }
      lastCloud = merged;
    } catch (e) { console.warn("sync: will try again", e.message); } // offline or the service is down
    syncBusy = false;
    if (syncAgain) { syncAgain = false; syncNow(); }
  }
  if (syncURL) {
    onSave = () => { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1200); };
    syncNow();
    setInterval(() => { if (!document.hidden) syncNow(); }, 20_000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
    addEventListener("online", syncNow);
    // closing the tab right after a change: send it on the way out (merged with the last copy seen)
    addEventListener("pagehide", () => {
      if (!syncTimer || !lastCloud) return;
      try { fetch(syncURL, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(mergeState(syncedPart(state), lastCloud)) }); } catch {}
    });
  }

  // Laptops (Ink & Paper): Homework on the left, the day on the right (schedule, weather, next up, quote, links, music),
  // and everything else as open cards packed in columns underneath: lunch, the Week/Tests/Quotes box, sports,
  // fantasy, news and countdowns. Nothing hides behind a tab nobody opens, and the two columns end near each other.
  // Phones and skins keep the original arrangement; each moved element goes back to the exact spot it came from.
  const FEED = ["sports", "fantasy", "news", "count"];
  const feedOn = () => !root.dataset.skin && matchMedia("(min-width:900px)").matches;
  function moveTo(el, parent) {
    if (!el || el.parentNode === parent) return;
    if (!el._home) { el._home = document.createComment("home"); el.before(el._home); }
    parent.append(el);
  }
  const moveHome = (el) => { if (el?._home && el.previousSibling !== el._home) el._home.after(el); };
  function placeFeed() {
    const on = feedOn(), feed = $("#feed");
    if (!feed) return;
    const panes = FEED.map((name) => $(`.pane[data-pane="${name}"]`)).filter(Boolean);
    panes.forEach((pane) => {
      const name = pane.dataset.pane;
      if (!pane.querySelector(":scope > .feed-h")) pane.insertAdjacentHTML("afterbegin", `<h2 class="feed-h">${esc($(`[data-tab-pane="${name}"]`)?.textContent || name)}</h2>`);
    });
    // Music rides with the cards below so the two columns above end together
    const cards = [$(".p-lunch"), $(".p-more"), $(".p-music"), ...panes];
    if (on) {
      cards.forEach((el) => moveTo(el, feed));
      panes.forEach(wake);
      if (FEED.includes(state.pane)) showPane("week");
    } else {
      [...cards].reverse().forEach(moveHome);
    }
  }
  matchMedia("(min-width:900px)").addEventListener("change", placeFeed);

  // ---------- motion: spring physics from Motion (motion.dev), loaded as a module in index.html ----------
  // Only on the Ink & Paper look (skins have their own effects), never with reduced motion, and not in a hidden tab
  // (it pauses animations, which would leave things mid-fade). Without Motion
  // (offline, blocked CDN) every change below still happens, just instantly.
  const mo = () => (window.Motion && !root.dataset.skin && !document.hidden && !matchMedia("(prefers-reduced-motion:reduce)").matches ? window.Motion : null);
  const spring = (visualDuration, bounce) => ({ type: "spring", visualDuration, bounce });
  // run fn when the animation ends, or after ms at the latest: a hidden tab pauses animations, and the change itself must never wait on one
  function settle(anim, fn, ms = 450) {
    let done = false;
    const go = () => { if (!done) { done = true; fn(); } };
    Promise.resolve(anim?.finished || anim).then(go, go);
    setTimeout(go, ms);
  }

  // a highlighter that slides between tabs and toggles (.tabs, .seg) instead of jumping
  function inkTo(box, glide) {
    const el = box.querySelector(':scope > [aria-selected="true"], :scope > [aria-pressed="true"]');
    let ink = box.querySelector(":scope > .ink");
    const m = window.Motion && !root.dataset.skin ? window.Motion : null;
    if (!el || !m) { ink?.remove(); box.classList.remove("has-ink"); return; }
    if (!el.offsetWidth) return; // hidden for now; the resize watcher places it once it shows
    const to = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
    if (!ink) {
      ink = document.createElement("span");
      ink.className = "ink";
      ink.setAttribute("aria-hidden", "true");
      box.prepend(ink);
      glide = false;
    }
    box.classList.add("has-ink");
    const at = ink.dataset.at, key = `${to.left},${to.top},${to.width},${to.height}`;
    if (at === key) return;
    ink.dataset.at = key;
    m.animate(ink, to, glide && mo() ? spring(0.3, 0.2) : { duration: 0 });
  }
  const inkAll = (glide) => document.querySelectorAll(".tabs, .seg").forEach((b) => inkTo(b, glide));
  function inkWatch(redo) {
    document.querySelectorAll(".tabs, .seg").forEach((box) => {
      if (box.dataset.ink) { if (redo) inkTo(box, false); return; }
      box.dataset.ink = "1";
      new MutationObserver(() => inkTo(box, true)).observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected", "aria-pressed"] });
      new ResizeObserver(() => inkTo(box, false)).observe(box);
      inkTo(box, false);
    });
  }

  // the picked calendar day's ring glides from the last day to the new one
  let ringAt = "";
  function ringHide() {
    const r = $(".cal-wrap > .cal-ring"), m = mo();
    if (r && m) m.animate(r, { opacity: 0 }, { duration: 0.1 });
    ringAt = "";
  }
  function ring(cell, glide) {
    const wrap = $(".cal-wrap"), cal = $("#cal"), m = mo();
    let r = wrap?.querySelector(":scope > .cal-ring");
    if (!wrap || !cell || !m) { r?.remove(); cal.classList.remove("has-ring"); ringAt = ""; return; }
    const to = { left: cell.offsetLeft + cal.clientLeft, top: cell.offsetTop + cal.clientTop, width: cell.offsetWidth, height: cell.offsetHeight };
    if (!to.width) return;
    const key = `${to.left},${to.top},${to.width},${to.height}`;
    cal.classList.add("has-ring");
    if (r && key === ringAt) return;
    if (!r) {
      r = document.createElement("span");
      r.className = "cal-ring";
      r.setAttribute("aria-hidden", "true");
      wrap.append(r);
      glide = false;
    }
    if (glide && ringAt) m.animate(r, { ...to, opacity: 1 }, spring(0.34, 0.2));
    else { m.animate(r, to, { duration: 0 }); m.animate(r, { opacity: [0, 1] }, { duration: 0.18, delay: 0.1 }); }
    ringAt = key;
  }

  new ResizeObserver(() => { ringAt = ""; ring($("#cal .cell.sel")); }).observe($("#cal")); // a new width moves the cells

  // switch what a panel shows: the old content slips out, the new springs in from the side you moved toward
  function swapIn(els, dir, update, dist = 14) {
    const m = mo();
    if (!m || !dir) { update(); return; }
    settle(m.animate(els, { opacity: 0, x: -dist * dir }, { duration: 0.12, ease: "easeIn" }), () => {
      update();
      m.animate(els, { opacity: [0, 1], x: [dist * 1.3 * dir, 0] }, spring(0.38, 0.12));
    });
  }

  // checking off: the box squishes, the tick draws (CSS), the title is struck, the row slides away, the rest close up
  function checkOff(li, box) {
    const m = mo();
    m.animate(box, { scale: [0.8, 1] }, spring(0.25, 0.5));
    setTimeout(() => settle(m.animate(li, { x: 26, opacity: 0 }, spring(0.3, 0)), () => flip(renderHomework)), 300);
  }
  function flip(update) {
    const m = mo(), key = (el) => `${el.closest("ul")?.id}:${el.dataset.id}`, before = new Map();
    document.querySelectorAll(".p-hw .item[data-id]").forEach((el) => before.set(key(el), el.getBoundingClientRect().top));
    update();
    if (!m) return;
    document.querySelectorAll(".p-hw .item[data-id]").forEach((el) => {
      const top = before.get(key(el));
      if (top == null) m.animate(el, { opacity: [0, 1], y: [-6, 0] }, spring(0.35, 0.1));
      else if (Math.abs(top - el.getBoundingClientRect().top) > 1) m.animate(el, { y: [top - el.getBoundingClientRect().top, 0] }, spring(0.35, 0.1));
    });
  }

  // schedule rows rise in one after another when the day or letter changes (not on the clock's own updates)
  let schedKey = "";
  function rowsIn() {
    const m = mo(), li = [...document.querySelectorAll("#timeline li")].slice(0, 12);
    if (m && li.length) m.animate(li, { opacity: [0, 1], y: [8, 0] }, { ...spring(0.4, 0.15), delay: m.stagger(0.035, { startDelay: 0.05 }) });
  }
  document.addEventListener("motion-ready", () => {
    if (!schedule) return;
    inkWatch(true);
    ring($("#cal .cell.sel"));
    rowsIn();
  });
  document.fonts?.ready.then(() => inkAll(false));

  // ---------- boot ----------
  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  Promise.all([getJSON("schedule.json"), getJSON("homework.json").catch(() => null), getJSON("fantasy.json").catch(() => null), getJSON("news.json").catch(() => null), getJSON("news_summary.json").catch(() => null), getJSON("menu.json").catch(() => null), getJSON("links.json").catch(() => null), getJSON("quotes.json").catch(() => null)])
    .then(([s, h, f, n, b, mn, ln, qd]) => {
      quoteDeck = Array.isArray(qd?.quotes) ? qd.quotes.filter((q) => q?.id && q.text) : [];
      news = n;
      brief = b;
      menu = mn;
      schedule = s;
      homework = h;
      fantasy = f;
      document.title = s.owner ? `${s.owner}'s RL Planner` : "RL Planner";
      render();
      renderBrief();
      renderLunch();
      renderClassLinks(ln);
      loadTeams();
      loadBoards();
      loadSportsNews();
      setInterval(loadSportsNews, 15 * 60_000);
      loadSnow();
      setInterval(loadSnow, 3 * 3600_000);
      loadWeather();
      setInterval(loadWeather, 30 * 60_000);
      spCallback().then(() => { spRender(matchMedia("(min-width:760px)").matches); spPoll(); }); // on laptops the card is always in view
      setInterval(() => { renderBar(); renderSchedule(); renderWeather(); if (!lunchPick) renderLunch(); }, 15_000);
      // tick just after each second turns over; a plain 1s interval drifts and skips a second now and then
      const tickLoop = () => { tickNow(); setTimeout(tickLoop, 1000 - (now().getTime() % 1000) + 15); };
      tickLoop();
      document.addEventListener("visibilitychange", () => { if (!document.hidden) tickNow(); });
    })
    .catch((err) => {
      $(".dash").innerHTML = `<p class="empty-state">Couldn't load the schedule (${esc(err.message)}). If you opened the file directly, serve the folder instead: <code>python3 -m http.server</code>.</p>`;
    });
})();
