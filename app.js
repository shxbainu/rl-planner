// Brian's RL Planner: renders schedule.json + homework.json, keeps check-offs and own items in localStorage.
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
    const empty = { done: {}, manual: [], letters: {} };
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
  const nextSchoolDay = (s) => { let d = addDays(s, 1); while (isWeekend(d)) d = addDays(d, 1); return d; };
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
  const schoolDay = () => (isWeekend(today()) ? nextSchoolDay(today()) : today());

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
    for (const a of homework?.assignments || []) {
      if (!a?.title || !a?.due) continue;
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
    return `<li class="item${done ? " done" : ""}${major && !done ? " major" : ""}${overdue ? " overdue" : ""}" style="${cc(it.class)}" data-id="${esc(it.id)}">
      <input type="checkbox" class="check" ${done ? "checked" : ""} aria-label="Done: ${esc(it.title)}">
      <div class="body">
        <span class="title">${esc(it.title)}</span>
        <span class="meta">${meta}</span>
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
      : `Next up: ${fmt(day, { weekday: "long", month: "short", day: "numeric" })}`;
    const rot = letter && schedule.rotations[letter];
    const sub = [];
    if (!letter) sub.push("Tap ? to set the day letter");
    else {
      sub.push(`${letter} day`);
      if (from === "guess") sub.push("guessed, tap to fix");
      if (from === "you") sub.push("set by you");
      if (rot && !rot.confirmed) sub.push("<b>times unconfirmed</b>");
    }
    $("#bar-sub").innerHTML = sub.join(" · ");

    const el = $("#updated");
    const at = homework?.updated_at ? new Date(homework.updated_at) : null;
    if (!at || isNaN(at)) {
      el.className = "bar-status stale";
      el.innerHTML = `<span class="pill"><span class="dot"></span>Homework hasn't loaded</span>`;
      return;
    }
    const hrs = (now() - at) / 36e5;
    const ago = hrs < 1 ? "just now" : hrs < 24 ? `${Math.floor(hrs)}h ago` : `${Math.floor(hrs / 24)}d ago`;
    const when = at.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const stale = hrs > STALE_HOURS;
    el.className = "bar-status" + (stale ? " stale" : "");
    el.innerHTML = `<span class="pill" title="Homework last updated ${esc(when)}"><span class="dot"></span>${stale ? `Homework is ${ago} old, check Blackbaud` : `Homework updated ${esc(when)} · ${ago}`}</span>`;
  }

  function renderToday() {
    const t = today(), day = schoolDay();
    const isToday = day === t;
    $("#today-h").textContent = isToday ? "Today" : fmt(day, { weekday: "long" });
    const { letter } = letterFor(day);
    const rot = letter && schedule.rotations[letter];
    $("#today-meta").textContent = rot ? `${letter} day · ${rot.periods.length} classes` : "";

    const mins = now().getHours() * 60 + now().getMinutes();
    $("#periods").innerHTML = !rot
      ? `<li class="empty">Set the day letter to see classes.</li>`
      : rot.periods.map(([time, name]) => {
          const c = cls(name), start = minutes(time), end = start + 45;
          const st = !isToday ? "" : mins >= end ? "past" : mins >= start - 5 ? "now" : "";
          return `<li class="${st}" style="${cc(name)}">
            <span class="tm">${esc(time)}</span><span class="bar-c"></span>
            <span class="cn">${esc(c.name)}<span class="who">${esc([c.teacher, c.room].filter(Boolean).join(" · "))}</span></span>
          </li>`;
        }).join("");
    const a = schedule.after_school;
    $("#after").innerHTML = a ? `After school: <b>${esc(a.name)}</b>, ${esc(a.coach)}` : "";
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
    $("#hw").innerHTML = html;

    $("#done-count").textContent = done.length;
    $("#done").innerHTML = done.length ? done.map((i) => itemHTML(i, { showDue: true })).join("") : `<li class="empty-state">Checked-off assignments land here.</li>`;
  }

  function renderBlocks() {
    const byBlock = {};
    for (const [key, c] of Object.entries(schedule.classes)) if (c.block) (byBlock[c.block] ||= []).push([key, c]);
    $("#blocks").innerHTML = LETTERS.map((b) => {
      const list = byBlock[b];
      if (!list) return `<li class="free"><span class="blk">${b}</span><span class="nm">Free</span><span></span></li>`;
      const [key, c] = list[0];
      const extra = list.slice(1).map(([, x]) => `${x.short}${x.note ? ` ${x.note.replace(/^(\w{3})\w*/, "$1")}` : ""}: ${x.teacher} · ${x.room}`);
      return `<li style="${cc(key)}"><span class="blk">${b}</span>
        <span class="nm">${esc(c.name)}<small>${esc(c.teacher || "")}${extra.length ? ` · ${esc(extra.join("; "))}` : ""}</small></span>
        <span class="rm">${esc(c.room || "")}</span></li>`;
    }).join("");
  }

  function renderRotation() {
    const { letter } = letterFor(schoolDay());
    const head = `<colgroup><col class="tmc">${LETTERS.map(() => "<col>").join("")}</colgroup><thead><tr><th></th>${LETTERS.map((l) => {
      const r = schedule.rotations[l];
      return `<th class="${l === letter ? "cur" : ""}">${l}${r && !r.confirmed ? `<span class="q">?</span>` : ""}</th>`;
    }).join("")}</tr></thead>`;
    const rows = schedule.times.map((t) => `<tr><td class="tm">${t}</td>${LETTERS.map((l) => {
      const p = schedule.rotations[l]?.periods.find((x) => x[0] === t);
      if (!p) return `<td class="x"></td>`;
      return `<td class="${l === letter ? "cur" : ""}" style="${cc(p[1])}" title="${esc(cls(p[1]).name)}">${esc(cls(p[1]).short)}</td>`;
    }).join("")}</tr>`).join("");
    $("#rot").innerHTML = head + `<tbody>${rows}</tbody>`;
  }

  function render() {
    renderBar();
    renderToday();
    renderHomework();
    renderBlocks();
    renderRotation();
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

  // ---------- boot ----------
  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  Promise.all([getJSON("schedule.json"), getJSON("homework.json").catch(() => null)])
    .then(([s, h]) => {
      schedule = s;
      homework = h;
      render();
      setInterval(() => { renderBar(); renderToday(); }, 60_000);
    })
    .catch((err) => {
      $(".dash").innerHTML = `<p class="empty-state">Couldn't load the schedule (${esc(err.message)}). If you opened the file directly, serve the folder instead: <code>python3 -m http.server</code>.</p>`;
    });
})();
