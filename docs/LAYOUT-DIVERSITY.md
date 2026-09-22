# Layout diversity — findings and implementation

**Revision:** `7bec1b6` · **Baseline measured at:** `48687b3`
**Artefacts:** [`baseline/`](../baseline/) (the before-state) · [`after/`](../after/) (the after-state,
with [`after/FINDINGS.md`](../after/FINDINGS.md) for the matched comparison)

---

## 1. The problem, measured

Before any change, a subagent captured 11 designs across 7 briefs — shop, event, editorial,
software, service, artist, technical — **plus three runs of one brief left completely unchanged**
as a control. Full detail in [`baseline/FINDINGS.md`](../baseline/FINDINGS.md).

| | Baseline (`48687b3`) | After (`7bec1b6`) |
|---|---|---|
| Distinct section orders | **2 across 11 designs** — one order used by 9 | **7 across 10 designs** |
| Sections used | a fixed spine: hero · items · features · about · contact | a declared subset per page |
| Three identical `shop` runs | **near-identical** — same 8/8 axes, same order, same blocks | **3 distinct orders of 4** |
| Navigation / footer / contact | fixed template in **11/11** | 6 nav, 6 footer, 3 contact treatments |
| `h1` rendered size | 72 – 142.8 px | 73 – 163 px (up to 208 px on poster heroes) |
| Horizontal overflow | **1 page** (artist: 1568 px at 1440) | **0** |
| Duplicate ids | two `#top`, and a repeated module emitted the same id twice | **0** |
| Images generated vs rendered | 2 generated, **0 rendered** | slots are derived from the layout |

Two defects surfaced incidentally, both fixed: `organic-mesh` overflowed horizontally, and
generated artwork was discarded because the chosen layout had no image slot.

---

## 2. The architecture

Five layers, each with one job. Every one of them is validated, and the whole stack is
deterministic given a seed.

### 2.1 Layout blueprint — what is on the page

`src/blueprint.ts`. A typed description of arrangement:

```
lead         statement | product | catalogue | story | date | data | image | offer
hero         display | split | compact | panel | media | index | dateline
             | poster | editorial-figure | product-demo
nav          bar | bar-cta | minimal | inline-links | stacked | none
footer       masthead | columns | minimal | cta-band | ledger | colophon
sections     an ordered subset of 11 modules, each with a block variant
grid         columns, max-width        rhythm  tight | even | generous | dramatic
imageSlots   how many images the layout wants (0 is legitimate)
```

**19 blueprints, all 8 leads, 19 distinct section orders, 0 near-identical pairs.** Validation
enforces compatibility: a `date`-led page needs a schedule; a `product`-led page must open with
items or features; a media/figure/demo hero needs an image slot; a multi-column grid below 8
columns is refused.

### 2.2 Visual blueprint — how it is drawn

`src/visual.ts`. Derived from (blueprint, typeface, emotion, density, seed) — deliberately **not**
a further model call, so previewing a set stays free and a direction renders identically after a
reload.

- **Hero recipes.** Three added beyond the original seven: `poster` (the headline *is* the first
  screen), `editorial-figure` (large plate beside a narrow column), `product-demo` (a framed
  browser/device demonstration). All 10 exercised.
- **Typographic recipes, not font names.** Five voices fixing a headline *construction*
  (stacked / run-on / broken / outline / caps), a reading measure, alignment, label style, scale,
  weight and tracking. **All 5 constructions in use.** Density moves the measure, never the
  construction.
- **Section recipes.** Per-section bleed (inset / full / edge-left / edge-right), alignment,
  whitespace and image-to-text ratio, so the same module is drawn differently on different pages.
  All 4 bleeds and all 3 whitespace rhythms in use.
- **Art-directed treatments.** plain, cutout, duotone, shaped (`clip-path`), layered, textwrap
  (`float` + `shape-outside`). Each has a fallback and a `prefers-contrast: more` escape hatch.

Validation caught a real contradiction while being written: outline headlines were being assigned
a 58ch measure, which is unreadable at outline scale. The construction now widens the measure with
it.

### 2.3 Direction selection — several viable directions

