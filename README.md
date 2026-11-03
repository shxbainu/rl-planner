# RL Planner

A Roxbury Latin schedule + homework dashboard. Plain HTML/CSS/JS, no build step.

- `schedule.json`: `owner` (first name shown in the page title), classes, blocks, day-letter rotations (B, E, G marked unconfirmed).
- `homework.json`: latest assignments (`assignments`), optional day letters (`days`, `"YYYY-MM-DD": "H"`), and `updated_at`. The daily update only touches this file.
- Check-offs and added assignments live in the browser's localStorage; Export / Import moves them between devices.

Preview locally:

    python3 -m http.server 8765

then open http://localhost:8765. Add `?date=2026-11-04&time=10:15` to preview another day.
