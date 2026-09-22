# Modern CSS in the layout engine

The engine targets the **Interop 2026** feature set (the features Blink, WebKit
and Mozilla have jointly committed to shipping consistently), plus a set of
adjacent features that are usable today.

The rule applied throughout: **every modern feature is doing a job that
previously required JavaScript or a fragile hack**, and every one is either
safely ignorable or explicitly gated behind `@supports`. Nothing is decoration.
Nothing can break the page in an engine that lacks it.

---

## Interop 2026

| Feature | What it replaces here |
|---|---|
| **Anchor positioning** + `@position-try` | JS measurement to attach a caption to its host. The caption flips above automatically if it would overflow. |
| **Advanced `attr()`** | Reading typed values out of `data-*` attributes via JS. |
| **`@container style()` queries** | JS-driven theme/density class toggling. Components now respond to the *design decision* (`--density`, `--mood`), not the viewport. |
| **`contrast-color()`** | Hand-picking a foreground for each accent. Now computed per palette, with a `@supports not` fallback to the authored ink. |
| **Custom highlights** (`::target-text`) | Unstyled text-fragment highlights from search referrals. |
| **`dialog` / `popover` / invoker commands** | A JS panel component for the "how this was built" popover. |
| **Media state pseudo-classes** (`:playing`, `:paused`) | JS media listeners, for any media the generator emits. |
| **Scroll-driven animations** | An `IntersectionObserver` reveal system *and* a scroll-listener progress bar. Both are now pure CSS: `animation-timeline: view()` and `scroll(root block)`. |
| **Scroll snapping** | Hand-rolled snapping maths. |
| **`shape()`** | SVG path data for an organic section boundary. Now expressed in CSS units. |
| **View transitions** | Page-transition JS, for navigating between generated pages. |
| **`zoom`** | Layout-affecting scale (as opposed to `transform`, which is merely visual). |

### Why scroll-driven animations matter most here

They delete an entire category of JavaScript. The generated page ships **zero
scroll listeners and zero observers** — reveals and the reading-progress bar are
linked to scroll position by the engine. For a tool that emits pages
continuously, "the motion system has no runtime cost and cannot leak an observer"
is a structural win, not a nicety.

---

## Beyond the Interop list

| Feature | What it does |
|---|---|
| **`@layer`** | Cascade layers fix specificity *structurally*. The generated stylesheet contains no `!important` and no specificity escalation — conflict resolution is declared once, up front. |
| **`sibling-index()` / `sibling-count()`** | The most valuable addition for a **generator**. Stagger delays, `01 / 06` numbering and alternating grid rhythm are all derived from an element's position, so the engine never has to know how many children exist. Previously the generator had to emit `style="--d: 120ms"` per child. |
| **`@container scroll-state()`** | Styles the header once it is **stuck**, with no scroll listener. |
| **`::scroll-button()` / `::scroll-marker()`** | A native carousel with accessible controls and zero JS — used for the work rail. |
| **`appearance: base-select` + `::picker(select)`** | A fully styleable `<select>` without rebuilding it in JS. |
| **`@function`** | Reusable value logic that lives in CSS. Always emitted **with a plain fallback declaration first**, because an unsupported `@function` call makes the declaration invalid. |
| **`corner-shape`** | A corner family chosen per emotion — `squircle` for delight/optimism, `bevel` for tension, `round` otherwise. |
| **`reading-flow`** | Visual order can be reordered while DOM and tab order stay logical. This is how the engine can be visually adventurous without costing accessibility. |
| **`grid-lanes`** | Native masonry-style packing for the work grid where supported. |
| **`oklch()` + relative colour syntax** | The whole palette (accent steps, hairline greys, surfaces) is derived from **one** accent value, perceptually evenly. |
| **`light-dark()`** | One declaration serves both colour schemes. |
| **`@starting-style` + `allow-discrete`** | Entry animation for popovers without scripted class toggling. |
| **`subgrid`** | Card internals align to the page grid, so labels across a row share a baseline regardless of content length. |
| **`:has()`** | A card highlights itself when a descendant receives focus — no JS. |
| **`text-box-trim` / `text-box-edge`** | Display type aligns *optically* to its container edge by trimming the half-leading. |
| **`field-sizing: content`** | Form controls size to their content. |
| **`scrollbar-gutter: stable`** | Content-height changes cannot shift the layout horizontally. |
| **`prefers-reduced-transparency`** | The sticky header drops its backdrop blur when translucency is unwanted. |
| **`content-visibility` (opt-in)** | Off-screen blocks skip paint. Deliberately **not** applied to sections by default: it interferes with `view()` timelines and with sticky/anchor positioning, so correctness wins over a micro-optimisation. Exposed as a `.defer-render` utility instead. |

---

## Two layout bugs this engine had to fix, and the general rule

Both were found by rendering generated pages in headless Chromium and testing
**actual scrollability** (`scrollX` after attempting to scroll) rather than
`scrollWidth`.

1. **`overflow-x` on `<body>` is a trap.** Because `<html>` starts at
   `overflow: visible`, an `overflow-x` on `<body>` *propagates to the viewport*,
   and the body's own used value reverts to `visible`. The document then still
   reports an over-wide content box. Horizontal clipping must live on `<html>`.
   (Using `hidden` instead of `clip` on `<body>` is worse: it makes `<body>` a
   scroll container and silently kills every `position: sticky` inside it.)

2. **A display-size email address is the most reliable way to blow out a
   viewport.** `studio@ateliern.ull` is a single unbreakable token ~19 characters
   long; at `11vw` it overflowed by 267 px. The engine now sets
   `overflow-wrap: anywhere` on `.display` and `overflow-wrap: break-word` on
   headings and paragraphs.

**And the measurement rule:** `scrollWidth > clientWidth` does **not** mean the
page scrolls. Content can be correctly clipped and still be reported. Always test
the real thing:

```js
window.scrollTo(800, 0);
const scrolls = window.scrollX > 0;   // this is the actual bug
```

---

## Support strategy

| Mechanism | Used for |
|---|---|
| `@supports (feature)` | Features where a wrong fallback would look broken — grid-lanes, subgrid, corner-shape, select styling, carousel controls, anchor positioning, `@function` usage. |
| Plain declaration + override | Where a safe fallback already exists (e.g. `padding: var(--s-3)` then `padding: --forge-space(3)`). |
| No guard needed | Features that are pure enhancement and inert if ignored — `text-box-trim`, `scrollbar-gutter`, `text-wrap`. |

Accessibility is never conditional on a modern feature. `prefers-reduced-motion`
is honoured in every generated page, and there is a test asserting it.
