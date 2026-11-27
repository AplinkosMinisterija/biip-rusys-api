# Faster Request PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the wall time of a request PDF extract (išrašas) at least in half, with every map
screenshot pixel-identical to today's and the legends unchanged.

**Architecture:** Keep the maps-web rendering that produces each place and informational-form
map. Remove the waste around each screenshot instead: the `networkidle0` tail after the image is
already captured, the cold start of a fresh Chrome per screenshot, and ten retries of a screenshot
that cannot succeed. Then raise the screenshot parallelism to what the shared browserless can
take. A second plan (render many places in one loaded maps-web page) is written only if the
numbers from Task 5 fall short.

**Tech Stack:** Moleculer + BullMQ (biip-rusys-api), Moleculer (biip-tools), browserless/chrome v1,
Vue 3 + OpenLayers (biip-maps-web, read only here), Docker Compose (biip-infra).

**Spec:** user requirements of 2026-11-27, copied verbatim into Global Constraints. The
measurements and the screenshot mechanism are in `docs/areas/requests.md` (Traps).

## Global Constraints

- "turi greičiau generuoti pdf'us": the PDF must be generated faster.
- "screenshotai tokie patys išliks... turi būti su legendom ir t.t. kaip ir dabar yra, tik kad
  greičiau": screenshots stay exactly as they are now, legends included. Only the speed changes.
- The legends ("Sutartiniai ženklai") come from QGIS GetLegendGraphic and are rendered in the HTML
  (`templates/request-pdf.ejs`), not in the screenshots. No task touches them.
- No change to `templates/**`, to maps-web, or to which maps a PDF contains.
- biip-tools `/screenshot` is shared with UETK. Every new parameter defaults to today's behaviour.
- Prod browserless (`biip-infra/environments/base/docker-compose.yml`, service `chrome`):
  `MAX_CONCURRENT_SESSIONS: 10`, `MAX_QUEUE_LENGTH: 10`, memory limit 8G. It is shared with
  UETK and with the PDF print itself.
- rusys-api runs as one container with a 512M memory limit.
- Yarn only. Images run Node 18.

**Baseline**, measured 2026-11-27 against prod maps-web through browserless (harness in Task 5):

| phase | time |
|---|---|
| DOMContentLoaded | 0.8 s |
| `#image-canvas-0` present (image captured) | 3.3 s |
| `goto` with `networkidle0` returns | 4.0 s |
| biip-tools `/screenshot` HTTP total | 4.5–5.5 s |

The PDF needs one screenshot per place and per informational group. A request with 1,845 places
takes about 30 min at today's concurrency of 5.

## Review Focus

1. A map layer that finishes drawing after `#image-canvas-0`: the screenshot must still match
   today's pixel for pixel. Test: Task 2's pixel-identity gate uses place views with INVA and
   SRIS layers.
2. A screenshot that can never succeed (QGIS `LayerNotDefined`, as happened in prod from
   2026-11-23): the PDF job must fail within minutes, not hours. Test: Task 2 pins `attempts: 3`.
3. browserless refusing a session because its queue is full (HTTP 429/503) after concurrency is
   raised: this must be retried, not turn into an empty screenshot. Test: Task 4 adds a
   makeScreenshot test where a 429 rejects, so the job can retry.
4. UETK screenshots must not change. Test: Task 1 pins the default `waitUntil` to `networkidle0`.
5. Warm Chrome processes holding memory on a host shared by every app. Test: Task 3 records
   browserless RSS before and after on staging.

---

### Task 1: biip-tools `/screenshot` takes `waitUntil`

**Files:**
- Modify: `biip-tools/services/screenshot.service.ts` (action `get`: params and the
  `gotoOptions` it posts)
- Test: `biip-tools/services/screenshot.service.spec.ts` (new)

**Interfaces:**
- Produces: query parameter `waitUntil` on `GET /tools/screenshot`, one of `load`,
  `domcontentloaded`, `networkidle0`, `networkidle2`, default `networkidle0`. It is passed through
  as `gotoOptions.waitUntil` in the browserless request body.

