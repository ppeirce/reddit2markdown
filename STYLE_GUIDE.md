# Bureau

A design system for interfaces that refuse to be neutral.

---

## Philosophy

Bureau is editorial brutalism for the screen. It borrows from Swiss typographic posters, newspaper compositing rooms, and institutional print — then strips away everything that exists to make users comfortable. No dark mode safety blanket. No rounded corners. No gradients. No shadows. No illustrations. The content is the interface and the typography is the architecture.

The name comes from the French word for both "desk" and "office" — the place where editorial decisions are made. Bureau interfaces feel like they were typeset, not designed. They have the confidence of a newspaper front page and the restraint of a gallery wall.

### Core convictions

1. **Typography is structure.** Every hierarchy problem is a type problem. If you need a box, a divider, or an icon to create clarity, your type system is weak.
2. **Empty space is not wasted space.** Negative space is a compositional tool with equal weight to content. A page that feels "empty" is a page that breathes.
3. **Color is punctuation, not decoration.** One accent color, used sparingly. It should feel like a red pen mark on a manuscript — deliberate, authoritative, impossible to ignore.
4. **No ornamentation.** If a visual element doesn't convey information or create hierarchy, it doesn't exist. No grain overlays, no glows, no background patterns, no decorative borders.
5. **Instant state changes.** Things don't slide, bounce, or ease into existence. They appear. The interface respects that users are here to do something, not to watch something happen.
6. **Light, not dark.** A warm, paper-toned background. This is the single most polarizing choice and the hill Bureau dies on. Dark mode is a crutch that flatters everything. Light demands that your typography and spacing actually work.

---

## Color

The palette is intentionally starved. Three functional colors, one accent, one surface variant. That's it.

| Token    | Value     | Role                                                                 |
|----------|-----------|----------------------------------------------------------------------|
| `paper`  | `#F2EDE8` | Primary background. Warm, not white. Reads as unbleached newsprint.  |
| `ink`    | `#111`    | Primary text, headings, bold rules. Near-black, not pure black.      |
| `red`    | `#E63312` | The only accent. Signal red. Used for emphasis, active states, CTAs.  |
| `stone`  | `#888`    | Secondary text, placeholders, inactive controls, metadata.           |
| `wash`   | `#EAE5E0` | Recessed surfaces — code blocks, data tables, inset areas.           |

### Rules for color

- **`red` is rationed.** It appears on: the primary action button, active tab indicators, usernames/author attributions, text selection highlight, focused input borders, and error messages. It does NOT appear on backgrounds, large surface areas, or decorative elements.
- **No gray spectrum.** There is `ink` (dark) and `stone` (mid). You don't need five grays. If something needs to be between `ink` and `stone`, reconsider the hierarchy instead of reaching for another shade.
- **`paper` is never pure white.** The warmth is structural — it softens the contrast ratio just enough to feel analog without sacrificing readability. If adapting Bureau to a different project, any warm off-white between `#EDE8E3` and `#F5F0EB` works. Cool whites and blue-tinted grays are off-brand.
- **Text selection is `red` with white text.** This is a small detail that reinforces the accent everywhere a user interacts.

---

## Typography

Three typefaces. Each has a specific job. No typeface does another's job.

### Display: Bebas Neue

- **Use for:** Hero headlines, page titles, section headers, rendered H1/H2 content.
- **Character:** Condensed, all-caps (enforce via `text-transform: uppercase`), high-impact. Reads as newspaper headline or protest poster.
- **Sizing:** Go large or don't use it. Minimum effective size is ~2rem. Hero applications should use `clamp(5rem, 17vw, 15rem)` or similarly aggressive scaling. The whole point of a condensed display face is that it earns its space by being enormous.
- **Line height:** Tight. `0.85`–`0.95`. Display type at large sizes has built-in optical spacing in the cap height. Adding generous leading undermines the density that makes it work.
- **Letter spacing:** `-0.01em` to `0.01em`. Bebas Neue is already tightly spaced. Don't open it up.
- **Weight:** Regular (400) only. Bebas Neue has one weight and that's a feature, not a limitation.

### Body: Space Grotesk

- **Use for:** Body copy, UI labels, button text, navigation, descriptions, any running text.
- **Character:** Geometric grotesque with subtle personality. Modern but not clinical. The slight quirks in letterforms (the `a`, the `g`) prevent it from feeling sterile.
- **Sizing:** `15px` for body copy. `11px`–`13px` for UI controls, labels, and metadata (always with increased letter-spacing at small sizes).
- **Weights:**
  - `400` — Body copy, descriptions
  - `500` — UI labels, secondary buttons, metadata
  - `600` — Button text, tab labels, emphasis
  - `700` — Rarely. Only when `600` doesn't create enough separation.
