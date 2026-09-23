# TurboSlop — Implementation report

**Starting SHA:** `1193968a05257c5f1a53a37ddeb0e1ea063ca53e` (the reviewed revision — checked first: no later commits existed, so every finding below was still live)
**Implementation SHA:** `7ef1374ac44c5a6b086fd53e8b188e2302e3c3a6`
**Live-evidence pass:** starts at `0b20860c710cb79dee07b6991e5e7a6c5cc13c9d` — credentials became
available in the environment, so the live halves of the suites, the UI journeys and a new live
evidence phase were run and the counts below were regenerated.
*(this document lands in the follow-up documentation commit that immediately follows it)*
**Branch:** `main`, pushed normally to `origin/main`.
**Environment:** node v22.23.1 · credentials present (`TYPESAFE_API_KEY` for Jev,
`DEEPSEEK_API_KEY` for the writer, a configured image service), sourced from
`~/.config/atelier-null/{jev,llm}.env`. The **corpus** still runs the offline control the
baseline itself used — local decider + specimen inventory + a **controlled local fixture** for
the image service — so it reproduces byte-for-byte from the same inputs; a separate **live
phase** (`scripts/evidence.ts`, tables §10) records real Jev decisions, a real writer call and a
real image batch, or the reason it could not. Every test, journey and table below was produced
with those credentials present: **264 passed · 0 failed · 0 skipped**.

Every table quoted here is generated from the raw evidence by
`scripts/report.ts` → [`evidence/tables.md`](../evidence/tables.md). Nothing below is
hand-counted.

---

## 1. Exact commands

```bash
# type checking (src + test + scripts)
npm run typecheck

# 13 offline suites — captured verbatim as evidence/tests.txt
npm test 2>&1 | tee evidence/tests.txt

# the Unicode ZIP filename investigation — evidence/zip-unicode.txt
npx tsx scripts/zip-unicode-check.ts | tee evidence/zip-unicode.txt

# the corpus: 3 briefs x 3 seeds x 6 directions + style probe + fixture run + the LIVE phase
# (Jev / writer / image service — each part skipped with a reason if unconfigured; --no-live
#  drops it), then live-browser measurement of every page at 1440x900 and 390x844
npx tsx scripts/evidence.ts --out evidence          # (adds shots with default flags)

# fingerprint distance vs rendered geometry — evidence/calibration.json/.txt
npx tsx scripts/calibrate.ts --evidence evidence | tee evidence/calibration.txt

# every report table from those raw files — evidence/tables.md
npx tsx scripts/report.ts --evidence evidence
```

Supporting, run during this pass and quoted below:

```bash
# the real control surface, driven end to end in Chromium
FORGE_OUT_DIR=/tmp/opencode/ui-out2 FORGE_HOST=127.0.0.1 FORGE_PORT=4471 \
  FORGE_PROJECT=ui-verify npx tsx src/server.ts
# generate → select → lock (cross-card) → regenerate → expand → finalize →
# revise → export: 30/30 checks (playwright-core + bundled Chromium)
npx tsx /tmp/opencode/ui-journey.mts
# upload → slot assignment → finalize → metadata in the design + ZIP: 6/6
npx tsx /tmp/opencode/ui-upload.mts
```

---

## 2. What is now visibly different

1. **Six directions are six designs, and the set says so.** Across the nine evidence sets
   (festival / ceramics-shop / software, three seeds each): **6 compositions per set against a
   target of 4, 3–5 headline constructions against 3, 4 visual treatments against 3, and 6 of 6
   directions distinct in grayscale — 9/9 sets meet every target**
   ([tables §1](../evidence/tables.md)). **The same 9/9 holds when the decision is made by the
   real Jev service** (jev-1.13.0, 561–3154 ms per decision —
   [tables §10](../evidence/tables.md)). Across the 54 directions: 49 distinct blueprints,
   5 headline constructions, 4 treatments, **54 distinct fingerprint keys** (§3).
   Direction 1 is always the strongest best-fit option; the rest are purposeful alternatives
   with their separation reported as a measured distance, never as "% perceptual uniqueness".
