// The Firebase web config for "Sign in to sync" (see the README). It's public by design: what protects the data
// is firestore.rules, which lets each signed-in person read and write only their own doc. Until this is filled in,
// the sign-in chip stays hidden and the planner saves to this browser only, as it always has.
//
// Paste the config from Firebase (Project settings → Your apps → SDK setup and configuration → Config) here:
//   window.RLP_FIREBASE = { apiKey: "…", authDomain: "….firebaseapp.com", projectId: "…", storageBucket: "…", messagingSenderId: "…", appId: "…" };
window.RLP_FIREBASE = null;
