---
name: mcp-token-optimizer
description: A quiet developer console where you watch tool-response noise get cut.
colors:
  ground-dark: "#0c0c0b"
  surface-dark: "#141413"
  raise-dark: "#1b1b19"
  ink-dark: "#edece8"
  ink-2-dark: "#a8a7a1"
  ink-3-dark: "#85847e"
  cut-dark: "#f7703f"
  ok-dark: "#7fd4a0"
  key-dark: "#d7c9a7"
  ground-light: "#fafaf8"
  surface-light: "#ffffff"
  raise-light: "#efefeb"
  ink-light: "#0c0c0b"
  ink-2-light: "#55544e"
  ink-3-light: "#6b6a63"
  cut-light: "#c2410c"
  ok-light: "#15803d"
  code-ground-dark: "#0e0e0d"
  code-ground-light: "#f4f4f0"
  code-cut-light: "#a83a0b"
  code-ok-light: "#126b35"
  code-key-light: "#8a5a00"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5.6vw, 4.375rem)"
    fontWeight: 560
    lineHeight: 1.02
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 3.4vw, 2.625rem)"
    fontWeight: 560
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 560
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "-0.006em"
  label:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  code:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.8
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "16px"
  pill: "99px"
spacing:
  gutter: "clamp(20px, 4vw, 40px)"
  section: "clamp(64px, 9vw, 120px)"
  card: "22px"
  tile-text: "20px 22px 24px"
  stack-sm: "12px"
  stack-md: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink-dark}"
    textColor: "{colors.ground-dark}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "42px"
  button-line:
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "42px"
  card:
    backgroundColor: "{colors.surface-dark}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card}"
  terminal:
    backgroundColor: "{colors.code-ground-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.code}"
    rounded: "{rounded.lg}"
  tab:
    textColor: "{colors.ink-3-dark}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "26px"
  tab-selected:
    backgroundColor: "{colors.raise-dark}"
    textColor: "{colors.ink-dark}"
  pill:
    textColor: "{colors.ink-2-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "30px"
---

# Design System: mcp-token-optimizer

## Overview

**Creative North Star: "The Night Console"**

The site is a developer's console late in the day: a near-black (or warm off-white) ground, hairline-framed content, and real working screens doing the talking. The product's mechanism is the visual language. Tokens arrive, noise is struck through in one warm orange, and what survives reaches the model. Every section shows a working artifact (an agent window, a pipeline, a terminal, a figure) with at most a line of copy beside it; prose never carries a section on its own.

The system is quiet and monochrome by default and spends colour on meaning only. One accent, the cut orange, marks what mto removes; a muted green marks what passed or was saved. There is no brand purple and no gradient decoration. Depth comes from real window chrome, soft long shadows under floating screens, and a faint dot-matrix field behind the page whose dots read as tokens.

The user rejected an earlier flat, windowless, text-heavy direction as tasteless and AI-generic; this system replaces it.

**Key Characteristics:**
- Near-black dark theme (`#0c0c0b`, never pure black) and a warm off-white light theme; both are first-class.
- Real screens instead of illustrations: an agent app, terminals, config diffs, all fed with real product output.
- One accent (cut orange) used only for what is removed; hatched orange for "cut" in charts.
- Light headings (weight 560) with tight tracking; JetBrains Mono for everything a machine wrote.
- Motion explains the mechanism: a timeline replay, scroll-linked reveals, bars that shrink to their saving.

## Colors

A neutral warm-grey palette with a single warm accent; code surfaces have their own ramp that flips with the theme.

### Primary
- **Cut Orange** (dark `#f7703f`, light `#c2410c`, on code surfaces in light `#a83a0b`): strike rules through noise, the hatched "cut" segment of every bar, the noise fields in the agent replay, focus rings, text selection. Never decorative.

### Secondary
- **Pass Green** (dark `#7fd4a0`, light `#15803d`, on code surfaces in light `#126b35`): PASS lines, `round-trip ok`, a copied-state confirmation, the `mto_expand` result. Small amounts only.

### Tertiary
- **Key Sand** (dark `#d7c9a7`, light code `#8a5a00`): JSON and TOON keys inside code; nowhere else.

### Neutral
- **Ground** (dark `#0c0c0b`, light `#fafaf8`): page background.
- **Surface / Raise** (dark `#141413` / `#1b1b19`, light `#ffffff` / `#efefeb`): cards, tiles, selected tabs, hover fills.
- **Ink, Ink 2, Ink 3** (dark `#edece8` / `#a8a7a1` / `#85847e`; light `#0c0c0b` / `#55544e` / `#6b6a63`): headings and primary text, supporting copy, captions and metadata. All pairs pass WCAG AA on their grounds.
- **Code Ground** (dark `#0e0e0d`, light `#f4f4f0`): agent window, terminals, feature-tile visuals, docs code blocks.
- **Hairlines**: ink at 8% (default) and 15% (emphasis) alpha.

### Named Rules
**The One Accent Rule.** Orange means "cut by mto". If an element is orange and nothing was removed, it is wrong.

**The No Purple Rule.** No violet, no brand gradient, no glow colour. The user explicitly rejected the purple, AI-generic look.

## Typography

**Display Font:** Geist (with system-ui fallback)
**Body Font:** Geist
**Label/Mono Font:** JetBrains Mono

**Character:** Geist is a calm, technical grotesk at light display weights; JetBrains Mono is what developers read in their editors, so every command, JSON line, caption and number in data uses it.

