# TurboSlop — Architecture

*Machine-made, human-judged.* A brief goes in; a designed, written, illustrated
page comes out — reproducibly, with every decision typed and scored.

This document describes how the current implementation is put together. The
implementation report (`docs/IMPLEMENTATION-REPORT.md`) maps every requirement
to the evidence that verifies it; this file is the map of the code.

---

## 1. The pipeline, and its budgets

```
        brief
          │
          ▼
   ┌──────────────┐  one decision call (Jev or the local stand-in)
   │   DECIDE     │  full distribution per axis, calibrated confidence
   └──────┬───────┘
          ▼
   ┌──────────────┐  bounded candidate search over resolved designs:
   │  SELECT      │  layouts × styling, near-duplicate rejection,
   │ (diverse set)│  project history, coverage targets → direction set
   └──────┬───────┘
          ▼
   ┌──────────────┐  ONE shared content inventory for the whole set
   │    WRITE     │  (specimen when no writer is configured)
   └──────┬───────┘
          ▼
   ┌──────────────┐  N local renders — no model involved
   │    RENDER    │  resolved spec + visual recipes + asset slots
   └──────┬───────┘
          ▼
   ┌──────────────┐  pick one → optional final-copy writer call →
   │  FINALIZE    │  shared asset plan (supplied first, generate the rest)
   └──────┬───────┘  → placement verification → export
          ▼
   ┌──────────────┐  scoped revision of the chosen resolved spec:
   │   REVISE     │  copy-only preserves everything visual; visual edits
   └──────────────┘  touch only the axes the request names
```

Budgets, enforced by construction and shown in the control surface:

| step | model calls |
|---|---|
| preview set of N directions | 1 decision + at most 1 inventory write |
| selection, locks, regeneration | **0** (stored decision + stored inventory) |
| finalizing the selected direction | at most 1 writer call (final copy) |
| revision | 0 or 1 writer call — never a re-decision |
| rejected candidates | **0** image requests; previews generate no images at all |

---

## 2. Layers

### 2.1 Decision — `decider.ts`, `questions.ts`, `compose.ts`

Jev (or the deterministic local stand-in) answers one question per axis and
returns a full probability distribution per axis, not just an argmax.
`compose.ts` turns the answers into a typed `DesignSpec`: composite scoring is a
weighted sum of per-axis confidences (weights live in `questions.ts`), and any
axis below its threshold is flagged for review rather than silently shipped.

### 2.2 Selection — `directions.ts` + `fingerprint.ts` + `history.ts`

Diversity is an **enforced property of the generated set**, measured on
resolved-design fingerprints:

- `fingerprint.ts` defines the feature vector: composition (lead, hero,
  navigation, footer, grid, rhythm, block sequence), typography proportions
  (construction, measure, scale, weight, tracking, alignment, label style),
  imagery (treatment, motif family/role, slot count and scale), and surface
  (tone, density, effects, motion). `featureDistance` and
  `grayscaleDistance` (hue and motion terms dropped) are weighted sums over
  those features — *measurable separation within a set and against recent
  history*, never a claim about perceptual uniqueness.
- `directions.ts` runs a **bounded** search: ≤ `MAX_STYLING` (48) styling
  combinations per structure, ≤ 57 structures (19 blueprints × base + ≤2
  bounded variants), ≤ `MAX_CANDIDATES` (2400) total. Exact-key
  de-duplication, then explicit near-duplicate rejection
  (`NEAR_DUPLICATE`), then project-history separation
  (`HISTORY_SEPARATION`), then content-availability filtering.
- Two selection inputs are not "the brief": when the run will place images
  (`wantsImages`), layouts with zero image slots are dropped so an enabled
  image setting cannot resolve to "generated but never rendered" (a lock, or
  a pool with nothing capable left, is honoured and the asset plan then says
  why no request was made); and a standalone run (`freshLeads`) skips the
  leads the newest three history entries used, so pressing "generate" again
  opens on a different KIND of page instead of another variant of the last one.