2. **Previews are real viewports.** Every card simulates 1440×900 (desktop) or 390×844
   (mobile), scaled to fit; resizing the card changes only the scale
   (`test/viewport.test.ts`, 6/6). Labels, diagnostics and status chips sit **outside** the
   generated page. Expanded comparison offers first-screen and full-page modes at the same fixed
   viewport; a preview flips to "ready" only after fonts load, images settle and motion is
   frozen.
3. **Locks mean what they say.** `{name, value, fromIndex}` — the value and the card it came
   from are shown on the card, applied *during* selection, and re-verified after regeneration.
   Unknown names and incompatible combinations are rejected with an explanation (§4).
4. **Batches are immutable.** Regeneration writes `previews/<sid>/b<n>/…` and archives the
   outgoing batch; saved links to batch 0 still resolve — **including their bundled fonts**
   (the bug the UI pass found, fixed in the preview route).
5. **Revision is scoped.** The offline "fix the punctuation" request that used to turn
   `data-metrics` into `story-origin` now changes nothing visual: blueprint, palette,
   typography, motion, effects, density, seed and assets verified byte-identical
   (`test/revision.test.ts`, 8/8, plus the same check through the real API and UI).
6. **Images go to their intended slots.** One shared asset plan everywhere (UI, sessions, CLI,
   exports): slot ownership checked against the rendered module *variant* and the content,
   supplied images resolved first, **zero slots ⇒ zero requests**, and every asset verified
   inside its own `data-slot` element after render. Selection is image-aware too: with the image
   setting on, a layout that cannot hold an image is never chosen (so the setting cannot be
   silently dropped), and a fresh run after a similar brief opens on a different lead.
7. **First screens open with a headline.** Measured fixes this pass: media heroes had their h1
   at 946–1031 px on a 900 px fold (plate now clamped — h1 at 647–677 px); editorial-figure
   heroes pushed text below the fold on phones (text column now leads on narrow screens);
   display words overflowed three mobile layouts (`overflow-wrap: anywhere`, fluid work-grid
   gutters). Result: **58 pages × 2 viewports → 0 horizontal overflow, 0 duplicate ids,
   0 broken anchors, every mobile h1 within the first 500 px** (§5).

---

## 3. Measurements

### Direction sets (explore = 1, count = 6, fixed content inventory)

| | |
|---|---|
| sets measured | 9 (festival, ceramics-shop, software × seeds 11/42/97) |
| targets met | **9/9**, no shortfall rows |
| compositions per set | **6** (target 4) |
| headline constructions per set | **3–5** (target 3) |
| treatments per set | **4** (target 3) |
| distinct in grayscale vs the best fit | **6** (target 4) |
| minimum pairwise separation | 0.43–0.62 (floor 0.20) |
| content inventory | identical hash across all three seeds of each brief (§2) — the variation above is design variation, not copy variation |

Full per-set table, complete direction listings and shortfall columns: [`evidence/tables.md`](../evidence/tables.md) §1–§3.

### Budget (offline control)

| | |
|---|---|
| model calls per six-direction set | **1** (decision; +1 shared inventory write when a writer is configured) |
| selection / locks / regeneration | **0 model calls** — verified both by test and by counting API calls during the UI journey |
| finalize | 0 (reuses the shared inventory) or **1** writer call for final copy; surfaced as `modelCalls` in the job timings |
| revision | **0–1** writer call, never a re-decision |
| end-to-end per set | 91–119 ms (decide 0–1 ms · inventory 0 ms offline · local render 5–8 ms); the whole evidence run 30,021 ms |
| candidate search | bounded: 2,394 candidates (57 structures × ≤48 styling combos, cap 2,400) → 795–1,344 after de-duplication, history and content filters |
| image requests for the preview set | **0** (previews never generate images) |

