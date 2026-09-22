# TurboSlop — Baseline Layout Findings

**Captured:** 2026-09-22 (UTC) · **Source revision:** git `48687b3` (`baseline/src-provenance.txt` has per-file SHA-256)
**Method:** 11 pages generated with the live Jev decider + live writer (no local fallback), then measured from the **live DOM** with Playwright/Chromium 1228 at 1440×900 and 390×844. Screenshots in `baseline/shots/`, raw measurements in `baseline/structure.json`, stage metrics/costs in `baseline/timings.json`.

> Measurement only. Nothing under `src/`, `public/`, `test/` or `docs/` was touched; nothing was committed.

**Headline:** These 11 independent briefs produced only **4 underlying compositions** and **2 section-id orders**. Navigation, footer and contact treatment are effectively **fixed templates** (11/11 identical), while the hero, section order and imagery are driven almost entirely by the composition axis. The three identical `shop` runs produced an **identical design skeleton** (8/8 decider axes identical) with only the written copy changing. Generating images changed nothing visible: the image-enabled run rendered **0 `<img>` elements** because the chosen composition has no image slots.

---

## Per-design summary

`firstScreen` = distinct block types visible in the top 900 px, in first-appearance order.

| slug | composition | section `[id]` order | h1 px / lines | firstScreen | nav links | imgs | contact | footer | overflow 1440 | overflow 390 |
|---|---|---|---|---|---|---|---|---|---|---|
| shop | gallery-first | top-hero·items·features·about·contact | 72 / 6 | h1,panel,lede,buttons,ticker,eyebrow,h2 | 4 | 0 | form+email+phone | 4-block 1-col | no | no |
| event | classic-stack | …·stats·… (6) | 142.8 / 3 | eyebrow,h1,lede,buttons,caption,ticker | 5 | 0 | form+email+phone | 4-block 1-col | no | no |
| editorial | editorial-lede | 5 (as shop) | 77.52 / 4 | eyebrow,h1,lede,buttons,h2 | 4 | 0 | form+email+phone | 4-block 1-col | no | no |
| software | data-first | 5 (as shop) | 121.38 / 3 | eyebrow,h1,lede,stats,h2 | 4 | 0 | form+email+phone | 4-block 1-col | no | no |
| service | classic-stack | …·stats·… (6) | 129.2 / 4 | eyebrow,h1,lede,buttons,caption,ticker | 5 | 0 | form+email+phone | 4-block 1-col | no | no |
| artist | gallery-first | 5 (as shop) | 80 / 4 | h1,panel,lede,buttons,ticker,eyebrow | 4 | 0 | form+email+phone | 4-block 1-col | **yes** | **yes** |
| technical | data-first | 5 (as shop) | 121.38 / 3 | eyebrow,h1,lede,stats,h2 | 4 | 0 | form+email+phone | 4-block 1-col | no | no |
| shop-run2 | gallery-first | 5 (as shop) | 72 / 7 | h1,panel,lede,buttons,ticker,eyebrow,h2 | 4 | 0 | form+email+phone | 4-block 1-col | no | no |
| shop-run3 | gallery-first | 5 (as shop) | 72 / 6 | h1,panel,lede,buttons,ticker,eyebrow,h2 | 4 | 0 | form+email+phone | 4-block 1-col | no | no |
| shop-run4 | gallery-first | 5 (as shop) | 72 / 7 | h1,panel,lede,buttons,ticker,eyebrow | 4 | 0 | form+email+phone | 4-block 1-col | no | no |
| technical-images | data-first | 5 (as shop) | 121.38 / 3 | eyebrow,h1,lede,stats,h2 | 4 | **0** (2 generated) | form+email+phone | 4-block 1-col | no | no |

---

## 1. First-screen geometry — four shapes, not eleven

Measured from the DOM (all 11 have `lede` inside the first viewport; that is the only universal hero element besides the h1):

| composition | n | eyebrow above h1 | first-screen extras | h1 px | buttons in view |
|---|---|---|---|---|---|
| classic-stack | 2 | **yes** | caption + ticker | 142.8, 129.2 | 2 |
| gallery-first | 5 | **no** (eyebrow sits below the fold) | right-hand spec panel + ticker | 72–80 | 1 |
| editorial-lede | 1 | yes | nothing extra | 77.52 | 1 |
| data-first | 3 | yes | 4-up stats row | 121.38 | **0** |

The h1 is always a single `<h1 class="display">` (or `masthead__title`), always the first heading, and always the `tagline`. It is **not** a fixed shape: measured font-size ranges 72 → 142.8 px and wraps to 3–7 lines, driven by `--fs-display`/`--fs-h1` and the layout's display factor, not by the brief. The hero is left-aligned for gallery-first/data-first and full-width for the others. No hero ever renders an image.

