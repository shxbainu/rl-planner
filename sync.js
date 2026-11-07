// Cloud sync: "Sign in with Google" mirrors the planner's saved state (check-offs, your own items, day letters,
// countdowns, a few settings) to one Firestore doc, users/{uid}, so the phone and the laptop agree.
// app.js loads this only when firebase-config.js has the project's config. localStorage stays the real store:
// signed out, or offline, the page works exactly as before. Spotify sign-in tokens are never synced.
const FB = "https://www.gstatic.com/firebasejs/10.12.2";
const { initializeApp } = await import(`${FB}/firebase-app.js`);
const { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } = await import(`${FB}/firebase-auth.js`);
const { getFirestore, doc, setDoc, onSnapshot, serverTimestamp } = await import(`${FB}/firebase-firestore.js`);

// a stable string for comparing two copies (key order doesn't matter)
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function start(config, app) {
  const fb = initializeApp(config), auth = getAuth(fb), db = getFirestore(fb);
  const el = document.getElementById("acct");
  let user = null, ref = null, unsub = null, timer = null, status = "synced", open = false, lastSent = "";

  function paint() {
    el.hidden = false;
    if (!user) {
      el.innerHTML = `<button type="button" class="acct-btn" data-acct="in" title="Sign in with Google to keep your check-offs on every device">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/><path d="M12 15v-5M9.5 12.5 12 10l2.5 2.5"/></svg><span>Sign in to sync</span></button>`;
      return;
    }
    const first = (user.displayName || "You").split(" ")[0];
    const face = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : `<i>${esc(first[0])}</i>`;
    const say = { synced: "Synced", saving: "Saving…", offline: "Saved here · will sync", error: "Sync paused" }[status];
    el.innerHTML = `<button type="button" class="acct-btn signed ${status}" data-acct="menu" aria-expanded="${open}" title="${esc(first)} · ${say}">${face}<span><b>${esc(first)}</b><small>${say}</small></span></button>
      ${open ? `<div class="acct-menu" role="menu"><p>Your check-offs, own items, day letters, countdowns and theme sync to every device you sign in on.</p><button type="button" class="btn" data-acct="out" role="menuitem">Sign out</button></div>` : ""}`;
  }
  const setStatus = (s) => { if (status !== s) { status = s; paint(); } };

  // write this device's copy (debounced: one write a second at most)
  function push() {
    if (!ref) return;
    clearTimeout(timer);
    setStatus(navigator.onLine === false ? "offline" : "saving");
    timer = setTimeout(async () => {
      const data = canon(app.local());
      if (data === lastSent) return setStatus("synced");
      try {
        await setDoc(ref, { data, updatedAt: serverTimestamp(), v: 1 });
        lastSent = data;
        setStatus("synced");
      } catch (e) { console.warn("sync write failed", e); setStatus(e?.code === "unavailable" ? "offline" : "error"); }
    }, 1000);
  }

  // the cloud copy changed (or this is the first look after signing in): merge, keep the result here, and send it
  // back only if this device added something the cloud didn't have
  function take(raw) {
    let remote = null;
    try { remote = raw ? JSON.parse(raw) : null; } catch {}
    const local = app.local(), merged = remote ? app.merge(local, remote) : local;
    if (canon(merged) !== canon(local)) app.apply(merged);
    if (!remote || canon(merged) !== canon(remote)) push(); else { lastSent = canon(remote); setStatus("synced"); }
  }

  function signedIn(u) {
    user = u;
    ref = doc(db, "users", u.uid);
    paint();
    // the first snapshot is the cloud copy as it stands; later ones are the other device's changes
    unsub = onSnapshot(ref, (snap) => { if (!snap.metadata.hasPendingWrites) take(snap.data()?.data); }, (e) => { console.warn("sync read failed", e); setStatus("error"); });
    app.onSave(push);
  }
  function signedOut() {
    unsub?.();
    unsub = null;
    clearTimeout(timer);
    app.onSave(null);
    user = ref = null;
    open = false;
    lastSent = "";
    paint();
  }

  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-acct]");
    if (!b) return;
    const what = b.dataset.acct;
    if (what === "menu") { open = !open; paint(); }
    if (what === "out") signOut(auth);
    if (what === "in") {
      const provider = new GoogleAuthProvider();
      try { await signInWithPopup(auth, provider); }
      catch (err) {
        // a home-screen web app can't open the popup; go to Google and come back instead
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(err?.code)) signInWithRedirect(auth, provider);
        else if (err?.code !== "auth/popup-closed-by-user" && err?.code !== "auth/cancelled-popup-request") console.warn("sign-in failed", err);
      }
    }
  });
  document.addEventListener("click", (e) => { if (open && !el.contains(e.target)) { open = false; paint(); } });
  addEventListener("online", () => { if (user) push(); });

  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, (u) => (u ? signedIn(u) : signedOut()));
}
