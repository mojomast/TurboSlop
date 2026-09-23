# Layout diversity — findings and implementation

**Baseline measured at:** `48687b3` · **after-state measured at** `7bec1b6` · **current tree:** see
[`docs/IMPLEMENTATION-REPORT.md`](IMPLEMENTATION-REPORT.md) for exact starting/final SHAs
**Artefacts:** [`baseline/`](../baseline/) (the before-state) · [`after/`](../after/) (the matched
comparison) · [`evidence/`](../evidence/) (the current corpus: direction sets, live-browser
geometry, calibration, generated tables)

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

Two selection inputs are not "the brief":

- **Images on** (`wantsImages`): layouts with zero image slots are dropped, so an enabled image
  setting cannot resolve to the "generated but never rendered" case. A lock is honoured, and if
  nothing image-capable exists the full pool comes back — the asset plan then records why no
  request was made rather than dropping the setting quietly.
- **A fresh standalone run** (`freshLeads`): the leads the newest three history entries used are
  skipped, so pressing generate again opens on a different kind of page instead of another
  variant of the last one. Falls back when every lead was used recently.

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
A returned frame that carries no picture (a uniform black or blank render, which the service
sometimes answers a "no focal subject" prompt with) is **discarded, not rendered**: the slot keeps
its plate and the plan says so, rather than giving the page a slab where a texture should be.

Supplied brand images are the preferred source. They are copied into the export with their
creator, licence and **real** intrinsic pixel size (PNG/JPEG/WebP/GIF headers are parsed, so an
enlargement is measurable rather than hidden). Path traversal and non-images are refused with a
reason.

### 2.6 Bundled type

Five SIL OFL 1.1 variable fonts (Archivo, Source Serif 4, Nunito, JetBrains Mono, Inter), 332 KB
of latin-subset woff2, with the full licence text in `public/fonts/LICENSES.md`. Archivo carries a
real **width axis** (`wdth` 62–125) and the pack emits the `font-stretch` descriptor for it, so a
page's `font-stretch` — the `--head-width` in every typographic recipe — actually condenses or
expands the display type. The `@font-face`
blocks are emitted into the page and the family is placed first in every stack, so **a generated
page makes no remote font request at all** — the Google Fonts link is gone. Fonts are copied to
`<outDir>/fonts/` and referenced relatively, so the same HTML works from disk, from
`/preview/<id>/` and inside a ZIP; the single-file export inlines them as data URIs.

### 2.7 Code-rendered assets

- `src/motifs.ts` — deterministic seeded SVG motifs, twelve families (halftone, contour, hatching,
  technical, stamp, truchet, isometric, weave, fishscale, waves, quatrefoil, stipple). One
  coordinated family per direction, placed **once** on the page as a background, band, corner or
  rule.
- `src/frames.ts` — seven presentation frames (browser, device, packaging, ticket, cover, figure,
  plain); they wrap the figure and demo heroes, so they change image placement rather than
  decorating it.
- `src/icons.ts` — two vendored families: the 22 original 24×24 line icons and a curated
  **Lucide** subset (69 glyphs, ISC, pinned commit, licence in `public/icons/LICENSES.md`). A
  page draws from exactly ONE family — chosen by its seed — and each meaning (email, date,
  price, …) resolves through a small candidate list, capped at six icons per page.

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

## 4. Structural and visual fingerprints

Fingerprints exclude copy and byte length — both can differ while a page reads
identically. Since the diversity pass they describe the **resolved design**,
not the catalog entry it started from (`src/fingerprint.ts`): composition
(lead, hero, chrome, rhythm, block sequence), typography proportions
(construction, measure, scale, weight, tracking, alignment, label style),
imagery (treatment, motif, slot count and scale) and surface (tone, density,
effects, motion). Two directions sharing a blueprint can then be far apart —
and a palette swap alone can be near-duplicate.

Three distances carry the work, all weighted sums over that feature vector:

| threshold | name | job |
|---|---|---|
| ≤ 0.06 | `NEAR_DUPLICATE` | explicit rejection inside the candidate pool |
| ≥ 0.20 | `MIN_SEPARATION` | minimum distance between two members of one set |
| ≥ 0.17 | `HISTORY_SEPARATION` | keeps a new run off what the project just made |

`grayscaleDistance` drops the hue-only terms (effects, motion) so a set can be
asked to differ *even in grayscale*. These are measurable separations within a
set and against recent history — not a percentage of perceptual uniqueness and
not a claim that any page is universally unique.

**Calibration** (`scripts/calibrate.ts`, `evidence/calibration.json`): 465
within-brief pairs of *measured pages* — same brief, so the content inventory
is fixed and geometry differences are design differences. The rendered-geometry
distance (section heights, hero height, headline size, first-screen shape)
rises monotonically across the fingerprint bands (median 0.21 → 0.35 → 0.41),
and pages with an identical section sequence measure within 0.04 of each other
even when their styling differs. Pairs below the near-duplicate threshold are
deliberately absent from the corpus — that is the enforcement working; the
style-probe pages exist to calibrate the bands the selector removes.

Complemented by real measurement rather than replaced by it:
`scripts/measure.ts` reports document width, horizontal overflow, first-screen
blocks, `h1` size and line count, section heights, image counts and **upscale
factors**, id uniqueness and anchor resolution from a live browser.

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

The current evidence corpus (`evidence/tables.md` §5) runs the **offline control** — local
decider, specimen inventory: 1 model call per six-direction set, ~92–125 ms end to end per set,
4–9 ms of that spent rendering all six previews locally. Candidate search is bounded at 2,394
candidates per set. The second (inventory) call is the one that appears when a writer is
configured; it is never paid per direction. The same two calls measured **live**
(`evidence/tables.md` §10): Jev answered in 189–267 ms per decision (9 calls), and the shared
inventory write took 9,670 ms for 955 in / 1,815 out tokens — $0.00123 on `deepseek-flash`.

