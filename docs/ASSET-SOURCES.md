# TurboSlop — asset sources and licence register

**Status: research register, kept current with what has been vendored.** Every row states where
an asset or technique can come from, what it contributes, its licence, and what TurboSlop does
with it. Licence claims were verified against upstream licence files in September 2026; re-check
before vendoring anything new.

Legend: **added** = in the repo now · **shortlisted** = licence-clean and researched, not yet
vendored · **inspire** = usable as an idea, do not copy the artifact · **avoid** = licence makes
it unusable here.

## Rules this repo holds itself to

1. Generated pages are **offline and self-contained**: no CDN, no remote font or icon request,
   no page runtime JS.
2. Code-generated elements come first; a raster/library asset is vendored only when it adds
   something code cannot (a typeface, a specific icon vocabulary).
3. **Zero runtime dependencies.** Vendored data is committed; scripts fetch and verify it.
4. Every vendored artifact travels with its **verbatim licence** and a provenance note
   (`public/fonts/LICENSES.md` is the model), and every generated page that uses it renders
   colour from the palette rather than baking in the source's look.
5. A vendored asset must be **deterministic**: pinned source, pinned bytes, idempotent re-fetch.
6. Attribution duties are part of the decision, not an afterthought — CC-BY and CC-BY-SA are
   usually the wrong trade for a page generator; OFL, MIT, ISC, BSD, Apache-2.0 and CC0 are not.

## 1. Typefaces (added / shortlisted)

Bundled pack: `scripts/fetch-fonts.ts` → `public/fonts/` + verbatim OFL text.

| family | axes | voice | licence | status |
|---|---|---|---|---|
| Archivo | **wdth 62–125**, wght 100–900 | poster | OFL-1.1 | **added** — width axis upgraded this pass; the pack now emits the `font-stretch` descriptor |
| Source Serif 4 | opsz 8–60, wght 200–900 | literary | OFL-1.1 | added |
| Nunito | wght 200–1000 | friendly | OFL-1.1 | added |
| JetBrains Mono | wght 100–800 | technical | OFL-1.1 | added |
| Inter | wght 100–900 | restrained | OFL-1.1 | added |
| Fraunces | WONK 0–1, SOFT 0–100, opsz 9–144, wght 100–900 | editorial display | OFL-1.1 | shortlisted — custom axes; wiring needs a new catalog typeface (changes decisions, so it is a deliberate later step) |
| Anybody | wdth 50–150, wght 100–900 | brutalist display | OFL-1.1 | shortlisted |
| Roboto Flex | GRAD, slnt, wdth 25–151, wght 100–1000 | technical/UI | OFL-1.1 | shortlisted — four axes in one ~99 KB file |
| Inconsolata | wdth 50–200, wght 200–900 | mono display | OFL-1.1 | shortlisted |
| Fredoka | wdth 75–125, wght 300–700 | soft rounded | OFL-1.1 | shortlisted |
| Encode Sans, IBM Plex Sans | wdth 75–125 / 75–100 | news / engineering | OFL-1.1 (**Reserved Font Name**) | shortlisted — RFN only restricts renaming derivatives; vendor verbatim |

**Fetch notes.** Google's CSS2 API serves *only the axes you request*, so the query must name
every axis or the file silently loses it. Font files are otherwise re-cut upstream; Fontsource on
jsDelivr gives byte-pinned alternatives. Foundry caveats: Fontshare's ITF-FFL forbids serving the
files to third parties; Pangram Pangram "free" fonts are trials — neither is vendorable.

**Traps.** Reserved Font Names (Encode Sans, IBM Plex, Liberation); "variable" families that ship
several static files; CJK families that look small per-file but pull megabytes; `wdth`-less
families where `font-stretch` is a no-op.

## 2. Icons (shortlisted)

Today: 22 original glyphs in `src/icons.ts` (24-grid, stroke 1.6, round caps, outline-only,
`currentColor`), with a family-consistency test and an original-work licence note.

