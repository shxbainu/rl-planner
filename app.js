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

  // ---------- storage ----------
  function load() {
    const empty = { done: {}, manual: [], letters: {}, countdowns: [] };
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || "null");
      return s ? { ...empty, ...s } : empty;
    } catch { return empty; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
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
    const nm = !done && nextMeeting(it.class);
    const next = nm ? `<span class="next" title="${nm.unsure ? "Based on a guessed day letter" : ""}">next class ${esc(/^(Today|Tomorrow)$/.test(relDay(nm.date)) ? relDay(nm.date).toLowerCase() : relDay(nm.date))} ${esc(nm.time)}${nm.unsure ? "?" : ""}</span>` : "";
    return `<li class="item${done ? " done" : ""}${major && !done ? " major" : ""}${overdue ? " overdue" : ""}" style="${cc(it.class)}" data-id="${esc(it.id)}">
      <input type="checkbox" class="check" ${done ? "checked" : ""} aria-label="Done: ${esc(it.title)}">
      <div class="body">
        <span class="title">${esc(it.title)}</span>
        <span class="meta">${meta}${next}</span>
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
    el.innerHTML = `<span class="pill" title="Homework last updated ${esc(when)}"><span class="dot"></span>${stale ? `Homework is ${ago} old, check Blackbaud` : `Homework updated ${esc(when)} · ${ago}`}</span>`;
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
    const day_ = segs.slice(firstI, lastI + 1);
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

  // once a second: update the number and bar in place; redraw the card when the block changes
  function tickNow() {
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
    $("#sched-meta").textContent = letter ? `${letter} day · ${special(day) ? "special schedule" : `${classes} classes`}` : "";
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
      ? "? = day letter is a guess. Tap the letter in the top bar to fix today's." + sps.map((c) => ` * ${c.top}: ${c.sp}.`).join("")
      : "? = B, E and G times aren't confirmed yet.";
  }

  function groupBy(items) {
    const g = new Map();
    for (const it of items) { if (!g.has(it.due)) g.set(it.due, []); g.get(it.due).push(it); }
    return g;
  }

  // Two school weeks (Mon–Fri) of chips by due date; the picked day's full checklist sits underneath.
  let calWeek = 0, selDay = null, showOverdue = false;
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
      return `<button type="button" class="cell${d === t ? " today" : ""}${d === selDay && !showOverdue ? " sel" : ""}${d < t ? " past" : ""}" data-day="${d}" aria-label="${esc(fmt(d, { weekday: "long", month: "long", day: "numeric" }))}, ${list.length} due">
        <div class="top"><b>${num}</b><span class="lt">${letter || ""}</span></div>${chips}${more}</button>`;
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
    $("#hw-notes").innerHTML = (homework?.notes || []).map((n) => `<p class="hw-note">${esc(n)}</p>`).join("");

    const done = items.filter(isDone).sort((a, b) => b.due.localeCompare(a.due));
    $("#done-count").textContent = done.length;
    const doneToday = Object.values(state.done).filter((v) => typeof v === "string" && iso(new Date(v)) === today()).length;
    $("#done-count").dataset.stage = Math.min(4, doneToday);
    $("#done").innerHTML = done.length ? done.map((i) => itemHTML(i, { showDue: true })).join("") : `<li class="empty-state">Checked-off assignments land here.</li>`;
  }
  $("#cal").addEventListener("click", (e) => {
    const c = e.target.closest("[data-day]");
    if (c) { selDay = c.dataset.day; showOverdue = false; renderHomework(); }
  });
  $("#overdue-bar").addEventListener("click", (e) => {
    if (e.target.closest("[data-overdue]")) { showOverdue = !showOverdue; renderHomework(); }
  });
  document.querySelector(".cal-nav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cal]");
    if (!b) return;
    const n = Number(b.dataset.cal);
    calWeek = n === 0 ? 0 : calWeek + n * 2;
    if (n === 0) selDay = schoolDay();
    renderHomework();
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
    (state.countdowns ||= []).push({ id: "c" + Date.now().toString(36), title, date });
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
    save();
    renderCounts();
    toast("Removed", () => { state.countdowns.splice(i, 0, gone); save(); renderCounts(); });
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
    const m = f.matchup;
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

  // ---------- opening a box scrolls just enough to show all of it (or its top, if it's taller than the space) ----------
  document.querySelectorAll("details.extra").forEach((d) => d.addEventListener("toggle", () => {
    if (!d.open) return;
    wake(d);
    {
      let sc = d.parentElement;
      while (sc && sc !== document.body && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
      const page = !sc || sc === document.body;
      const box = page ? { top: $(".bar").getBoundingClientRect().bottom, bottom: innerHeight } : sc.getBoundingClientRect();
      const r = d.getBoundingClientRect();
      let dy = Math.max(0, r.bottom - (box.bottom - 8));
      if (r.top - dy < box.top + 8) dy = r.top - (box.top + 8);
      if (Math.abs(dy) > 1) (page ? window : sc).scrollBy({ top: dy, behavior: reduced() ? "auto" : "smooth" });
    }
  }));

  // ---------- music: Spotify's embed player (no login; full songs when you're signed in to Spotify in this browser) ----------
  // The player's inside is Spotify's own, either dark or tinted from the cover; each skin dresses the card around it
  // and picks which with --sp-embed (dark | art). The iframe loads the first time the box opens.
  const SP = "rlp-spotify";
  const SP_DEFAULT = { type: "playlist", id: "37i9dQZF1DWWQRwui0ExPn", title: "lofi beats", art: "" };
  const spParse = (s) => {
    const m = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?|spotify:)(playlist|album|track|episode|show|artist)[/:]([A-Za-z0-9]{22})/.exec(s || "");
    return m && { type: m[1], id: m[2] };
  };
  let sp = (() => {
    try { const v = JSON.parse(localStorage.getItem(SP)); if (v && spParse(`spotify:${v.type}:${v.id}`)) return { ...SP_DEFAULT, ...v }; } catch {}
    return { ...SP_DEFAULT };
  })();
  const spSave = () => { try { localStorage.setItem(SP, JSON.stringify(sp)); } catch {} };
  function spRender(load) {
    const f = $("#sp-frame");
    if (!f) return;
    const de = document.documentElement, v = getComputedStyle(de).getPropertyValue("--sp-embed").trim();
    const src = `https://open.spotify.com/embed/${sp.type}/${sp.id}?utm_source=generator${(v ? v === "dark" : de.dataset.mode === "dark") ? "&theme=0" : ""}`;
    $("#sp-title").textContent = sp.title || "Spotify";
    $("#t-music").textContent = sp.title || "";
    $("#sp-art").src = sp.art || "";
    $("#sp").classList.toggle("tall", !!sp.tall);
    $("#sp-size").setAttribute("aria-pressed", String(!!sp.tall));
    $("#sp-size").textContent = sp.tall ? "Shorter" : "Taller";
    $("#sp-reset").hidden = sp.id === SP_DEFAULT.id;
    if ((load || f.src) && f.src !== src) f.src = src;
  }
  // title and cover from Spotify's oEmbed, which allows requests from other sites
  async function spMeta() {
    try {
      const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${sp.type}/${sp.id}`)}`);
      if (!r.ok) return;
      const d = await r.json();
      sp = { ...sp, title: d.title || sp.title, art: d.thumbnail_url || "" };
      spSave();
      spRender();
    } catch {}
  }
  $(".p-music").addEventListener("toggle", (e) => { if (e.target.open) spRender(true); });
  $("#sp-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const got = spParse($("#sp-url").value.trim());
    $("#sp-err").hidden = !!got;
    if (!got) return;
    sp = { ...got, title: "", art: "", tall: sp.tall };
    $("#sp-url").value = "";
    spSave();
    spRender(true);
    spMeta();
  });
  $("#sp-reset").onclick = () => { sp = { ...SP_DEFAULT, tall: sp.tall }; spSave(); spRender(true); spMeta(); };
  $("#sp-size").onclick = () => { sp.tall = !sp.tall; spSave(); spRender(); };
  spRender();
  if (!sp.art) spMeta();

  // ---------- expanded view: a side box opens big; its contents move into the dialog and back ----------
  const xdlg = $("#xdlg");
  let xHome = null;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-expand]");
    if (!b) return;
    xHome = b.closest("details.extra");
    $("#x-dlg-h").textContent = xHome.querySelector(".x-name").textContent;
    xdlg.dataset.x = xHome.dataset.x;
    $("#x-dlg-body").append(xHome.querySelector(".x-body"));
    xdlg.showModal();
    wake($("#x-dlg-body"));
    $("#x-dlg-body").scrollTop = 0;
  });
  xdlg.addEventListener("close", () => { if (xHome) xHome.append($("#x-dlg-body .x-body")); xHome = null; });
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
    document.querySelectorAll(".p-scores .seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.league === sbLeague)));
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
  document.querySelector(".p-scores .seg").addEventListener("click", (e) => {
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
  const wake = (el) => { if (el.closest("details[open], dialog[open]")) el.querySelectorAll('img[loading="lazy"]').forEach((im) => { im.loading = "eager"; }); };
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

  // ---------- tests & quizzes (from homework) ----------
  function renderBig() {
    const t = today(), until = addDays(t, 28);
    const list = allItems().filter((i) => MAJOR.has(i.type) && i.due >= t && i.due <= until);
    $("#big-meta").textContent = list.length ? "next 4 weeks" : "";
    $("#big").innerHTML = list.length ? list.map((i) => {
      const n = daysBetween(t, i.due), done = isDone(i);
      return `<li class="${done ? "done" : ""}${n === 0 ? " today" : ""}" style="${cc(i.class)}"><span class="d">${n === 0 ? "Today" : n}${n ? `<small>day${n === 1 ? "" : "s"}</small>` : ""}</span>
        <span class="w"><b>${esc(i.title)}</b><small>${esc(cls(i.class).short || i.class)} · ${esc(i.type)} · ${esc(fmt(i.due))}</small></span></li>`;
    }).join("") : `<li class="empty-state" style="display:block;border:0">No tests or quizzes in the next 4 weeks.</li>`;
  }

  const tease = (id, html) => { const el = $("#" + id); if (el) el.innerHTML = html; };

  function render() {
    renderBar();
    renderSchedule();
    renderHomework();
    renderBig();
    renderRotation();
    renderCounts();
    renderFantasy();
    renderNews();
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
    if (on) state.done[it.keys[0]] = new Date().toISOString();
    else it.keys.forEach((k) => delete state.done[k]);
    save();
  }

  document.addEventListener("change", (e) => {
    if (e.target.matches(".check")) {
      const li = e.target.closest(".item");
      const id = li.dataset.id, on = e.target.checked;
      li.classList.toggle("done", on);
      setDone(id, on);
      li.style.setProperty("--rnd", (Math.random() * 2 - 1).toFixed(2));
      li.classList.add("leaving");
      setTimeout(() => { renderHomework(); renderBig(); }, leaveMs());
      if (on) {
        toast("Moved to Done", () => { setDone(id, false); renderHomework(); renderBig(); });
        // finished everything due that day? celebrate a little
        const day = allItems().find((i) => i.id === id)?.due;
        const left = allItems().filter((i) => i.due === day && !isDone(i)).length;
        if (day && !left) toast(`Everything due ${relDay(day).toLowerCase()} is done`);
      }
    }
    if (e.target.id === "letter-select") {
      const d = e.target.dataset.date;
      if (e.target.value) state.letters[d] = e.target.value; else delete state.letters[d];
      save();
      render();
    }
  });

  document.querySelector(".p-week .seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    state.view = b.dataset.view;
    save();
    renderRotation();
  });

  document.querySelectorAll("details.extra").forEach((d) => {
    if (state.open?.[d.dataset.x]) d.open = true;
    d.addEventListener("toggle", () => { (state.open ||= {})[d.dataset.x] = d.open; save(); });
  });

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
    if (editing) Object.assign(editing, data);
    else state.manual.push({ uid: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), added: new Date().toISOString(), ...data });
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
    save();
    dlg.close();
    renderHomework();
    toast("Deleted", () => { state.manual.splice(idx, 0, removed); save(); renderHomework(); });
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
    paintThemeBtn();
    spRender();
  };
  matchMedia("(prefers-color-scheme:dark)").addEventListener("change", () => { paintThemeBtn(); spRender(); });
  paintThemeBtn();

  // ---------- skins: optional looks from themes/, picked in the top bar (index.html applies the saved one before paint) ----------
  const SKIN = "rlp-skin";
  const SKINS = { original: "Original", herbarium: "Herbarium", departure: "Departure board", blueprint: "Blueprint", catalog: "Card catalog", nautical: "Nautical chart", almanac: "Seed almanac", arcade: "Arcade", chess: "Chess club", hardwood: "Hardwood" };
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
    if (remember) try { localStorage.setItem(SKIN, name); } catch {}
    if (schedule) { renderBar(); renderSchedule(); }
    spRender();
  }
  // a saved skin that's since been retired (Riso zine, Star chart) is forgotten; index.html already showed the original
  try { const s = localStorage.getItem(SKIN); if (s && !SKINS[s]) localStorage.removeItem(SKIN); } catch {}
  const skinSels = document.querySelectorAll(".skin-select");
  skinSels.forEach((sel) => {
    sel.innerHTML = Object.entries(SKINS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    sel.value = skinNow();
    sel.onchange = () => { setSkin(sel.value); skinSels.forEach((o) => { o.value = sel.value; }); };
  });

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

  // ---------- boot ----------
  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  Promise.all([getJSON("schedule.json"), getJSON("homework.json").catch(() => null), getJSON("fantasy.json").catch(() => null), getJSON("news.json").catch(() => null)])
    .then(([s, h, f, n]) => {
      news = n;
      schedule = s;
      homework = h;
      fantasy = f;
      document.title = s.owner ? `${s.owner}'s RL Planner` : "RL Planner";
      render();
      loadTeams();
      loadBoards();
      loadSportsNews();
      setInterval(loadSportsNews, 15 * 60_000);
      setInterval(() => { renderBar(); renderSchedule(); }, 15_000);
      // tick just after each second turns over; a plain 1s interval drifts and skips a second now and then
      const tickLoop = () => { tickNow(); setTimeout(tickLoop, 1000 - (now().getTime() % 1000) + 15); };
      tickLoop();
      document.addEventListener("visibilitychange", () => { if (!document.hidden) tickNow(); });
    })
    .catch((err) => {
      $(".dash").innerHTML = `<p class="empty-state">Couldn't load the schedule (${esc(err.message)}). If you opened the file directly, serve the folder instead: <code>python3 -m http.server</code>.</p>`;
    });
})();