### Rendered geometry (live Chromium, both viewports — 116 measurements)

| | |
|---|---|
| pages | 58 (54 directions + 4 calibration probes) |
| horizontal overflow / duplicate ids / broken anchors | **0 / 0 / 0** |
| distinct section orders | 40 of 58 pages · distinct first screens 29 of 58 |
| h1 rendered size | 45.6 – 187.68 px · hero heights 275 – 1592 px |
| image use | offline corpus 0 `<img>` (specimen); fixture page measured with **3 images, upscale- and placement-verified** (`evidence/measure-fixture.json`) |

### Image workflow — controlled fixture (NOT live-service evidence)

From [`evidence/tables.md`](../evidence/tables.md) §6: one direction with **5 renderable slots**,
**1 supplied** → **exactly 2 requests** to the fixture service (count = 2), **3 assets on the
page** (user `hero` with `CC0` + 1×1 dimensions, generated `gallery-1`, `gallery-2` at 256×256),
placement verification `ok=true, checked=3, issues=0`, ZIP integrity test passed with 13 entries
including `fonts/LICENSES.md`.

### Live services — same workflow, real Jev / writer / image service ([tables §10](../evidence/tables.md))

Captured with the keys in the environment (§1). Jev resolved to `jev-1.13.0` and answered each
of 9 decisions in **561–3154 ms**; the writer is `deepseek-flash` (**9480 ms**, 955/1666 tokens,
$0.001143, brand "Blokpunt"). Diversity under the live decision: **9/9 sets meet every target**
(6/4 compositions, 4–5/3 constructions, 4/3 treatments, 6/4 grayscale, minimum separation
0.4166–0.5752). The image workflow ran against `https://kimi.tailec998.ts.net:4363`: direction
`dir_4565d30a` (blueprint `event-festival`), 5 renderable slots, `hero` supplied → 2 requested,
**2 new job ids observed** on the service between the pre-run and post-run `/api/status`
snapshots, 3 assets on the page (user `CC0` 1×1 + `gallery-1` 256×256 in 6.62 s, `gallery-2`
256×256 in 0.8 s), placement `ok=true, checked=3, issues=0`, image step 8087 ms, ZIP integrity
passed with 13 entries.

### Similarity calibration ([`evidence/calibration.json`](../evidence/calibration.json))

465 within-brief pairs (fixed inventory) plus a 4-page style probe:

| band (fingerprint distance) | pairs | median geometry distance |
|---|---|---|
| 0.06–0.2 (below separation) | 10 | **0.257** |
| 0.2–0.40 | 45 | **0.367** |
| ≥ 0.40 | 410 | **0.407** |
| *identical section sequence* | 5 | **0.045** |
| *different section sequence* | 460 | **0.400** |

Spearman ρ(fingerprint, geometry) = **0.163** (ρ grayscale = 0.168). The honest reading: band
medians rise monotonically, and pages with an identical block sequence render **nine times
closer** than pages with a different one — while ρ stays modest because the selector has already
removed the close pairs from the corpus (range restriction) and geometry still varies with
headline size and copy length. The weights were adjusted *because of* this measurement: the
block sequence carries 0.18 and nav/footer/grid carry 0.03/0.03/0.015. Thresholds in force:
`NEAR_DUPLICATE 0.06`, `MIN_SEPARATION 0.20`, `HISTORY_SEPARATION 0.17`,
`GRAYSCALE_SEPARATION 0.16`. Screenshots of the same corpus were reviewed directly
(§6 below); no claim of perceptual uniqueness is made anywhere in the code or docs.

### Tests — passed / failed / skipped, separately

Generated from `evidence/tests.txt` (tables §8):