| set | glyphs | licence | style | note |
|---|---|---|---|---|
| **Lucide** | ~2,100 | ISC | 24-grid, stroke 2, round | closest to the house voice; first choice |
| **Tabler** | ~5,200 outline | MIT | 24-grid, stroke 2, round | largest outline set; filled variants too |
| **Iconoir** | ~1,670 | MIT | 24-grid, stroke 1.5 | lighter editorial accent |
| Phosphor | ~1,500 × 6 weights | MIT | 256-grid, filled | best second (fill) family |
| Heroicons | ~1,290 | MIT | 24/20/16, outline+solid | Tailwind accent |
| Feather | ~290 | MIT | 24-grid, stroke 2 | superseded by Lucide |
| Simple Icons | ~3,460 | CC0 project, **per-icon licences vary** | filled | brand marks only, with per-icon licence checks |
| Material Symbols | ~3,800 | Apache-2.0 | 960-grid, filled, variable axes | NOTICE + trademark duties |
| Font Awesome Free | ~2,880 | CC-BY-4.0 + OFL + MIT | filled, per-icon viewBox | visible attribution required |

**Vendoring scheme (designed, not yet built).** `scripts/fetch-icons.ts` + `ICON_PACKS` in
`src/iconpacks.ts` → `public/icons/<family>/<name>.svg` + `public/icons/LICENSES.md`, mirroring
the font script: pinned version/commit, an explicit allowlist of glyph names (never a glob),
per-file sha256 in a manifest, atomic writes, idempotent re-run, hard rejection of
`script`/`style`/`use`/`foreignObject`/`on*`/`href`/`url(`, and a normaliser that re-emits every
glyph through the house wrapper (24-grid, stroke 1.6, round caps, no fills) so a family stays
consistent. Each vendored family becomes its own `iconFamily`, one per page, with its own licence
record — the existing test then asserts the profile per family.

**Avoid.** Remix Icon ≥ 4.9 (custom non-OSI licence that bans competing icon libraries; npm
metadata still says Apache-2.0 — unsafe to audit); Streamline's non-open free sets (ban
"builder" apps, which is exactly what this is); Iconify bulk dumps (mixed GPL/NC collections).

## 3. Patterns, textures and ornaments

Code-generated motifs live in `src/motifs.ts`; the first seven additions from this research are
**added** and reachable by emotion (every family is used):

| family | construction | source of the idea | status |
|---|---|---|---|
| truchet | quarter-arc tiles, one seeded bit per cell | classic Truchet / *10 PRINT* | added (original implementation) |
| isometric | 30/90/150° line families | drafting paper | added |
| weave | basket-weave slat pairs | parquet/basket weave | added |
| fishscale | staggered scalloped arcs | roof tiles / fish scale | added |
| waves | seeded sine lines | plotter art | added |
| quatrefoil | four overlapping lobes per cell | Moorish lattice | added |
| stipple | jittered hex dot field, thinned by a seeded coin | stippling | added |
| halftone, contour, hatching, technical, stamp | pre-existing five | original | added (earlier) |

Sources for further code-generated material — **shortlisted**:

| source | licence | what to port | why |
|---|---|---|---|
| css-pattern.com / `Afif13/CSS-Pattern` | MIT | ~150 parameterised gradient-stack patterns | CSS-only grounds, no SVG payload |
| `bansal/pattern.css` | MIT | small tiling primitive set | cheap geometric grounds |
| rough.js + hachure-fill | MIT | seeded jitter for line/edges/hachure | hand-drawn material |
| simplex-noise.js / FastNoiseLite | MIT | 2-D noise + fbm | fields, topography, flow |
| d3-shape / d3-scale / d3-delaunay / d3-contour | ISC | path builders, ticks, Voronoi, marching squares | generative + data-viz |
| poisson-disk-sampling | MIT | blue-noise site placement | stipple, halftone upgrades |
| Truchet/L-system/flow-field repos | MIT | bounded rewrite + turtle | ornaments, dividers |
| gggrain / Haikei / getwaves / BGJar / paaatterns | no SPDX or no-clone terms | **inspire only** | reproduce with `feTurbulence` + gradients |
| ambientCG, Poly Haven | CC0 | raster textures, if a pre-baked 64–128 px tile is ever worth it | legally clean but huge |
| Wikimedia Commons texture categories | per-file CC-BY/CC-BY-SA/CC0 | per-item check; ShareAlike is viral | avoid unless the file is PD/CC0 |
| Openverse | aggregator only | discovery, never a licence oracle | always verify at the source |

