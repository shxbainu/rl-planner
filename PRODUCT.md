# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Brian, a student at Roxbury Latin, and only Brian. He uses it mostly on a laptop: open in a tab during the school day, and in the evenings while doing homework. Phone use is secondary.

## Product Purpose

A personal school-day dashboard: what's due and checking it off, today's class schedule (rotating A–H letter days, rooms, passing time, a live countdown), and a study mode for focused evening work. Around those sit the things he enjoys: Warriors/49ers scores, his ESPN fantasy team, news, the daily chess puzzle, debate quotes, lunch, music. Success: he opens it every day because it is the fastest true answer to "what do I have and what's next", and it is pleasant to keep open.

## Positioning

Not a generic planner. The homework is pulled from his real school portal every day by another agent (Muse, via Crosswalk) and the schedule knows Roxbury Latin's letter-day rotation, so it is correct without data entry.

## Operating Context

- Static site on GitHub Pages (https://shxbainu.github.io/rl-planner/), deployed by a GitHub Action that pulls `homework.json`, `fantasy.json` and news from Crosswalk before each build (hourly schedule plus on push).
- Vanilla HTML/CSS/JS: `index.html`, `style.css`, `paper.css` (default look), `app.js`, `themes/*.css` (optional skins), `scenes/*.webp` (study-mode rooms).
- His check-offs, added items and settings live in localStorage and sync between his devices through a JSON blob (`SYNC_URL`).
- Muse posts nightly homework updates; Claude Code applies them and deploys.

## Capabilities and Constraints

- Homework: calendar of the next two weeks, the checklist for a picked day, overdue, majors (tests, quizzes, projects), notes, done list, adding his own items.
- Schedule: letter day, period timeline with rooms and teachers, now/next card, after-school activity, day-letter override.
- Study mode: full screen, focus timer or school bell clock, the current task and queue, subject helper facts, painted room per subject whose string lights track the round.
- Extras: weather, next tests, quote of the day and quote practice, This week (focus minutes, check-offs), next break, lunch menu, sports, fantasy (recommend-only), news, countdowns, daily Lichess puzzle, Spotify/Lofi music, class links, command palette.
- Optional skins in `themes/` (10). The user said nothing about the current look is sacred; only features and data must survive.
- No build step; no framework. Keep it that way unless asked.

## Brand Commitments

None binding. The name is "Brian's RL Planner". First name only anywhere public; never his school email or sign-in details.

## Evidence on Hand

Real data only: `homework.json`, `schedule.json`, `menu.json`, `fantasy.json`, `news.json`, `quotes.json`, `links.json`. No invented assignments, scores or stats.

## Product Principles

1. Truth first: what's due and what's next must be right and visible without scrolling on a laptop.
2. Operate, don't decorate: every block earns its place by being used; the fun stuff is welcome but sits below the work.
3. Instant: checking things off and switching days must feel immediate.
4. One Brian, many devices: whatever he does on one device shows up on the other without thinking about it.