`src/directions.ts`. Jev already returns a **full distribution per axis**; only the argmax was
used. Now: rank the alternatives → build a candidate pool → score for fit and coherence → select a
**set** under a diversity objective with escalating minimum separation, preferring a different
blueprint family per direction. Seeded and deterministic.

> **`fit` is not a probability.** It is a weighted sum of independent per-axis probabilities plus a
> structural term. The axes are independent; treating their marginals as a joint probability for a
> page would be meaningless. It ranks candidates.

> **Fit initially ignored structure entirely**, so every candidate sharing a palette tied and all
> 19 blueprints scored identically. Structure now carries 55% of the weight.

The `explore` dial (0..1) trades fit for range. At `0` the shop brief yields 3 families; at the
`0.45` default, 6.

### 2.4 Direction sessions — the contact sheet

`src/sessions.ts`. A session owns the decision, which is what the old flow threw away:

```
POST /api/directions              1 Jev call + 1 shared writer call, then N local renders
GET  /api/sessions/:id            the stored session
POST /api/sessions/:id/select     record choice + locks       (model-free)
POST /api/sessions/:id/regenerate re-roll unlocked directions (model-free)
POST /api/sessions/:id/finalize   write final blueprint-specific copy
POST /api/sessions/:id/revise     a REVISION of the chosen design, kept separate
                                  from "a different direction"
```

| | Measured |
|---|---|
| Six directions for one brief | **2 model calls**, $0.0017, 11.6 s |
| Decide (Jev) | 457 ms |
| Inventory (one shared writer call) | 11.2 s |
| Render, all six | **6 ms** |
| Regenerate (local) | 67 ms, 0 model calls |
| Finalize | 1 writer call |

Previews say on their face that their copy is a shared brief-level inventory — or local specimen
copy when no writer is configured. Final copy is written only for the blueprint you keep, and only
for the modules it renders.

### 2.5 Image slots — a place, not a count

`src/blueprint.ts` + `src/images.ts` + `src/userassets.ts`. A slot declares role, aspect, crop,
placement, and whether a 256 px generated asset can fill it without being stretched into something
it is not:

- `native` — used at or near its true size (tiles, framed demo)
- `texture` — deliberately enlarged, so it **must** be drawn as atmosphere, marked
  `data-texture="1"` with alt text that calls it a texture

Generation is capped at the number of slots, so a page with two places asks for two images and the
baseline's "generated but never rendered" cannot recur. Resolution is **by slot id**, never by
cycling: a named place gets its own picture or the CSS gradient, and never borrows a neighbour's.

Supplied brand images are the preferred source. They are copied into the export with their
creator, licence and **real** intrinsic pixel size (PNG/JPEG/WebP/GIF headers are parsed, so an
enlargement is measurable rather than hidden). Path traversal and non-images are refused with a
reason.

### 2.6 Bundled type

Five SIL OFL 1.1 variable fonts (Archivo, Source Serif 4, Nunito, JetBrains Mono, Inter), 278 KB
of latin-subset woff2, with the full licence text in `public/fonts/LICENSES.md`. The `@font-face`
blocks are emitted into the page and the family is placed first in every stack, so **a generated
page makes no remote font request at all** — the Google Fonts link is gone. Fonts are copied to
`<outDir>/fonts/` and referenced relatively, so the same HTML works from disk, from
`/preview/<id>/` and inside a ZIP; the single-file export inlines them as data URIs.

### 2.7 Code-rendered assets

- `src/motifs.ts` — deterministic seeded SVG motifs, five families (halftone, contour, hatching,
  technical, stamp). One coordinated family per direction, placed **once** on the page as a
  background, band, corner or rule.
- `src/frames.ts` — seven presentation frames (browser, device, packaging, ticket, cover, figure,
  plain); they wrap the figure and demo heroes, so they change image placement rather than
  decorating it.
- `src/icons.ts` — 22 original 24×24 line icons in one consistent stroke family, chosen only where
  they annotate a real route (contact, schedule, pricing) and capped at six per page.

---

## 3. Where the evidence lives

