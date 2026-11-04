# Planner themes: grade these

Nine reskins of the same planner. Layout, data and buttons are identical in all of them; only colors, type, borders, textures and small check-off moments change. Each has a light and a dark version, so the existing dark-mode button keeps working.

- **Gallery:** `gallery.html` in this folder shows the first round of eight themes. It predates the Nov 3 overhaul: Riso zine and Star chart are gone, Card catalog, Nautical chart and Seed almanac were redone, and Arcade, Chess club and Hardwood are new.
- **Try them for real:** pick one from the palette menu next to the light/dark button (just the palette icon on phones), or add `?theme=name` to the address to preview one without saving it. Names: `herbarium`, `departure`, `blueprint`, `catalog`, `nautical`, `almanac`, `arcade`, `chess`, `hardwood`.
- Your pick is saved in this browser under `rlp-skin`. Homework, check-offs and countdowns (`rlp-v1`) are untouched. The original look stays the default.

All proofs show Tuesday, Nov 3 at 6:39am (`?date=2026-11-03&time=06:39`).

| # | Theme | Idea | Files |
|---|---|---|---|
| 1 | Herbarium | a botanist's specimen collection (the one paper-and-ink theme) | `themes/herbarium.css` |
| 2 | Departure board | a European station at dawn, split-flap tiles | `themes/departure.css` |
| 3 | Blueprint | drafting table, dimension lines, title blocks | `themes/blueprint.css` |
| 4 | Card catalog | soft walnut drawers and grey-white index cards, built to be easy on the eyes | `themes/catalog.css` |
| 5 | Nautical chart | a real chart's colors: shallow-water blue, white deep water, buoy-red lights, yellow land for days off | `themes/nautical.css` |
| 6 | Seed almanac | a spring garden: pea-green page, green masthead, white seed packets | `themes/almanac.css` |
| 7 | Arcade | a retro console: notched pixel boxes, HP-bar countdown; light mode is a green handheld screen | `themes/arcade.css` |
| 8 | Chess club | a tournament hall: ivory and ebony squares, chess-clock countdown, "!!" on tests | `themes/chess.css` |
| 9 | Hardwood | game night: maple floor, royal-and-gold banners, red shot-clock countdown | `themes/hardwood.css` |

Every theme also dresses the Music card (the Spotify player) its own way.

## Grade sheet

Score 1–10. "Lives with it" means: would you still like it after a month of looking at it every day?

| | Mood | Readable at a glance | Phone | Unique | Lives with it | Overall | Notes |
|---|---|---|---|---|---|---|---|
| 1 Herbarium | | | | | | | |
| 2 Departure board | | | | | | | |
| 3 Blueprint | | | | | | | |
| 4 Card catalog | | | | | | | |
| 5 Nautical chart | | | | | | | |
| 6 Seed almanac | | | | | | | |
| 7 Arcade | | | | | | | |
| 8 Chess club | | | | | | | |
| 9 Hardwood | | | | | | | |

Mixing is fine, for example "Departure board's schedule with Herbarium's colors".

## Checks done

- Text contrast is checked automatically against WCAG AA for every visible text element in all 18 theme × mode combinations.
- Header, date and status pill fit on a 390px phone exactly as they do in the original.
- All motion turns off with Reduce Motion. The only continuous motion is the Departure board clock and its slow "due today" dot.
- Dark modes use soft, desaturated accents on neutral dark greys; saturated colors vibrate against dark backgrounds (Material Design's dark-theme guidance).
- Not themed yet: the game window (box score, play-by-play) keeps the original look.
