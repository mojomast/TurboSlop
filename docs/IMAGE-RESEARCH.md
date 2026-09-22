# Supra2 image service — research & measurements

> **Scope note.** This document measures one *particular* deployment of the API. The endpoint
> is fully configurable in TurboSlop — localhost, LAN, VPN, Tailscale, or a reverse proxy all
> work identically, and there is no default host. Tailscale happened to be how this instance is
> reached; nothing in the integration depends on it. See the
> [Image generation section of the README](../README.md#image-generation) and
> [`.env.example`](../.env.example) for the transport-agnostic setup.

Measured against the private service at `https://kimi.tailec998.ts.net:4363`.
This document is the evidence base for the image integration in `turboslop/src/`.
It contains **no code changes** and **no credentials**.

Legend used throughout:

| Tag | Meaning |
|---|---|
| ✅ **MEASURED** | I ran it against the live service / local tooling and recorded the value. |
| 🔶 **INFERRED** | Reasoned from evidence, not stated by the service. Could be wrong. |
| 📜 **TOLD** | From the task contract or the upstream model documentation. Not independently verified. |

---

## 0. Reachability & authorization — ✅ ACCESSIBLE AND AUTHORIZED

| Check | Result |
|---|---|
| Tailscale | Up. Peer `kimi` = `100.125.104.79`; this host **is** the tailnet node `kimi`, tailnet user `mojomasta@gmail.com`. |
| `GET /health` | **HTTP 200** `{"ok":true,"release":"c30e50eb66b7f34ceb7da1d679a391c392e9d5fe102696496c2ad4a6345d2922"}` |
| `GET /api/status` | **HTTP 200**, returned full JSON incl. `busy`, `device`, `mode`, `worker`, `jobs` (163 jobs retained at query time). |
| `POST /api/generate` | **HTTP 202**, real images returned and downloaded. |

Authorization works end-to-end (reads *and* writes). Identity is supplied by the tailnet;
**no `Tailscale-User-Login` header was forged or sent** — never do so.

> `/health` only proves the process is up. It does **not** prove authorization or that a model is loaded.
> ✅ `/api/status` reported `worker.loaded:false` (cold) while `/health` was already `ok:true`.

---

## 1. Endpoint contract

| Item | Value | Source |
|---|---|---|
| `GET /health` | `{"ok":true,"release":"<build sha>"}` | ✅ measured |
| `GET /api/status` | `{busy, device, mode, worker{loaded,threads,idle_unload_seconds}, jobs[]}` | ✅ measured |
| `POST /api/generate` | body **exactly** `{prompt, seed, steps, cfg}` → **202** `{id, batch, ids}` | ✅ measured |
| `POST /api/batch` | body **exactly** `{prompt, count, steps[], guidance[]}` → **202** `{id, batch, ids}` | 📜 contract |
| Auth/check headers | `Content-Type: application/json` **and** `Origin: https://kimi.tailec998.ts.net:4363` | ✅ measured (below) |
| Busy | **HTTP 429** `{"error":"A batch is already running. Wait or cancel its queued images."}` | ✅ measured |
| Cancel | `POST /api/cancel` cancels **ALL** queued images service-wide | 📜 contract — **never call routinely** |

**Validation is strict and confirmed by probe** (all rejected with `400`, no generation triggered):

| Input | Response |
|---|---|
| missing/!wrong `Origin` | `403 {"error":"Invalid origin or content type"}` |
| empty / 1001-char prompt | `400 "Prompt must contain 1–1000 characters."` |
| `steps` 0 or 101 | `400 "steps must be an integer from 1 to 100."` |
| `cfg` 0 or 11 | `400 "Guidance must be from 1 to 10."` |
| `seed` -1 or 2147483648 | `400 "seed must be an integer from 0 to 2147483647."` |
| **any extra field** | `400 "Expected prompt, seed, steps and cfg only."` |

⚠️ **Build payloads verbatim.** An extra key (e.g. `negative_prompt`, `width`) fails the whole request.
`cfg` (generate) and `guidance` (batch) are the **same parameter** under two names.

---

## 2. Model identity

### What the service exposes — ✅ MEASURED

| Field | Value |
|---|---|
| `device` | `CPU` |
| `worker.threads` | `16` |
| `worker.idle_unload_seconds` | `600` (unloads after 10 min idle) |
| `mode` | `"Warm worker; unloads after 10 minutes idle"` |
| `/health.release` | `c30e50eb66b7f34ceb7da1d679a391c392e9d5fe102696496c2ad4a6345d2922` (build hash, **not** a model id) |
| Native output | 256×256 PNG |
| Model name / architecture / version | **NOT EXPOSED** — no `/api/model`, `/openapi.json`, or version field (all 404). |

The service does **not** name its checkpoint. Do not hardcode a version string from it.

### Most likely identity — 🔶 INFERRED (strong, but not confirmed by the service)

The web UI at `/` is titled **"Supra2 · Image Studio"**; `/app.js` adds nothing about the checkpoint.
A public model matches every stated architecture fact:

**`SupraLabs/Supra2-IMG` — "SupraDiT", ~104.1M-param tiny diffusion transformer.**

| Attribute | Public model card | Service | Match |
|---|---|---|---|
| Text encoder | frozen **Flan-T5-Base**, 128-token context | "128-token text encoder" | ✅ |
| VAE | SD-VAE-FT-MSE (`VAE_SCALE 0.18215`) | 256² PNG, SD-class | ✅ |
| Resolution | 256² | 256² native | ✅ |
| Latent / patch | 32² / patch 2 | — | — |
| Params / config | 104.1M, `D_MODEL 576`, `DEPTH 14`, `N_HEADS 9` | 16-thread CPU, ~0.22 s/step | plausible |
| Sampler | rectified-flow **Euler ODE** | — | — |
| Recommended sampling | **cfg 3.0, steps 50** | service default guidance 3 | ✅ |

Evidence quality: architectural coincidence at this level is unlikely, but this remains an
**inference**. If the integration must be certain, ask the service owner for the loaded checkpoint hash.

**Official sampler behaviour** (from the upstream `inference.py`, 📜 + matches observations):
`use_cfg = cfg > 1.0`; `cfg≤1.0` runs **one** denoiser pass/step, `cfg>1.0` concatenates the
latent twice and runs **two** (batched) passes/step with `v = v_uncond + cfg·(v_cond − v_uncond)`.
Prompt is tokenized with the **T5 SentencePiece** tokenizer, `truncation=True, max_length=128`.
There is **no prompt-weighting syntax** and **no negative-prompt input**.

---

## 3. Real timings — ✅ MEASURED

Identical prompt and seed across every run (fair comparison):

> prompt: `"a small red sailboat on a calm blue sea, watercolor painting, soft light"` · seed `12345`
> All runs were issued **strictly one at a time**; the service serialises work anyway (§4).

| Run | steps | cfg | job gen (s) | submit→done (s) | submit→PNG (s) | warm | PNG bytes |
|---|---|---|---|---|---|---|---|
| warmup (cold start) | 2 | 1 | 1.582 | **10.192** | 10.202 | ❌ cold | 72,516 |
| steps10 cfg3 | 10 | 3 | 3.396 | **3.425** | 3.434 | ✅ warm | 63,846 |
| steps20 cfg3 | 20 | 3 | 5.876 | **5.978** | 5.988 | ✅ warm | 74,811 |
| steps50 cfg3 | 50 | 3 | 12.620 | **12.696** | 12.704 | ✅ warm | 81,118 |
| steps20 cfg1 | 20 | 1 | 4.247 | **4.279** | 4.287 | ✅ warm | 82,299 |
| steps20 cfg5 | 20 | 5 | 5.751 | **5.803** | 5.814 | ✅ warm | 66,704 |

**Cold start:** the first request after idle took **≈8.6 s of load overhead** (10.19 s wall vs 1.58 s
generation). Warm it up before a latency-sensitive first render, or accept an ~8–9 s first hit.

**Wall-clock ≈ generation + ~0.05 s.** HTTP submit/poll overhead and PNG download (~64–82 KB) are
negligible; the denoiser dominates.

**Scaling (warm, cfg 3):** ≈0.25 s/step at 10 steps, ≈0.22 s/step over 20→50 steps — roughly linear.

**Cost depends on the `cfg>1` threshold, not on the value.** ✅ cfg 3 and cfg 5 are within noise
(5.88 s vs 5.75 s at 20 steps) because both take the CFG path. ✅ cfg 1 is cheaper
(4.25 s vs 5.88 s, ~1.4×) via a single pass. So `cfg 2 ≈ cfg 3 ≈ cfg 5 ≈ cfg 10` in cost.

> ⚠️ **These absolute times are ~1.6–2.6× the documented/historical baseline** (📜 ~2.3 s for warm
> 20-step). Three 20-step/cfg-3 samples spanned **3.63 s – 5.88 s**. The host was likely under load
> during measurement. **Treat absolute numbers as an upper bound and design around relative costs**;
> do not hardcode 2.3 s or 5.9 s.

---

## 4. Queue behaviour — ✅ MEASURED

| Observation | Value |
|---|---|
| Single submission while idle: `started − created` | ≈ **0.001 s** (no queue) |
| Batch of 2 (count 2, steps [20], guidance [3]), image 1 | queued 0.001 s, gen 5.445 s |
| Batch of 2, image 2 | **queued 5.447 s** = exactly image 1's runtime, then gen 3.633 s |
| Batch total wall | 9.287 s |
| Second batch while one is running | **HTTP 429** `"A batch is already running…"` |

**The service runs one image at a time.** Within a batch, later images wait behind earlier ones;
a second *batch* is rejected with 429 rather than queued. This is why a `/api/batch` settings sweep
is efficient (one submission, N images serialised) but concurrent submissions are not.

---

## 5. Prompt-length reality: the 128-token wall — ✅ MEASURED

The API limits **characters** (1000); the **Flan-T5-Base encoder** limits **tokens** (128).
Characters ≠ tokens, so the API cap does **not** protect you.

I tokenized real prompts with the upstream `google/flan-t5-base` tokenizer (isolated `/tmp` venv):

| Prompt style | words | tokens | tokens/word |
|---|---|---|---|
| Common prose ("the quick brown fox…") | 31 | 37 | **1.19** |
| Natural descriptive sentence ("a small red sailboat…") | 13 | 19 | **1.46** |
| Natural descriptive sentence ("a lone lighthouse…") | 13 | 25 | **1.92** |
| SD-style tag list ("masterpiece, best quality, 8k…") | 29 | 56 | **1.93** |

| Practical budget (from the measurements above) | Value |
|---|---|
| Typical English prose ratio | **~1.4–1.5 tokens/word** (up to ~1.9 for tag/capitalised lists) |
| 128 tokens ≈ | **~85–105 words**, or **~430–500 characters** of prose |
| API's 1000-character max ≈ | **~250–300 tokens** → **~2× over budget; the tail is silently dropped** |
| My test prompt | 19 tokens — well inside budget |

**Failure modes when you exceed 128 tokens** (📜 upstream truncates at `ctx_len` with a warning; the
service caps at 1000 chars):
- **Silent truncation** — the end of the prompt is never seen; there is no API error.
- **Ignored tail clauses** — style/medium words placed last (e.g. "…, watercolor") can vanish.
- **Wasted tokens** — score-tag spam consumes budget and pushes real content out.

**✅ Recommendation: keep prompts to one or two descriptive sentences, ≤ ~60 words / ≤ ~400
characters (~≤100 tokens).** Validate/truncate client-side before sending.

---

## 6. Prompt engineering for this model class

This model is **not** SD-1.5-with-CLIP. 🔶 It is a ~104M DiT conditioned by a frozen
**Flan-T5-Base** encoder, trained on `FLUX-Reason-6M` with captions selected in the priority order
`composition → entity → text → style → imaginative` (📜 model card). T5 is a *natural-language*
encoder: prose is in-distribution, tag soup is not.

| Topic | Guidance | Basis |
|---|---|---|
| **Ordering** | Lead with **subject + composition** ("a lone lighthouse on a jagged rock, centred, wide shot"). Training preferred composition-first captions. Front-load what must survive. | 🔶 from training caption order |
| **Weighting** | **Unsupported.** No `(word:1.3)` / A1111 / compel syntax — it would be encoded as literal text. Control emphasis with word order and explicit language instead. | 📜 + ✅ (sampler code has no weighting path) |
| **"8K", "masterpiece", score tags** | **Ineffective.** Output is fixed 256² with no upscaler, so resolution words change nothing; quality tags carry no grounding for a T5 encoder trained on descriptive captions and only spend the 128-token budget. | ✅ fixed 256² + 🔶 encoder class |
| **Negation** | **No negative prompt**, and text encoders handle negation weakly — "no people" can summon people. Describe what you **want** instead. | 📜 contract + 🔶 |
| **Composition at 256²** | One clear subject, centred, generous margins, strong silhouette/high contrast. Readable = large shapes. | ✅ 256² ⇒ 65k px |
| **Avoid** | Crowds, tiny faces/hands, lettering/signage, fine patterns — all below the resolution floor. | ✅ resolution |
| **Art style / medium** | Works well and is cheap: *watercolor, oil painting, pencil sketch, flat vector, 3D render, pixel art*. Style was a training caption field. Keep it to one style phrase. | 🔶 training data |
| **Seed reuse** | Same prompt + seed + steps + cfg is **deterministic** ⇒ safe caching/idempotency. A fixed seed across *different* prompts only reuses the initial noise — it does **not** preserve a character or scene. No img2img/reference, so there is **no true continuity**. | 📜/✅ sampler + 🔶 |
| **Guidance** | `cfg 1.0` = no CFG: cheaper, looser adherence. `cfg >1` sharpens prompt adherence and contrast; very high values add oversaturation/artifacts. Cost is identical for any value >1, so there is no reason to exceed the useful range — use **3.0**. | ✅ measured + 📜 sampler |

---

## 7. Recommended presets

Costs are ✅ measured on a loaded host (relative costs are robust; absolute seconds may be lower
when idle). "Workflow default" = a choice about UX/latency, **not** a claim about image quality.

| Preset | steps | cfg | Measured wall (this host) | Historical warm | Type | Use for |
|---|---|---|---|---|---|---|
| **Fast preview** | 10 | 1 | (not run; ~2.5 s est. 🔶) | — | workflow default | Live/interactive drafts, cheap sweep grids |
| **Balanced default** | 20 | 3 | **5.98 s** | ~2.3 s 📜 | workflow default | Normal renders; good quality-per-second |
| **Reference** | 50 | 3 | **12.70 s** | ~5 s 📜 | **quality claim** — vendor-recommended (`--steps 50 --cfg 3.0`) | Final/hero images |
| **Adherence check** | 20 | 1 | 4.28 s | — | diagnostic | See what CFG adds; cheapest cfg>1-alternative |
| **Guidance comparison** | 20 | 3 vs 5 | 5.88 / 5.75 s | — | diagnostic | Same cost; shows guidance value is free >1 |

Guidance experiments: `cfg 2`, `3`, `5` all cost the same, so compare freely. Higher cfg does **not**
cost more — only crossing above `1.0` does.

---

## 8. What this means for the integration

- **Transport:** POST JSON with **exactly** the four (or four batch) fields and **both** required
  headers (`Content-Type`, `Origin`). Any extra field ⇒ `400`; missing `Origin` ⇒ `403`.
- **Async model:** submission is `202 {id, batch, ids}`; poll `GET /api/status` and match `id`s
  (`queued → running → done | failed | cancelled`). Download the PNG and store it yourself.
- **Back-pressure:** the service runs one batch at a time. On **`429`, back off and retry** — never
  call `/api/cancel` as routine. Do not fire concurrent generations; batch settings into one
  `/api/batch` (seeds are reused across setting combinations for fair comparison).
- **Latency:** expect ~8–9 s cold load after 10 min idle, then roughly linear per-step cost.
  Budget in **relative** terms, keep a warm-up render, and don't hardcode measured seconds.
- **Retention:** history + PNGs are limited to **256 entries**. Persist images immediately;
  never treat the service as durable storage.
- **Prompts:** validate/truncate to **≤ ~400 chars (~≤100 T5 tokens)**; natural sentences, not tag
  spam; no weighting syntax; no negative prompt; describe desired content, not exclusions.
- **Identity:** the service exposes **no model name**. It is *likely* `SupraLabs/Supra2-IMG`
  (§2) — confirm with the owner before depending on that, and don't record a guessed version.
- **Determinism:** `(prompt, seed, steps, cfg)` is reproducible — usable as a cache key.
- **Security:** rely on tailnet identity; **never** send a forged `Tailscale-User-Login` header or
  weaken auth. Keep the service off any public surface.

---

### Provenance summary

| Claim | Status |
|---|---|
| Reachable & authorized; all timings/queue/token tables | ✅ **MEASURED** |
| Model identity = `SupraLabs/Supra2-IMG` / SupraDiT | 🔶 **INFERRED** (strong branding + architecture match) |
| Validation bounds, 202/429 semantics, 256², 128-token truncation, retention, cancel scope | 📜 **TOLD** (contract; validation & 429 reproduced ✅) |
