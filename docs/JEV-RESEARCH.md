# JEV RESEARCH — decision-model architecture for an agentic design tool

Research compiled 2026-09-22. Sources: TypeSafe AI launch post, `docs.typesafe.ai`,
Flavio Copes' deep dive (2026-09-21), CopilotKit "Jev: fast generative UI" cookbook,
LangChain / Langfuse integration posts, `@typesafe-ai/sdk`, `@typia/jev`.

---

## 1. What Jev is

A **System One model**: not a chatbot, not a coding model. It **cannot generate text**.
It takes *state* plus *typed questions* and returns *typed, calibrated answers*.

| | Existing LLMs | Jev |
|---|---|---|
| Output | strings (parsed + validated by you) | type-safe structured values |
| Sampling | sequential, token by token | parallel, all answers in one query |
| Cost | $0.20–$10 / M input, output ~5x input | **$0.042 / M input, output free** |
| Latency | 3–329 s | **70–500 ms** |
| Failure mode | can hallucinate / malform | **cannot produce a value outside your schema** |
| Confidence | overconfident, uncalibrated | calibrated (RLCD), `confidence` on every answer |

Trained with **RLCD** (Reinforcement Learning for Calibrated Decisions): an answer given
90% probability should be right ~90% of the time. **Calibration is the key property** —
it is what lets code branch on a threshold safely.

They call it **"a smart `if` statement"**. Name: System One ← Kahneman; "Jev" ← Jevons paradox.

> **The architecture rule: Jev decides, the LLM writes.**

---

