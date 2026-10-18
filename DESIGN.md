---
name: bubble (Tutor Engine)
description: Short practice missions for children 5–14 in six swappable worlds starring Bloop. The tokens below are the Build Steps world, which is also the base every world overrides.
colors:
  page: "#ffffff"
  ink: "#111318"
  ink-2: "#444a57"
  ink-3: "#5a6070"
  rule: "#d9dce3"
  parts: "#eef0f4"
  parts-2: "#dfe2e9"
  yellow: "#ffcf00"
  yellow-side: "#b89400"
  yellow-wash: "#fff5c7"
  blue: "#0a5bd3"
  blue-side: "#063f96"
  blue-wash: "#e4eefc"
  green: "#157a3a"
  green-side: "#0b4f24"
  green-wash: "#e1f2e6"
  red: "#c8261c"
  red-wash: "#fde8e5"
typography:
  display:
    fontFamily: "Lexend, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 2.2vw, 2.55rem)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  numeral:
    fontFamily: "\"Archivo Black\", Lexend, ui-sans-serif, sans-serif"
    fontSize: "clamp(64px, 14vw, 96px)"
    fontWeight: 400
    lineHeight: 0.8
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Lexend, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.45rem, 1.1rem + 1.6vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "Lexend, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Lexend, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
  label:
    fontFamily: "Lexend, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  brick-small: "9px"
  field: "10px"
  brick: "12px"
  tile: "14px"
  box: "16px"
  booklet: "18px"
  chip: "999px"
spacing:
  gutter: "20px"
  gutter-phone: "16px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.page}"
    typography: "{typography.label}"
    rounded: "{rounded.brick}"
    padding: "0 20px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "#126a32"
  button-go:
    backgroundColor: "{colors.green}"
    textColor: "{colors.page}"
    rounded: "{rounded.tile}"
    height: "64px"
    width: "100%"
  button-ghost:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.brick}"
    padding: "0 20px"
    height: "48px"
  button-ghost-hover:
    backgroundColor: "{colors.parts}"
  button-danger:
    backgroundColor: "{colors.red}"
    textColor: "{colors.page}"
    rounded: "{rounded.brick}"
    height: "48px"
  chip:
    backgroundColor: "{colors.parts}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chip}"
    padding: "4px 14px"
    height: "44px"
  chip-hover:
    backgroundColor: "{colors.yellow-wash}"
  input:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 14px"
    height: "48px"
  answer-input:
    backgroundColor: "{colors.parts}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    height: "64px"
  nav-tab:
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 14px"
    height: "44px"
  nav-tab-current:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.ink}"
  plan-brick-together:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.brick-small}"
    height: "44px"
  plan-brick-own:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.page}"
    rounded: "{rounded.brick-small}"
    height: "44px"
  plan-brick-review:
    backgroundColor: "{colors.green}"
    textColor: "{colors.page}"
    rounded: "{rounded.brick-small}"
    height: "44px"
  parts-box:
    backgroundColor: "{colors.parts}"
    rounded: "{rounded.box}"
    padding: "22px"
  booklet-box:
    backgroundColor: "{colors.page}"
    rounded: "{rounded.booklet}"
    padding: "22px"
---

# Design System: bubble (Tutor Engine)

## Overview

**Creative North Star: "The Instruction Booklet"**

Every mission is a page from a brick-building instruction booklet. White pages, ink outlines at 2px, one big numbered step at a time, a grey parts box for what you need, a callout box with a pointer for a clue, and coloured bricks that say who did the work. The world refuses the soft pastel learning-app card stack: no gradients, no floating blurred cards, no decoration that is not a brick, a box, or a number.

Density follows the reader. Ages 5–7 get bigger type, 64px targets and almost no words; 11–14 get calmer, denser pages; scoring is identical across bands. The child sees one build and one main action; the parent reads the same bricks as a record of what was built alone and what needs them.

Depth is physical, not atmospheric: a brick has a darker side face under it and presses down when tapped. That is the system's only lift.

**Key Characteristics:**
- White page, ink (`#111318`) 2px outlines on every interactive or framing element.
- Four brick colours with fixed meanings (yellow together, blue on your own, green go and look back, red outline missed).
- Lexend for all words; Archivo Black only for numerals (step numbers, plan bricks, counts, durations).
- One green primary brick per screen.
- Self-hosted fonts and assets under a strict CSP.

## Worlds

Each child picks one of six worlds (`students.world`, `src/worlds.ts`). Every world uses the same layout, components, copy and learning behaviour; only tokens and a few signature touches change. A page without a world (sign-in, the family list) shows Cartoon Club, the default.