- [ ] **Step 1: Write the failing tests.** Mock global `fetch` to resolve to a `Response` with an
  empty body, then call the action through a `ServiceBroker` with the service loaded:
  - `it('passes waitUntil to browserless')`: with `{ url: 'https://example.com', waitUntil: 'domcontentloaded' }`,
    `JSON.parse(fetch.mock.calls[0][1].body).gotoOptions` equals `{ waitUntil: 'domcontentloaded', timeout: 600000 }`.
  - `it('keeps networkidle0 when waitUntil is not given')`: same, but without `waitUntil`, expects
    `waitUntil: 'networkidle0'`.
  - `it('rejects an unknown waitUntil')`: `waitUntil: 'never'` rejects with
    `ValidationError`.
- [ ] **Step 2: Run** `yarn jest services/screenshot.service.spec.ts`. Expected: the first and
  third tests FAIL.
- [ ] **Step 3: Implement.** Add `waitUntil: { type: 'string', optional: true, default: 'networkidle0', enum: [...] }`
  to the params and use it in place of the hard-coded `'networkidle0'`.
- [ ] **Step 4: Run** `yarn jest && yarn lint && yarn build`. Expected: all green.
- [ ] **Step 5: Commit** `feat: let a screenshot caller choose when the page counts as loaded`.

### Task 2: rusys-api screenshots stop waiting for network idle, and fail fast

**Files:**
- Modify: `services/tools.service.ts` › `makeScreenshot` (params and query string)
- Modify: `services/jobs.service.ts` › `saveScreenshot` (passes `waitUntil`), service
  `settings.bullmq.job`
- Test: `services/tools.service.spec.ts` (new), `services/jobs.service.spec.ts` (new)

**Interfaces:**
- Consumes: Task 1's `waitUntil` query parameter (requires biip-tools deployed first in each
  environment; an older biip-tools ignores the unknown parameter, so the order is safe).
- Produces: `tools.makeScreenshot` param `waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'`.

- [ ] **Step 1: Write the failing tests.**
  - `tools.service.spec.ts`, `it('forwards waitUntil to the screenshot endpoint')`: with `fetch`
    mocked, `makeScreenshot` with `{ url, waitUntil: 'domcontentloaded' }` calls a URL whose
    `searchParams.get('waitUntil')` is `'domcontentloaded'`. Without it, the parameter is absent.
  - `jobs.service.spec.ts`, `it('gives up on a screenshot after three attempts')`: the service
    schema's `settings.bullmq.job` equals `{ attempts: 3, backoff: { type: 'exponential', delay: 2000 } }`.
  - `jobs.service.spec.ts`, `it('asks for a screenshot without waiting for network idle')`:
    `saveScreenshot` with `ctx.call` mocked calls `tools.makeScreenshot` with
    `expect.objectContaining({ waitUntil: 'domcontentloaded', waitFor: '#image-canvas-0' })`.
- [ ] **Step 2: Run** `npx jest services/tools.service.spec.ts services/jobs.service.spec.ts`
  (not `yarn test`, which migrates the dev database). Expected: FAIL.
- [ ] **Step 3: Implement** the param in `makeScreenshot` (set it on `searchParams` only when
  given), pass `waitUntil: 'domcontentloaded'` from `saveScreenshot`, and change the job settings.
- [ ] **Step 4: Run** `npx jest && npx tsc --noEmit && yarn lint`. Expected: all green.
- [ ] **Step 5: Pixel-identity gate.** On a local stack (rusys-api on the prod-copy database,
  local biip-tools, browserless, maps-web dev server with `VUE_APP_QGIS_SERVER=https://staging-gis.biip.lt`),
  take 20 place screenshots and 5 informational-group screenshots with `type=png`, once with
  `waitUntil=networkidle0` and once with `domcontentloaded`. Use 10 INVA and 10 SRIS places.
  Compare the decoded pixels. Expected: 0 differing pixels in every pair. A non-zero pair stops
  the plan, and its URL goes into the PR.
- [ ] **Step 6: Commit** `perf: take a request screenshot once the map image exists`.

### Task 3: browserless keeps Chrome warm

**Files:**
- Modify: `biip-infra/environments/base/docker-compose.yml` › service `chrome` › `environment`

- [ ] **Step 1: Measure cold vs warm locally.** Run a throwaway browserless with
  `PREBOOT_CHROME=true` and `KEEP_ALIVE=true`, and another without them. Run Task 5's harness 10
  times against each. Expected: the warm median `/screenshot` HTTP total is lower. If it is not
  lower by at least 0.3 s, drop this task.