| status | checks |
|---|---|
| **passed** | **264** |
| **failed** | **0** |
| **skipped** | **0** — every environment-gated check ran (live Jev, live writer), and the forge
suite's three live halves report `SKIPPED` only when the key really is absent |

13 suites: 58 · 24 · 11 · 23 · 31 · 19 · 22 · 13 · 22 · 14 · 8 · 13 · 6. The suites that
previously self-skipped now genuinely run: `diversity` gained the live-Jev check (17 offline
checks → 19, 22 with the 3 live), and `revision` (8) pins `FORGE_LLM_PROVIDER=__offline_test__`
so an ambient key can never turn its byte-identical assertion into a network call.
`npm run typecheck` is clean over `src/`, `test/` **and** `scripts/` (the `DOM.Iterable` lib
gap that hid script errors is closed).

---

## 4. Review findings → fix → evidence

| finding | fix | evidence |
|---|---|---|
| saved six-direction set used one look throughout | resolved-design fingerprints + coverage-bounded selection + blueprint variation + direction seeds | tables §1–§3, §10 (9/9 under the live service); `test/diversity.test.ts` (22 checks) |
| blueprint distance described as perceptual uniqueness | distances are weighted feature distances; rationale text reports "separation 0.xx from the closest earlier direction"; calibration measured against geometry | `src/fingerprint.ts`, `evidence/calibration.json`, report/README wording |
| no cross-session novelty | project-scoped history applied to batches **and** single-design runs, snapshotted before selection | `test/diversity.test.ts` history tests; `src/history.ts` |
| iframes at card width × 15rem | fixed 1440×900 / 390×844 with scale-to-fit, resize affects scale only | `test/viewport.test.ts` (6/6) |
| labels/diagnostics over the canvas | everything moved into card chrome; test asserts no floating overlay inside the preview box | viewport suite |
| fonts/assets not awaited; motion unstable for thumbnails | fonts.ready + image wait + injected freeze before `data-ready` | viewport suite |
| timings lumped; no progress during inventory | separate decide/inventory/render/assets/end-to-end cells + model-call count; SSE `content` events + 3 s heartbeat | tables §5; UI screenshot; journey check "metrics show … separately" |
| `regenerateSession` accepted a blueprint lock but did not apply it | locks applied *during* constrained selection (`structurePool`/`stylingPool`), re-verified | `test/locks.test.ts`: "a blueprint lock is actually applied…"; journey: "composition lock applied: every regenerated card resolves to the SAME layout" |
| lock checkbox could use another card's values | `{name, value, fromIndex}` bound to the source card, value must match that card, updates serialised | `test/locks.test.ts` "binds to the card it came from"; journey "lock checkboxes persist … on their source card" |
| revision reran selection (`data-metrics` → `story-origin`) | `reviseSession` is a scoped edit of the stored resolved spec; copy default; visual touches only named axes; separate endpoint | `test/revision.test.ts` (8/8); journey "revision used the SCOPED endpoint / never re-decided / copy revision preserved the blueprint" |
| contact-sheet finalize never generated images; zero-slot legacy requests; poster asked for 2, rendered 0 | one shared `assetplan.ts`: role-based slot ownership, supplied-first, zero-slot rule, placement verification | `test/assetplan.test.ts` (13/13, controlled fixture counting requests); tables §6 |
| no usable import flow; metadata lost | `POST /api/uploads` + per-slot assignment UI with alt/credit/licence; refusal notes surfaced in job notes | journey upload suite (6/6); `image-slots-upload.png` |
| direction identities / stored resolved spec | stable `dir_<hash>` ids; each card stores spec + visual recipes + content + slots + diagnostics; finalize reads the stored spec | `test/locks.test.ts` identity test; finalize job note echoes `direction dir_… — blueprint …, seed …` |
| no composition lock; unknown names; incompatible combos | `composition` (exact resolved layout) vs `blueprint` (catalog origin) locks, `validateLocks`, `assertLocksAreCompatible` | `test/locks.test.ts`; API smoke: `400 {"error":"unknown lock \"vibes\" … (turboslop/directions@2)"}` |
| previous batches destroyed by regeneration | `previews/<sid>/b<n>` + `session.versions[]`; byte-identical old previews asserted | `test/locks.test.ts` "the previous batch is preserved immutably" |
| unsupported content / empty galleries / dead CTAs | empty-state notes for gallery/schedule/pricing/faq, contact-guarded hero CTAs, missing-content diagnostics per card | anchors/diagnostics tests; cards show amber diagnostics when content is missing |
| fonts + licences in ZIP **and** single-file export | `fonts/LICENSES.md` in the ZIP; licence text embedded as a comment in the self-contained page (asserted) | `test/assetplan.test.ts` export test |
| Unicode ZIP filename failure | archive valid under Info-ZIP (both locales), Python and busybox; `?` glyphs are console display; the one real failure is `ERR_INVALID_CHAR` for non-latin1 response headers — slugs are ASCII and `contentDisposition()` RFC-6266-encodes regardless | `evidence/zip-unicode.txt`, `scripts/zip-unicode-check.ts`, `test/zip.test.ts` header test |
| "281 checks" and stale listings | every count now generated from `evidence/tests.txt`; LAYOUT-DIVERSITY rewritten (fingerprints section, suites table, limitations); README badge = 264 passed · 0 skipped | `evidence/tables.md` §8; `docs/LAYOUT-DIVERSITY.md` |
| the diversity suite hardcoded its live-Jev skip, so a key would have changed the meaning of a green run | replaced with a real conditional check: 3 briefs × 3 seeds under Jev, asserting the same targets as the offline control | `test/diversity.test.ts` (22 checks: 19 offline + 3 live) |
| an ambient `DEEPSEEK_API_KEY` could turn `revision`'s offline byte-identity assertion into a network call | the suite pins `FORGE_LLM_PROVIDER=__offline_test__` for its duration and restores the previous value in teardown | `test/revision.test.ts` (8/8) |
| no live evidence of the real services anywhere in the report | `runLive()` phase: decision, 9 live-decided diversity sets, writer call, image run with a pre/post `/api/status` job-id diff, ZIP check — recorded as `status + reason` per part | tables §10; `evidence/raw.json` `live` block |
| the image switch could resolve to a layout with **zero image slots**, so "generate images" made no request — and the next similar brief came back as the same lead/family again | selection reads the image setting (`wantsImages`): slot-less layouts are dropped (locks and an empty capable pool fall back, and the plan then says why); a fresh standalone run (`freshLeads`) skips the leads the newest three history entries used | `test/diversity.test.ts` (image + fresh-lead checks), `test/assetplan.test.ts` (image-enabled pipeline makes real requests), README/ARCHITECTURE/LAYOUT-DIVERSITY |