| World | Display / body fonts | Main action | Together / own / look back markers | Signature |
|---|---|---|---|---|
| Cartoon Club (default) | Bangers / Nunito | hot pink `#e6007e` | yellow star / pink star / cyan burst | 3px ink outlines, offset comic shadows, tilted mission card, yellow headline shadow |
| 8-Bit Dreamland | Pixelify Sans / Nunito | NES orange `#c84c0c` | pixel heart / gold coin / emerald | 4px black outlines, notched pixel corners, bevelled buttons, pixelated art |
| Toy Box | Fredoka | toy green `#158a3e` | orange block / purple block / green ring | no outlines, glossy jelly buttons, soft lifted shadows |
| Sticker Scrapbook | Patrick Hand / Nunito | tomato `#d63a12` | star / planet / strawberry stickers | white die-cut rings on buttons, washi tape on the mission card, slight paper tilt |
| Princess Land | Cherry Bomb One / Nunito | raspberry `#c2185b` | pink gem / purple gem / gold crown | gold double frames, jewel gradient buttons |
| Build Steps | Lexend / Archivo Black | green `#157a3a` | yellow / blue / green bricks | the booklet world documented below |

Rules that hold in every world:
- **Same meaning, different look.** The role tokens keep their names (`--yellow` together, `--blue` own, `--green` the main action and look back) while each world gives them its own colours and icons. Keys show the marker itself, never a colour name.
- **One main action per screen** is whatever the world paints with `--green`.
- **Content sits on a see-through screen.** In patterned worlds `main` is a 92% card over the pattern, so text never sits on the pattern itself.
- **The question leads.** The topic label above a question is a quiet 600-weight line in every world.
- **Bloop** is the only character: four poses per world (`wave`, `think`, `cheer`, `oops`) chosen by the moment, plus a hero scene behind the greeting. A right answer makes Bloop jump; reduced motion stops it.
- **Assets** live in `public/worlds/<world>/` (`bloop-*.webp`, `pattern.webp`, `hero.webp`, `step-*.webp`) and are original art. No existing game characters or level art.
- **Styles are generated.** Edit `scripts/build-worlds-css.py` and run it; it rewrites the Worlds block of `public/app.css`. Selectors use `:root:has([data-world="…"])`.

## Colors

Primary bricks on white paper with ink lines; every saturated colour carries a meaning, and each has a darker side face and a pale wash.

