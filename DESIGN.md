---
name: Brian's RL Planner
description: An open binder at today's section; punched leaves on a cloth board that takes the colour of the class you're in.
colors:
  board-latin: "#77612b"
  board-eng: "#2b4f7c"
  board-msi: "#2b6650"
  board-fr: "#55407e"
  board-fgc: "#86472a"
  board-arts: "#7a3960"
  board-glee: "#21676c"
  board-health: "#5b6526"
  board-slate: "#3b4250"
  board-latin-dark: "#3d3219"
  board-eng-dark: "#192c45"
  board-msi-dark: "#173628"
  board-fr-dark: "#2b2143"
  board-fgc-dark: "#45261a"
  board-arts-dark: "#3f1d31"
  board-glee-dark: "#123638"
  board-health-dark: "#2f3516"
  board-slate-dark: "#22262e"
  on-board: "#f6f2e7"
  leaf: "#fbf8ef"
  leaf-2: "#f2eee2"
  leaf-rule: "#ddd6c4"
  ink: "#1b1a17"
  ink-muted: "#4f4b42"
  ink-faint: "#6f6a5e"
  ink-done: "#8f897b"
  leaf-dark: "#1f1e1b"
  leaf-2-dark: "#282723"
  leaf-rule-dark: "#3a3832"
  ink-dark: "#efe9db"
  ink-muted-dark: "#c5bfaf"
  ink-faint-dark: "#9d9789"
  plate: "#1b1a17"
  plate-dark: "#0f0e0c"
  plate-sub: "#c9c3b3"
  errata: "#c8321f"
  errata-soft: "#f7e2dc"
  errata-dark: "#f07b62"
  tab-latin: "#8a5a00"
  tab-eng: "#1f5fa8"
  tab-msi: "#2c7a4b"
  tab-fr: "#5b3fa6"
  tab-fgc: "#b4471a"
  tab-arts: "#a2357a"
  tab-glee: "#0f7c84"
  tab-health: "#6b7a1f"
  tab-other: "#5f6b73"
  tab-latin-dark: "#e0b25a"
  tab-eng-dark: "#7fb2ee"
  tab-msi-dark: "#79cf9b"
  tab-fr-dark: "#b7a2f0"
  tab-fgc-dark: "#f0925f"
  tab-arts-dark: "#e98bc6"
  tab-glee-dark: "#6fd0d6"
  tab-health-dark: "#c3d36a"
  tab-other-dark: "#a9b4bb"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  numeral:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "46px"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Archivo Narrow, Archivo, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo Narrow, Archivo, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.06em"
  label-sm:
    fontFamily: "Archivo Narrow, Archivo, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.04em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  slip: "1px"
  chip: "2px"
  leaf: "3px"
  button: "4px"
  tab: "6px"
  hole: "50%"
spacing:
  hole-gutter: "34px"
  gutter: "22px"
  leaf-gap: "18px"
  leaf-pad: "16px"
  gutter-phone: "12px"
  row: "11px"
  rail: "96px"
components:
  leaf:
    backgroundColor: "{colors.leaf}"
    textColor: "{colors.ink}"
    rounded: "{rounded.leaf}"
    padding: "16px 18px 16px 34px"
  button:
    backgroundColor: "{colors.leaf}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.leaf}"
    rounded: "{rounded.button}"
  chip:
    backgroundColor: "{colors.tab-eng}"
    textColor: "#ffffff"
    typography: "{typography.label-sm}"
    rounded: "{rounded.chip}"
    padding: "0 6px"
  now-plate:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.on-board}"
    rounded: "{rounded.chip}"
    padding: "14px 16px"
  tab:
    backgroundColor: "{colors.tab-msi}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.tab}"
    padding: "6px 10px 6px 12px"
    height: "44px"
  errata-slip:
    backgroundColor: "{colors.errata}"
    textColor: "#ffffff"
    rounded: "{rounded.slip}"
    padding: "5px 14px 5px 12px"
  check:
    backgroundColor: "{colors.leaf}"
    rounded: "{rounded.chip}"
    size: "20px"
  check-punched:
    backgroundColor: "{colors.board-msi}"
    rounded: "{rounded.hole}"
    size: "20px"