## 2. Navigation — fixed template

- **11/11 sticky**, `position: sticky`, `top: 0`, still pinned at `top: 0` after an 800 px scroll. No on-scroll style change was detected (background, backdrop-filter and box-shadow unchanged) across all 11 — *inferred:* the `@container scroll-state(stuck)` rule either does not fire in this engine or changes only a child property not sampled.
- Structure is identical: brand link + `<ul class="nav-list">` + a "How this was built" popover button.
- Label count is determined by composition, not content: **4 labels in 9 designs, 5 in the 2 classic-stack designs**. Labels themselves are LLM-written and therefore differ per brief (`Tableware/Glazes/Process/Studio` vs `Programme/Tournament/Arcade/Venue/Badges & contact`).

## 3. Heading hierarchy and emphasis

- Exactly one `<h1>` per page, always the hero tagline. Emphasis lands on that h1; it is by far the largest type on every page.
- Then `<h2>` per section, then `<h3>` only for item/feature entries. **h3s appear only in classic-stack and gallery-first** (event, service, shop×4, artist). editorial-lede and data-first emit h1/h2 only.
- Counts: classic-stack event = 1 h1 / 4 h2 / 12 h3; service = 1/4/13; gallery-first shop = 1/4/5; data-first technical = 1/5/0; editorial = 1/4/5.
- Every page ends with a contact `<h2>` immediately before the form.

## 4. Section order — only **2 distinct orders** across 11 designs

```
A (6 sections): top-hero, items, features, stats, about, contact   → event, service   (2)
B (5 sections): top-hero, items, features, about, contact          → the other 9
```

The 6th section in A (`stats`) is a real `<section id="stats">` only in classic-stack; in data-first the stats are folded into `top-hero`, and in gallery-first the ticker/pull-quote are `<section>`s **without ids** (excluded from `section[id]`). So the *visible* structure is more varied than the id list suggests — but by the literal measure requested (ordered `section[id]` values) there are exactly **2**.

Composition picks: gallery-first ×5, data-first ×3, classic-stack ×2, editorial-lede ×1. **3 of the 7 catalog compositions were never selected** in 11 draws (split-hero, bento-grid, manifesto).

## 5. Block shapes

Distinct item-block shapes observed: **4** — scrollable `rail` of `.work-card` (classic-stack), full-bleed `.gallery` of `.tile` (gallery-first), numbered `.editorial-list` of `.erow` (editorial-lede), and a `.spectable` `<table>` (data-first).
Distinct feature-block shapes: **3** — `.card` grid (classic-stack), `.frow` rows (gallery-first/editorial-lede), `.deflist` definition list (data-first).
So cards, rows, and a table all appear; which one you get is a function of the composition axis only.

## 6. Image placement — **nowhere in this baseline**

- **All 11 pages contain 0 `<img>` elements** (`imageCount: 0`, `imageByLocation: {}`).
- Without `--images`, image slots render as CSS-gradient `.plate`/`.tile__plate` placeholders (a gradient box, not an image).
- With images requested (`technical-images`: 2 assets, turbo, 8.9 s), the service produced a backdrop (13.5 KB, 6.64 s) and a surface (12.2 KB, 0.82 s) on disk — but the decider chose **data-first**, whose builder never calls `heroArt()` or `plate()`. Result: **2 images generated, 0 rendered, 0 bytes referenced**. Images would only appear with `--images` *and* a composition that has slots (classic-stack → hero backdrop + one plate per item; gallery-first/bento → one per tile).

## 7. Contact treatment — one template, 11/11

Every design renders the same `#contact` block: an intro `<h2>`, a large `mailto:` email link, a phone `tel:` link with the address as a tag, and an **inline form with 4 fields** (name, email, select, textarea). `contactTreatment.descriptor` = `form + email + phone` for **11/11**.

## 8. Footer treatment — one template, 11/11

`<footer class="sec">` → one `.wrap` (`display: block`, no columns) with exactly **4 block children**: address eyebrow → phone tel link → brand masthead → meta eyebrow (`… · generated by TurboSlop · decisions by Jev · composite X.XX`). Identical shape and child count on all 11.

---

## 9. The control: three identical `shop` runs

All four `shop`/`shop-run{2,3,4}` generations returned the **same 8/8 decider axes** (`serenity · gallery-first · tactile-paper · bone-terracotta · humanist-light · centered-measure · breath · quiet`) — zero decision variance. `technical` vs `technical-images` likewise returned 8/8 identical axes.