## 2. The wire format (exact)

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY
Content-Type: application/json
```

```jsonc
{
  "model": "jev-latest",          // or pin "jev-1.13.0"
  "state": { /* anything: string | object | array; text only */ },
  "questions": {
    "<your_id>": { "type": "...", "instructions": "...", "criteria": ... }
  }
}
```

```jsonc
{
  "model": "jev-1.13.0",
  "answers": {
    "is_sponsor_inquiry": { "type": "noul", "noul": 0.99 },
    "product_category": {
      "type": "choice",
      "choice": "dev_tool",
      "probabilities": { "dev_tool": 0.97, "course": 0.01, "unrelated": 0.02 },
      "confidence": 0.95
    },
    "message_quality": {
      "type": "score",
      "score": 1.9,
      "legend": { "0": "...", "1": "...", "2": "..." },
      "probabilities": { "0": 0.0, "1": 0.1, "2": 0.9 },
      "confidence": 0.86
    }
  },
  "usage": { "input_tokens": 210, "output_tokens": 31 }
}
```

### The three primitives

| Type | Question | `criteria` | Answer |
|---|---|---|---|
| **Noul** | "Is this true?" | optional `{true,false}` clarifiers | `noul`: P(yes), 0–1 |
| **Choice** | "Which of these?" | **object** of `id → description`, ≤255 | `choice`, `probabilities`, `confidence` |
| **Score** | "Where on this scale?" | **array** low→high, 2–10 levels | `score` (weighted mean), `legend`, `probabilities`, `confidence` |

- The question **id is never sent to the model** — write the full question in `instructions`.
- **Noul has no `confidence`** — the probability *is* the uncertainty.
- Noul at 0.5 means *"I can't tell"*, **not** "medium". Use a Score for degree.
- Score levels are judged **independently** — the model never sees level numbers or neighbours.
- Errors: `401` bad key · `422` body validation failed · `429` rate limit · `529` overloaded. Retry 429/529 with backoff (SDKs do it).
- Limits: state+questions ≈64k tokens; state + longest question ≈32k; Choice ≤255 options; Score 2–10 levels.

---

## 3. Typesafe Jev — the part that matters for a tool

**Three layers of type safety, in order of value:**

1. **SDK inference (best).** `@typesafe-ai/sdk`'s `noul()` / `choice()` / `score()` helpers
   infer the answer union from the question definition:
   ```ts
   const { answers } = await client.systemOne({
     state: { ticket },
     questions: {
       category: choice('What kind of ticket is `ticket`?', {
         bug_report: 'Something is broken',
         billing: 'Charges, invoices, refunds',
         other: null,
       }),
     },
   })
   // answers.category.choice : 'bug_report' | 'billing' | 'other'
   // exhaustive switch works; unknown labels fail type checking.
   ```

2. **Schema validation at the boundary.** CopilotKit's recipe validates the *decision shape*
   with zod before it reaches the UI — `PanelSchema.parse(...)` — so a malformed decision is
   caught in code, not in the renderer.

3. **`@typia/jev`** — a Jev wire format for the `typia` runtime-validator ecosystem
   (`samchon/typia`), plus `@compootor/effective-jev` (Effect-based). Useful if the host
   project already standardises on typia or Effect.

> Note: Jev guarantees **no type errors**, but **not correct routing**. A Choice always
> returns an allowed option and can still be the wrong one. Version questions + criteria +
> thresholds together and replay known inputs when any change.

---

## 4. Best practices (the operational core)

### 4.1 Speculative fan-out — the highest-leverage habit
Every question runs **independently and in parallel against the same state**. So ask
**every question you might need, in one call**, even ones only relevant for some branches.
TypeSafe measured **13 questions in one call = 12.2x cheaper and 10x faster** than 13
sequential calls. Most of the saving is sending the state once.

A second call is justified *only* when code cannot construct it until it has the first answer.

### 4.2 Composite scoring
When a judgment depends on several things, **one question per factor**, then combine with
**weights you own in code**. Normalise each Score by its top level before weighting:
```ts
const norm = (a, id) => a[id].score / (QUESTIONS[id].criteria.length - 1);
priority = 0.6*norm(a,'severity') + 0.3*norm(a,'frustration') + 0.1*norm(a,'report_quality');
```
Tuning a coefficient beats rewriting a prompt.

### 4.3 Confidence thresholds — the decision policy
`confidence` is the shape of the distribution collapsed to one number.
- **High → act automatically**
- **Medium → confirm / flag / gather more**
- **Low → route to a person or a slower fallback**

Every Choice and Score carries it. Thresholds belong in code where they can be read and
changed. Docs *example* 0.5 as a review floor and 0.9 before a destructive action —
**examples, not defaults**. Calibrate against labelled data.

### 4.4 Writing questions Jev answers well
- **One judgment per question.** "Analyze this and decide the best action" hides several.
- **Write the exact condition.** It reads literally, not charitably. Scoping words, negations and implied conditions are taken at face value.
- **Describe situations, not degrees.** "Broken feature, workaround exists" ✅. "Moderately severe" ❌.
- **Give each level `what` + `examples`.** Measured: plain string levels → 1.30 @ 0.54 confidence; same levels + one relevant example → **1.07 @ 0.90**. An *unrelated* example changed nothing.
- **Always give an exit** — an `other` / `none_of_the_above` option on any Choice that might not cover every input.
- **Backticked dot-paths** to point at state (`\`order.charges\``) — indirection costs accuracy.
- **Send only what the questions need** — context rot degrades accuracy like any model.
- **Never let instructions and criteria contradict** (e.g. a Noul where `true` means "no").

### 4.5 Where Jev breaks → design around it
| Weakness | Rule |
|---|---|
| Literal reading | be explicit; split interpretation into two questions |
| **No math / counting** | compute in code, pass in the result or a named bucket |
| Counting matching items | one Noul per item, sum in code |
| Score ≠ measurement | threshold or rank with it; **never interpolate a magnitude** |
| **Dates** | extract as Choice over months/days/years + "not stated", build the real date in code |
| Indirection / double negatives | point directly at the relevant state |
| Large irrelevant state | filter first, or one Noul per chunk |
| Prompt injection via state | criteria + hostile-input testing before going public |

> **The golden rule: "Pick a card from the deck — don't ask it to name one."**
> When you want to *extract* something, instead present candidates and ask *which one*.

---

## 5. The generative-UI pattern (CopilotKit cookbook) — our blueprint

The documented recipe for "Jev builds UI":

| Layer | Owns |
|---|---|
| **Jev** | which prepared control fits the moment; how well each candidate matches |
| **Your application** | schemas, components, **fixed labels**, candidate IDs, validation, confirmed actions |
| **Transport** (AG-UI) | carrying state/results to the React UI |