---

## 5. Screenshot paths

Committed evidence (paths relative to the repo root):

| path | what it shows |
|---|---|
| `evidence/shots/festival-s42-d0-desktop.png` | first screen, 1440×900 |
| `evidence/shots/festival-s42-d0-mobile.png` | first screen, 390×844 |
| `evidence/shots/shop-s42-d2-desktop.png`, `-mobile.png` | second brief, both viewports |
| `evidence/shots/software-s42-d1-desktop.png`, `-mobile.png` | third brief, both viewports |
| `evidence/shots/shop-s42-d2-full.png` | representative full page |
| `docs/screenshots/contact-sheet-desktop.png` | the real control surface, desktop viewports |
| `docs/screenshots/contact-sheet-mobile.png` | the same set in mobile viewports |
| `docs/screenshots/contact-sheet-selected.png` | a selected direction in the sheet (journey step) |
| `docs/screenshots/direction-expand.png` | expanded first-screen comparison |
| `docs/screenshots/directions-locks-regenerated.png` | locks + regenerated batch (all cards holding the locked layout) |
| `docs/screenshots/image-slots-upload.png` | upload → slot assignment UI |
| `docs/screenshots/design-finalized.png` / `design-revised.png` | finalized design / post-revision state |

---

## 6. Requirement → evidence map