---

# Design System: Brian's RL Planner

> **Update (Nov 19, 2026):** At Brian's request the look got more life and less rigidity. Headings, the date, the countdown and tab labels are now **Bricolage Grotesque** in sentence case, and body, labels and item titles are **Figtree**. Archivo and Archivo Narrow caps are retired, and IBM Plex Mono is still for times only. Homework is the focus: titles are 17.5px, checkboxes are 24px rounded and outlined in the subject colour, and rows get a subject-colour wash on hover. Every leaf carries a coloured divider tab above its heading (`--tab`), so the palette goes beyond ink on cream. The page fills the full width (no 1560px cap) with the tab rail on the screen edge, and leaves and buttons have softer 9–10px corners. Where this note conflicts with the sections below, this note wins.

## Overview

**Creative North Star: "The Open Binder"**

The planner is a ring binder lying open at today's section. Every work area is a milk-white leaf with two punch holes down its bound edge, lying on one coloured section board. The board is bookcloth: a procedural cloth tile (`assets/cloth.png`, 128px, made by `tools/make-cloth.py`) soft-light blended over a deep, low-chroma hue that belongs to the class Brian is in, or heading to. Before and after school, on free periods and evenings the board is slate. At each bell the board changes cloth, and the schedule itself is the binder's tab rail: today's periods as divider tabs, sized by length, coloured by subject, the live one pulled out.

Density is operational: ruled rows, no floating cards, no tinted wells. Leaves carry content; the board carries only the bar, the tab rail and the link row. Motion is mechanical, like a tab hinge or a hole punch: stepped, short, never smooth, with one eased exception (the board fade at a bell).

The whole world lives in `tabboard.css`, scoped to `:root:not([data-skin])`; the optional skins in `themes/` are separate alternates and are not part of this system. `app.js` `renderTabs()` sets `data-sect` (board colour), builds `#tabrail`, and sets `data-only` when a tab is picked.

**Key Characteristics:**
- One cloth board per class hue, slate when no class is on; white leaves sit calmly on it all day.
- Punched leaves: two holes on the bound edge show the board's own cloth through the paper.
- The schedule is a physical tab rail on the fore edge; the live class is the extended tab.
- Narrow caps for section heads and tab labels; mono only for times.
- Stepped motion (two frames, 90ms); the board's 600ms fade at a bell is the only eased transition.
- Vermilion means overdue. Nothing is bright yellow.

## Colors

Deep bookcloth boards, milk-white paper, near-black ink, a wheel of mid-value subject hues for tabs and chips, and a single vermilion reserved for errata.

### Primary
- **Section Board Cloth** (`board-*`): the page ground under everything, picked by `data-sect` from the current or next class: Latin ochre-olive, English navy, MSI forest, French plum, FGC rust, Arts mulberry, Glee teal, Health moss, and **Slate** (`board-slate`) for no class. Dark mode swaps each for a deeper `*-dark` sibling. Always rendered with the cloth tile soft-light blended over it, never as flat fill. The board also cuts into leaves: punch holes, the punched check box, today's calendar cell, the This-week bars, and the chess dark squares (62% board mixed with parchment).

