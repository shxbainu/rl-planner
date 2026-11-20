---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["style.css","app.js"]
---

# Surface brief: RL Planner dashboard (index.html)

Mode: Operate. Laptop first (open all school day and evenings), phone second.
Job: fastest true answer to "what do I have and what's next", plus the fun cards below. Full dashboard stays: calendar + checklist, schedule + now card, Today board, links, lunch, week/tests/quotes, music, chess, sports, fantasy, news, countdowns, study mode.
Chosen: Tab Board (bolder re-roll, Brian picked it over Night Console and Spectrum Rail).
Memorable moment: today's classes as divider tabs down the right edge; the current one is pulled out.

## Direction contract

THESIS: The planner is an open binder at today's section. It refuses the category default of cards floating on a tinted ground: here every work area is a punched leaf lying on one coloured section board, and the schedule is the binder's own tab rail.

OWN-WORLD: No bright yellow (Brian: it hurts). The section board is the current class's tab hue as deep, low-chroma bookcloth (e.g. Latin moss, English navy, MSI rust, French plum, FGC teal, Art umber), changing at each bell; before/after school and evenings it is slate. The pulled-out tab becomes the board. Board tokens stay dark enough that white leaves sit calmly on it all day; milk-white leaves (#fbf8ee) with two punch holes and one short hard shadow on the cut side; ink #1a1a1a; subject hues from the tab wheel (oxide orange, ultramarine, grass, violet, teal, sienna); vermilion only for overdue/errata. Archivo for UI and headings, Archivo Narrow caps for section heads and tab labels, IBM Plex Mono only for times, counts and scores. Drawn SVG icons, one 1.8 stroke.

STORY: Brian sees the date and day letter, the pulled-out tab tells him which class he is in and how long is left, the leaf under it lists what is due; he checks items off in place, then scrolls to lunch, the puzzle, scores and fantasy.

FIRST VIEWPORT: Top: day letter block, date, sync status, Add and Study buttons on the board. Left leaf (wide): Homework, two-week calendar grid then the picked day's checklist. Right column: Schedule leaf with the black now-plate (class, room, big countdown, progress) and period list, then the Today leaf (weather, next up, quote, this week, next break). Fore edge, fixed right: stepped tab rail of today's periods, height by length, hue by subject, current tab extended. Below the fold: icon link row, then the feed leaves.

FORM: rw-manual-acetate-tab-board, challenger in the bolder register, list position: dealt challenger 2 of 6; seed:ea03fcc70c2d9c65

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction and motion
- Tab rail: current tab extended; at each bell the next tab steps out in a 90ms two-frame hinge (steps(2)), no easing anywhere in the world's own motion.
- Check-off: the box is punched: a round hole opens showing the board colour through the leaf, small bounce, the row strikes in place (nothing moves away).
- Board change: at each bell the board cross-fades to the new class's cloth (the one eased exception, 600ms), together with the tab step.
- Overdue is an errata slip: a vermilion slip tucked on the homework leaf, not a pink banner.
- Tabs are live: clicking a class tab filters the checklist to that subject; click again to clear.
- Reduced motion: hinges become instant.

## Unresolved
- Sync backend (SYNC_URL empty).
- Whether the 10 optional skins survive; default look is replaced, skins untouched for now.