- **Line height:** `1.6`–`1.7` for body copy. Generous leading is critical for readability on a warm background.
- **Letter spacing at small sizes:** `0.08em`–`0.12em` for anything under `13px`. Small text needs air.
- **Text transform:** Uppercase for all UI controls (buttons, tabs, labels, navigation). Mixed case for body copy and descriptions.

### Mono: JetBrains Mono

- **Use for:** Input fields, code blocks, raw/preformatted text, timestamps, technical metadata, subtle branding marks.
- **Character:** The "machine voice" of the interface. Wherever text represents data, user input, or system output, it's monospaced.
- **Sizing:** `13px`–`14px`. Slightly smaller than body copy to create visual distinction without hierarchy confusion.
- **Weights:** `300`–`500`. Use `400` by default. `300` for large-set code blocks where density matters.

### Typographic hierarchy (reference scale)

| Element               | Face           | Size                          | Weight | Transform | Spacing      |
|-----------------------|----------------|-------------------------------|--------|-----------|--------------|
| Hero title            | Bebas Neue     | `clamp(5rem, 17vw, 15rem)`   | 400    | uppercase | `-0.01em`    |
| Content H1            | Bebas Neue     | `clamp(2rem, 6vw, 3.5rem)`   | 400    | uppercase | `0.01em`     |
| Content H2            | Bebas Neue     | `1.75rem`                     | 400    | uppercase | `0`          |
| Body                  | Space Grotesk  | `15px`                        | 400    | none      | `0`          |
| Strong/emphasis       | Space Grotesk  | inherit                       | 600    | none      | `0`          |
| Button (primary)      | Space Grotesk  | `12px`                        | 600    | uppercase | `0.1em`      |
| Button (secondary)    | Space Grotesk  | `11px`–`12px`                 | 500–600| uppercase | `0.1em`–`0.12em` |
| Input text            | JetBrains Mono | `14px`                        | 400    | none      | `0`          |
| Input placeholder     | JetBrains Mono | `14px`                        | 400    | none      | `0`          |
| Code block            | JetBrains Mono | `13px`                        | 400    | none      | `0`          |
| Footer/meta mark      | JetBrains Mono | `11px`                        | 400    | none      | `0.05em`     |
| Subtitle/descriptor   | JetBrains Mono | `12px`                        | 400    | none      | `0.04em`     |
| Error message         | JetBrains Mono | `12px`                        | 400    | uppercase | `0.04em`     |

---

## Layout

### The content column

All content lives in a single centered column with a maximum width of **900px**. This is narrower than most web applications and that's deliberate — it creates a reading measure (~75 characters at body size) that references editorial print layouts. On wide monitors, the generous margins on either side are not wasted space; they're the design.

Horizontal padding scales responsively: `clamp(1.5rem, 5vw, 3rem)`.

### Full-bleed rules

Horizontal rules span the full viewport width, breaking out of the content column. They are the primary structural device — they separate the page into zones the way a newspaper uses column rules and section dividers.

- **Heavy rule:** `2px solid ink`. Used at major structural boundaries (top of workspace, above footer, between page-level sections).
- **Thin rule:** `1px solid stone`. Used for secondary separations within a section (between toolbar and content, between metadata and body).

Rules carry no margin of their own. Spacing is controlled by the zones they separate.

### Two-state interfaces

Bureau interfaces should consider having distinct **empty** and **loaded** states:

- **Empty state:** Expansive. The primary action (input, search, upload) is presented with maximum visual weight. Display typography dominates. The page feels like a poster — a single clear message and a single clear action.
- **Loaded state:** Compressed. The input mechanism shrinks to a toolbar. Display typography vanishes. The interface becomes subservient to the content it produced. This transformation communicates: "The tool is not the point. What you made with it is."

The transition between states is instantaneous. No morphing, no animation.

### Vertical rhythm

- Hero title to subtitle: `1.5rem`
- Subtitle to form: `3rem`
- Toolbar padding: `1rem` top and bottom
- Content area top: `2rem`
- Content area bottom: `4rem`
- Footer padding: `1.25rem` top and bottom

---

## Components

### Primary button

The primary button is a solid `red` rectangle. It is the loudest element on any page and should only appear once per view.

- Background: `red`
- Text: white, `12px`, `600` weight, uppercase, `0.1em` letter-spacing
- Padding: `14px 28px`
- Border: none
- Border radius: none (rectangles only, no rounding)
- Hover: `opacity: 0.85`
- Active: `scale(0.98)`
- Disabled: `opacity: 0.4`

### Text button

