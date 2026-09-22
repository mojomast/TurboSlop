<div align="center">

# TURBO&nbsp;SLOP

### *Machine-made. Human-judged.*

A brief goes in. A designed, written and illustrated page comes out — in about a second,
for a fraction of a cent, with every decision typed, scored and reproducible.

[![tests](https://img.shields.io/badge/tests-47%20passing-3fb950?style=flat-square)](#testing)
[![node](https://img.shields.io/badge/node-%E2%89%A520-3fb950?style=flat-square)](https://nodejs.org)
[![deps](https://img.shields.io/badge/runtime%20deps-1%20(zod)-3fb950?style=flat-square)](#why-so-few-dependencies)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)](tsconfig.json)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

</div>

---

## Why it exists

Generating a page is slow and expensive. *Deciding* a page is fast and cheap — and almost
nobody separates the two.

TurboSlop does. **[Jev](https://typesafe.ai)** (TypeSafe's "System One" decision model) chooses
the design from a curated catalog and returns **calibrated probabilities** instead of prose.
A language model writes the copy. A hosted image model illustrates it. Code composes the
result and owns every fact.

The model never writes markup, never picks a colour that doesn't exist, and never invents a
number about your business. Its freedom is bounded to *pick a card from the deck* — which is
exactly why the output is always renderable, always on-brand, and always typed.

> Ten fully-designed, written and illustrated directions cost about **$0.001** and finish in
> roughly the time it takes to read this paragraph.

---

## Screenshots

### The control surface

Everything in one place: the catalog the machine may speak, the CSS the engine emits, the
artwork it generated, and every design you've ever made.

![TurboSlop control surface](docs/screenshots/control-surface.png)

### Iterating on a finished design

Pick any previous design, lock its brief, and describe what to change. The original is never
mutated — you get a new revision with visible lineage.

![Iterating on a design](docs/screenshots/design-detail.png)

### The CSS it knows

Not a list of features it might use — the ones it **actually emits**, and what each replaces.

![CSS library](docs/screenshots/css-library.png)

### Generated artwork

Every image with the exact prompt, seed, steps and guidance that produced it.

![Artwork library](docs/screenshots/artwork-library.png)

### A generated page

Output of the pipeline above, at `256×256` artwork and all.

![Generated page](docs/screenshots/generated-page.png)
![Generated work section](docs/screenshots/generated-page-work.png)

---

## How it works

```
        brief
          │
          ▼
   ┌─────────────┐   one batched call, ~360ms
   │    JEV      │   returns choices + calibrated confidence
   │   decides   │   cannot return a value outside the catalog
   └──────┬──────┘
          ▼
   ┌─────────────┐   ~310ms
   │    LLM      │   writes the prose in the register Jev chose
   │   writes    │   fixed facts are prompt-enforced, not invented
   └──────┬──────┘
          ▼
   ┌─────────────┐   optional, 1.2–12.7s per image
   │   IMAGES    │   illustrative only; the page works without them
   └──────┬──────┘
          ▼
   ┌─────────────┐
   │    CODE     │   composite scoring · confidence gates · typed spec
   │  composes   │   → self-contained HTML
   └─────────────┘
```

| Stage | Model | Job | Cannot |
|---|---|---|---|
| **Decide** | Jev | pick + rank from the catalog, with confidence | write a sentence |
| **Write** | any OpenAI-compatible LLM | prose in the chosen register | change a fact or a colour |
| **Illustrate** | Supra2 | 256×256 artwork | affect layout or copy |
| **Compose** | code | weights, thresholds, tokens, markup | hallucinate |

**Every stage is optional.** No Jev key → a deterministic local decider. No LLM → canonical
copy. No image service → CSS gradient fallbacks. The page always ships.

See [`docs/JEV-RESEARCH.md`](docs/JEV-RESEARCH.md) for the decision-model research and
[`docs/MODERN-CSS.md`](docs/MODERN-CSS.md) for the CSS feature set.

---

## Quickstart

```bash
git clone <your-fork> turboslop
cd turboslop
npm install

# 1. optional: live Jev decisions
export TYPESAFE_API_KEY=...        # https://typesafe.ai

# 2. optional: a copywriter (any OpenAI-compatible endpoint)
export FORGE_LLM_PROVIDER=deepseek
export DEEPSEEK_API_KEY=...

# 3. optional: image generation
export FORGE_IMAGE_BASE_URL=https://your-host:4363

npm run serve          # http://127.0.0.1:4400
```

Then open **http://127.0.0.1:4400**, write a brief, and hit *Generate design*.

### Command line

```bash
npm run decide -- --brief "A calm, spa-like landing page for a wellness studio"
npm run decide -- --brief "..." --images --image-count 3 --image-preset preview
npm run decide -- --briefs briefs.example.json --out out
npm run decide -- --brief "..." --decider local --no-copy     # fully offline
```

| Flag | |
|---|---|
| `--brief` / `--briefs` | one brief, or a JSON batch |
| `--decider auto\|live\|local` | `auto` uses Jev when a key is present |
| `--no-copy` | skip the LLM, keep canonical copy |
| `--images` `--image-count` `--image-preset` `--image-steps` `--image-guidance` `--image-seed` | image generation |

### Image presets

| Preset | Steps / guidance | Measured |
|---|---|---|
| `turbo` | 4 / 2 | ~1.2 s |
| `preview` | 10 / 3 | ~3.4 s |
| `balanced` | 20 / 3 | ~6.0 s |
| `reference` | 50 / 3 | ~12.7 s |
| `fast` | 20 / **1** | ~4.3 s |

Workflow defaults, **not** quality claims. Guidance `1` skips the unconditional prediction so
it is genuinely cheaper; guidance `2`, `3` and `5` all cost the same as each other.

---

## Exporting

Every design exports three ways:

| | |
|---|---|
| **ZIP** | `index.html` + `index.selfcontained.html` + `design.spec.json` + `assets/` + a `README.md` documenting the brief, every decision with its confidence, and every image prompt |
| **One-shot HTML** | a single self-contained file with all artwork inlined as data URIs — copy it into an email, a gist, a CMS field, anywhere |
| **Spec JSON** | the full decision record, including every probability, for audit or replay |

![Export buttons](docs/screenshots/design-detail.png)

From the surface: **Download .zip** or **Copy one-shot HTML**.
From the CLI: everything is already in `out/`.

---

## Deployment

The control surface is a single Node process. Generated designs are static files, so you can
deploy either the *tool* or just its *output*.

> ### One thing to know first
> Image generation talks to **any reachable HTTP endpoint** — that is the only requirement.
> There is no default host and no assumption about your network: a service on `localhost`, on
> your LAN, behind a VPN, behind Tailscale, or behind a reverse proxy all work identically.
> Decisions, copy and rendering need only outbound HTTPS.
> If the endpoint is unreachable, TurboSlop ships the page without artwork and says so.
> See [Image generation](#image-generation) below.

### 1. Local

```bash
npm install && npm run serve
```

### 2. Static output (the simplest deploy)

Generated pages are self-contained. Publish `out/` to any static host:

```bash
npm run decide -- --brief "..." --images --out dist
npx serve dist                      # or: netlify deploy --dir dist, vercel deploy dist,
                                    #     aws s3 sync dist s3://bucket --delete
```

This is the right choice when you only need the *results* — no server, no keys, no runtime.

### 3. Docker

```bash
docker build -t turboslop .
docker run -d --name turboslop -p 4400:4400 \
  -v turboslop-out:/data/out \
  -e TYPESAFE_API_KEY=... \
  -e DEEPSEEK_API_KEY=... \
  -e FORGE_LLM_PROVIDER=deepseek \
  turboslop
```

The image runs unprivileged, keeps `out/` on a volume so designs survive redeploys, and has a
`HEALTHCHECK` against `/api/state`. If your image service is tailnet-only, add
`--cap-add=NET_ADMIN` and mount a Tailscale sidecar (below).

### 4. VPS with systemd + nginx

```bash
sudo useradd -r -s /usr/sbin/nologin turboslop
sudo mkdir -p /opt/turboslop /var/lib/turboslop /etc/turboslop
sudo rsync -a --exclude node_modules --exclude out ./ /opt/turboslop/
cd /opt/turboslop && sudo npm install --no-audit
sudo chown -R turboslop:turboslop /opt/turboslop /var/lib/turboslop

# secrets, root-owned and unreadable to others
sudo install -m 600 -o root -g root /dev/null /etc/turboslop/env
sudo tee /etc/turboslop/env >/dev/null <<'EOF'
TYPESAFE_API_KEY=...
DEEPSEEK_API_KEY=...
FORGE_LLM_PROVIDER=deepseek
EOF

sudo cp deploy/turboslop.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now turboslop
sudo cp deploy/nginx.conf /etc/nginx/sites-available/turboslop
sudo ln -s /etc/nginx/sites-available/turboslop /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d turboslop.example.com
```

The unit is hardened (`ProtectSystem=strict`, `ProtectHome`, `NoNewPrivileges`, a single
writable path). The nginx config **disables proxy buffering on `/`** — without that, Server-Sent
Events progress stalls until the run finishes and the surface looks frozen.

### 5. Fly.io / Railway / Render

Any of them will run the `Dockerfile` as-is. Set the same environment variables, mount a
volume at `/data/out`, and expose port `4400`.

```toml
# fly.toml
app = "turboslop"
[build] dockerfile = "Dockerfile"
[env] FORGE_PORT = "4400" FORGE_OUT_DIR = "/data/out"
[mounts] source = "turboslop_out" destination = "/data/out"
[http_service] internal_port = 4400 force_https = true
```

<a id="image-generation"></a>
### 6. Image generation — pick whichever topology fits

Artwork comes from any HTTP endpoint that speaks this API. **There is no default host**:
`FORGE_IMAGE_BASE_URL` is the only thing that turns it on. Four common setups, all equally
supported:

#### a. Local service — no network at all

```bash
FORGE_IMAGE_BASE_URL=http://127.0.0.1:8000
```

`localhost`, `127.0.0.1` and `::1` are always permitted, so this needs no allowlist entry.
Best for a single machine, air-gapped work, or a GPU box you SSH into.

#### b. LAN / private network

```bash
FORGE_IMAGE_BASE_URL=http://192.168.1.50:8000
FORGE_IMAGE_ALLOW_HOSTS=192.168.1.50
```

Any hostname that is not localhost must be named in `FORGE_IMAGE_ALLOW_HOSTS` (comma-separated,
hostnames only — ports are not part of the match). This is what stops the app being turned into
an arbitrary fetch proxy by a crafted request.

#### c. Over a tunnel — VPN, WireGuard, SSH, Tailscale, ZeroTier

```bash
FORGE_IMAGE_BASE_URL=https://your-host.your-tailnet.ts.net:4363
FORGE_IMAGE_ALLOW_HOSTS=your-host.your-tailnet.ts.net
```

TurboSlop does not care *how* the route exists — only that the endpoint is reachable from the
process making the request. An SSH tunnel is often the simplest:

```bash
ssh -N -L 8000:127.0.0.1:8000 user@gpu-box &
FORGE_IMAGE_BASE_URL=http://127.0.0.1:8000
```

If you do use Tailscale in a container, a sidecar works:

```yaml
# docker-compose.yml
services:
  tailscale:
    image: tailscale/tailscale:latest
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_USERSPACE=false
    volumes: [ts-state:/var/lib/tailscale]
    cap_add: [NET_ADMIN, SYS_MODULE]
    restart: unless-stopped
  turboslop:
    build: .
    network_mode: "service:tailscale"     # shares the tailnet interface
    environment:
      - FORGE_IMAGE_BASE_URL=https://your-host.your-tailnet.ts.net:4363
      - FORGE_IMAGE_ALLOW_HOSTS=your-host.your-tailnet.ts.net
    volumes: [slop-out:/data/out]
    depends_on: [tailscale]
volumes: { ts-state: {}, slop-out: {} }
```

If the service authenticates by network identity, **do not forge identity headers** and do not
expose it publicly. If the deployment identity is not authorised, leave images off — the rest
of the pipeline is unaffected.

#### d. Behind a reverse proxy, with a token

```bash
FORGE_IMAGE_BASE_URL=https://images.internal.example.com
FORGE_IMAGE_ALLOW_HOSTS=images.internal.example.com
FORGE_IMAGE_TOKEN=...                     # sent as `Authorization: Bearer ...`
# FORGE_IMAGE_TOKEN_HEADER=X-Api-Key      # for a non-bearer scheme
# FORGE_IMAGE_ORIGIN=https://images.internal.example.com   # only if it checks Origin
```

#### Trusted-network shortcut

If the endpoint is only ever reachable from a network you control, you can skip the allowlist:

```bash
FORGE_IMAGE_ALLOW_ANY_HOST=1
```

Only do this where an SSRF would not matter. The allowlist exists because the spec that drives
a request is machine-generated.

Everything above is documented inline in [`.env.example`](.env.example).

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `TYPESAFE_API_KEY` | — | enables live Jev decisions |
| `FORGE_DECIDER` | `auto` | `auto` \| `live` \| `local` |
| `FORGE_LLM_PROVIDER` | `deepseek` | `deepseek` \| `openai` \| `openrouter` \| `groq` \| `together` \| `ollama` |
| `FORGE_LLM_BASE_URL` / `FORGE_LLM_MODEL` / `FORGE_LLM_API_KEY` | — | point at **any** OpenAI-compatible endpoint |
| `FORGE_LLM_EFFORT` | `low` | reasoning budget. **Measured near-no-op** on `deepseek-flash` — reasoning cannot be switched off; see [Saving time and money](#saving-time-and-money) |
| `FORGE_IMAGE_BASE_URL` | *unset* | **any** reachable HTTP service; unset = images off |
| `FORGE_IMAGE_ALLOW_HOSTS` | — | extra hostnames beyond localhost (comma-separated) |
| `FORGE_IMAGE_ALLOW_ANY_HOST` | — | `1` disables the allowlist (trusted networks only) |
| `FORGE_IMAGE_TOKEN` / `FORGE_IMAGE_TOKEN_HEADER` | — | auth, if the service needs it |
| `FORGE_IMAGE_ORIGIN` | base URL | only if the service checks `Origin` |
| `FORGE_IMAGE_TIMEOUT_MS` / `FORGE_IMAGE_POLL_TIMEOUT_MS` | `20000` / `180000` | request and job timeouts |
| `FORGE_HOST` / `FORGE_PORT` / `FORGE_OUT_DIR` | `0.0.0.0` / `4400` / `./out` | server bind and storage |

See [`.env.example`](.env.example) for a fully commented template.

> **⚠️ The control surface has no authentication.** It is a local studio tool, not a
> multi-tenant service. Anyone who can reach the port can spend your API credits and generate
> images. Keep `FORGE_HOST=0.0.0.0` on a private network (tailnet, VPN, LAN) or behind an
> authenticating proxy, and prefer `FORGE_HOST=127.0.0.1` when in doubt. The reverse-proxy
> config in [`deploy/nginx.conf`](deploy/nginx.conf) is a good place to add auth.

**Swapping the writer is configuration, not code.** Every provider above speaks the same
`/chat/completions` shape; set three variables and restart.

### Secrets

Nothing here is ever read from the repository. Locally they live in
`~/.config/turboslop/*.env` (mode `600`); in production, in `/etc/turboslop/env` or your
platform's secret store. `.gitignore` covers `.env*`, `*.key`, `*.pem`.

---

## Testing

```bash
npm test         # 47 checks, fully offline — no keys, no network, no GPU
npm run typecheck
```

| Suite | Checks | Covers |
|---|---|---|
| `test/forge.test.ts` | 18 | decision composition, composite scoring, confidence gates, catalog drift, renderer, modern-CSS emission |
| `test/images.test.ts` | 19 | payload validation, path-traversal refusal, URL allowlist, PNG magic bytes, **foreign-job filtering**, busy/429 backoff, ambiguous submissions |
| `test/zip.test.ts` | 10 | CRC-32 vectors, real `unzip` round-trips, DEFLATE vs STORE selection, traversal rejection |

The ZIP writer's output was additionally verified with Python's `zipfile` — an independent
implementation — confirming valid CRCs and correct per-entry compression choices.

---

## Project structure

```
src/
  types.ts        zod schemas + inferred types — the contract
  catalog.ts      every value the machine may emit (the "deck")
  questions.ts    ALL Jev questions, criteria, thresholds, weights  ← review this
  jev.ts          typed transport for POST /v1/systemone
  decider.ts      live (Jev) + deterministic local decider, one interface
  compose.ts      composite scoring + confidence gates → DesignSpec
  copy.ts         the writer: prompt, schema, fixed-fact enforcement
  llm.ts          provider-agnostic chat-completions transport
  images.ts       Supra2 client: allowlist, PNG validation, own-jobs-only filtering
  layout.ts       the layout engine → stylesheet
  render.ts       DesignSpec → self-contained HTML
  pipeline.ts     the one definition of "generate a design"
  registry.ts     design history and lineage
  zip.ts          dependency-free ZIP writer
  server.ts       control surface API + SSE
public/
  index.html      the control surface (no build step)
deploy/           systemd unit, nginx config
docs/             research, CSS reference, screenshots
```

### Why so few dependencies?

One runtime dependency (`zod`). The decision transport, the LLM client, the image client, the
layout engine, the ZIP writer and the HTTP server are all hand-written. For a tool whose whole
claim is *deliberate, inspectable decisions*, a readable dependency tree is part of the
argument.

---

### Saving time and money

The writer dominates both. Measured on the default setup:

| | Decide (Jev) | Write (deepseek-flash) |
|---|---|---|
| tokens | ~2,500 in, ~0 out | ~900 in, **~4,000 out** |
| time | ~0.4 s | **~19–22 s** |
| cost | $0.0001 | **~$0.0024** |

The write is **output-token-bound** at roughly **210 output tokens/second**, and
about **65% of those output tokens are reasoning** — the model thinks before it
writes.

**You cannot turn that reasoning off on `deepseek-flash`.** Measured over 3
samples per setting:

| setting | time | reasoning tokens | cost |
|---|---|---|---|
| `low` | 18.9 s | 2,542 | $0.00245 |
| `high` | 19.5 s | 2,777 | $0.00260 |
| `none` | 18.9 s | 2,223 | $0.00228 |
| *omitted* | 19.1 s | 2,842 | $0.00256 |

`effort` moves reasoning by ~9% and wall time by ~3% — within noise. Values like
`none`, `off`, `0` and `{"reasoning":{"enabled":false}}` are **accepted and
ignored**; the model reasons anyway.

**The real lever is the model.** The writer is provider-agnostic, so point it at a
non-reasoning one and the verbatim output (~1,400 tokens) is all you pay for —
at the measured 210 tok/s that is roughly **7 seconds and a third of the cost**:

```bash
FORGE_LLM_PROVIDER=openai
FORGE_LLM_MODEL=gpt-4o-mini
FORGE_LLM_PRICE_IN=0.15
FORGE_LLM_PRICE_OUT=0.60
```

The other lever is the brief itself: a larger content model costs more to write.
`content.ts` is where that shape is defined.

---

## What it deliberately does not do

- **No text in the decision layer.** Jev cannot write; the renderer is mechanical.
- **No invented content.** Colours, fonts and layouts come only from the catalog; business
  facts are prompt-enforced and never generated.
- **No silent guessing.** Any axis below its confidence threshold is flagged for review and
  its ranked alternatives are kept in the spec.
- **No blind retries.** The image service has no idempotency key, so an ambiguous submission is
  reported, never repeated.
- **No service-wide cancellation.** `/api/cancel` is deliberately not implemented — it would
  kill other people's queued work.

---

## License

MIT — see [LICENSE](LICENSE).

<div align="center">
<br>
<sub><i>“Machine-made. Human-judged.”</i></sub>
</div>
