# RL Planner

A Roxbury Latin schedule + homework dashboard. Plain HTML/CSS/JS, no build step.

- `schedule.json`: `owner` (first name shown in the page title), classes, blocks, day-letter rotations (B, E, G marked unconfirmed).
- `homework.json`: latest assignments (`assignments`), optional day letters (`days`, `"YYYY-MM-DD": "H"`), and `updated_at`. The daily update only touches this file.
- Check-offs and added assignments live in the browser's localStorage; Export / Import moves them between devices.

Preview locally:

    python3 -m http.server 8765

then open http://localhost:8765. Add `?date=2026-11-04&time=10:15` to preview another day.

## fantasy.json (Muse posts it; Muse and Claude add moves)

    {"updated_at":"<ISO>","league":"","team":"","week":10,"record":"6-3",
     "matchup":{"opponent":"","my_proj":118.4,"opp_proj":109.2,"my_score":null,"opp_score":null},
     "lineup":[{"slot":"QB","player":"","team":"SF","opp":"vs LV","kickoff":"<ISO>","proj":19.8,"points":null,"status":"Q|O|IR|"}],
     "bench":[ same shape ],
     "moves":[{"by":"Muse|Claude","kind":"start/sit|waiver|trade|drop","text":"","why":""}]}

Teams (Warriors, 49ers) come live from ESPN's public schedule feed; edit `teams` in schedule.json to change them.
Countdowns are added on the page and saved in the browser (included in Export/Import).