### Secondary
- **Tab Wheel** (`tab-*`): one mid-value hue per subject, read from base `--c-*` and passed to elements as `--cc`. Used solid on tab-rail tabs, subject chips, schedule period blocks, calendar count flags, the major-item dot, and the now-plate progress bar. White text on light-mode tabs; near-black (#14130f) on the lighter dark-mode hues.

### Tertiary
- **Errata Vermilion** (`errata`, dark `errata-dark`): overdue only. The errata slip, overdue "next" text, the due quote-practice key, and the phone calendar's overdue underline.

### Neutral
- **Milk Leaf** (`leaf`) and **Leaf Shade** (`leaf-2`): leaf paper and its hovered or selected wash.
- **Leaf Rule** (`leaf-rule`): every ruled row, cell divider and hole ring.
- **Ink** (`ink`) with **Muted**, **Faint** and **Done** steps: text, 1.5px outline rules, the primary button, the 2px heavy rules that open the calendar and agenda.
- **On-Board** (`on-board`, plus 74% alpha for secondary): text set directly on the cloth (date, sub-line, status).
- **Plate Ink** (`plate`, dark `plate-dark`, sub-text `plate-sub`): the solid now-plate; stays black in both modes.

### Named Rules
**The No Bright Yellow Rule.** Brian rejected bright yellow: it hurts. Every board is deep and low-chroma, and Latin, the warmest subject, sits at ochre-olive on the board and dark ochre on its tab. No new surface, highlight or state may introduce a saturated yellow.

**The Board Is the Class Rule.** The board colour is information, not decoration: it always equals the current or next class's hue (or slate). Never set it for style.

**The One Red Rule.** Vermilion is reserved for overdue and errata. Other warnings use ink.

## Typography

**Display Font:** Archivo (with system-ui)
**Body Font:** Archivo (with system-ui, -apple-system, Segoe UI)
**Label Font:** Archivo Narrow, uppercase
**Mono Font:** IBM Plex Mono (with ui-monospace, Menlo)

**Character:** A sturdy grotesque at heavy weights for dates and countdowns, its narrow cut in spaced caps for the things a binder would print on a tab, and a plain mono for clock times.

### Hierarchy
- **Display** (800, 22px, 1.15, -0.015em): the date on the board; 20px on phones. The day letter picker uses the same face at 24px.
- **Numeral** (800, 46px, 0.95, tabular): the now-plate countdown. Calendar counts use 800 at 20px (17px on phones), the weather temperature 800 at 18px.
- **Headline** (Archivo Narrow 700, 16px, 0.06em, uppercase): leaf section heads (h2) and feed heads; group and agenda heads at 15px.
- **Title** (600, 15.5px, 1.3): checklist item titles; schedule class names at 14.5px.
- **Body** (400, 14.5px, 1.5): leaf text; details at 13px in Muted.
- **Label** (Archivo Narrow 700, 13px, 0.06em, uppercase): tab-rail labels. Small labels (11px, 0.04 to 0.08em) for chips, tags, calendar weekdays and the Today leaf's left label column.
- **Mono** (IBM Plex Mono 400, 12px): times only: schedule period times, tab start times (500, 11px), game-night time.

### Named Rules
**The Tab Caps Rule.** Uppercase spaced Narrow is for things that would be printed on a tab or a section divider: leaf heads, tab labels, chips, row labels. Never for sentences.

**The Mono Is a Clock Rule.** Plex Mono sets times. Countdowns and counts use tabular Archivo heavy, not mono.

## Layout

The board is the page. A slim bar sits on the cloth (14px 22px padding), then on laptops the tab rail moves to the fore edge and the dashboard is two columns of leaves: Homework wide on the left (1.45fr, 1.5fr from 1280px), the day on the right (min 320px, 360px from 1280px), the link row under Homework, and the feed leaves packed below in CSS columns (330px, 18px gap). Leaves are spaced 18px apart with a 22px board gutter (12px on phones). The page scrolls like a page; it never locks to one screen.

Inside a leaf, content clears a 34px bound-edge gutter (30px on phones) that holds the punch holes. Rows are ruled with Leaf Rule and padded 11px vertically; lists have no gap between rows.

**Tab rail, three states:**
- **≥1180px (fore edge):** fixed to the right edge, full height, 96px wide; body gains 96px right padding. Tabs stack vertically, height proportional to period length (min 44px), squared on the bound side and rounded 6px on the free side. Resting tabs are tucked in 12px; hover pulls one out to 6px; the live tab is fully extended (0) and adds "now" on its own line.
- **760 to 1179px (top strip):** a horizontal row under the bar, tabs widths by length (min 64px), rounded on top only. Resting tabs sit 5px low (hanging behind the leaf); hover lifts to 2px; the live tab stands at 0 with an on-board inner rule and appends "· now". Scrolls sideways if needed.
- **Phones (≤759px):** the same top strip with 12px gutters. Past tabs desaturate in every state; lunch is a disabled tab.

Picking a tab sets `data-only` and filters the checklist to that class; the agenda head says so, and picking again clears it.

Breakpoints: 559px (bar wraps, Today labels stack above values), 759/760px (phone vs. laptop), 900px (two-column dashboard), 1180px (fore-edge rail), 1280px (wider columns, max 1560px).

## Elevation & Depth

Depth is physical: paper on cloth. Leaves are the only lifted surfaces, with one short hard offset on the cut side (paper thickness) plus a soft ambient fall-off. Punch holes are inset into the leaf. Items sitting on the board itself (link tabs, the day letter, the Add button) get a soft lift with no hard offset. Inside a leaf, everything is flat: rules and ink frames, never shadows.

### Shadow Vocabulary
- **Leaf** (`box-shadow: 3px 3px 0 rgb(0 0 0 / .2), 0 10px 24px -14px rgb(0 0 0 / .45)`; dark `3px 3px 0 rgb(0 0 0 / .35), 0 12px 26px -14px rgb(0 0 0 / .7)`): every leaf and the game-night strip.
- **Fore-edge tab** (`inset 3px 0 0 rgb(0 0 0 / .15), 2px 2px 0 rgb(0 0 0 / .18)`; live `3px 3px 0 rgb(0 0 0 / .22)`): tabs on the ≥1180px rail.
- **Strip tab** (`inset 0 -3px 0 rgb(0 0 0 / .18)`; live adds `0 4px 10px -4px rgb(0 0 0 / .5)`): tabs in the top strip.
- **On-board lift** (`0 1px 2px rgb(0 0 0 / .18), 0 6px 14px -8px rgb(0 0 0 / .45)`): link tabs, the day letter, the primary bar button.
- **Hole** (`inset 2px 2px 3px rgb(0 0 0 / .5)`): punch holes and the punched check box.

### Named Rules
**The Hard Edge Is Paper Rule.** A hard offset shadow appears only on leaves and tabs, where it is the thickness of paper or card. Nothing else gets one: not buttons, not chips, not the now-plate.

## Shapes

Nearly square. Paper and card corners are barely softened: leaves 3px, buttons 4px, chips, tags and the now-plate 2px, the errata slip 1px. The only round forms are punch holes and a punched check box (50%), and the fore-edge tab's free corners (6px). Rules carry structure: 1px Leaf Rule between rows, 2px Ink rules opening the calendar and agenda, 1.5px Ink outlines on buttons and tags.

**Punched holes:** two 14px circles, 10px from the bound edge, 54px and 122px from the top (the second is omitted on a leaf with a single child). Each shows the board cloth through, with an inset shadow, a 2px Leaf Shade ring and a 1px Leaf Rule ring.

## Components

### Leaves
Milk paper on cloth, punched on the left.
- **Corner Style:** 3px.
- **Background:** Milk Leaf; padding 16px 18px 16px 34px (14px 14px 14px 30px on phones).
- **Shadow Strategy:** the Leaf shadow; see Elevation.
- **Holes:** two punched holes in the bound gutter, as in Shapes.

### Buttons
Leaf-white with an ink rule; they step, they don't ease.
- **Shape:** 4px, 1.5px Ink border, weight 700.
- **Primary:** solid Ink with Milk Leaf text. On the board bar the primary flips to Milk Leaf with the on-board lift.
- **Active:** nudges 1px down-right over 90ms in two frames.
- **Small icon button:** 1px Leaf Rule border, Ink on hover. Icons are drawn SVG, 16px.

### Chips and Tags
- **Subject chip:** solid tab hue, white Narrow caps 11px, 2px corners, like a coloured tab edge.
- **Tag:** transparent with a 1.5px currentColor border, Narrow caps 10px; vermilion when bad, dashed and Faint when unsure.

### Checklist and the Check-off Punch
- **Rows:** ruled, 22px check column, 14px gap, 11px vertical padding.
- **Check box:** 20px, 2px Ink border, 2px corners, Milk Leaf fill; border takes the subject hue on hover.
- **Checked:** the box is punched out: it becomes a round hole filled with the board colour and the hole inset shadow, with a 420ms spring scale from 0.55 (`--pop`). The title strikes in place with a 1.5px ink line drawn across in three steps over 180ms and fades to Done. Nothing moves away.
- **Major items:** a 7px dot in the subject hue after the title.

### The Errata Slip
Overdue is a vermilion slip tucked onto the Homework leaf, not a banner: solid Errata, white 700 13px text, 1px corners, the right end notched with a 6px V cut, rotated -1.2deg with a small drop shadow. Hover straightens it.

### Calendar
A ruled grid under a 2px Ink rule. Weekday heads in Faint Narrow caps over a 1px Ink line. Today is cut from the board cloth with on-board text; the picked day gets a 2px inset Ink frame; past days fade to 50%; off days use Leaf Shade.

### The Now-Plate
Solid black plate at the top of the Schedule leaf (stays black in dark mode): class name 700 15px, the big countdown in Numeral on the right, sub-line in Plate Sub, and a flat 6px progress bar in the class hue on 14% white. No shadow, 2px corners.

### Schedule List
Ruled period rows: a 30px by 22px subject block (tab hue, Narrow 12px, squared on the right), class name, teacher in Faint, time in Mono. The current period gets Leaf Shade and a 1.5px inset Ink frame; past rows fade to 48%; free and event blocks are dashed outlines.

### Tab Rail
Today's classes as divider tabs; see Layout for the three responsive states. Tabs are solid subject hue with white Narrow caps labels and a Mono start time. A picked tab gets a 2px on-board outline inset 4px.

### Navigation (tabs and segments inside leaves)
Pane tabs sit on a 2px Ink rule; the selected one is a solid Ink block with Milk Leaf text. Segmented controls are Leaf Shade wells with a solid Ink indicator.

### Motion
Motion is mechanical: stepped, short, two frames.
- **Default:** `steps(2)` at 90ms for button press, link-tab lift, and tab rail movement in the top strip. Calendar cell hover steps over 100ms.
- **Board fade at a bell:** `background-color` 600ms `ease-out` on the body and bar, the only eased transition. It is gated by `data-sect-ready`, which `app.js` sets two frames after first paint, so the board never fades on page load.
- **Check-off punch:** a keyframed 420ms spring (`--pop`, a `linear()` overshoot curve), the one sanctioned bounce, paired with a three-step strike.
- **Reduced motion:** all transitions and animations are removed.

## Do's and Don'ts

### Do:
- **Do** set the board only through `data-sect`, from the current or next class, and slate otherwise.
- **Do** render the board as the cloth tile soft-light blended over the board hue, everywhere the board shows (page, bar, holes, today's cell, punched checks).
- **Do** put work on leaves: milk paper, 3px corners, two punch holes in a 34px bound gutter, the Leaf shadow.
- **Do** set section heads and tab labels in Archivo Narrow 700 uppercase with 0.04 to 0.08em tracking, and times in IBM Plex Mono.
- **Do** move in two steps at 90ms; the 600ms board fade at a bell is the only eased exception, and only after `data-sect-ready`.
- **Do** keep the live class's tab extended and the board equal to its hue.
- **Do** draw icons as inline SVG strokes.

### Don't:
- **Don't** use bright yellow anywhere: no yellow board, highlight, badge or state.
- **Don't** put a hard offset shadow on anything but leaves and tabs.
- **Don't** use vermilion for anything but overdue and errata.
- **Don't** float tinted cards on the board or nest boxed wells inside leaves; rule rows instead.
- **Don't** ease the world's own motion, and don't let the board fade on page load.
- **Don't** move a checked item away; it strikes in place.
- **Don't** apply these rules to the skins in `themes/`; they are separate alternates.