- Selection keeps the best-fit direction first, then adds alternatives under
  an escalating minimum separation (`MIN_SEPARATION`, grayscale separation)
  with coverage bonuses for compositions, headline constructions and
  treatments the set does not have yet. `targetsFor(count, explore)` sets the
  targets — at maximum exploration: 6 directions spanning ≥4 compositions,
  ≥3 headline constructions, ≥3 treatments, several members distinct in
  grayscale — and `reportDiversity` reports any shortfall **with the reason**
  instead of padding the set with bad fits.
- `history.ts` persists recent resolved fingerprints per **project**
  (`FORGE_PROJECT`, file `out/.history/<project>.json`). Selection takes a
  snapshot first and the session records the snapshot's keys, so
  (versioned inputs, seed, snapshot) reproduces a run exactly. The current
  session's own entries are excluded from its own regeneration.

### 2.3 Layout blueprint — `blueprint.ts`

A blueprint is a typed, validated description of arrangement: lead, hero, nav,
footer, ordered section modules with block variants, grid, rhythm, image slots.
Validation refuses layouts that cannot be filled honestly (a date-led page
without a schedule, an image hero without a slot, an offer without a route to
act on).

**Bounded variation** (`varyBlueprint`) makes blueprints composable starting
points: block-variant swaps, section reordering (never the lead-critical
opener), hero-geometry swaps within lead compatibility, nav/footer/chrome
swaps, rhythm and width steps, and module additions — each committed only if
the result still validates. The variant's id (`base~seedhexbucket`) encodes
its own rng seed and explore bucket, so `resolveBlueprint(id)` rebuilds the
identical layout from the id alone: stored specs, exports and old preview
links all resolve to what actually rendered.

### 2.4 Visual blueprint — `visual.ts`

Derived — never decided — from (blueprint, typeface, emotion, density,
direction seed): hero recipe, typographic recipe (headline construction,
measure, scale, weight, width axis, tracking, wrap strategy, label style),
per-section recipes (bleed, alignment, whitespace, image ratio), motif family
and role, image treatment, frames, icons. `TYPO_COMPAT` states the
compatibility rules explicitly and `validateVisualBlueprint` enforces them on
every render. The **direction seed** (`directionSeedFor(sessionSeed,
directionId)`) keeps a batch from inheriting one decoration while staying
reproducible.

### 2.5 Content — `content.ts`, `writer.ts`

The inventory schema, its tolerant repair pass, the honest specimen fallback
and `validateContentForBlueprint` live here. Nothing about a particular company
is baked in; missing content renders an honest "not supplied" note (or, for
structured blocks like pricing and galleries, is treated as *unavailable* so
selection never justifies it with a diversity target) and surfaces as a
diagnostic in the control surface. `reviseContent` rewrites copy against the
existing content and never touches the spec.

### 2.6 Assets — `assetplan.ts` (one shared path)

The UI, sessions, CLI and exports all go through `planAssets` /
`finalizeAssets`:

1. **Slot ownership** is validated against the rendered module *variant* and
   available content (`renderableSlots`): an `items:table` draws no plates; an
   empty gallery renders no figures.
2. Supplied images resolve first (alt, dimensions, source, credit, licence
   preserved), and their slots are removed from the generate list.
3. Generation is opt-in and capped by what is left — **zero renderable slots
   produce zero requests**.
4. After render, `verifyAssetPlacement` proves each asset is inside *its*
   `data-slot` element; finding a URL elsewhere in the HTML is not evidence.

### 2.7 Rendering — `render.ts`, `blocks.ts`, `layout.ts`, `styles.ts`, `frames.ts`, `motifs.ts`, `icons.ts`, `fonts.ts`

The blueprint's structure is data: unique stable section ids, navigation
labels matched to their targets, honest contact handling, CTAs only where an
anchor exists, and `data-slot` markers on every plate. Fonts are bundled OFL
faces with licences and make no remote request. Frames and motifs are
rendered in code from palette tokens; icons come from two vendored families —
the original set and Lucide (ISC, pinned commit) — and a page draws exactly
one family, chosen by its seed.

### 2.8 Sessions — `sessions.ts`

A session owns the decision, the inventory, and every direction's **resolved
specification**: the exact `DesignSpec`, visual recipes, content, image slots,
diagnostics and fingerprint that produced each preview. Finalizing reuses that
stored spec verbatim, so a selected alternative can never revert to the
model's original top-ranked choices.