The core move — **batch a Choice + one Score per candidate in a single call**:
```ts
questions.control = choice('Choose the useful next control...', {
  clarification: '...', comparison: '...', agent: '...'
});
for (const c of candidates)
  questions[`fit_${c.id}`] = score(`How well does candidate ${c.id} fit?`,
    ['Poor fit','Unclear fit','Good fit','Strong fit']);

const result = await client.systemOne({ model:'jev-1.13.0',
  state: { latestMessage, selectedId, candidates, publishedGuidance }, questions });
```
Then code: validate with zod → sort candidates by `score` → render.

**Why this is the right architecture for a design tool:**
- The model never invents markup. It **selects from a curated catalog** — structurally incapable of producing an unstyled or unvalidated component.
- Ranking is a Score, so you get an *ordered* composition, not just a pick.
- `confidence` gives a principled "ask the user instead" path.

---

## 6. Applying Jev with subagents (synthesis)

Subagents are generative and expensive; Jev is discriminative and cheap. Match the tool to
the job:

| Job | Right tool |
|---|---|
| Invent a novel visual direction | **subagent** (generative) |
| Pick a validated design direction for a brief from N known options | **Jev Choice** |
| Score candidates on `clarity`, `originality`, `fit`, `emotion` | **Jev Score** ×4 |
| Decide whether a built artefact violates the design contract | **Jev Noul** |
| Fix the violations | **subagent** (generative) |

### The pattern: generate wide with subagents, decide with Jev
1. **Subagents fan out** — produce diverse candidates (the 10 emotional variations).
2. **Jev fans in** — one batched call scores *every* candidate on *every* axis at once
   (speculative fan-out). This is the curation step, and it is where an LLM would be slow,
   expensive and uncalibrated.
3. **Code composes** — weighted composite score picks the winner and decides which elements
   to harvest; thresholds route low-confidence axis scores to human review.
4. **Subagents rebuild** — only for the *generative* step: assembling harvested elements into
   the final artefact.

### Concretely, for our design tool
- **Question file as the contract.** One reviewable module holds every question, its criteria
  and every threshold — the artefact a human reviews and versions.
- **Catalog as candidates.** Design elements (palettes, type stacks, motion languages,
  layouts) are the "prepared controls". Jev chooses and ranks; it never authors.
- **Composite scoring for composition.** A whole design direction is composed from several
  independent axis scores combined with weights we own — not one holistic "is it good?".
- **Confidence gate.** `< threshold` → surface alternatives to the user rather than guessing.

---

## 7. Environment constraints (checked)

- **No `TYPESAFE_API_KEY`** is present in this environment. Available keys are
  `PROXY_API_KEY`, `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`, `HATZ_API_KEY`.
- Therefore the tool must ship **two interchangeable backends behind one interface**:
  1. **`live`** — the real `POST /v1/systemone` wire format + `@typesafe-ai/sdk`-shaped
     question helpers. Used the moment a key is present.
  2. **`local`** — a deterministic, dependency-free decider implementing the *same* answer
     shapes (noul/choice/score/probabilities/confidence) from explicit rules. Keeps the whole
     pipeline runnable, testable and CI-friendly with no key and no network.
- The `local` backend is **explicitly labelled as a stand-in** — it must never masquerade as
  Jev. Swapping to live changes nothing else in the pipeline, which is the point.

---

## 8. Sources

- TypeSafe AI — *Introducing System One Models & Jev* (2026-09-15) — typesafe.ai/blog
- Flavio Copes — *A deep dive into Jev* (2026-09-21) — flaviocopes.com/jev
- CopilotKit — *Jev: fast generative UI* — docs.copilotkit.ai/cookbook/jev-generative-ui
- LangChain — *Building a harness with Jev*; Langfuse — *Using Jev for evals* (2026-09-18)
- `@typesafe-ai/sdk`; `@typia/jev` (samchon/typia); `@compootor/effective-jev` (JSR)
- TypeSafe docs — question craft, jaggedness pages; evals.typesafe.ai