**Avoid.** Trianglify (**GPL-3.0** — do not port code); SVG Backgrounds (EULA explicitly bans
end-user generator products); Hero Patterns (CC-BY-4.0 — usable only with a visible per-page
credit, so a from-scratch topography/zigzag is the better trade); MagicPattern (no
redistribution, no AI training).

## 4. CSS techniques and token values

| source | licence | what to mine | status |
|---|---|---|---|
| **Open Props** | MIT | easing ramps, shadow ladder, radius/blob scales, gradient presets, mask edges | shortlisted — vendor as typed data (one MIT notice) |
| Penner easing equations | MIT + BSD-3 | classic in/out/in-out curves | shortlisted |
| Animista generated CSS | BSD-2 | entrance/exit keyframes with blur+scale | shortlisted |
| webgradients / uiGradients | MIT | ~180 gradient presets as data | shortlisted |
| `transition.css` (Argyle) | Apache-2.0 | pure-CSS transition recipes (NOTICE duty) | shortlisted |
| neumorphism.io | BSD-3 | dual-shadow maths | shortlisted |
| MDN code samples | CC0 | glass/blend/scroll-driven recipes | shortlisted |
| developer.chrome.com / web.dev code | Apache-2.0 | view transitions, scroll-driven demos | shortlisted |
| Temani Afif CSS-Art / rounding / blob repos | MIT | shape vocabulary | shortlisted |
| Pico, Water, new.css, Tacit, Marx, MVP, Bulma, missing.css | MIT (missing.css BSD-2) | component patterns to re-derive | inspire |
| **animate.css** | Hippocratic-2.1 (not OSI) | — | avoid |
| **Hover.css** | MIT only for personal/OSS; paid commercial | — | avoid |
| transitions.dev | free to use, **redistribution prohibited** | — | avoid |
| Every Layout | per-seat commercial | intrinsic layout *ideas* only | avoid the code |
| easings.net source repo | GPL-3.0 | — | avoid (use the Penner values) |
| CodePen | public pens MIT, private pens all rights reserved | technique only | check before copying |

## 5. Adding a vendored asset — the recipe

1. Pin the source: an exact npm version or a commit SHA, never a branch.
2. Fetch with a script under `scripts/`, write atomically, and **skip verified existing bytes** so
   re-running is a no-op (`--refresh` to override after an upstream/axis change).
3. Validate before writing: magic bytes / declared viewBox / schema; reject scripts, event
   handlers, external refs and non-finite numbers.
4. Record provenance: source URL, version, sha256, SPDX id, and the verbatim licence text in a
   `LICENSES.md` next to the files.
5. Keep the subset explicit — an allowlist of glyphs/files, never a glob.
6. Add tests: every referenced file exists and is valid, the licence file names every bundled
   file, byte counts match the manifest, and a page never references an unknown asset.
7. State the attribution duty in the export surface when the licence requires it.

## 6. What this pass changed

- **`src/motifs.ts`: 5 → 12 families.** Seven new original generators (truchet, isometric, weave,
  fishscale, waves, quatrefoil, stipple), each deterministic, bounded, and reachable from the
  emotion map; the emotion → family mapping was redistributed so every family is used.
- **Font pack: real width axis.** Archivo now ships `wdth 62–125` (88 KB latin subset) and
  `src/fonts.ts` emits the `font-stretch` descriptor, so the `--head-width` already present in
  every typographic recipe finally condenses or expands the display type. Pack: 5 families,
  332 KB (each page ships only the face it uses).
- **`scripts/fetch-fonts.ts`**: `stretchRange` support, the `font-stretch` descriptor, a width
  range in the licence document, and `--refresh` for when a query changes.

The next vendoring candidates, in order: a Lucide icon family (ISC) with the scheme in §2;
Open Props values for §4; then Fraunces/Anybody as new typographic voices, which needs a new
catalog typeface and therefore a deliberate evidence pass.