| | |
|---|---|
| Baseline: 33 screenshots, 11 specs, structure + timings | [`baseline/`](../baseline/) |
| After: 10 designs, 30 screenshots, raw measurements | [`after/`](../after/) |
| Matched before/after comparison with the repeated-brief control | [`after/FINDINGS.md`](../after/FINDINGS.md) |
| Contact sheet, desktop / narrow / mobile | [`after/shots/sheet/`](../after/shots/sheet/) |
| Each direction's own desktop + mobile preview | [`after/shots/sheet/dir-*.png`](../after/shots/sheet/) |

Reproduce the measurement:

```bash
npm run matrix -- --out /tmp/matrix      # 171 blueprint x effect pages
npm run measure -- --dir /tmp/matrix --shots /tmp/shots
npm run sheet-shot -- --url http://127.0.0.1:4400 --out /tmp/sheet
```

---

## 4. Structural fingerprints

Fingerprints exclude HTML length, class names, colour and copy — each of which can differ while the
page reads identically. They are built from `lead | hero | nav | footer | columns | rhythm |
section sequence`. Same-family blueprints sit ≈0.5–0.66 apart; different families ≈0.8–1.0. Those
bands tune the minimum-separation thresholds. A test asserts all 19 blueprints have unique
fingerprints and that the closest pair differs by at least 0.18.

They are complemented by real measurement rather than replaced by it: `scripts/measure.ts` reports
document width, horizontal overflow, first-screen blocks, `h1` size and line count, section
heights, image counts and **upscale factors**, id uniqueness and anchor resolution from a live
browser.

---

## 5. Cost and latency

| | Baseline | After |
|---|---|---|
| Cost per design | $0.00113 | $0.000999 |
| Wall time per design | 7,574 ms | 6,683 ms |
| Writer share of spend | 87.5% | ~85% |
| Thinking tokens | 0 | 0 |
| Six directions | — | **$0.0017, 11.6 s, 2 model calls** |

Thinking mode is off by default (see [`JEV-RESEARCH.md`](JEV-RESEARCH.md)); the writer leg is ~7 s
and dominates.

---

## 6. Tests

**281 offline checks across 8 suites** (`npm test`) — no keys, no network, no GPU.

| Suite | Checks | Protects |
|---|---|---|
| `forge.test.ts` | 58 | blueprint + visual-blueprint validation (5,481 combinations), fingerprint uniqueness, every blueprint renders with resolving anchors, unique ids, the three hero recipes, typographic recipes, treatments, icons |
| `images.test.ts` | 24 | payload validation, path-traversal refusal, PNG magic bytes, foreign-job filtering |
| `zip.test.ts` | 10 | CRC-32 vectors, real `unzip` round-trips |
| `motifs.test.ts` | 23 | determinism, element budgets, density, data-URI encoding |
| `assets.test.ts` | 31 | frame composition, icon family consistency, escaping |
| `fonts.test.ts` | 19 | every bundled file exists and is a real woff2, licences present, only used faces emitted |
| `session.test.ts` | 22 | selection performs **no** model call and leaves the decision byte-identical; regeneration is deterministic and free; locks pin exactly their axes; previews are labelled; ids unique; anchors resolve |
| `slots.test.ts` | 13 | slot derivation, the texture-vs-native rule, prompt budgets, header parsing, traversal refusal, slot-scoped resolution, supplied-beats-generated |

Three regression checks exist because of bugs found during this work: the affinity/catalog drift
check, the palette-guardrail lightness check, and "no asset is ever referenced from a path outside
the output".

---

## 7. Remaining limitations

1. **The `after/` corpus has no generated images.** The slot system is verified by tests and by
   live API runs, but not by a photographed before/after image batch.
2. **Three of four repeated runs of one brief still converge.** The direction set is diverse; a
   single best-fit run is not, by design. Choosing among the six is what the contact sheet is for.
3. **Fingerprints remain blueprint-derived.** Rendered geometry is now measured but is not fed back
   into the diversity objective.
4. **Third-party image search is not implemented**, deliberately — user-supplied local images are
   the supported path, and a licensed search that cannot verify its licences would be worse than
   none.
5. **The visual blueprint is derived, not decided.** It is deterministic and validated, but the
   model has no say in it. Whether it should is an open question, not an oversight.