- **Locks** are `{name, value, fromIndex}`: an explicit value bound to an
  explicit source card. Names and values are validated
  (`validateLocks`), cross-lock combinations are checked
  (`assertLocksAreCompatible`, e.g. composition ⊆ blueprint), and locks are
  applied **during** constrained selection — fit and separation are then
  recomputed for the constrained set. Unknown names are rejected with the list
  of what can be locked.
- **Batches are immutable**: regeneration writes `previews/<sid>/b<n>/…`,
  archives the outgoing batch in `session.versions` and never rewrites its
  files, so saved preview links and backtracking keep working.
- **Revision** (`reviseSession`, backed by `revise.ts`) is a scoped change to
  the finalized resolved spec, deliberately separate from both regeneration
  and "explore new directions": copy-only edits preserve layout, styling, seed
  and assets byte-for-byte; visual edits start from the *selected tokens* and
  touch only the axes the request names.

### 2.9 Server and control surface — `server.ts`, `public/index.html`

Plain `node:http`, no build step. The surface renders previews inside **real
simulated viewports** — 1440×900 desktop, 390×844 mobile — scaled to fit their
cards (resizing a card changes only the scale), with an expanded/full-page
comparer, labels and diagnostics outside the canvas, fonts/assets awaited and
motion frozen before a thumbnail is considered ready, per-card locks with
visible values and sources, the diversity report and candidate statistics,
missing-content diagnostics, batch browsing, and an image upload flow with
slot assignment.

### 2.10 Export — `export.ts`, `zip.ts`

One export path: `index.html`, the full decision record, every asset with its
metadata, bundled fonts **with their licences**, a `README.md` documenting the
run, and a self-contained single file with fonts and artwork inlined.
`contentDisposition()` RFC-6266-encodes any non-ASCII download name (the one
reproducible Unicode-filename failure mode — see §5).

---

## 3. Data contracts

| artefact | shape | notes |
|---|---|---|
| `DesignSpec` | zod schema (`types.ts`) | typed decisions, tokens, blueprint id, seed, assets |
| session | schema `version: 2` | decision, inventory, directions with `resolvedSpec`, `versions[]`, `locks[]`, `diversity`, `stats`, metrics |
| history | `out/.history/<project>.json` | `{version:1, entries:[{key, features, at, source, seed}]}`, capped at 96 |
| fingerprint | `DesignFeatures` | see `fingerprint.ts`; `SELECTION_VERSION = turboslop/directions@2` |

Reproducibility inputs, all recorded: `SELECTION_VERSION`, session seed,
per-batch seed, per-direction seed, and the history snapshot keys
(`session.historyKeys`).

---

## 4. Determinism

- Local decider, `compose`, blueprint variation, candidate shuffles, motif
  generation and section recipes are seeded and pure.
- Regeneration derives its batch seed from the session's own inputs
  (`session.seed + batch·7919` unless overridden) — never `Math.random`.
- Same versioned inputs + same seed + same history snapshot ⇒ same direction
  set, asserted by `test/diversity.test.ts`.

---

## 5. Testing and evidence

`npm test` runs 13 suites — 277 checks passed, 0 failed, 0 skipped when credentials are
present (the live Jev / writer halves run); without keys those same checks skip with the
reason in their name. See `evidence/tables.md` §8 for the generated counts. Evidence is
produced by:

```bash
npm test 2>&1 | tee evidence/tests.txt
npx tsx scripts/zip-unicode-check.ts | tee evidence/zip-unicode.txt
npx tsx scripts/evidence.ts --out evidence        # corpus + fixture + live phase + browser measurement
npx tsx scripts/calibrate.ts --evidence evidence  # fingerprint vs rendered geometry
npx tsx scripts/report.ts --evidence evidence     # evidence/tables.md
```

`scripts/measure.ts` loads every page in real Chromium at 1440×900 and
390×844 and records section geometry, image use and upscale factors, overflow,
duplicate ids, broken anchors and first-screen shapes. The image-evidence run
uses a **controlled local fixture** of the image-service API and labels itself
as such; the evidence run's **live phase** (tables §10) additionally talks to
the real services the environment provides — Jev, the writer and the image
service — and records either what happened or the reason it could not run.
There is no live-service claim without a live service.
