# TurboSlop — Dynamic-design plan

**Status: research and plan, nothing here is implemented.** Produced by six parallel
audits (generative-surface inventory, quantified sameness audit, modern-CSS capability
audit, generated-asset expansion analysis, state-of-the-art research, and a throwaway
six-page prototype). Numbers below are measured from `evidence/raw.json`,
`evidence/measure.json`, the 58 rendered pages in `evidence/pages/`, and the 11 recent
live designs in the run output — not estimates.

Owner's brief: *"more elements that were generated … if it requires more assets generate
them … drastically different designs every time … procedurally generate out of the design
elements and CSS tricks."*

---

## 1. The problem, measured

| symptom | measurement |
|---|---|
| layered CSS byte-identical on **all** pages | **93 %** (48,745 of 52,561 B) across the 58 measured pages; the same in the live run |
| CSS rules shared by all pages | **325 of ~333 per page** (97–99 %); only **42 of a 403-rule union** are page-unique |
| `motion` axis | `glacial` **54/54** |
| `motifFamily` | `contour` **54/54** |
| `tone` | `dark` **54/54** |
| palettes across 54 directions | **3 used of 11**, all near-black backgrounds (#05060a ×24, #000 ×20, #08080a ×10) |
| effects kits | **2 used of 9** |
| typefaces | **4 labels of 7**, but 46/54 pages embed the *same* `archivo-latin-var.woff2` |
| structural skeletons | **40 distinct for 54 designs**; 23 directions share a skeleton with another |
| module markup | **332 sections → 48 markup shapes**; 98 % reuse shapes seen on ≥2 pages |
| class names on every page | **10** (`wrap`, `sec`, `hgroup`, `eyebrow`, `hero`, `note`, `mono`, `footer`, `grain`, `atmosphere`) |
| h1 rendered size | only **10 distinct px values**; 8 of them cover 55/58 pages |
| images in the corpus | **0 of 58** |

Root cause: the generator **picks from bounded lists** (11 palettes, 7 typefaces, 9 effect
kits, 19 blueprints, 2–7 variants per module) and renders them through **one fixed markup
and stylesheet template**. The only genuinely seed-computed layers today are the blueprint's
≤4 bounded edits (`src/blueprint.ts`), the per-section recipe in `src/visual.ts:266-299`,
and the generated SVG motifs/frames. Everything else is a catalog index. The enforced
diversity fingerprint does not include the carriers that dominate perception — type program,
material/surface, ornament, motion, markup shape — so "9/9 targets met" is true and the
pages still read as one site.

### Dead or half-wired pieces found while auditing

These are cheap repairs and worth doing before building on top:

| finding | where |
|---|---|
| `composition` (7 values) is decided but **never reaches the renderer** | `src/compose.ts` (tokens) vs no use in `render.ts`/`blocks.ts` |
| `layout` (5 values) is decided but is **not part of a Direction** or the fingerprint | `src/compose.ts:198-205` |
| `@function --forge-space/--forge-ink-on` are defined and **never called** | `src/layout.ts:218-224` |
| `light-dark()` is emitted with **identical light/dark values** (a no-op) | `src/layout.ts:191-192` |
| `font-stretch: var(--head-width)` is emitted although **no bundled face declares `wdth`** | `src/visual.ts:517` |
| `<span data-year></span>` is emitted and **never populated** (footer year is empty) | `src/blocks.ts:792` |
| `.reveal--scale` is emitted twice with **no CSS rule** | `src/blocks.ts:214,229` |
| `data-reveal` attributes match no rule (the `.reveal` class does the work) | `src/blocks.ts` passim |

---

## 2. Target: a design compiler, not a catalog picker

**Principle.** A *variant* randomizes one axis. A *different site* re-derives the strongest
identity carriers **together** from one seed — type voice, macro composition, material/medium,
ornament language, motion cadence, imagery — with covariation so the result stays coherent.

**Proof.** The throwaway prototype (`/tmp/opencode/proto/`, not committed) drove **six
full-page designs from one shared 2.6 KB content object**, offline, no service, no libraries:

| prototype measure | value |
|---|---|
| CSS unique to each page | **5.7–8.2 KB, ~99 % own stylesheet** (only the reset overlaps) |
| selector Jaccard between designs (mean / max) | **0.029 / 0.094** — near-disjoint vocabularies |
| structural skeletons | **6 distinct**, DOM nodes 207–765 |
| generated inline SVG shapes | 37–**454** per page |
| first-fold pixel difference (coarse) | mean **42.8 %** |
| page height | 900–3,568 px |

**Proposed shape** — every layer is a *generator* with a seeded PRNG, a bounded output and a
fallback, not a list:

```
brief ──► Jev semantics (prior + constraint, not an index)
              │
              ▼
        DESIGN DNA  (one JSON per direction: material · type · grammar · ornament · motion · palette · imagery)
              │
   ┌──────────┼───────────┬───────────┬────────────┐
   ▼          ▼           ▼           ▼            ▼
tokens/type  layout     material/    motion      imagery
+ palette    grammar    ornament     identity    (code + service)
   └──────────┴───────────┴───────────┴────────────┘
              │
              ▼
        one self-contained HTML page, byte-identical for (seed, inputs)
```

### Layer-by-layer

| # | layer | today | generate instead | new/changed code | fallback |
|---|---|---|---|---|---|
| 1 | **Design DNA** | implicit: Jev picks + selector | one seeded spec object; Jev's answers become a *prior* the seed samples within (semantics preserved) | new `src/dna.ts` (+ move `mulberry32` to `src/rand.ts`) | DNA with fixed defaults reproduces today's output |
| 2 | **Palette + tokens** | pick 1 of 11 hex palettes; 51 custom props mostly constant | derive OKLCH hue/chroma/lightness chains from the seed *conditioned on* Jev's emotion; contrast is a constraint, not a check; radii/rules/shadow/spacing from the same stream | `src/layout.ts` (tokens), new generator in `src/dna.ts` | curated palette nearest the seed; `prefers-contrast` keeps AA |
| 3 | **Typography** | 7 typefaces collapsing to 5 files; 5 constructions; `alignment` always `start`; scale a formula | seeded type program: construction, alignment, measure, scale ratio, weight/tracking program, variable-font axis positions (bundled `wght`/`opsz`), per-section type treatments | `src/visual.ts`, `src/fonts.ts` | static weight; bundled faces unchanged |
| 4 | **Layout grammar** | 19 blueprints × ≤4 bounded edits; one markup template per module variant | seeded `grid-template-areas`/span grammar + per-section recipes; module *shapes* as generated structures (still one validation entry point) | new `src/grammar.ts`, `src/blocks.ts` renderer contract | today's blueprints become one grammar family |
| 5 | **Material + ornament** | one motif per page (family from emotion, role seeded); fixed kits; 4 treatments | seeded surface programs: tileable SVG pattern, `feTurbulence` grain, ornament algebra (dividers/rules/marks), clip-path silhouettes, `border-image` edges, blend/isolation programs; multiple ornaments per page with containment rules | new `src/surface.ts`, extend `src/motifs.ts` + `src/visual.ts` | flat ground + the existing plate gradients |
| 6 | **Motion identity** | `--dur/--ease/--tempo` from 6 picks; one reveal animation | seeded easings/durations/stagger + named scroll timelines, sticky decks, view transitions; generated `prefers-reduced-motion` and print defaults | new `src/motion.ts`, `src/layout.ts` | static page, no animation |
| 7 | **Imagery** | 256×256 service images in slots; code-generated motifs/frames/icons | code-generated first: tileable pattern, ornament band, section numbering, generative data-viz (from real numbers only), icon sheet growth, frame kinds. Service second: about/portrait figure (+1 image), section ground texture (+1), feature spot illustrations (+≤3) | `src/motifs.ts`, `src/frames.ts`, `src/icons.ts`, `src/blueprint.ts` (slots), `src/images.ts` (templates) | code layers always; service slots keep their CSS plates |

Invariants that must not change: offline reproducibility (same seed + inputs →
byte-identical page), zero runtime deps, **no JS in the page**, no remote requests, no
invented facts, AA contrast, no horizontal overflow, print and reduced-motion fallbacks, and
the enforced-diversity contract with a measured report.

---

## 3. Diversity and evidence must grow with the generator

If the fingerprint does not see the new identity carriers, the selector will happily pick six
pages that differ only in ways it can measure. Two changes are prerequisites, not cleanup:

1. **Extend the fingerprint** (`src/fingerprint.ts`) with the new dimensions — type program,
   material/ornament family, layout-grammar hash, motion identity, markup-shape hash — and
   keep the existing weights/thresholds meaningful. Targets and shortfall reasons continue to
   be reported per set.
2. **Extend the evidence** (`scripts/measure.ts`, `scripts/report.ts`) with distinctness
   gates borrowed from the prototype: unique-CSS share per page, pairwise selector Jaccard,
   skeleton-hash distinctness, generated-SVG shape counts, contrast sample audit,
   running-animation count under `prefers-reduced-motion`, plus the existing overflow/id/anchor
   checks. A new table section reports them; the README badge story stays generated.

---

## 4. Phased plan

Effort is relative (S / M / L), risk is the chance of a quality or determinism regression.

| phase | deliverable | tests / evidence | risk | effort |
|---|---|---|---|---|
| **0. Repair** | fix the dead wiring in §1; wire `composition` → layout *or* delete it; make `light-dark()` real or drop it; populate the year; align reveal attributes/classes | existing suites; no number movement in `tables.md` except tests | none | S |
| **1. Computed tokens + type** | `src/dna.ts` + generators; palettes/type programs derived, not picked; contract: same seed → same program | new determinism test (byte-identical page per seed); contrast gate per design; evidence: distinct palette/type programs | M | M |
| **2. Material + ornament** | `src/surface.ts`: pattern/grain/ornament/silhouette/edge programs; multiple seeded ornaments per page | snapshot byte-determinism; "no remote refs" test; shape budgets; contrast with overlays | M | M |
| **3. Layout grammar** | `src/grammar.ts`: generated structure + markup shapes, replacing the single module template with a validated grammar | grammar validation (content fit, anchors, ids, heading order); a11y and overflow gates; evidence: skeleton-hash distinctness | H | L |
| **4. Motion identity** | `src/motion.ts`: seeded cadence + scroll timelines/sticky decks/view transitions | reduced-motion count == 0; print static; no layout-shift budget | M | M |
| **5. Imagery expansion** | code-generated pattern/ornament/numbering/data-viz; new service slots (about figure, ground texture, feature spots) with templates and prompts | request counting per slot (fixture); flat-frame rejection; placement verification; prompt budget per emotion | M | M |
| **6. Reconcile** | tables, README/ARCHITECTURE/LAYOUT-DIVERSITY, report §4 rows, live evidence re-run | full suite + journeys + evidence regeneration | M | M |

Suggested first slice: **Phase 0 + Phase 1**, then re-measure. Phase 1 alone should move the
stylesheet from 93 % identical to genuinely per-design, because the token layer is the ~51
custom properties declared on every page and only a handful of them differ today.

---

## 5. Risks and non-goals

- **Random soup.** Uncurated randomness produces incoherent pages. The prototype's lesson:
  structure separates designs, but tonality did not (three light designs sat only 8–12 %
  apart in the coarse pixel metric) — so structure and material must vary **together** under
  a coherence rule set. Keep constraint sets curated and small; generate *within* them.
- **Perf budget.** Page CSS is already 59–72 KB inlined. Cap rules, shapes and gradients per
  design; keep scroll-driven animation cheap; no per-frame filters.
- **Accessibility.** Contrast is a constraint in the token generator, decorative SVG stays
  `aria-hidden`, generated charts need text alternatives, heading order and focus styles are
  asserted.
- **Determinism.** No `Math.random`, no `Date.now`, no CSS `random()` (still experimental and
  unseeded cross-engine), no Houdini `paint()` as a core layer (Chromium-only), no live WebGL
  background (mobile thermals, driver-variant output).
- **Cost.** Image requests stay capped and opt-in; code-generated elements come first;
  zero-slot ⇒ zero requests stays a hard rule.
- **Non-goals.** Frameworks, page runtime JS, CDNs, "infinite" randomness without curation,
  pixel-identical engines (fonts and filters may differ marginally).

---

## 6. Prototype appendix (throwaway, not committed)

`/tmp/opencode/proto/` — `content.ts` (one object), `build.ts`, `art.ts`, six pages
(`editorial`, `bento`, `poster`, `scroll`, `split`, `brutal`), `metrics.json`, `shots/`.
The prototype also produced the real gate list above and three implementation warnings worth
carrying into the build: decorative layers need their **own containment contract** (a broad
`.panel > *` selector moved one); the emphasis convention needs **type-level enforcement**
(a `Text` wrapper, not caller discipline); and reduced-motion/print must be **generator
defaults**, not per-design hand work.