### Hierarchy
- **Display** (560, `clamp(2.5rem, 5.6vw, 4.375rem)`, 1.02, -0.045em): the hero headline only, max 17ch.
- **Headline** (560, `clamp(1.875rem, 3.4vw, 2.625rem)`, 1.1, -0.035em): section titles, balanced wrap.
- **Title** (560, 1rem, 1.35): card, tile and step titles.
- **Body** (400, 1rem–1.1875rem, 1.55–1.6): subtitles at `--text-2`, max ~54ch.
- **Label** (JetBrains Mono 400, 0.72–0.75rem): captions, tabs, pills, file names, legend text.
- **Code** (JetBrains Mono 400, 0.7–0.78rem, 1.7–1.8): terminals, agent window, docs code blocks.

### Named Rules
**The Light Heading Rule.** Headings stay at 560. The user called a heavier hero "way too bold"; do not go above 600.

**The Machine Voice Rule.** If a program printed it or a person types it into one, it is set in JetBrains Mono. Marketing copy never is.

## Layout

A centred column of 1180px with 1px side rules (the frame), sections separated by full-width hairlines and padded `clamp(64px, 9vw, 120px)` vertically and `clamp(20px, 4vw, 40px)` horizontally. Sections alternate between a heading block (max 660px) followed by a working artifact, and a two-column split (copy left, terminal right, `0.8fr / 1.2fr`) for install and testing. Features use a 3-column bento with alternating wide tiles. Every grid declares `minmax(0, 1fr)` tracks so long code never widens the page; below 900–1000px everything stacks to one column, and the page holds at 390px with no horizontal scroll. The nav is sticky, translucent and blurred, 60px tall.

## Elevation & Depth

Flat surfaces with hairline borders; depth is reserved for screens. Floating windows (agent app, terminals) carry one long, soft shadow; cards gain a border emphasis on hover and lift 2px; the maker card tilts toward the pointer. Behind everything sits a fixed canvas dot field (26px grid) that dims under a slow diagonal sweep and brightens near the cursor.

### Shadow Vocabulary
- **Window** (dark `0 40px 100px -30px rgba(0,0,0,.8), 0 0 0 1px rgba(237,236,232,.06)`; light `0 40px 90px -36px rgba(12,12,11,.45), 0 0 0 1px rgba(12,12,11,.08)`): agent app and terminals only.
- **Card lift** (`0 30px 60px -30px` of ink at 30%): the maker card on hover.

### Named Rules
**The Screens Float, Pages Don't Rule.** Only real windows get a shadow; cards and tiles stay flat on hairlines.

## Shapes

Gently rounded throughout: 6px for tabs and inline code, 10px for buttons and copy controls, 14px for windows and the install box, 16px for cards and tiles, full pills for the hero pill. Windows have real chrome (three neutral dots, a title bar). Charts use 3px-radius bars with a 45° hatch for the cut portion.

## Components

### Buttons
- **Shape:** gently rounded (10px), 42px tall, 16px horizontal padding, icon + label.
- **Primary:** ink background, ground text ("Download latest", GitHub on the maker card).
- **Line:** 1px hairline border at 15%, ink text, raise fill on hover.
- **Press:** translate 1px down; no scale, no glow.

### Tabs (terminal and install box)
- **Style:** JetBrains Mono 0.7rem, 26px tall, 6px radius, ink-3 text.
- **Selected:** raise background, ink text. Arrow keys move between tabs (roving tabindex).

### Cards / Tiles
- **Corner Style:** 16px.
- **Background:** surface at 75% over the field; hairline border, emphasis on hover.
- **Feature tile:** a 196px code-ground visual on top (a live, looping scene that only runs in view), title and one sentence below.

### Terminal (signature component)
Window chrome, tabbed sessions, commands typed (capped at about one second each) and output streamed line by line when scrolled into view; latest output pinned to the bottom with a fade; footer with source note and "Copy commands". Reduced motion shows the finished transcript.

### Agent replay (signature component)
A three-pane agent app (chats and MCP servers, chat with a tool-call card, response inspector) on a 15.5s loop that pauses off-screen: prompt typed, raw JSON streams in, noise fields flagged orange, struck, collapsed, TOON and the real `[mto: …]` note appear, token count falls 37,355 → 13,244. Every string is real output from the repository's sample data.

### Benchmark bars
One row per measured response: a bar that starts full and shrinks to the share that reaches the model, revealing a hatched orange cut segment, with the token count counting down and the percentage at right.

### Navigation
Sticky 60px bar, mono wordmark with a monochrome mark, section anchors and Docs, a divider, GitHub icon and theme toggle; anchors collapse below 880px.

## Do's and Don'ts

### Do:
- **Do** feed every visual with real product output (smoke results, the TOON list, the `mto_expand` note) and label replays as such.
- **Do** keep code surfaces on their own ramp (`--m-*`) so they flip correctly between themes.
- **Do** run every looping animation only while it is on screen and give it a finished static state under `prefers-reduced-motion`.
- **Do** open every external link in a new tab through `externalLinks.ts`, never per link.
- **Do** declare `minmax(0, 1fr)` on every grid track.

### Don't:
- **Don't** use purple, gradients as decoration, glow, or neon accents.
- **Don't** set headings heavier than 600 or make the hero louder than the agent window beneath it.
- **Don't** add blinking or pulsing status dots.
- **Don't** let a section be carried by prose; one line of copy beside a working artifact is the ceiling.
- **Don't** use dot-matrix "each dot is 2%" charts; the user rejected them in favour of the shrinking bars.
- **Don't** invent claims: no user counts, star counts, testimonials or an npm package before v3.
