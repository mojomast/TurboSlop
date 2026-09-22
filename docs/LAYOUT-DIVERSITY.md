# Layout diversity — findings and implementation

**Revision:** `c4cef66` (baseline measured at `48687b3`)
**Baseline artefacts:** [`baseline/`](../baseline/) — 33 screenshots, 11 specs, `structure.json`, `timings.json`, `FINDINGS.md`

---

## 1. The problem, measured

Before any change, a subagent captured a baseline of 11 designs across 7 briefs —
shop, event, editorial publication, software product, service business, artist
portfolio, technical offering — **plus three runs of one brief left completely
unchanged** as a control. Full report in [`baseline/FINDINGS.md`](../baseline/FINDINGS.md).

| | Baseline |
|---|---|
| Distinct section orders | **2 across 11 designs** — one order used by 9 of them |
| Compositions actually selected | 4 of 7; **3 were never chosen at all** |
| Three identical `shop` runs | **near-identical** — same 8/8 axes, same composition, same section order, same block types. Only the prose differed |
| Navigation | fixed template in 11/11 (sticky bar, 4–5 labels) |
| Footer | fixed template in 11/11 (4-block single column) |
| Contact | fixed template in 11/11 (form + email + phone) |
| First-screen geometry | this *did* vary (h1 72–142.8px, 3–7 lines, 4 shapes) |
| Images | 2 generated, **0 rendered** — the chosen layout had no image slot |

Two defects surfaced that were not part of the stated problem:

- **`organic-mesh` overflowed horizontally** — 1568px at a 1440px viewport, 413px
  at 390px. Cause: `.sec::before { inset-inline-end: -10% }`.
- **Generated artwork was discarded.** The image batch ran, then the selected
  layout had nowhere to put the result.

The conclusion was unavoidable: the pages were one design family wearing different
palettes. One top-ranked choice per axis, one of seven whole-page templates, and a
content schema that always demanded the same modules.

---

## 2. The architecture

### 2.1 Blueprint — content separated from arrangement

`src/blueprint.ts`. A blueprint is a typed, validated description of layout:

```
lead         statement | product | catalogue | story | date | data | image | offer
hero         display | split | compact | panel | media | index | dateline
nav          bar | bar-cta | minimal | inline-links | stacked | none
footer       masthead | columns | minimal | cta-band | ledger | colophon
sections     an ordered subset of modules, each with a block variant
grid         columns, max-width
rhythm       tight | even | generous | dramatic
imageSlots   how many images the layout wants (0 is legitimate)
requires     the content modules it needs written
```

`src/blocks.ts` renders every module per variant — 11 modules, 34 variants.
`src/render.ts` assembles nav → hero → sections → footer from the blueprint.
**There is no fixed spine.** This is the structural change: the page's shape is data.

Current catalog: **19 blueprints**, all 8 leads represented, **19 distinct section
orders**, 6 nav variants, 7 hero variants, 6 footer variants, 4 rhythms, 7 that
need no images at all.

`validateBlueprint` enforces compatibility — a `date`-led page needs a `schedule`;
a `product`-led page must open with `items` or `features`; a `media` hero needs an
image slot; four or more sections need navigation; `imageSlots > 0` requires a
module that can show an image. Writing this caught a real inconsistency
(`story-origin` wanted 2 image slots with no module able to display one).

### 2.2 Direction selection

`src/directions.ts`. Jev already returns a **full probability distribution per
axis**; the previous model threw all but the argmax away. Now:

1. Each axis contributes its top few alternatives as a candidate pool.
2. Candidates are scored for **fit** and filtered for **coherence** (an axis
   combination that violates the emotion's affinity model is dropped, not
   rendered).
3. A **set** is selected under a diversity objective with escalating minimum
   separation, preferring a different blueprint *family* per direction.
4. Selection is **seeded and deterministic**.

Two things worth stating plainly:

> **`fit` is not a probability.** It is a weighted sum of independent per-axis
> probabilities plus a structural term. The axes are chosen independently by the
> model; treating the product or sum of their marginals as a joint probability
> for a page would be meaningless. It is a ranking device.

> **Fit initially ignored structure entirely.** It scored only the styling axes,
> so every candidate sharing a palette tied and all 19 blueprints scored
> identically — "fit-first" was meaningless and the layout was being chosen purely
> by the novelty pass. Structure now carries 55% of the weight, via an explicit
> emotion→lead affinity table plus a weak lexical match against the blueprint's own
> description.

### 2.3 The fit-first / explore dial

`explore` 0..1 controls how far outside the brief's most natural leads the
selector may range. Measured on the `shop` brief:

| `explore` | directions | families | min pairwise distance |
|---|---|---|---|
| `0` (fit-first) | 6 | 3 | 0.50 |
| `0.45` (default) | 6 | **6** | 0.70 |
| `1` (explore) | 6 | **6** | 0.82 |

At `0.45`, **every brief tested produced 6 directions across 6 different
families.** Novelty is never forced past usefulness: selection stops when nothing
remaining is within 55% of the best candidate's fit.

### 2.4 Content follows the layout

The content schema's modules are now optional, and the writer is asked **only for
the modules a blueprint needs**. A `manifesto` page is not billed for six
catalogue entries. A blueprint that cannot be filled honestly is reported
(`validateContentForBlueprint`) rather than fabricated.

Provenance ("how this was built") moved out of the page's chrome into a popover
and the spec, so the header and footer serve the brief's own brand.

---

## 3. Before / after

### 3.1 Same brief, six directions

