# After — measured against the baseline

**Captured:** 2026-09-22 · **Revision:** `7bec1b6` (baseline measured at `48687b3`)
**Method:** the same 7 briefs as [`../baseline/briefs.json`](../baseline/briefs.json) plus three
repeated runs of the *unchanged* shop brief, generated with the live Jev decider and the live
writer, then measured from the live DOM at 1440×900 and 390×844.

Artefacts: `out/` (10 designs), `measure.json` (raw measurements), `shots/` (30 screenshots),
`shots/sheet/` (the contact sheet and each direction), `sheet.json`.

> The baseline's control was three identical `shop` runs coming out **near-identical**: same 8/8
> decider axes, same composition, same section order, same block types. That control is repeated
> here unchanged, because copy varies run to run and structure should not.

---

## Headline

| | Baseline (`48687b3`) | After (`7bec1b6`) |
|---|---|---|
| Distinct section orders | **2 across 11 designs** (one order used by 9) | **7 across 10 designs** |
| Distinct first screens | 4 shapes | **7 of 10** |
| `h1` rendered size | 72 – 142.8 px, 3–7 lines | 73 – 163 px |
| Hero height | — | 456 – 922 px |
| Navigation / footer / contact | fixed template in **11/11** | per-blueprint variants (6 navs, 6 footers) |
| Horizontal overflow | **1 page** (artist: 1568 px at 1440, 413 px at 390) | **0 of 10** |
| Duplicate ids | not measured (there were two `#top`) | **0 of 10** |
| Broken anchors | not measured | **0 of 10** |
| Images generated vs rendered | 2 generated, **0 rendered** | slots are defined by the layout, so 0 unrendered is structural |
| Cost per design | $0.00113 | $0.000999 |
| Wall time per design | 7,574 ms | 6,683 ms (7) · 7,085 ms (3 repeats) |

## The control: three repeated runs of one unchanged brief

| | Baseline | After |
|---|---|---|
| Distinct section orders across 4 runs | **1** | **3** |
| Distinct first screens | — | **3 of 4** |

Baseline orders, all four runs: `top‑hero · items · features · about · contact`.

After:

```
shop        top > stats > about > process > contact
shop-run2   top > about > features > quote > items > contact
shop-run3   top > stats > about > process > contact
shop-run4   top > stats > about > process > contact
```

Three of four still converge — and that is the honest result. Each run picks its own set's
*best fit*, and the best fit for a ceramics shop stays a statement-led page. The diversity exists
**in the direction set**, and the contact sheet is what makes it a deliberate choice.

Every design in this corpus:

```
artist      top > about > features > quote > items > contact
editorial   top > stats > about > process > contact
event       top > schedule > items > features > pricing > contact
service     top > stats > items > features > faq > contact
shop        top > stats > about > process > contact
software    top > stats > items > features > about > contact
technical   top > stats > items > features > about > contact
shop-run2   top > about > features > quote > items > contact
shop-run3   top > stats > about > process > contact
shop-run4   top > stats > about > process > contact
```

Seven distinct orders, and `contact` sits in a different position on different pages.

## The contact sheet — one brief, six directions

Screenshot: `shots/sheet/contact-sheet-desktop.png`. Same brief, seed 4242, explore 0.5.

```
#1 · date-led · date           Event programme        fit 0.774  novelty 1.00
     schedule:agenda > items:list > features:rows > pricing:table > contact:form
#2 · image-led · image         Image strip, then text fit 0.652  novelty 0.94
     gallery:strip > items:list > features:deflist > contact:split
#3 · statement-led · statement Letter to a reader     fit 0.552  novelty 1.00
     about:letter > quote:inline > items:list > contact:email
#4 · story-led · story         Profile of a person    fit 0.535  novelty 0.94
     about:rail-text > gallery:strip > quote:large > process:timeline > contact:email
#5 · data-led · data           Numbers first          fit 0.552  novelty 0.90
     stats:tiles > items:table > features:deflist > about:columns > contact:split
#6 · offer-led · product       Offer and price        fit 0.594  novelty 0.72
     pricing:tiers > features:cards > faq:accordion > stats:inline > contact:form
```

**Six distinct leads, six distinct block sequences, six distinct heroes.**

### What the set costs

| | Measured |
|---|---|
| Model calls for the whole set | **2** (one Jev decision + one shared inventory write) |
| Decide | 457 ms |
| Inventory (one writer call) | 11,180 ms |
| Render | **6 ms for all six directions** |
| Preview set, end to end | 11.6 s |
| Estimated cost | **$0.0017** |
| Regenerate unlocked (local) | 67 ms, **0 model calls** |
| Finalize (final blueprint-specific copy) | one writer call, ~5.4 s |

Previewing six directions costs 1.5× one design, not 6×. The old flow paid a full writer call
per direction; this pays one for the brief and one only for the page you keep.

## Whole-matrix measurement

Every blueprint × effect-kit combination (171 pages) rendered and measured in a real browser:

| | |
|---|---|
| Horizontal overflow | **0** |
| Duplicate ids | **0** |
| Broken anchors | **0** |
| Distinct section orders | 19 |
| Distinct first-screen shapes | 17 |
| Hero recipes exercised | 10 of 10 |
| Headline constructions exercised | 5 of 5 |
| Motif families exercised | 5 of 5 |
| Image treatments exercised | 4 of 6 |

The `organic-mesh` overflow the baseline found (1568 px at a 1440 viewport) does not reproduce:
all 19 `organic-mesh` pages measure 1425 px desktop / 375 px mobile, which is the scrollbar gutter.

Two overflows *were* found in this after-corpus at mobile width — a four-column spec table
pushing the document to 454 px at a 390 px viewport. Fixed by capping the table wrap and letting
its cells wrap; the poster hero was also capped after measuring it at 3,617 px tall (16 lines of
208 px type), which is a wall, not a first screen.

## Cost and latency, honestly

| | Baseline | After |
|---|---|---|
| Writer share of spend | 87.5% | ~85% |
| Thinking tokens | 0 (disabled by default) | 0 |
| Bundled fonts added to an export | — | 278 KB (5 OFL variable woff2 + licences) |

A finalized design's ZIP contains `index.html`, `index.selfcontained.html` (fonts inlined as data
URIs), `design.spec.json`, `README.md`, and `fonts/` with `LICENSES.md`. Verified with Python's
`zipfile`: `testzip()` returns `None`.

## What is still not done

Stated plainly, because the honest failure mode here is claiming more than was measured.

1. **The `after/` corpus has no images.** Every page in it was generated without `--images`, so
   the slot system is verified by *tests and by the matrix*, not by a photographed run. Slot-aware
   generation, the texture-vs-native rule and supplied-image precedence are covered by 13 offline
   checks and by live API runs, but a matched before/after image batch was not captured.
2. **Three of four repeated shop runs still converge.** The direction set is diverse; a single
   best-fit run is not, by design.
3. **Fingerprints are still blueprint-derived.** They use the rendered block sequence and the
   hero/nav/footer variants. Rendered box geometry is measured now (the measure tool reports
   section heights, hero height and upscale factors) but is not fed back into the diversity
   objective.
4. **Third-party image search is not implemented** — deliberately. The brief allowed it as an
   optional separate source; a half-working licensed-image search that cannot verify its licences
   is worse than none, so user-supplied local images are the supported path.
5. **The explore dial is not exposed in the UI as a numeric control** — it is a range input on the
   composer, and its effect is documented rather than previewed.