| | shop | shop-run2 | shop-run3 | shop-run4 |
|---|---|---|---|---|
| composition | gallery-first | gallery-first | gallery-first | gallery-first |
| section order | B | B | B | B |
| 8/8 axes | identical | identical | identical | identical |
| firstScreen | h1,panel,lede,buttons,ticker,eyebrow,h2 | same | same | same (no trailing h2) |
| nav labels | Tableware, Glazes, Process, Studio | …, The Studio, Shipping | …, The studio, Firing schedule | …, The studio, Shipping |
| h1 lines | 6 | 7 | 6 | 7 |
| h1 text | unique | unique | unique | unique |
| writer latency | 8072 ms | 7274 ms | 7337 ms | 7901 ms |
| writer output tok | 1507 | 1444 | 1362 | 1488 |
| cost | $0.001181 | $0.001144 | $0.001094 | $0.001170 |

**Verdict:** near-identical. The design *skeleton* — composition, section order, block types, contact, footer, nav position — is effectively deterministic for a fixed brief. Variance is confined to LLM-written prose: headlines, nav label wording, body copy, and a 1-line wrap difference. Nav labels 1–2 are byte-identical across all four; labels 3–4 vary (`Process/Studio` vs `The Studio/Shipping` vs `Firing schedule`). So a later change to layout code can be judged against this control with high confidence, while any *copy* comparison must expect run-to-run noise.

---

## 10. How many structurally distinct designs?

**Definition (primary):** two pages are the same structure iff they share the same `data-composition` and the same ordered `section[id]` list. Under that: **4 distinct** (classic-stack, gallery-first, editorial-lede, data-first) among 11 designs. Adding the first-screen block-type sequence keeps it at 4 families. If one also requires identical measured h1 font-size and nav-label count, the count rises to **6** (event≠service; shop≠artist). The honest headline is **4 structural families, and only 4 of the 7 available compositions were ever chosen**.

## 11. Cost & latency

Prices: Jev $0.042/M input tokens; writer $0.15/M input + $0.60/M output; images self-hosted $0. Writer dominates at **87.5%** of the bill.

| metric | value |
|---|---|
| designs | 11 |
| Jev input tokens (total) | 37,070 |
| Writer input / output tokens (total) | 9,856 / 15,729 |
| Jev cost (total) | $0.001557 |
| Writer cost (total) | $0.010916 |
| **Total measured cost** | **$0.012473** |
| Per-design cost range | $0.001045 (software) – $0.001192 (event) |
| Jev latency range | 320–452 ms |
| Writer latency range | 6,063–8,072 ms |
| Image stage (technical-images) | 8,900 ms for 2 images |
| Batch end-to-end (7 designs) | 53,015 ms total, **7,574 ms avg** |
| Individually timed runs | shop-run2 7,879 ms · run3 8,006 ms · run4 8,495 ms · technical-images 16,569 ms |

Render time is not separately reported by the CLI. *Inferred:* end-to-end minus (Jev + writer) leaves roughly 200–500 ms per design for `renderHtml` + process start + file I/O; images add ~7–8 s on this host.

## Method & caveats

- Screenshots use `prefers-reduced-motion: reduce` so CSS scroll-driven reveals are fully opaque and stable. Without it, below-fold blocks can be captured mid-reveal — this affects screenshots only, not the DOM measurements.
- `h1Lines` is measured by counting distinct `Range.getClientRects()` top edges; inline `<em>` runs are merged by top so they do not inflate the count.
- `firstScreenBlocks` is a 900 px cutoff; a trailing block that belongs to the *next* section can bleed in when the hero is short (this is why shop/run2/run3 show a trailing `h2` and run4/artist do not).
- `overflow`: 10/11 report no horizontal overflow (`scrollWidth` 1425 ≤ 1440; the 15 px is the scrollbar gutter). **artist overflows**: 1568 px at 1440 and 413 px at 390. Cause verified by ablation: disabling the `organic-mesh` effect's decorative `.sec::before` (`inset-inline-end: -10%`) drops `scrollWidth` back to 1425. `html { overflow-x: clip }` hides the scrollbar but the document still reports the overflow, and the full-page screenshot is 1568 px wide.
- **Concurrent `src/` edits observed.** `src/blueprint.ts` and `src/directions.ts` appeared, and `catalog.ts` / `compose.ts` / `decider.ts` were modified while this baseline was being generated (git working tree dirty on those three; `src-provenance.txt` pins the revision captured at 20:28:33Z). `cli.ts`, `pipeline.ts`, `render.ts`, `compositions.ts`, `layout.ts`, `styles.ts`, `types.ts`, `writer.ts` and `content.ts` were **unchanged**. All 11 pages remain mutually coherent (the four `shop` runs and the two `technical` runs produced identical decision axes), so the baseline is internally consistent — but a later comparison should treat the decider/compose/catalog changes as part of the delta, not as a confound.
- Everything under **Findings** is measured from the DOM; statements marked *inferred* are labelled.