- [ ] **Step 2: Add** `PREBOOT_CHROME: "true"` and `KEEP_ALIVE: "true"` (and nothing else).
- [ ] **Step 3: Run** `Agent(subagent_type: 'deploy-premortem')` on the diff. Fix any P0/P1.
- [ ] **Step 4: Deploy to staging** through `deploy-environment.yml` with `environment=Staging`.
  Record browserless RSS (`docker stats`) at idle and during a 200-place PDF. Expected: it stays
  under the 8G limit, and a UETK screenshot still renders.
- [ ] **Step 5: Commit** in biip-infra:
  `perf(chrome): keep browserless Chrome warm between screenshots`.

### Task 4: screenshot parallelism matches browserless capacity

**Files:**
- Modify: `services/jobs.service.ts` › `settings.bullmq.worker.concurrency`
- Modify: `services/tools.service.ts` › `makeScreenshot` (no change expected, test only)
- Test: `services/jobs.service.spec.ts`, `services/tools.service.spec.ts`

**Interfaces:**
- Produces: env `SCREENSHOT_CONCURRENCY` (integer, default `5`). It is set to `8` in
  biip-infra for staging, then prod: 10 sessions minus 2 for the PDF print and UETK.

- [ ] **Step 1: Write the failing tests.**
  - `it('reads screenshot concurrency from SCREENSHOT_CONCURRENCY')`: with the env var set to
    `'8'` before the module loads (`jest.isolateModules`), `settings.bullmq.worker.concurrency`
    is `8`. Unset, it is `5`.
  - `it('rejects a refused browserless session so the job retries')`: `fetch` resolves
    `{ ok: false, status: 429 }`, and `makeScreenshot` rejects with a message containing `429`.
- [ ] **Step 2: Run** the two spec files. Expected: the first test FAILS (the second documents
  today's behaviour and should pass).
- [ ] **Step 3: Implement** `concurrency: Number(process.env.SCREENSHOT_CONCURRENCY) || 5`.
- [ ] **Step 4: Run** `npx jest && npx tsc --noEmit && yarn lint`. Expected: green.
- [ ] **Step 5: Add `SCREENSHOT_CONCURRENCY=8`** to the staging rusys-api environment in
  biip-infra (append a new variable only), then run `Agent(subagent_type: 'deploy-premortem')`.
- [ ] **Step 6: Commit** `perf: run as many screenshots at once as browserless can take`.

### Task 5: measure end to end and decide on part 2

**Files:** none (measurement only; results go into the PR bodies and `docs/areas/requests.md`)

- [ ] **Step 1: Harness.** browserless `POST /function` with a puppeteer function that records
  `goto` time, the time to `#image-canvas-0` and request count. The copy used for the baseline is
  in this session's scratchpad as `measure.js`. Run it 5 times per variant and report medians.
- [ ] **Step 2: End to end on staging.** Pick one request with 150–250 places. Clear its
  `generated_file` and the `temp/screenshots/<hash>.jpeg` objects of its places, then press
  "generate PDF" before the deploy and again after Tasks 1–4. Record wall time from the click
  to the `requests.saveGeneratedPdf` history entry. Expected: after ≤ 0.5 × before.
- [ ] **Step 3: Decide.** If the target is met, update `docs/areas/requests.md` with the new
  per-screenshot cost. If it is not, write a part 2 plan in which maps-web renders a list of
  places in one loaded page and hands back one image per place. That plan adds a maps-web
  change and needs its own pixel-identity gate.

## Decided

- Every place keeps its own map, however large the request ("reikės visų radaviečių", user,
  2026-11-27). Speed comes only from making each map cheaper and running more of them at once.

## Execution outcome (2026-11-27)

| Task | Outcome |
|---|---|
| 1, 2 (`waitUntil=domcontentloaded`) | dropped: the pixel gate showed 1 run in 3 differing; screenshots keep `networkidle0` |
| 2 (fail fast) | shipped on the flow children (3 attempts, exponential pause from 2 s): a child takes the caller's job settings, so the plan's target file was never read |
| 3 (warm Chrome) | shipped as `PREBOOT_CHROME` only (−0.5 to −0.8 s per screenshot); `KEEP_ALIVE` dropped after the premortem reproduced a dead-browser pool |
| 4 (concurrency) | shipped: `SCREENSHOT_CONCURRENCY` staging 8, production 10 (production browserless has 15 sessions, not 10) |
| 5 (end-to-end) | after deploy to staging |