For secondary actions. No background, no border. Just text that changes color.

- Color: `stone` → `ink` on hover → `red` when active
- Text: `11px`–`12px`, `500`–`600` weight, uppercase, `0.1em` letter-spacing
- Padding: `8px 16px` (generous hit target despite minimal visual footprint)

### Input field

Inputs are bottomline-only — no surrounding border, no background. They sit on the page like a line on a form.

- Border: bottom only, `2px solid ink`
- Font: JetBrains Mono, `14px`
- Padding: `14px 0`
- Placeholder: `stone`
- Focus: bottom border becomes `red`
- Caret: `red`
- Compact variant: `1px` border, `10px` padding, `13px` font

### Blockquotes (nested content)

Used for threaded or hierarchical content. The left border color indicates depth:

- Level 1: `3px solid ink`
- Level 2: `3px solid red`
- Level 3+: `3px solid stone`

Padding-left: `1.25rem`. No background color. No right border.

### Code / preformatted blocks

- Background: `wash`
- Padding: `2rem`
- Font: JetBrains Mono, `13px`, line-height `1.7`
- No border. The background shift is sufficient separation.

### Horizontal rules in content

Inside rendered content (not page-level structure), rules are `2px solid ink` with `2rem` vertical margin. They should feel like section breaks in a long-form article.

---

## Interactions

### Hover states

- Buttons and links shift color. Primary buttons reduce opacity.
- No underlines on links by default. Color change is the hover signal.
- Transitions are `0.1s`–`0.15s`. Fast enough to feel responsive, just enough to avoid a jarring flash.

### Focus states

- Input borders change to `red` on focus.
- Carets are `red`.
- No focus rings or outlines on buttons (use `:focus-visible` if accessibility requires it, styled as a `1px` `red` outline with `2px` offset).

### Animations

Bureau uses exactly one animation: a `250ms` opacity fade (`fadeIn`) for content that appears after a user action (loaded results, expanded sections). Everything else is instantaneous.

No transforms. No slides. No bounces. No spring physics. Content doesn't move into position — it's either there or it isn't.

### Error states

Errors are `red`, monospaced, uppercase, small (`12px`). They appear immediately below the element that caused them. No icons, no boxes, no background color. Just red text stating what went wrong in plain language.

---

## Spacing and sizing reference

| Token       | Value    | Usage                                         |
|-------------|----------|-----------------------------------------------|
| `4px`       | `0.25rem`| Micro gaps (between inline elements)          |
| `8px`       | `0.5rem` | Button internal padding (vertical)            |
| `12px`      | `0.75rem`| Control bar padding, tight component spacing  |
| `16px`      | `1rem`   | Toolbar padding, standard component gap       |
| `24px`      | `1.5rem` | Section internal padding, content top margin  |
| `32px`      | `2rem`   | Content block separation, code block padding  |
| `48px`      | `3rem`   | Hero header to form gap                       |
| `64px`      | `4rem`   | Content area bottom padding                   |

---

## What Bureau is not

- **It is not minimalism.** Minimalism removes elements to achieve calm. Bureau removes elements to achieve tension. The negative space isn't serene — it's charged. The absence of decoration makes every remaining element carry more weight.
- **It is not retro.** Bureau references print and editorial traditions but doesn't cosplay as a newspaper or a Swiss poster. There are no paper textures, no halftone effects, no vintage color grading. The references are structural, not aesthetic.
- **It is not brutalism for its own sake.** Brutalist web design often prioritizes shock and ugliness. Bureau is opinionated, not hostile. Every choice serves readability and function — it just refuses to sand down the edges to make those choices palatable.

---

## Adapting Bureau

When applying this system to a different product:

1. **Keep the paper background.** Adjust the warmth (cooler for technical products, warmer for editorial ones) but stay in the off-white family. The moment you go dark, you've left Bureau.
2. **Pick one accent color and commit.** `#E63312` signal red is the reference. Alternatives that preserve the same energy: `#E05A00` (burnt orange), `#0047AB` (cobalt), `#1A7A4C` (racing green). Avoid pastels, neons, and anything that could be described as "friendly."
3. **Respect the type scale.** The display face should be condensed and used at extremes. The body face should be geometric and clean. The mono face handles all data and input. Don't mix these roles.
4. **Use rules, not cards.** Bureau layouts are divided by lines, not enclosed in boxes. If you find yourself reaching for a card component with padding, border-radius, and shadow — use a horizontal rule above and below instead.
5. **One primary action per view.** The red button appears once. If a view has multiple competing actions, the hierarchy is wrong.

---

*Bureau doesn't ask permission. It makes a decision and stands behind it.*