### Primary
- **Go Green** (green, side green-side, wash green-wash): the one primary action per screen (Let's go, Check, Enter) and "look back" review steps. The wash marks a correct answer, a ready pack, and a due review leading the More to do list.
- **On-Your-Own Blue** (blue, side blue-side, wash blue-wash): a step done or to be done alone; the only colour that counts toward "learned". Also the focus ring, caret, checkbox accent, and the parent note box. Link text uses blue-side.

### Secondary
- **Together Yellow** (yellow, side yellow-side, wash yellow-wash): a step done together, with a clue, or with help. Also the selected state for choices, durations and pack options, the current nav tab, the brand brick, text selection, and banners/resume strips in wash.

### Tertiary
- **Missed Red** (red, wash red-wash): appears as an outline over its wash, never as a filled brick, for a missed step and a failed pack or class build. A filled red only on the destructive button.

### Neutral
- **Ink** (ink): text, every outline, the header and section rules.
- **Ink 2 / Ink 3** (ink-2, ink-3): secondary copy, ledes, captions, map connector strokes.
- **Rule** (rule): 1px dividers between list rows.
- **Parts Grey** (parts, parts-2): the parts box background, ghost-button side face, chip fill and border, hover fill.
- **Page** (page): every surface; there is no dark theme (`color-scheme: light`).

### Named Rules
**The Brick Meaning Rule.** Yellow is together / with a clue / with help. Blue is on your own. Green is go and look back. Red outline is missed. A brick colour never appears without its meaning; plan bricks, progress stones, step tags, build-log bricks and strength marks all speak this one language.

**The One Green Rule.** Each screen has exactly one green brick, the main action. Everything else is a ghost brick (white with ink outline) or a link. On the learner home, practice-asking stays ghost so the mission's Let's go is the only green.

## Typography

**Body Font:** Lexend (self-hosted variable, 400–700, with ui-sans-serif, system-ui fallback)
**Numeral Font:** Archivo Black (self-hosted, 400, with Lexend fallback)

**Character:** Lexend is wide, plain and easy for early readers; Archivo Black is the heavy printed step number of an instruction booklet. Body runs tabular numerals throughout.

### Hierarchy
- **Display** (700, clamp 1.75–2.55rem, 1.08, -0.02em): page h1; balanced wrapping. Greeting h1 and mission title use a smaller clamp (to 2.2rem and 2.1rem).
- **Numeral** (Archivo Black 400, clamp 64–96px, 0.8, -0.04em): the step number beside each question. The same face at 16–24px sets plan bricks, choice letters, duration and count tiles, parent counts, and measure values.
- **Headline** (700, clamp 1.45–2rem, 1.25): the question text.
- **Title** (700, 1.3rem, 1.2): h2 section heads; h3 at 1.05rem/1.3.
- **Body** (400, 17px, 1.55): all copy. Lede 1.12rem in ink-2, max 40rem. Fine print 0.85rem in ink-3.
- **Label** (600, 15px): form labels, nav tabs, links-as-buttons. Buttons are 700 16px.

### Named Rules
**The Numerals-Only Rule.** Archivo Black sets numbers and the wordmark, never sentences or headings.

**The No-Kicker Rule.** No eyebrow, kicker or overline labels above headings, and no uppercase tracked micro-labels. A heading stands on its own; status is a step tag or a brick, never a label stacked over a title.

## Layout

A single centred column: header and main share `min(1120px, 100% - 2 × gutter)` (gutter 20px, 16px on phones). Learner pages narrow to 760px. The header is a 72px row (64px on phones) closed by a 2px ink rule. Main pads 8px top, 72px bottom.

Sections are separated by 2px ink top rules (More to do, This week, controls, metrics) and list rows by 1px rule lines, like a printed booklet, rather than by stacked cards. Measures read as labelled rows, not big-number tiles. Grids use `auto-fill`/`auto-fit` with minmax (plan bricks 38px, choices 140px, week trail 200px, family progress 260px).

Breakpoints: at 900px and up, More to do splits into two columns and the mission box pads 28px. At 750px and below, two-column panels collapse to one, page-wide actions go full width, and the learner tabs become a fixed bottom bar. At 380px parent actions drop to a single column.

**The Bottom Tabs Rule.** On phones (≤750px) the learner tabs are a fixed bottom bar: white, 2px ink top rule, equal columns, 56px icon-over-label tabs, safe-area padding, and main gets 110px bottom clearance. While a question or answer review is on screen the bar steps aside entirely; Save & stop is the way out.

**The Age Band Rule.** 5–7 (`data-band="5-7"`): base 21px, every button and nav tab 64px tall, choices 76px at 28px type, question text up to 2.4rem, ledes, fine print and the mission key hidden. 11–14: base 16px, buttons 44px at 15px, question text 1.35rem, step number 64px. The junior presentation sits between at 19px and 56px buttons. Every band keeps 44px minimum targets.

## Elevation & Depth

Flat white paper with physical bricks. The only lift is a solid same-hue side face under a brick, and it is part of the brick, not a shadow cast on the page. Pressing a button pushes it down 3px and shrinks the side face. Selected choices, durations, plan bricks and done stones carry the side face inset at the bottom edge. The current progress stone lifts 3px with an ink face under it. Soft ambient blur appears only on overlays: the sticky lesson start bar and the planner drawer.

### Shadow Vocabulary
- **Brick side face** (`box-shadow: 0 4px 0 var(--green-side)`; ghost `0 3px 0 var(--parts-2)`; danger `0 4px 0 #7f150f`): every button at rest.
- **Pressed brick** (`transform: translateY(3px); box-shadow: 0 1px 0 var(--green-side)`): button active.
- **Inset brick face** (`box-shadow: inset 0 -5px 0 var(--<colour>-side)`, 4px on smaller bricks): plan bricks, selected options, done stones, strength marks.
- **Current stone** (`box-shadow: inset 0 -4px 0 var(--brick-side), 0 3px 0 var(--ink); transform: translateY(-3px)`): the step you are on.
- **Overlay** (`0 8px 24px rgba(17,19,24,.12)`; drawer `-10px 0 30px rgba(17,19,24,.14)`, phone sheet `0 -10px 30px rgba(17,19,24,.16)`): sticky lesson bar and planner drawer only.

### Named Rules
**The Side-Face Rule.** A side face is the darker side of the same brick colour, offset straight down, with no blur. Never a black or grey offset slab on a content card, and never a blurred drop shadow on page content.

## Shapes

Rounded bricks and boxes, never pills except chips. Radii step by size: 9px plan bricks and keepsakes, 10px fields and tabs, 12px buttons and callouts, 14px answer tiles and choices, 16px parts boxes and cards, 18px booklet boxes (mission, prompt, build log, map viewport). Small marks (stones, build-log bricks, strength marks) are 4–5px. Every framing edge is a 2px ink line; dashed outlines mean waiting or empty, dotted mean pending review. The clue callout carries a rotated-square pointer at its top edge, like a booklet callout.

## Components

### Buttons
Tactile bricks that press down.
- **Shape:** 12px radius, 2px ink outline, 48px minimum height and width, 20px side padding, 700 16px.
- **Primary:** green with white text and a green-side face. The mission's Let's go and the answer Check grow to full width, 62–64px tall, 20px type, 14px radius.
- **Hover / Focus / Active:** hover darkens to `#126a32`; focus is a 3px blue outline offset 3px; active presses 3px down. Transitions 120ms with the out-ease.
- **Ghost:** white, ink text, parts-2 side face; hover fills parts grey. The default for every secondary action.
- **Danger:** red fill with a dark red side face, destructive actions only.
- **Link-like:** 44px tall underlined blue-side text, no brick.

### Chips
- **Style:** parts-grey pill, 2px parts-2 border, 600 14px, 44px tall.
- **State:** hover turns yellow wash with a yellow-side border.

### Cards / Containers
- **Parts box:** parts grey, 16px radius, 22px padding (18px on phones), no outline. Holds what you need: forms, practice asking, measures.
- **Booklet box:** white, 2px ink outline, 18px radius, 22px padding. The mission, the question prompt, the build log.
- **Callouts:** 12px radius, 2px outline, 14–16px padding. Correct and celebration use green wash with green border; a miss uses yellow wash with yellow-side border (encouraging, not red); a hint is white with ink outline and pointer; a re-ask is blue wash with blue border.
- **Shadow Strategy:** none on boxes; see Elevation.

### Inputs / Fields
- **Style:** white, 2px `#9aa0ae` border, 10px radius, 48px tall, 400 17px; hover darkens the border to ink-3.
- **Focus:** border goes ink plus a 3px blue outline offset 2px; caret is blue.
- **Answer field:** parts-grey fill, ink border, 14px radius, 64px tall, 700 28px.
- **Choices:** 60px tiles with ink outline and a numeral letter square; checked turns yellow with an inset side face and an ink letter square.

### Navigation
- **Desktop/tablet:** a row of 44px tabs with a 20px line icon and 600 15px label; hover parts grey; current is a yellow tab with ink outline. The parent link sits at the far right with a parts-2 outline.
- **Phone:** the fixed bottom tab bar (see Layout), hidden during questions.

### Mission Plan (signature)
A row of 44px numbered bricks in Archivo Black, ink-outlined with inset side faces, one per step, coloured by who does it: yellow together, blue on your own, green look back. A small key below names the colours (hidden for 5–7).

### Progress Stones (signature)
30×18px bricks across the top of a question. Upcoming stones are an outline of their colour over a 14% tint; done stones fill with ink outline and side face; the current stone is ink-outlined at 3px, lifted 3px, and snaps in.

### Step Head (signature)
The giant Archivo Black step number beside a step tag (ink-outlined 8px-radius label in the brick colour of the step) and the topic, above the question text.

### Build Log (signature)
Parent record of recent missions: date, title, and a row of 20×14px bricks per mission, blue alone, yellow with help, green remembered later, red outline over red wash for missed, dotted for pending, dashed grey for not yet done, with a colour key underneath.

### Motion
One authored moment, a brick snapping into place (`snap-in`: from 8px up at 96% scale, 320ms, snap ease) on celebrations, the current stone, parent notes and pack cards. Small idle bobs mark something in progress (the current pack step, tap-to-hear for 5–7). Reduced motion removes all animation and transitions, and gives tap-to-hear a blue outline instead.

## Do's and Don'ts

### Do:
- **Do** outline every brick, box, tab and field in 2px ink.
- **Do** keep exactly one green brick per screen; make every other action a ghost brick or a link.
- **Do** use yellow only for together / clue / help and selection, blue only for on-your-own, green only for go and look back, and red only as an outline over red wash for missed or failed.
- **Do** set step numbers, plan bricks, counts and durations in Archivo Black; set every word in Lexend.
- **Do** keep targets at 44px minimum, 64px for ages 5–7.
- **Do** serve fonts, icons and images from the app's own origin. The CSP allows only same-origin styles, fonts and scripts (`style-src 'self'`, `font-src 'self'`, `script-src 'self'`): all styling lives in `/app.css`; server templates may set a custom property or a map position in a style attribute; scripts toggle classes and data attributes rather than writing inline styles.
- **Do** separate sections with 2px ink rules and rows with 1px rule lines rather than stacking cards.
- **Do** step the phone tab bar aside whenever a question or answer review is on screen.

### Don't:
- **Don't** put an eyebrow, kicker or overline label above a heading, or use uppercase tracked micro-labels.
- **Don't** use a second green brick, a filled red brick for a mistake, or a brick colour without its meaning.
- **Don't** use pastel gradients, blurred drop shadows on content, glassy or floating card stacks: the soft pastel learning-app look this world refuses.
- **Don't** use big-number stat tiles; counts are small numeral bricks beside a label and measures are labelled rows.
- **Don't** load fonts or assets from a CDN, or add inline `<style>` blocks.
- **Don't** use text glyphs or emoji as icons; icons are drawn SVG in the shared stroke.