| # | requirement | evidence |
|---|---|---|
| 1 | diversity as an enforced property | `src/fingerprint.ts`, `src/directions.ts` (bounded search, near-dup rejection, coverage targets, shortfall reasons), `src/blueprint.ts` (`varyBlueprint`/`resolveBlueprint`), `src/history.ts` · `test/diversity.test.ts` (22, incl. live Jev) · tables §1–§3, §7 (calibration), §10 (live) · 9/9 offline **and** 9/9 live sets, 54/54 fingerprint keys |
| 2 | accurate previews, fast generation | `public/index.html` viewport engine · `test/viewport.test.ts` (6) · journey checks (metrics separation, 0 model calls on regenerate) · tables §5 |
| 3 | trustworthy selection/locks/regeneration/revision | `src/sessions.ts`, `src/revise.ts` · `test/locks.test.ts` (14), `test/revision.test.ts` (8) · journey (30/30), API smoke (§1 commands) |
| 4 | complete image workflow | `src/assetplan.ts`, `POST /api/uploads`, placement verification · `test/assetplan.test.ts` (13, fixture) · tables §6 (controlled fixture) **and §10 (live service: 2 new jobs, 3 assets, 0 issues)** · upload journey (6/6) |
| 5 | CSS / typography / assets | `src/visual.ts` (`TYPO_COMPAT`, width/wrap/hierarchy), `src/styles.ts`, `src/layout.ts`, frames in gallery, direction-seeded motifs, licence-embedded export · geometry table (§5 above: 0 overflow, 0 dup, 0 broken) |
| 6 | verify journeys, reconcile evidence | all of §1's commands; `evidence/` raw JSON → `tables.md`; screenshots §5; passed/failed/skipped reported separately (264/0/0) |
| 7 | deliver | `ARCHITECTURE.md`, this report, commits `98c1482` + `7ef1374` + `0b20860` (+ docs commits) pushed to `origin/main`; this live-evidence commit follows it |

---

## 7. Remaining limitations

1. **Live evidence is one machine's snapshot, not an SLA.** §10 was captured with this
   environment's keys: 9 Jev decisions (561–3154 ms), one `deepseek-flash` inventory write
   (9480 ms, $0.001143) and one image run (8087 ms, 2 jobs). Latencies, costs and job ids will
   differ on any other run; the offline corpus remains the reproducible control, and
   `--no-live` reproduces it byte-for-byte without touching the network. Anything that could
   not run is recorded in §10 with its `status + reason` rather than omitted — there are no
   silent gaps.
2. **Palette spread is bounded by the decision distribution**: 3 of 11 palettes across 54
   offline directions (the local decider's marginals are peaked and four sets ran dark). The
   enforced targets are composition/construction/treatment/grayscale separation, which all pass;
   hue spread moves when the distributions do.
3. **A composition lock asks for one composition** — such a set then separates only on the
   remaining axes, and the grayscale target can become unreachable (observed: 1/3, reported with
   its reason in the session, the UI and the API). Targets clamp to what a lock and a lead allow;
   the shortfall is never hidden and never padded away.
4. **Spearman ρ against geometry is modest (0.16)** under range restriction; the stronger
   evidence is the band table and the 0.045-vs-0.400 identical/different-sequence contrast. The
   weights are one calibration pass, not an optimisation.
5. **Diagnostics chips** only appear when content is genuinely missing — the specimen inventory
   fills every module, so in offline runs they stay hidden by design (they appear when a writer
   returns partial content).
6. **Third-party image search** remains deliberately unimplemented (unchanged policy: a licensed
   search that cannot verify licences would be worse than none).