| | Baseline (11 designs) | Now (one brief) |
|---|---|---|
| Distinct section orders | 2 | **6** |
| Distinct leads | — | **6** |
| Distinct heroes | 4 | **6** |
| Minimum pairwise structural distance | not measured | **0.70–0.84** |

### 3.2 Same brief, six repeated CLI runs

The baseline's control, repeated. The three identical shop runs were
near-identical before.

| | Baseline | Now |
|---|---|---|
| Distinct blueprints | 1 | **3** |
| Distinct section orders | 1 | **3** |
| Distinct block sequences | 1 | **3 of 6** |

**This is not yet 6 of 6, and it is worth being precise about why.** Each run
selects its own set's *best fit*, and the best fit for a ceramics shop is
consistently a statement-led page. The diversity now exists **in the set** — the
workflow that surfaces it is the contact sheet, which is the gap listed in §6.

### 3.3 Structural fingerprint

Fingerprints intentionally exclude HTML length, class names, colour and copy —
each of which can differ while the page reads identically. They are built from
`lead | hero | nav | footer | columns | rhythm | section sequence`:

```
fingerprintDistance(a, b)        0 = identical structure, 1 = nothing in common
```

Same-family blueprints sit ≈0.5–0.66 apart; different families ≈0.8–1.0. Those
bands are what the minimum-separation thresholds are tuned against. A test asserts
all 19 blueprints have unique fingerprints and that the closest pair differs by at
least 0.18.

---

## 4. Measured latency and cost

Baseline: 11 designs, live decider and writer throughout.

| | Baseline | Now |
|---|---|---|
| Cost per design | $0.00113 | **$0.00105** |
| Writer (dominant leg) | 6.1–8.1 s | 5.4–7.5 s |
| Decide (Jev) | 320–452 ms | 300–560 ms |
| Writer share of spend | 87.5% | ~85% |

Cost is flat-to-slightly-lower despite the writer now receiving a *narrower*
request and the pages being structurally richer. Thinking mode being off
(see [`JEV-RESEARCH.md`](JEV-RESEARCH.md)) is what keeps the writer leg near 7s.

Six-direction batch: **45.2 s and $0.0063 total** (~7.5 s and ~$0.001 each).

---

## 5. Tests

**81 offline checks pass** (`npm test`) — no keys, no network, no GPU.

| Suite | Checks | Notable additions |
|---|---|---|
| `test/forge.test.ts` | 47 | blueprint validation; catalog-wide fingerprint uniqueness; lead coverage; "no single section order is used more than twice"; every blueprint renders with resolvable nav anchors; ≥12 distinct *rendered* structures; reasoning-control field names |
| `test/images.test.ts` | 24 | payload validation, path-traversal refusal, PNG magic bytes, foreign-job filtering, ambiguous submissions |
| `test/zip.test.ts` | 10 | CRC-32 vectors, real `unzip` round-trips, DEFLATE vs STORE selection |

Two regression checks exist specifically because of bugs found during this work:

- **Every local-decider affinity id must exist in the catalog.** Ten typography
  ids pointed at typefaces that were planned but never landed, so that axis of
  variety was silently dead.
- **The palette guardrail must derive lightness from the palette**, not from a
  hardcoded list of names — the list had drifted when a palette was renamed.

---

## 6. Remaining limitations

Stated plainly rather than left implied.

1. **The contact-sheet workflow is not built.** `buildDirections` produces the
   set and the pipeline exposes it via `onDirections`, but the control surface
   does not render a contact sheet, compare desktop/mobile previews, lock aspects,
   or regenerate the others. **This is the largest gap against the brief**, and it
   is what would turn §3.2's 3-of-6 into a deliberate choice among 6.
2. **No fast preview path.** Candidate previews still require a full writer call
   each. The intended design — render candidates locally from a brief-driven
   content inventory, then write final copy only for the chosen direction — is not
   implemented. A six-direction batch costs 6 writer calls.
3. **No matched after-screenshots.** The baseline has 33 screenshots at known
   briefs and seeds; the "after" set was not captured at the same inputs, so the
   before/after evidence here is structural and numeric rather than visual.
4. **Fingerprints are blueprint-derived, not measured from rendered geometry.**
   They use the rendered block sequence and variant attributes; hero box
   dimensions, grid spans and actual section box heights are not fingerprinted. A
   page could pass a structural metric and still *look* the same.
5. **Image slots are not blueprint-aware at generation time.** The generator still
   cycles backdrop/surface/motif rather than producing what each blueprint's slots
   want. The instance the baseline found (the `index` hero discarding its backdrop)
   is fixed; the general case is not.
6. **Contact details are still invented** by the writer for fictional brands. They
   remain required because every blueprint emits a contact section, so "preserve
   the brief's actual facts" is only partly honoured here.
7. **`src/compositions.ts` is dead code.** The renderer no longer uses it; the
   seven whole-page builders it contains have been superseded by `blocks.ts`.
8. **The explore dial is not surfaced in the UI** — it is a pipeline/CLI option.

---

## 7. Reproducing any of this

```bash
cd turboslop
. "$HOME/.config/atelier-null/jev.env"; . "$HOME/.config/atelier-null/llm.env"

npm test                       # 81 offline checks
npx tsc --noEmit               # strict typecheck

# one design, blueprint-driven
npx tsx src/cli.ts --brief "A shop selling hand-thrown ceramic tableware." --out out

# the direction set for one brief (prints blueprints, fit, novelty)
# see test/forge.test.ts for the assertions over BLUEPRINTS and buildDirections

# the baseline, for comparison
cat baseline/FINDINGS.md
cat baseline/timings.json
```
