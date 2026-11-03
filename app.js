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

  function now() {
    // ?date=YYYY-MM-DD&time=HH:MM previews another day
    const q = new URLSearchParams(location.search);
    const d = new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get("date") || "")) {
      const [y, m, dd] = q.get("date").split("-").map(Number);
      d.setFullYear(y, m - 1, dd);
    }
    if (/^\d{1,2}:\d{2}$/.test(q.get("time") || "")) {
      const [h, mi] = q.get("time").split(":").map(Number);
      d.setHours(h, mi, 0, 0);
    }
    return d;
  }
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
    const alias = { "Math-Sci": "MSI", "Math-Sci Investigations": "MSI", Art: "Arts", "Health & Wellness": "Health" };
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

  // ---------- rendering ----------
  const cls = (name) => schedule.classes[name] || schedule.classes.Other;
  const cc = (name) => `--cc:var(--c-${cls(name).color})`;

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

  function renderBar() {
    const t = today(), day = schoolDay();
    const { letter, from } = letterFor(day);
    const sel = $("#letter-select");
    sel.innerHTML = `<option value="">?</option>` + LETTERS.map((l) => `<option ${l === letter ? "selected" : ""}>${l}</option>`).join("");
    sel.dataset.date = day;

    $("#bar-date").textContent = day === t
      ? fmt(t, { weekday: "long", month: "long", day: "numeric" })
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
  }

  // One row per bell slot; a class in a split slot (the 4th block) gets one segment per part.
  function dayRows(letter) {
    const rot = letter && schedule.rotations[letter];
    if (!rot) return [];
    const at = Object.fromEntries(rot.periods);
    return schedule.bells.map((b) => {
      if (b.lunch) return { kind: "lunch", bell: b, segs: [{ start: b.start, end: b.end, label: "Lunch" }] };
      const name = at[b.start];
      const label = name ? cls(name).name : "Free";
      const parts = b.parts || [[b.start, b.end]];
      return {
        kind: name ? "class" : "free", name, bell: b,
        segs: parts.map(([s, e], i) => ({ start: s, end: e, label: parts.length > 1 ? `${label} (part ${i + 1} of 2)` : label, name })),
      };
    });
  }

  const dur = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`);
  const where = (name) => (name ? cls(name).room || "" : "");

  function nowCard(rows, isToday, day, letter) {
    const after = schedule.after_school;
    if (!rows.length) return `<div class="big"><span class="lbl">Set the day letter to see your classes</span></div>`;
    const firstClass = rows.flatMap((r) => r.segs).find((s) => s.name);
    if (!isToday) {
      return `<div class="big"><span class="lbl">${esc(fmt(day, { weekday: "long" }))} is ${/^[AEFH]/.test(letter) ? "an" : "a"} ${letter} day</span></div>
        <div class="sub">First class: <b>${esc(firstClass ? cls(firstClass.name).name : "none")}</b>${firstClass ? ` at ${firstClass.start} in ${esc(where(firstClass.name))}` : ""}</div>`;
    }
    // ignore free time before the first class and after the last
    const segs = rows.flatMap((r) => r.segs);
    const firstI = segs.findIndex((s) => s.name), lastI = segs.length - 1 - [...segs].reverse().findIndex((s) => s.name);
    const day_ = segs.slice(firstI, lastI + 1);
    const m = now().getHours() * 60 + now().getMinutes() + now().getSeconds() / 60;
    const nextAfter = (i) => day_.slice(i + 1).find((s) => s.name || s.label === "Lunch");
    const nextLine = (n) => n ? `Then <b>${esc(n.label)}</b> at ${n.start}${n.name ? ` in ${esc(where(n.name))}` : ""}` : "Last one today";

    if (m < minutes(day_[0].start)) {
      const left = Math.ceil(minutes(day_[0].start) - m);
      return `<div class="big"><span class="num">${dur(left)}</span><span class="lbl">until school</span></div>
        <div class="sub">First: <b>${esc(day_[0].label)}</b> at ${day_[0].start} in ${esc(where(day_[0].name))}</div>`;
    }
    if (m >= minutes(day_.at(-1).end)) {
      return `<div class="big"><span class="lbl">Done with classes for today</span></div>${after ? `<div class="sub">Next: <b>${esc(after.name)}</b></div>` : ""}`;
    }
    for (let i = 0; i < day_.length; i++) {
      const s = day_[i], a = minutes(s.start), b = minutes(s.end);
      if (m >= a && m < b) {
        const left = Math.ceil(b - m), pct = Math.round(((m - a) / (b - a)) * 100);
        return `<div class="big" style="${s.name ? cc(s.name) : ""}"><span class="num">${dur(left)}</span><span class="lbl">left in ${esc(s.label)}</span></div>
          <div class="prog" style="${s.name ? cc(s.name) : ""}"><i style="width:${pct}%"></i></div>
          <div class="sub">Ends ${s.end} · ${nextLine(nextAfter(i))}</div>`;
      }
      const n = day_[i + 1];
      if (n && m >= b && m < minutes(n.start)) {
        const left = Math.ceil(minutes(n.start) - m);
        return `<div class="big" style="${n.name ? cc(n.name) : ""}"><span class="num">${dur(left)}</span><span class="lbl">until ${esc(n.label)}</span></div>
          <div class="sub">${n.name && n.name === s.name ? "Short break · same room" : `Passing time${n.name ? ` · head to <b>${esc(where(n.name))}</b>` : ""}`}</div>`;
      }
    }
    return "";
  }

  function renderSchedule() {
    const t = today(), day = schoolDay(), isToday = day === t;
    const { letter } = letterFor(day);
    const rows = dayRows(letter);
    const classes = rows.filter((r) => r.kind === "class").length;
    $("#sched-h").textContent = isToday ? "Today" : relDay(day);
    $("#sched-meta").textContent = letter ? `${letter} day · ${classes} classes` : "";
    $("#now-card").innerHTML = nowCard(rows, isToday, day, letter);

    const m = now().getHours() * 60 + now().getMinutes();
    const first = rows.findIndex((r) => r.kind === "class");
    const last = rows.length - 1 - [...rows].reverse().findIndex((r) => r.kind === "class");
    $("#timeline").innerHTML = !rows.length
      ? `<li class="empty">Set the day letter to see classes.</li>`
      : rows.map((r, i) => {
          if (r.kind === "free" && (i < first || i > last)) return ""; // no class yet / already out
          const a = minutes(r.bell.start), b = minutes(r.bell.end);
          const live = isToday && r.segs.find((s) => m >= minutes(s.start) && m < minutes(s.end));
          const st = !isToday ? "" : m >= b ? "past" : live ? "now" : "";
          const pct = live ? Math.round(((m - minutes(live.start)) / (minutes(live.end) - minutes(live.start))) * 100) : 0;
          const c = r.name && cls(r.name);
          const badge = r.kind === "lunch" ? "L" : c ? c.block : "·";
          const tm = r.bell.parts ? r.bell.parts.map((p) => p.join("–")).join("<br>") : `${r.bell.start}–${r.bell.end}`;
          const label = r.kind === "lunch" ? "Lunch" : c ? c.name : "Free";
          const who = c ? [c.teacher, c.room].filter(Boolean).join(" · ") : "";
          return `<li class="${r.kind} ${st}" style="${r.name ? cc(r.name) : ""}">
            <span class="blk">${badge}</span>
            <span class="cn">${esc(label)}${r.bell.parts && c ? `<span class="split">25 + 15</span>` : ""}${who ? `<span class="who">${esc(who)}</span>` : ""}</span>
            <span class="tm">${tm}</span>
            ${live ? `<span class="prog"><i style="width:${pct}%"></i></span>` : ""}
          </li>`;
        }).join("");
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
        return { key: date, cur: date === day, top: fmt(date, { weekday: "short" }), letter, off, q: !off && (!letter || from === "guess") };
      });
    } else {
      const { letter: curL } = letterFor(day);
      cols = LETTERS.map((l) => ({ key: l, cur: l === curL, top: "", letter: l, q: !schedule.rotations[l]?.confirmed }));
    }
    const head = `<colgroup><col class="tmc">${cols.map(() => "<col>").join("")}</colgroup><thead><tr><th></th>${cols.map((c) =>
      `<th class="${c.cur ? "cur" : ""}"${c.off ? ` title="${esc(c.off)}"` : ""}>${esc(c.top)}<small>${c.off ? "Off" : c.letter || ""}${c.q ? `<span class="q">?</span>` : ""}</small></th>`).join("")}</tr></thead>`;
    const rows = schedule.bells.map((b) => {
      if (b.lunch) return `<tr><td class="tm">${b.start}</td><td class="lunch" colspan="${cols.length}">Lunch</td></tr>`;
      return `<tr><td class="tm">${b.start}</td>${cols.map((c) => {
        const p = c.letter && schedule.rotations[c.letter]?.periods.find((x) => x[0] === b.start);
        if (!p) return `<td class="x"></td>`;
        return `<td class="${c.cur ? "cur" : ""}" style="${cc(p[1])}" title="${esc(cls(p[1]).name)}">${esc(cls(p[1]).short)}</td>`;
      }).join("")}</tr>`;
    }).join("");
    $("#rot").className = "rot " + view;
    $("#rot").innerHTML = head + `<tbody>${rows}</tbody>`;
    $("#rot-note").textContent = view === "week"
      ? "? = day letter is a guess. Tap the letter in the top bar to fix today's."
      : "? = B, E and G times aren't confirmed yet.";
  }

  function groupBy(items) {
    const g = new Map();
    for (const it of items) { if (!g.has(it.due)) g.set(it.due, []); g.get(it.due).push(it); }
    return g;
  }

  function renderHomework() {
    const t = today();
    const items = allItems();
    const open = items.filter((i) => !isDone(i));
    const overdue = open.filter((i) => i.due < t);
    const upcoming = open.filter((i) => i.due >= t);
    const done = items.filter(isDone).sort((a, b) => b.due.localeCompare(a.due));
    const soonEnd = nextSchoolDay(t);
    const soonCount = upcoming.filter((i) => i.due <= soonEnd).length;
    $("#hw-meta").textContent = `${open.length} open · ${soonCount} due by ${relDay(soonEnd).toLowerCase()}`;

    let html = "";
    if (overdue.length) {
      html += `<div class="grp overdue"><div class="grp-h"><span class="rel">Overdue</span></div><ul class="list">${overdue.map((i) => itemHTML(i, { showDue: true, overdue: true })).join("")}</ul></div>`;
    }
    if (!upcoming.some((i) => i.due <= soonEnd)) {
      html += `<p class="empty-state">Nothing due ${isWeekend(t) ? "before " + esc(fmt(soonEnd, { weekday: "long" })) : "today or " + esc(relDay(soonEnd).toLowerCase())}.</p>`;
    }
    for (const [d, list] of groupBy(upcoming)) {
      const { letter, from } = letterFor(d);
      const ltr = letter && !isWeekend(d) ? `${letter} day${from === "guess" && daysBetween(t, d) > 1 ? "?" : ""}` : "";
      html += `<div class="grp"><div class="grp-h"><span class="rel">${esc(relDay(d))}</span>${daysBetween(t, d) < 7 ? `<span>${esc(fmt(d, { month: "short", day: "numeric" }))}</span>` : ""}<span class="ltr">${ltr}</span></div><ul class="list">${list.map((i) => itemHTML(i)).join("")}</ul></div>`;
    }
    if (!upcoming.length && !overdue.length) html += `<p class="empty-state">Nothing on the list yet.</p>`;
    for (const n of homework?.notes || []) html += `<p class="hw-note">${esc(n)}</p>`;
    $("#hw").innerHTML = html;

    $("#done-count").textContent = done.length;
    $("#done").innerHTML = done.length ? done.map((i) => itemHTML(i, { showDue: true })).join("") : `<li class="empty-state">Checked-off assignments land here.</li>`;
  }

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
    $("#sports-meta").textContent = "ESPN";
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
  function renderFantasy() {
    const f = fantasy;
    if (!f || !f.lineup?.length) {
      $("#ff-meta").textContent = "";
      $("#ff").innerHTML = `<p class="empty-state">Waiting on Muse to post your lineup. Suggested moves from Muse and Claude will show here too.</p>`;
      return;
    }
    const at = f.updated_at ? new Date(f.updated_at) : null;
    $("#ff-meta").textContent = [f.week ? `Week ${f.week}` : "", f.record, at ? `updated ${at.toLocaleDateString(undefined, { weekday: "short" })}` : ""].filter(Boolean).join(" · ");
    const m = f.matchup;
    const score = (a, b) => (a ?? b ?? "–");
    const row = (p) => {
      const out = /^(O|IR|OUT)$/i.test(p.status || "");
      return `<tr><td class="slot">${esc(p.slot || "")}</td><td class="pl">${esc(p.player)}${p.status ? `<span class="st${out ? " out" : ""}">${esc(p.status)}</span>` : ""}<small>${esc([p.team, p.opp, p.kickoff ? gameTime(p.kickoff) : ""].filter(Boolean).join(" · "))}</small></td><td class="pj">${p.points ?? p.proj ?? ""}</td></tr>`;
    };
    $("#ff").innerHTML = `
      ${m ? `<div class="ff-match"><div class="side"><b>${score(m.my_score, m.my_proj)}</b>${esc(f.team || "You")}</div><span class="vs">${m.my_score != null ? "LIVE" : "PROJ"}</span><div class="side"><b>${score(m.opp_score, m.opp_proj)}</b>${esc(m.opponent || "")}</div></div>` : ""}
      ${f.moves?.length ? `<div class="sub-h">Suggested moves</div><ul class="moves">${f.moves.map((x) => `<li><span class="by"><i>${esc(x.by || "")}</i>${x.kind ? ` · ${esc(x.kind)}` : ""}</span>${esc(x.text)}${x.why ? `<span class="why">${esc(x.why)}</span>` : ""}</li>`).join("")}</ul>` : ""}
      <div class="sub-h">Starters</div><table class="ff-table">${f.lineup.map(row).join("")}</table>
      ${f.bench?.length ? `<details><summary>Bench <span class="count">${f.bench.length}</span></summary><table class="ff-table">${f.bench.map(row).join("")}</table></details>` : ""}`;
  }

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
    game = { lg, id, d: null };
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

  function renderGame() {
    const d = game.d, comp = d.header.competitions[0], st = comp.status.type;
    const teams = [...comp.competitors].sort((x) => (x.homeAway === "away" ? -1 : 1));
    const side = (t) => `<div class="g-team ${t.homeAway}"><img src="${esc(t.team.logos?.[0]?.href || t.team.logo || "")}" alt=""><div><b>${esc(t.team.displayName)}</b><small>${esc(t.record?.[0]?.displayValue || t.record?.[0]?.summary || "")}</small></div><span class="pts">${st.state === "pre" ? "" : esc(t.score ?? "")}</span></div>`;
    const periods = Math.max(...teams.map((t) => t.linescores?.length || 0));
    const pName = (i) => (game.lg === "nba" ? (i < 4 ? `Q${i + 1}` : `OT${i > 4 ? i - 3 : ""}`) : i < 4 ? `Q${i + 1}` : "OT");
    const lines = periods ? `<table class="lines"><tr><th></th>${Array.from({ length: periods }, (_, i) => `<th>${pName(i)}</th>`).join("")}<th>T</th></tr>${teams.map((t) =>
      `<tr><td>${esc(t.team.abbreviation)}</td>${(t.linescores || []).map((l) => `<td>${esc(l.displayValue ?? l.value ?? "")}</td>`).join("")}<td>${esc(t.score ?? "")}</td></tr>`).join("")}</table>` : "";
    const venue = d.gameInfo?.venue?.fullName;
    const mid = `<div class="g-mid"><b class="${st.state === "in" ? "live" : ""}">${esc(st.state === "pre" ? gameTime(comp.date) : st.shortDetail || st.detail)}</b>${venue ? esc(venue) : ""}${d.gameInfo?.attendance ? `<br>${Number(d.gameInfo.attendance).toLocaleString()} fans` : ""}</div>`;
    $("#g-score").innerHTML = `<div class="g-sc">${side(teams[0])}${mid}${side(teams[1])}</div>${lines}`;
    document.querySelectorAll("#g-tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === gTab)));
    $("#g-body").innerHTML = gTab === "box" ? boxHTML(d) : gTab === "plays" ? playsHTML(d) : teamStatsHTML(d, teams);
  }

  function leadersHTML(d) {
    if (!d.leaders?.length) return "";
    return `<div><h3>Leaders</h3><div class="ldrs">${d.leaders.flatMap((t) => (t.leaders || []).slice(0, 3).map((c) =>
      c.leaders?.[0] ? `<div class="ldr"><span>${esc(t.team.abbreviation)} · ${esc(c.displayName)}</span><b>${esc(c.leaders[0].athlete.displayName)}</b> ${esc(c.leaders[0].displayValue)}</div>` : "")).join("")}</div></div>`;
  }
  function boxHTML(d) {
    const groups = d.boxscore?.players || [];
    if (!groups.length) return `${leadersHTML(d)}<p class="empty-state">Box score shows up once the game starts.</p>`;
    const tables = groups.map((g) => g.statistics.map((s) => {
      if (!s.athletes?.length) return "";
      const title = `${g.team.displayName}${s.name ? ` · ${s.name[0].toUpperCase() + s.name.slice(1)}` : ""}`;
      let benchMarked = false;
      const rows = s.athletes.map((a) => {
        const bench = game.lg === "nba" && a.starter === false && !benchMarked;
        if (bench) benchMarked = true;
        const dnp = a.didNotPlay || !a.stats?.length;
        return `<tr class="${bench ? "bench-start" : ""}${dnp ? " dnp" : ""}"><td>${esc(a.athlete.shortName || a.athlete.displayName)}${a.athlete.position?.abbreviation ? `<small>${esc(a.athlete.position.abbreviation)}</small>` : ""}</td>${dnp ? `<td colspan="${s.labels.length}" style="text-align:left">${esc(a.reason || "DNP")}</td>` : a.stats.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`;
      }).join("");
      const totals = s.totals?.length ? `<tr><td>Team</td>${s.totals.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>` : "";
      return `<div><h3>${esc(title)}</h3><div class="bx-wrap"><table class="bx"><tr><th>Player</th>${s.labels.map((l) => `<th>${esc(l)}</th>`).join("")}</tr>${rows}${totals}</table></div></div>`;
    }).join("")).join("");
    return leadersHTML(d) + tables;
  }
  function playsHTML(d) {
    const filter = `<label class="g-filter"><input type="checkbox" id="g-scoring" ${scoringOnly ? "checked" : ""}> Scoring plays only</label>`;
    if (game.lg === "nba") {
      let plays = [...(d.plays || [])].reverse();
      if (scoringOnly) plays = plays.filter((p) => p.scoringPlay);
      if (!plays.length) return filter + `<p class="empty-state">No plays yet.</p>`;
      let per = null;
      const items = plays.slice(0, 400).map((p) => {
        const head = p.period?.number !== per ? `<li class="per">${esc(p.period?.displayValue || `Period ${p.period?.number}`)}</li>` : "";
        per = p.period?.number;
        return `${head}<li class="${p.scoringPlay ? "scoring" : ""}"><span class="clk">${esc(p.clock?.displayValue || "")}</span><span>${esc(p.text || "")}</span><span class="scr">${p.awayScore ?? ""}–${p.homeScore ?? ""}</span></li>`;
      }).join("");
      return filter + `<ul class="plays">${items}</ul>`;
    }
    // NFL: drives, newest first, with their plays
    const drives = [...(d.drives?.previous || []), ...(d.drives?.current ? [d.drives.current] : [])].reverse();
    if (scoringOnly) {
      const sp = d.scoringPlays || [];
      return filter + (sp.length ? `<ul class="plays">${[...sp].reverse().map((p) => `<li class="scoring"><span class="clk">Q${p.period?.number} ${esc(p.clock?.displayValue || "")}</span><span><b>${esc(p.team?.abbreviation || "")}</b> ${esc(p.text)}</span><span class="scr">${p.awayScore}–${p.homeScore}</span></li>`).join("")}</ul>` : `<p class="empty-state">No scores yet.</p>`);
    }
    if (!drives.length) return filter + `<p class="empty-state">No drives yet.</p>`;
    return filter + drives.map((dr, i) => `<details class="drive"${i === 0 ? " open" : ""}><summary>${esc(dr.team?.abbreviation || dr.team?.shortDisplayName || "")} · ${esc(dr.result || dr.displayResult || "In progress")}<small>${esc(dr.description || "")}</small></summary><ul class="plays">${[...(dr.plays || [])].reverse().map((p) =>
      `<li class="${p.scoringPlay ? "scoring" : ""}"><span class="clk">Q${p.period?.number} ${esc(p.clock?.displayValue || "")}</span><span>${esc((p.text || "").trim())}</span><span class="scr">${p.awayScore ?? ""}–${p.homeScore ?? ""}</span></li>`).join("")}</ul></details>`).join("");
  }
  function teamStatsHTML(d, teams) {
    const bt = d.boxscore?.teams || [];
    if (bt.length < 2) return `<p class="empty-state">Team stats show up once the game starts.</p>`;
    const away = bt.find((t) => t.homeAway === "away") || bt[0], home = bt.find((t) => t !== away);
    const homeBy = Object.fromEntries((home.statistics || []).map((s) => [s.label || s.name, s.displayValue]));
    return `<table class="ts"><tr><th style="text-align:right">${esc(away.team.abbreviation)}</th><th></th><th style="text-align:left">${esc(home.team.abbreviation)}</th></tr>${(away.statistics || []).map((s) =>
      `<tr><td>${esc(s.displayValue)}</td><td>${esc(s.label || s.name)}</td><td>${esc(homeBy[s.label || s.name] ?? "")}</td></tr>`).join("")}</table>`;
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
  function renderNews() {
    const secs = news?.sections ? Object.keys(news.sections) : [];
    if (!secs.length) {
      $("#news-tabs").innerHTML = "";
      $("#news").innerHTML = `<li class="empty-state">Headlines refresh every hour on the live site.</li>`;
      $("#news-foot").textContent = "";
      return;
    }
    if (!secs.includes(newsTab)) newsTab = secs[0];
    $("#news-tabs").innerHTML = secs.map((k) => `<button type="button" data-news="${esc(k)}" aria-pressed="${k === newsTab}">${esc(k[0].toUpperCase() + k.slice(1))}</button>`).join("");
    $("#news").innerHTML = news.sections[newsTab].slice(0, 25).map((n) =>
      `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(n.title)}</span><span class="src">${esc(n.source)}</span>${n.published ? `<span class="ago">${ago(n.published)}</span>` : ""}</a></li>`).join("");
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
    $("#snews").innerHTML = all.length ? all.slice(0, 20).map((a) =>
      `<li><a href="${esc(a.links.web.href)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(a.headline)}</span><span class="src">${a.lg.toUpperCase()} · ${ago(a.published)} ago</span>${a.images?.[0]?.url ? `<img class="img" src="${esc(a.images[0].url)}" alt="" loading="lazy">` : ""}</a></li>`).join("")
      : `<li class="empty-state">Sports news unavailable right now.</li>`;
  }

  function render() {
    renderBar();
    renderSchedule();
    renderHomework();
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
      li.classList.add("leaving");
      setTimeout(renderHomework, 220);
      if (on) toast("Moved to Done", () => { setDone(id, false); renderHomework(); });
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

  // export / import
  $("#export-btn").onclick = () => {
    const blob = new Blob([JSON.stringify({ app: "rl-planner", version: 1, exported_at: new Date().toISOString(), ...state }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rl-planner-${today()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("#import-btn").onclick = () => $("#import-file").click();
  $("#import-file").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== "rl-planner") throw new Error("not a planner export");
      // merge: union of check-offs and own items, imported day letters win
      Object.assign(state.done, d.done || {});
      Object.assign(state.letters, d.letters || {});
      const haveC = new Set((state.countdowns ||= []).map((c) => c.id));
      for (const c of d.countdowns || []) if (c?.id && !haveC.has(c.id)) state.countdowns.push(c);
      const have = new Set(state.manual.map((m) => m.uid));
      for (const m of d.manual || []) if (m?.uid && !have.has(m.uid)) state.manual.push(m);
      save();
      render();
      toast("Imported");
    } catch {
      toast("That file isn't a planner export");
    }
  };

  // theme
  const icons = {
    dark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
    light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  };
  const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme:dark)").matches;
  const paintThemeBtn = () => { $("#theme-btn").innerHTML = isDark() ? icons.light : icons.dark; };
  try { const t = localStorage.getItem(THEME); if (t) document.documentElement.dataset.theme = t; } catch {}
  $("#theme-btn").onclick = () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME, next); } catch {}
    paintThemeBtn();
  };
  paintThemeBtn();

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
    })
    .catch((err) => {
      $(".dash").innerHTML = `<p class="empty-state">Couldn't load the schedule (${esc(err.message)}). If you opened the file directly, serve the folder instead: <code>python3 -m http.server</code>.</p>`;
    });
})();
