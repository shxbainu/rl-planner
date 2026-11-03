# RL Planner

A Roxbury Latin schedule + homework dashboard. Plain HTML/CSS/JS, no build step.

- `schedule.json`: `owner` (first name shown in the page title), classes, blocks, day-letter rotations (B, E, G marked unconfirmed).
- `homework.json`: latest assignments (`assignments`), optional day letters (`days`, `"YYYY-MM-DD": "H"`), and `updated_at`. The daily update only touches this file.
- Check-offs and added assignments live in the browser's localStorage (they stay on the device you used).

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
Countdowns are added on the page and saved in the browser.

## Sports and news

- Scores, game details (box score, play-by-play, team stats) and sports news load live from ESPN's public feeds in the browser.
- Headlines in seven sections (top, politics, world, business, tech, science, health) from about 25 outlets, including WSJ, NYT, BBC, Fox News, NBC, Al Jazeera and Bloomberg: `tools/fetch_news.py` builds `news.json` from their public RSS feeds, caps each outlet per section, and saves a picture for each story. The `Deploy site` workflow runs it on every push and hourly, then deploys to GitHub Pages. (GitHub pauses scheduled workflows after 60 days with no commits; any push restarts them.)

## Daily homework, hands-off

Muse saves the site-format JSON to the brianrlsite Crosswalk files at `site/homework.json` (and `site/fantasy.json`).
The `Deploy site` workflow pulls both every hour with a read-only Crosswalk key stored as the `CROSSWALK_KEY` repo secret,
checks their shape, and falls back to the repo copies if anything is missing or malformed.
