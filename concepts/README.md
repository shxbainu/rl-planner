# Planner themes: grade these

Eight reskins of the same planner. Layout, data and buttons are identical in all of them; only colors, type, borders, textures and small check-off moments change. Each has a light and a dark version, so the existing dark-mode button keeps working.

- **Gallery:** open `gallery.html` in this folder (or the published copy) for every theme in light and dark, desktop (1440×900) and phone (390 wide), with notes.
- **Try them for real:** pick one from the palette menu next to the light/dark button (in the footer on phones), or add `?theme=name` to the address to preview one without saving it. Names: `herbarium`, `departure`, `riso`, `starchart`, `catalog`, `nautical`, `blueprint`, `almanac`.
- Your pick is saved in this browser under `rlp-skin`. Homework, check-offs and countdowns (`rlp-v1`) are untouched. The original look stays the default.

All proofs show Tuesday, Nov 3 at 6:39am (`?date=2026-11-03&time=06:39`).

| # | Theme | Idea | Files |
|---|---|---|---|
| 1 | Herbarium | a botanist's specimen collection | `themes/herbarium.css` |
| 2 | Departure board | a European station at dawn, split-flap tiles | `themes/departure.css` |
| 3 | Riso zine | two-ink student zine, classes told apart by pattern | `themes/riso.css` |
| 4 | Star chart | antique celestial atlas at night | `themes/starchart.css` |
| 5 | Card catalog | oak drawers, index cards, rubber stamps | `themes/catalog.css` |
| 6 | Nautical chart | sea, sand-colored land, waypoint route | `themes/nautical.css` |
| 7 | Blueprint | drafting table, dimension lines, title blocks | `themes/blueprint.css` |
| 8 | Seed almanac | seed packets, moon phase, a plant that grows as you finish | `themes/almanac.css` |

## Grade sheet

Score 1–10. "Lives with it" means: would you still like it after a month of looking at it every day?

| | Mood | Readable at a glance | Phone | Unique | Lives with it | Overall | Notes |
|---|---|---|---|---|---|---|---|
| 1 Herbarium | | | | | | | |
| 2 Departure board | | | | | | | |
| 3 Riso zine | | | | | | | |
| 4 Star chart | | | | | | | |
| 5 Card catalog | | | | | | | |
| 6 Nautical chart | | | | | | | |
| 7 Blueprint | | | | | | | |
| 8 Seed almanac | | | | | | | |

Mixing is fine, for example "Departure board's schedule with Herbarium's colors".

## Checks done

- Every text color passes WCAG AA in all 16 theme × mode combinations (automated check of every visible text element).
- Header, date and status pill fit on a 390px phone exactly as they do in the original.
- All motion turns off with Reduce Motion. The only continuous motion is the Departure board clock and its slow "due today" dot.
- Not themed yet: the game window (box score, play-by-play) keeps the original look.
