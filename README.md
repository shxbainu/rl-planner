# RL Planner

A Roxbury Latin schedule + homework dashboard. Plain HTML/CSS/JS, no build step.

- `schedule.json`: `owner` (first name shown in the page title), classes, blocks, day-letter rotations (B, E, G marked unconfirmed).
- `homework.json`: latest assignments (`assignments`), optional day letters (`days`, `"YYYY-MM-DD": "H"`), and `updated_at`. The daily update only touches this file.
- Check-offs and added assignments live in the browser's localStorage (they stay on the device you used). So does the season record, which is computed from those check-offs; nothing personal is in the repo.

## On the page

- **Study mode** (headphones button): full screen. Counts down the current block (passing time and the next class in between), or runs a 25/5 or 50/10 focus timer outside school hours. Shows tonight's top item with a big checkbox, the rest as a queue, a subject helper drawn from the item (Odyssey lines, Ohm's law, ut clauses…), session time and break nudges, over a scene for the subject. Keeps the screen awake where the browser allows.
- **Scoreboard clock** (top of Today): classes are quarters, passing is a timeout, lunch is halftime, the whole day on one bar.
- **Season** (top of Homework): every day with homework due is a W if it all got done, an L if not; tonight's work as points scored vs projected. Resets after `marking_period.ends` in `schedule.json`.
- **Snow day odds**: appears only when Open-Meteo forecasts snow for West Roxbury on a school day. `?snow=15` previews it with 15 cm.
- **Game night**: a band in the team's colors on Warriors and 49ers game days, with the tip-off or kickoff countdown.
- **Command bar**: press `/`, then type `latin p245 ex c due fri` to add homework, or a section name to jump there.
- **Music** (always open on laptops, its own tab on phones): switch between **Spotify** and **Lofi Girl**. Spotify starts empty, with **Connect Spotify** and **Paste a link**: once connected it shows what you're playing on any device, with play, pause and skip on Premium; a pasted playlist, album or song plays in Spotify's embed (**Change** and **Clear** under it). Both tabs keep the card the same height. Lofi Girl is the 24/7 "lofi hip hop radio" YouTube stream; Lofi Girl restarts its streams now and then (the 2022 one ended in May 2026), so if the video says it's unavailable, put the current id from youtube.com/@LofiGirl/streams in `LOFI.id` in `app.js`. `?npdemo` previews the now-playing card.
- **Today's briefing** (top of More → News, with a "Read the briefing" link on Today): each morning an AI summary of the day's headlines: one sentence for the day, then the 5 to 7 biggest stories with why each matters and links to the outlets that covered it. Written by `tools/summarize_news.py` in the deploy workflow (one Claude API call a day, first run after 6:30am Eastern). The model may only use the headlines it's given, every story has to cite them, and the script drops any story whose citations don't match. Labeled on the page as an AI summary that may contain mistakes. Needs the API key below; without it the card says so and nothing else changes.
- **Quick links** (under Today): Portal, Classroom, Gmail, Drive, Membean, Chess.com and Spotify in one row (it scrolls sideways on phones), and under them a chip for each class that opens its Blackbaud Topics page. The class chips come from `links.json` (`{"class_links":[{"class":"Latin","topics":"<url>","bulletin":"<url>"}]}`, class names as in `schedule.json`), which Muse posts; only roxburylatin.myschoolapp.com addresses are used, and a class without one is left out.
- **Layout**: Today, Homework and Music stay open; Week, Sports, News, Fantasy and Countdowns share one tab strip. On phones a bottom bar switches between Today, Homework, Music and More.

## Turning on the daily briefing (once)

1. Go to https://console.anthropic.com, sign in or make an account, and add a payment method under **Billing**. It's pay as you go.
2. Under **API Keys**, press **Create Key**, name it something like `rl-planner`, and copy the key (it starts with `sk-ant-`). You only see it once.
3. On GitHub, open the repo **shxbainu/rl-planner → Settings → Secrets and variables → Actions → New repository secret**. Name it exactly `ANTHROPIC_API_KEY`, paste the key, and save.
4. To get a briefing right away instead of waiting for the next morning: **Actions → Deploy site → Run workflow**, tick **Rewrite today's AI briefing now**, and run it.

Cost: one call a day to Claude Sonnet 5.5 with about 14,000 tokens of headlines in and roughly 3,000 to 5,000 out (the briefing plus the model's thinking) comes to about 6 to 8 cents a day, around $2 to $2.50 a month. Hourly deploys don't call it again once the day's briefing exists. You can set a monthly spending limit in the Console under **Limits**. The key lives only in GitHub's encrypted secrets, never in the repo.

## Connecting Spotify (once, about two minutes)

The site asks Spotify for permission with the PKCE flow, so it needs no secret; you make the Spotify app yourself.

1. Go to https://developer.spotify.com/dashboard, log in with your Spotify account, and press **Create app**.
2. Give it any name and description. Under **Redirect URIs** add exactly `https://shxbainu.github.io/rl-planner/` (for the local preview, also `http://127.0.0.1:8765/`; Spotify doesn't accept `localhost`). Tick **Web API**, agree to the terms, and save.
3. Open the app's **Settings → User Management** and add your name and your Spotify account's email. New Spotify apps start in development mode, which only lets listed accounts in.
4. Copy the app's **Client ID**. On the planner, open Music, press **Connect Spotify**, paste the Client ID, and press **Connect**. Spotify asks you to agree, then sends you back.

The Client ID and sign-in live only in that browser's localStorage. **Disconnect** forgets the sign-in. Play, pause and skip need Spotify Premium; without it the card still shows what's playing.

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
- Headlines in seven sections (top, politics, world, business, tech, science, health) from about 25 outlets, including WSJ, NYT, BBC, Fox News, NBC, Al Jazeera and CNBC: `tools/fetch_news.py` builds `news.json` from their public RSS feeds, caps each outlet per section, and saves a picture for each story. The `Deploy site` workflow runs it on every push and hourly, then deploys to GitHub Pages. (GitHub pauses scheduled workflows after 60 days with no commits; any push restarts them.)

## Daily homework, hands-off

Muse saves the site-format JSON to the brianrlsite Crosswalk files at `site/homework.json` (and `site/fantasy.json`, `site/links.json`).
The `Deploy site` workflow pulls them every hour with a read-only Crosswalk key stored as the `CROSSWALK_KEY` repo secret,
checks their shape, and falls back to the repo copies if anything is missing or malformed.