---

## 6. Tests

Run `npm test` — 13 suites, offline by construction. The generated
counts (passed / failed / skipped per suite) live in
[`evidence/tables.md`](../evidence/tables.md) §8, produced from
`evidence/tests.txt` by `scripts/report.ts`, so the number quoted here can
never drift from the suite again. **277 checks passed, 0 failed, 0 skipped**
in this environment, where the credentials for the live halves are present;
without them those checks skip *with the reason in the test name* rather than
disappearing.

| Suite | Protects |
|---|---|
| `forge.test.ts` | decision composition, composite scoring, confidence gates, catalog drift, blueprint + visual-blueprint validation, fingerprint uniqueness, every blueprint renders with resolving anchors, unique ids, the three hero recipes, typographic recipes, treatments, icons — **plus the live writer, the live Jev decision and their composition**, which skip with a reason when unconfigured |
| `images.test.ts` | payload validation, path-traversal refusal, PNG magic bytes, foreign-job filtering, busy/429 backoff, flat-frame rejection (a uniform black/blank render is discarded, the slot keeps its plate) |
| `zip.test.ts` | CRC-32 vectors, real `unzip` round-trips (incl. Unicode names), DEFLATE vs STORE, traversal rejection, header-safe download filenames |
| `motifs.test.ts` | determinism, element budgets, density, data-URI encoding |
| `assets.test.ts` | frame composition, icon consistency and both vendored icon families (original + Lucide ISC), escaping |
| `fonts.test.ts` | every bundled file exists and is a real woff2, licences present, only used faces emitted |
| `session.test.ts` | selection performs no model call and leaves the decision byte-identical; previews labelled, ids unique, anchors resolve; finalize writes a real design |
| `slots.test.ts` | slot derivation, the texture-vs-native rule, prompt budgets, header parsing, traversal refusal, slot-scoped resolution, supplied-beats-generated |
| `diversity.test.ts` | the explore targets on all seven baseline briefs across seeds, near-duplicate rejection, bounded search, project-scoped history, image-on selection kept to image-capable layouts, fresh-lead avoidance on repeated standalone runs, reproducibility from inputs + seed + snapshot, **and the same targets under a live Jev decision** (9 live sets; skips with the reason when no key) |
| `locks.test.ts` | locks bound to explicit values and source cards, blueprint/composition locks applied, invalid and incompatible locks explained, immutable previous batches |
| `revision.test.ts` | copy-only revision preserves the resolved visual spec (the `data-metrics` → `story-origin` regression), visual edits touch only named axes, no re-decision |
| `assetplan.test.ts` | zero slots ⇒ zero asset-service requests (controlled fixture), image-enabled pipeline resolves to an image-capable layout and makes real requests, supplied images suppress generation, slot ownership by rendered variant, placement verification, ZIP export carries assets + fonts + licences |
| `viewport.test.ts` | the REAL control surface in a real browser: 1440×900 / 390×844 simulated viewports, card resize changes only the scale, labels outside the canvas, fonts-ready + motion-frozen before a thumbnail is "ready" |

Regression checks that exist because of bugs found during this work: the
affinity/catalog drift check, the palette-guardrail lightness check, "no asset
is ever referenced from a path outside the output", copy-revision visual
preservation, and the header-safe download filename check.

---

## 7. Remaining limitations

1. **Live image evidence is one service, not a survey.** The live batch in
   `evidence/tables.md` §10 ran against the image service this environment provides (a CPU
   host): a direction with 5 renderable slots, **1 supplied → 2 requests** and **2 new jobs
   observed on the service**, 3 assets on the page, placement `ok, 3 checked, 0 issues`, image
   step 3,263 ms, ZIP 13 entries and `unzip -t` clean. The controlled fixture remains the
   request-counting control and the offline corpus stays offline so it reproduces
   byte-for-byte; a different provider's queueing, pricing and failure modes are unmeasured.
2. **A single best-fit run still converges across repeats.** By design: direction 1 is the page
   the brief most wants. The diversity lives in the SET — six directions spanning six
   compositions, 3–4 headline constructions and 3–4 treatments, several distinct in grayscale
   (`evidence/tables.md` §1) — and choosing among them is what the contact sheet is for.
3. **Palette spread is bounded by the decision distribution.** The offline local decider's
   marginals are peaked, so 54 directions used 3 of 11 palettes; the live-decided 54 used 4
   (`electric-acid` 18, `steel-signal` 18, `bone-terracotta` 17, `sage-mist` 1). Structure,
   typography and treatment are what the enforced targets move; hue diversity moves when the
   distributions do — Jev returns a full distribution per axis, but it is peaked too.
4. **Third-party image search is not implemented**, deliberately — user-supplied local images are
   the supported path, and a licensed search that cannot verify its licences would be worse than
   none.
5. **The visual blueprint is derived, not decided.** It is deterministic, validated and now
   seed-varied per direction, but the model has no say in it. Whether it should is an open
   question, not an oversight.
6. **Live Jev and live writer paths are environment-gated, and they ran here.** With
   `TYPESAFE_API_KEY` and an LLM key present, `test/diversity.test.ts` checks the targets
   against nine live-decided sets (all met) and `test/forge.test.ts` runs the writer, the
   decision and their composition — 277 passed / 0 failed / 0 skipped. On a machine without
   credentials those same checks skip *with the reason in the test name*, the offline corpus is
   unchanged, and `scripts/evidence.ts` records why its live phase did not run instead of
   dropping the rows.
