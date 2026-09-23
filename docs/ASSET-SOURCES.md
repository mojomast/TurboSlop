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

## 2. Icons (**added** + shortlisted)

Today: two vendored families in `src/icons.ts` (24-grid, stroke 1.6, round caps, outline-only,
`currentColor`; one family per page; a family-consistency test per family):

- **`turboslop`** — the 22 original glyphs, one per meaning.
- **`lucide`** — a curated **69-glyph** subset of [Lucide](https://github.com/lucide-icons/lucide)
  at the pinned commit `3b9ea6d08707edc439f25a4c354cb0d6b8bee973` (release 1.47.0), ISC licence,
  fetched and normalised by `scripts/fetch-icons.ts` into generated data in `src/iconpacks.ts`.
  Categories: navigation 9 · contact 9 · commerce 8 · content 10 · data 8 · process 8 · trust 9 ·
  decoration 8. Each *meaning* (email, date, price, …) has 2–3 candidate glyphs, so two designs
  with the same modules need not draw the same icon. The upstream licence (ISC plus the MIT
  notice for Feather-derived glyphs) ships verbatim in `public/icons/LICENSES.md`, which also
  names the pinned commit and the glyph list.

The vendoring recipe that was used, and that any further family must follow: pinned
version/commit; an explicit allowlist of glyph names (never a glob); fetch raw SVGs; validate the
element set (`svg,path,circle,rect,line,polyline,polygon,ellipse,g`) and reject
`script`/`style`/`use`/`defs`/`image`/`mask`/`clipPath`/`foreignObject`, `on*`, `href`,
`xlink:href` and `url(`; strip presentation attributes so colour and stroke come from the house
wrapper; write generated data plus the verbatim licence; make re-runs byte-identical
(`--refresh` to re-fetch); then test the profile per family, the licence capture, determinism per
seed, and that every role resolves inside the chosen family.

| set | glyphs | licence | style | status |
|---|---|---|---|---|
| **Lucide** | ~2,100 (69 vendored) | ISC | 24-grid, stroke 2, round | **added** |
| **Tabler** | ~5,200 outline | MIT | 24-grid, stroke 2, round | shortlisted |
| **Iconoir** | ~1,670 | MIT | 24-grid, stroke 1.5 | shortlisted |
| Mynaui | 1,310 (+solid) | MIT | 24-grid, stroke 1.5, round | shortlisted — near drop-in |
| Meteocons / Weather Icons | 475+ / 222 | MIT / OFL-1.1 | 128-grid line / 30-grid fill | shortlisted — weather vocabulary |
| Pixelarticons | 1,036 free | MIT | 24-grid pixel fill | shortlisted — the one retro voice |
| Fluent UI System Icons | ~2,000 | MIT | 24-grid, regular+filled | shortlisted — best fill pair |
| MingCute | ~1,660 ×2 | Apache-2.0 | 24-grid, line+fill pairs | shortlisted — NOTICE duty |
| Phosphor | ~1,500 × 6 weights | MIT | 256-grid, filled | shortlisted |
| Heroicons / Feather / Octicons / Carbon | ~1,290 / 290 / 600 / 2,700 | MIT / MIT / MIT / Apache-2.0 | mixed fill | shortlisted |
| Simple Icons | ~3,460 | CC0 project, **per-icon licences vary** | filled | brand marks only, per-icon checks |
| Material Symbols | ~3,800 | Apache-2.0 | 960-grid, filled, variable axes | font only, NOTICE + marks |
| Font Awesome Free | ~2,880 | CC-BY-4.0 + OFL + MIT | filled, per-icon viewBox | visible attribution required |

**Icon fonts vs vendored SVG.** A self-hosted variable icon font stays offline and JS-free but
loses here: 960-unit filled symbols cannot be re-cut to the 24-grid/1.6-stroke house profile,
ligature text is invisible to accessibility tooling and can leak into copy, and the unsubsetted
Material Symbols woff2 is 3–4.7 MB. Vendored geometry wins; subsetting with a Python toolchain is
the only defensible font path and is not worth the dependency.

**Procedural marks as a complement.** Hash the page seed (FNV-1a) into a small geometry
generator — superformula sigils, phyllotaxis constellations, Lissajous/rose curves, epitrochoids,
hex-grid routes, Rule 30 strips, clipped Voronoi — for *logos, sigils and ornaments*, never for
UI semantics. Zero vendored bytes, zero licence, deterministic. MIT references: jdenticon,
boring-avatars, DiceBear's CC0 styles, minidenticons.

**Avoid.** Remix Icon ≥ 4.9 (custom non-OSI licence that bans competing icon libraries; npm
metadata still says Apache-2.0); Iconsax and Unicons (forbid redistributing the files as
assets — exactly what vendoring is); Solar (artwork CC-BY-4.0, no repo licence file, a GPL-3.0
third-party npm package — metadata is untrustworthy); Boxicons (README, LICENSE and npm
disagree; treat as CC-BY-4.0); OpenMoji (CC-BY-SA-4.0, viral); CC-BY sets that would need a
visible per-page credit (Codicons, Twemoji, VS Code product icons, HackerNoon Pixel); Streamline's
non-open free sets (ban "builder" apps); Iconify bulk dumps (mixed GPL/NC collections). And
remember: a permissive copyright licence never grants trademark rights — keep brand/product
marks out of the palette of identities.

## 2b. Illustration and imagery (shortlisted)

For page elements that should read as *objects or people* rather than abstract plates:

| source | licence | gives | note |
|---|---|---|---|
| Open Peeps | **CC0-1.0** | ~700 mix-and-match figures | modular busts/standing/sitting; best figure source |
| Humaaans | **CC0-1.0** | mix-and-match people + scenes | same author family as Open Peeps |
| Open Doodles | **CC0-1.0** | ~40 doodle scenes | gestures, empty states |
| IRA Design | MIT | 36 characters, 52 objects, 15 backgrounds | notice only |
| Openclipart / Public Domain Vectors | **CC0-1.0** | 186k / 70k vectors: objects, tools, vintage | minify hard; provenance is uploader-asserted |
| Noto Emoji (mono) | OFL-1.1 + Apache-2.0 | full Unicode emoji | OFL notice, RFN "Noto"; the clean emoji path |
| Met / Smithsonian / LoC / Rijksmuseum (CC0 slice) / NASA | **CC0 / PD** | photographs and artwork for archive plates | downscale at fetch time; NASA needs a source acknowledgement and no insignia |
| DiceBear CC0 styles / jdenticon / boring-avatars | CC0 / MIT / MIT | deterministic avatar marks | reimplement or port; keep brand glyphs out |

Offline sizing rule: pre-bake rasters at fetch time (hero ≤ 480 px long edge, tile 96–160 px),
quantise, commit the derivative with upstream sha256 + licence, and inline as a data URI only
under ~16 KB — otherwise keep the file and let the ZIP carry it. Never auto-trace a photo to SVG.

Five element proposals: `place-map` (Natural Earth public-domain geodata + an ISC projection),
`sigil` (identicon-style brand mark from the design fingerprint), `felt-state` (a CC0 figure in
empty/error states), `blueprint-plate` (CC0 objects recomposed on the isometric grid),
`archive-tile` (one downscaled CC0 museum/NASA crop in a framed slot).

**Avoid.** unDraw, DrawKit, Blush, Vecteezy free and Magnific/Freepik free tiers — their custom
terms ban shipping assets inside on-demand/generator products; OpenMoji and any CC-BY-SA work
(viral); SVG Repo's CC-BY-NC/ND slices; Flaticon free (mandatory per-icon attribution);
trusting Openverse or uploader metadata as a licence oracle.

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

## 3b. Textures, print effects and material datasets (shortlisted)

Raster texture corpora — **CC0, legally clean, but large; only worth pre-baking to a small tile**:
ambientCG (2000+ PBR sets; v3 JSON API + release pins for deterministic fetch), Poly Haven
(CC0 assets; API needs a unique UA and forbids scraping; previews are not CC0), 3DTextures.me
(CC0 but unversioned URLs — breaks the pin-and-hash rule).

| source | licence | call |
|---|---|---|
| ambientCG | **CC0-1.0** | vendor a pre-baked 64–128 px tile if ever needed |
| Poly Haven | **CC0-1.0** assets | same, with the API ToS respected |
| 3DTextures.me | **CC0-1.0** | reference; no pin |
| `noise-maker` | MIT | port SVG filter compositions |
| `paper-design/shaders` | Apache-2.0 (+NOTICE) | port the *maths* of paper-texture / halftone-CMYK / grain-gradient into build-time SVG (runtime canvas is disqualified) |
| `dither-js` | MIT | ordered/Bayer dithering at build time |
| `riso-colors` | MIT | 78 riso ink values as vendored data |
| gggrain / nnnoise, Haikei, getwaves, TextureLabs, Lost & Taken, ShareTextures, FreePBR, Subtle Patterns/Toptal | custom / none / CC-BY-SA | **avoid** — output-redistribution bans, no licence deed, or viral ShareAlike |

Print facts that are free to implement: halftone screen angles **K 45°, C 15°, M 75°, Y 0°**;
crop/bleed/registration marks; laid-paper chain lines and wire lines; foxing; Code 128 tables
(symbology is public domain — implement the table, never vendor the paid ISO text).

Ranked effects to build next: **riso overprint kit** (2–4 inks, rotated screens, offset
0.4–1.5 %, multiply compositing), **angled halftone/rosette** (an `angle` field on the existing
halftone), **paper substrate kit** (wove noise + laid rules + seeded foxing), **photocopy/toner**
(discrete threshold + `feMorphology` + streak + bloom), **engraving/woodcut warp** (fbm-warped
line field), **blue-noise stipple** (Mitchell/Lloyd instead of jittered hex), **guilloche/moiré**
(two rotated sinusoid families), **brushed metal/acetate** (anisotropic turbulence +
`feSpecularLighting`; CSS sheen for acetate). The first, second, third, fifth, sixth and seventh
are pure paths (byte-identical); the fourth and eighth rasterise differently per engine, so test
markup not pixels.

Raster-tile budget: 32² or 64², 4-bit/alpha, **≤1 raster tile per page and ≤8 KB base64**; never
above 128². A raster data URI cannot be recoloured with `var(--motif-ink)` — ship tone/alpha and
tint through `background-color`/`mask-image` instead.

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

## 4b. Colour and token sources (shortlisted)

For a *computed* palette engine (see `DYNAMIC-DESIGN-PLAN.md` phase 1) rather than more hex lists:

| source | licence | what to take |
|---|---|---|
| WCAG 2.2 contrast maths | W3C Rec, free to implement | the guarantee: linearise sRGB, `ratio = (L₁+0.05)/(L₂+0.05)` |
| Tailwind v4 palette | MIT | the best calibrated OKLCH prior — fit `L(step)`/`C(step)` per family, synthesize at any hue |
| Radix Colors | MIT | **step semantics**: 1–2 ground, 3–5 surface, 6–8 border, 9–10 solid, 11 muted, 12 body (light + dark) |
| Leonardo | Apache-2.0 | invert the luminance function to solve for a target ratio (ramps by construction) |
| ColorBrewer | Apache-2.0 | certified categorical / sequential / diverging sets, colour-blind-safe variants |
| Material 3 tonal palettes | Apache-2.0 | fixed 13-stop L\* ladder so every hue yields a full ramp |
| Open Color / Open Props / USWDS grades | MIT / MIT / CC0 | vendorable values; USWDS also carries the grade↔contrast table |
| Utopia `calculateClamp` / type scale | ISC (npm; no repo LICENSE file — record the npm provenance) | exact fluid `clamp()` output + zoom-violation flag |
| webgradients / uiGradients | MIT | gradient presets as data |
| `colorjs.io` / `culori` | MIT | reference maths if a port needs checking |

Proposed generator: seed + emotion + ground tone → OKLCH anchors (`Lbg` 0.97–0.99 light /
0.14–0.20 dark, `Cbg ≤ 0.02`), a harmonic hue set (analogous/complementary/split/triadic), an
in-gamut accent found by bisecting chroma, then a **contrast guard** that bisects lightness per
role until body ≥ 7.0 (floor 4.5), muted ≥ 4.5, accent-on-ground ≥ 4.5, focus ring ≥ 3.0;
unsolvable seeds fall back to the curated 11. Emit `oklch()` plus a hex fallback.

**Avoid.** APCA → `Myndex/SAPC-APCA` is *not* open source (commercial use prohibited, patents
pending) — implement WCAG 2.2 instead and never use the APCA name. Modern Polaris is not
OSI-MIT (Shopify attaches conduct conditions); use `polaris-tokens` or skip. Lospec has **no
per-palette licence field** and its terms forbid bulk reproduction — only individually verified
palettes. Colour Hunt / Coolors / Adobe Color / type-scale.com are ToS-only: inspiration, never
data. Apache-2.0 sources need a NOTICE; mixed-licence repos (USWDS: CC0 core, Apache icons, OFL
fonts) must be split by asset.

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

## 6. What these passes changed

Pass 1 — material and type:
- **`src/motifs.ts`: 5 → 12 families.** Seven new original generators (truchet, isometric, weave,
  fishscale, waves, quatrefoil, stipple), each deterministic, bounded, and reachable from the
  emotion map; the emotion → family mapping was redistributed so every family is used.
- **Font pack: real width axis.** Archivo now ships `wdth 62–125` (88 KB latin subset) and
  `src/fonts.ts` emits the `font-stretch` descriptor, so the `--head-width` already present in
  every typographic recipe finally condenses or expands the display type. Pack: 5 families,
  332 KB (each page ships only the face it uses).
- **`scripts/fetch-fonts.ts`**: `stretchRange` support, the `font-stretch` descriptor, a width
  range in the licence document, and `--refresh` for when a query changes.

Pass 2 — icons:
- **Lucide family vendored (ISC).** `scripts/fetch-icons.ts` fetches 69 curated glyphs from the
  pinned commit `3b9ea6d…` (release 1.47.0), validates and normalises them into generated data
  in `src/iconpacks.ts`, and writes `public/icons/LICENSES.md` with the verbatim upstream notice
  (ISC + the Feather-derived MIT block). `--refresh` re-fetches; a normal re-run is byte-identical.
- **Selection became role-based and seeded.** `iconsFor(bp, seed)` picks ONE family for the page
  and one glyph per *meaning* from 2–3 candidates; `iconFamily` is validated, a page can never
  mix families, and the cap stays at six icons. Fingerprints are unchanged, so selection
  behaviour is unchanged — only the drawn glyphs differ between designs.
- Tests: `test/assets.test.ts` 31 → 39 checks (both families' profiles, licence capture,
  determinism, resolution); the forge icon test asserts one family per page.

Next vendoring candidates, in order: Open Props values (§4); Mynaui or Pixelarticons as a third
icon family (§2); Fraunces/Anybody as new typographic voices, which needs a new catalog typeface
and therefore a deliberate evidence pass; then a texture kit (§3b) and the computed-palette
engine (§4b).
