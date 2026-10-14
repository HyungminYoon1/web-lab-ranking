# Verification

## 2026-10-14 — remaining local workerd stream diagnostic

**PASS on the supported local entry.** The remaining `Uncaught TypeError: Can't read from request stream after response has been sent.` is a real native request-lifetime exception, not a failed assertion or merely the application's intended 404/415. In the reproduced cases the complete expected HTTP response and immediate subsequent 201 both succeeded; no score/storage failure was observed. This does not prove that every occurrence is harmless or establish production impact. This follow-up supersedes the remaining-diagnostic limitation in the earlier transport repair below; the historical reports are unchanged.

### Executed RED and cause isolation

The new per-request regression first ran against D11's existing local entry, before the bounded Worker handoff was implemented. All 11 HTTP flows passed, but the zero-native-errors assertion **failed with three diagnostics** (`output/stream-diagnostics-20261014/observe-RsUYip/report.json`). Logs were forwarded, counted and attributed to request phases, not suppressed. Each case issued a normal POST immediately after its response, without sleeping or retrying; only then did the harness allow 100ms for late diagnostic attribution.

| Original request | Bytes | Expected HTTP / immediate follow-up | Native errors before fix |
| --- | --- | --- | --- |
| Body on an unknown route | 2 | 404 / 201 | 1 |
| Unsupported text/plain | 10 | 415 / 201 | 1 |
| Unsupported text/plain at the cap | 49,152 | 415 / 201 | 1 |

A minimal local Worker with a Durable Object, no ranking logic and no database queries isolated the boundary. At both 10 and 49,152 bytes, direct Worker rejection and direct cancellation were clean; an unread Durable Object rejection and explicit cancellation inside that object each logged the exception; consuming the complete bounded input, or consuming it in the outer Worker before forwarding a detached Request, was clean. All twelve responses were 415. Evidence: `output/stream-diagnostics-20261014/binding-kOb1VI/report.json`, four diagnostics in the two unread/cancelled object variants only. The matching [upstream Durable Object unread-body report](https://github.com/cloudflare/workerd/issues/918) supports this interpretation; an exact current native C++ source line was not traced.

Two earlier minimal-fixture attempts failed to initialize the test object under a long Windows local SQLite path. Moving only that fixture's state to a short fresh `.wrangler/stream-probe-*` path allowed the reduction to run. Those setup failures are preserved in `binding-gCtRRK` and `binding-DcNUNY`; they are not counted as ranking defects or successful diagnostic runs.

### Local-only repair and GREEN

Decision D12 adds a byte-only local Worker entry after D11's size gate. It independently checks the 49,152-byte limit, completes accepted native input before crossing the Durable Object boundary, releases its reader and passes a detached Request with identical method, URL, headers and raw bytes. Overflow is cancelled and rejected, not drained without a bound; broken input fails closed. There is no JSON/authentication/score/storage logic in this adapter, no write retry and no log suppression. `wrangler.jsonc.main` remains `src/worker.js`; production implementation, API/schema, game rules, records and deployment are unchanged.

- **260/260 request flows (13 cases x 20 cycles)** passed with **zero native diagnostics**, including shutdown. Cases cover valid/invalid/empty JSON, missing/unsupported Content-Type, an extra field, foreign/missing Origin, unknown route, wrong method, exact-limit JSON/text and limit+1. Every flow checks an immediate valid POST and authenticated deletion of its own generated identities. After stopping the new local DB, read-only counts confirmed `players=0`, `tickets=0`, `bests=0`. Report: `output/stream-diagnostics-20261014/observe-zURi0e/report.json`.
- **350/350 post-413 cycles**, ten boundary flows and the existing **32 actual HTTP/SQLite assertions** passed with **zero unread-stream diagnostics**. Includes legal local Parcel 1457 and Neon 4280 submissions, idempotent retries, ownership/CORS and deletion. Bodies of 49,153, 60,012 and 1,048,576 bytes remain rejected; at/below-limit and chunked cases retain their expected behavior. Report: `output/local-transport-20261014/regression-R7ZzQI/report.json`.
- **npm test: 63/63 reported subtests**, including two helper modules, no failures/skips. Four new tests cover native EOF before detached-copy cancellation, raw-byte/header preservation, exact-limit and bounded overflow, broken input and reader release. The additional deployment-entry guard ensures the local wrapper is not selected for production. The helper's passthrough implementation failed three tests before implementation; the actual workerd regression above is the primary defect-level RED evidence.
- **npm run check** and **git diff --check** pass. Tests now fail on recurrence of this native diagnostic rather than merely reporting its count. `npm run test:streams` is included in the Windows/Linux CI matrix, alongside transport checks. Remote CI is **NOT_RUN**; nothing was committed, pushed or deployed in this task.

Scope: executed on Windows, Node 22.23.2, Wrangler 4.149.0 and workerd 1.20261014.1, using fresh isolated local databases with no production calls. Direct raw Wrangler / the intentionally failing diagnostic fixture still reproduces the vendor condition; the native runtime itself is not repaired. Other operating systems, arbitrary streaming schedules, long-running memory/resource profiling and production provider telemetry are **NOT_RUN**. Node's experimental SQLite/MockTimers notices are distinct from this uncaught workerd exception.

Source accounting: VERIFIED for this scoped follow-up: architecture/API/README/decisions, Worker/controller/domain/repository, local development/transport tools and relevant tests, config/package/workflow, installed Wrangler request-drain middleware, new minimal fixture and actual result reports. PARTIAL: historical verification sections and vendor native internals; unrelated WEB LAB repositories were not inspected or changed. Existing uncommitted audit/transport changes were preserved.

## 2026-10-14 — local post-413 transport repair

**PASS on the supported `npm run dev` local entry, not an upstream Wrangler fix or a production deployment.** The 49,152-byte application limit, all `src/`, `client/`, frozen game rules, API/schema/retention settings and production config are unchanged. No production request or existing user record was touched for this task.

### RED and cause isolation

- New `tools/verify-local-transport.mjs`: send exactly 60,012 UTF-8 bytes, require 413/payload_too_large, immediately send 2-byte `{}`, require 201, and delete that synthetic local identity. No sleeps between those requests, no retries and no fabricated responses.
- Wrangler 4.149.0 / Miniflare 5.20261006.1-alpha / workerd 1.20261006.1 / Node 22.23.2 on Windows: **10 of 20 follow-ups failed** with non-JSON 500 / Network connection lost. Raw report: `output/local-transport-20261014/red-fetch.json`; assertion failed before any fix. All oversize requests received the intended 413. Fresh client sockets also failed (10/10), so disabling client connection reuse is insufficient.
- A minimal Worker with no database reproduced the failure. A diagnostic Connection: close response header did not fix it. Wrangler 4.151.0 / workerd 1.20261012.1 still failed (13/20). This narrows the fault to the local early-response/unread-stream transport path, not ranking SQL, scores or a Free-plan capacity refusal.
- Native workerd 1.20261014.1 alone passed original-size trials, but broader tests still failed at **1,048,576 bytes**: one non-JSON 500 on the oversized request and one transport failure in ten cycles. Preserve `regression-m6CByA/report.json` as FAIL. Do not call that attempted upgrade a complete repair.
- This behavior is consistent with the documented [unread-body/service-binding connection-reset report](https://github.com/cloudflare/workers-sdk/issues/15819) and [post-cancellation follow-up failure](https://github.com/cloudflare/workers-sdk/issues/15709). Those reports support the interpretation; they are not proof of a particular native source-line defect or production impact.
- Test development also caught two local-adapter defects: a direct response.end() could reset an unread upload, and retaining compressed response headers after Node Fetch decoded the body broke clients. Executed failing tests preceded the half-close and header corrections. The earlier exploratory chunked DELETE harness omitted Transfer-Encoding and was corrected; its protocol errors are **not** counted as application defects.

### Change and GREEN

The local-only Node gate rejects advertised or actual overflow before forwarding. It retains at most 49,152 body bytes, forwards an accepted body once, and leaves JSON validation/authentication/game/storage work in the real Worker. It sends a complete length-framed 413, half-closes TCP's write side, and bounds final connection cleanup to one second rather than resetting before the response can be read. It does not drain arbitrary rejected input. Partial upload timeout is ten seconds, and the local listener has a 64-connection bound. The production Worker keeps its original independent body limit/cancellation. Wrangler stays at 4.149.0; tested native workerd is locked at 1.20261014.1. See decision D11.

Three fresh local Worker/SQLite runs passed **350 reject → immediate create → own-delete cycles each: 1,050/1,050** with zero failed requests in this matrix. Every run also passed 10 boundary flows and the existing 32 HTTP/SQLite assertions, including actual legal Parcel 1457 and Neon 4280 submissions, three-way idempotent retry, ownership/CORS and authenticated deletion. These are local protocol/rules checks, not another live browser audit.

| Per-run matrix | Cycles | Result |
| --- | --- | --- |
| 60,012 bytes: fetch, fresh socket, keep-alive, chunked keep-alive, chunked fresh socket | 60 + 60 + 60 + 60 + 30 | PASS |
| 49,153 bytes: fetch and chunked keep-alive | 30 + 30 | PASS |
| 1,048,576 bytes: fetch and chunked keep-alive | 10 + 10 | PASS |

Boundary flows: 49,151 and exactly 49,152 bytes accepted with both Content-Length and chunked framing; declared oversize headers refused before any body is sent; a live chunked stream refused before EOF; interrupted upload and 415 followed by normal 201. Local-gate tests additionally check a 300ms delayed response reader, Expect:100-continue rejection, stalled-upload timeout, no upstream forwarding for oversize, exact Origin reflection, no blind retry, DELETE authorization forwarding and decoded response framing. Measured maximum retained/forwarded body: **49,152 bytes**.

Evidence (ignored, local only): `output/local-transport-20261014/regression-8IkU2j/report.json`, `regression-XgWFqP/report.json`, and **`regression-rHpDut/report.json` after clean npm ci --ignore-scripts**. Reports contain status/size/stage metadata, never credentials or response bodies. Tests start with fresh local DB directories, remove successful synthetic identities/scores, and close their servers. Failed exploratory databases contain only generated local fixtures, not existing user data.

After clean install: **npm test 58/58 reported subtests**, including two fixture/helper modules, all PASS/no skips; **npm run check PASS**. Eight gate tests and one native-lock test were added in this task. GitHub CI now includes actual transport tests on Windows/Linux, without provider/deploy credentials. Remote CI is **NOT_RUN**: these changes are local and have not been committed/pushed/deployed.

### Remaining scope and source accounting

- Direct `npx wrangler dev` bypasses the gate and can still reproduce the vendor problem. The project-local entry is repaired; the vendor runtime itself is **not** claimed repaired.
- Each broad successful run still logged one native `Can't read from request stream after response has been sent` diagnostic during other rejection coverage. This message was counted, not suppressed. It did not cause a failed HTTP request in these runs; do not report all native error logs as eliminated.
- Windows Node 22.23.2 was executed. Linux/macOS, other Node/browser versions, every TCP timing/slow-client schedule, production oversized traffic and provider CPU/load telemetry are **NOT_RUN**. A 300ms delayed reader test is not proof for arbitrary delays.
- VERIFIED for this scoped repair: architecture/API/README/decisions, worker/controller/domain, applicable existing edge tests, new local tools/tests, lock/config/workflow and actual result reports. PARTIAL: vendor native internals and unrelated repository features; no full application/security audit was performed. Other WEB LAB repositories were unchanged and not re-audited.

## 2026-10-14 — approved production registration / independent browser / deletion

**PASS for the two specific live ranking lifecycle flows.** The user explicitly authorized creation and deletion of test-only records. This supersedes the October 13 production-write NOT_RUN status for this flow, not for load, abuse, retention or the separate local transport edge.

- Actual published Pages and actual Worker API, without a proxy, fabricated API response, injected victory, trusted client score or direct database access. The guards only continued legitimate requests or would have blocked out-of-scope writes. Gameplay used normal controls with the existing legal action witnesses.
- Writer: fresh Chrome 155.0.8059.40 process with one isolated context/new identity per game. Observer: independent Edge 155.0.4283.45 process with separate fresh contexts and GET-only API guards. No personal browser profiles, cookies or existing registration credentials were used.
- Initial public boards: Neon 0 entries, Parcel 0 entries. Labels: QA1014N1d6d2f and QA1014P1d6d2f. No third-party record deletion was requested. The public board is top 50; this is not a private-database inventory.

| Live check | NEON TACTICS mission 16 | PARCEL PANIC contract 14 |
| --- | --- | --- |
| Actual game completion | 4280 | 1457 |
| POST /v1/scores | 201, accepted | 201, accepted |
| Server tie-break | [5,12,0,6] | [142,49,552] |
| Independent Edge reload + GET + rendered row | Exact nickname and 4280 | Exact nickname and 1457 |
| UI deletion cancelled first | No DELETE; authority retained | No DELETE; authority retained |
| Own app's confirmed DELETE /v1/identity | 200, deleted:true | 200, deleted:true |
| Independent Edge reload after deletion | Row absent | Row absent |
| Final public board | 0 entries | 0 entries |

The Neon identity was deleted first while the Parcel test record remained. Both a public query and a new Edge reload confirmed Parcel's other-identity record and score were unchanged. Then Parcel's own UI deleted its identity. The before/after board fingerprints match. Exactly two identity creations, two challenge starts, two score registrations and two own-identity deletions were issued; no fallback cleanup request was needed. Credentials were retained only in memory/isolated browser storage, never output, traced, placed in HAR, or saved in evidence. Both test browsers were closed after cleanup.

Additional checks: incomplete attempts cannot submit; invalid nickname causes no score request; completed submission is disabled after acceptance; the observer cannot delete somebody else's record and never obtains a registration identity. Desktop/390/320 ranking layouts passed numeric checks, with desktop and 320 screenshots visually reviewed for readable rows, clipping and controls. Post-cleanup keyboard disclosure toggles, empty-board refresh, nickname focus/edit and disabled submit/delete controls were checked. No page errors or ownership-guard errors were observed. These were scoped ranking checks, not a new review of every game feature.

Evidence: `../output/playwright/live-ranking-20261014/live-ranking-results.json` relative to the repository's sibling project root contains 71 lifecycle checkpoints (including repeated per-viewport checks), response status/timestamps, the post-cleanup exploration, and 12 exact byte comparisons between published game rules/app/client assets and the local source. Screenshots in the same directory show records in Edge and their removal. Actual registration/deletion took place around 22:38–22:41 KST on October 14. The initial Neon observer reload reopened onboarding and blocked a test click; the harness was corrected to dismiss that normal welcome dialog via its button. This was an automation setup issue, not an application bug; the successful registration was not repeated.

Local rerun: server Node 49/49 reported subtests (including two helper modules and two new manual-audit safety tests), Neon 50/50, Parcel 53/53, no failures/skips. All three source checks pass. The two safety tests ensure ordinary test/CI runs cannot start the production audit without explicit boolean authorization or mistake a single browser for an independent observer. The production harness is a manual export, not a CI test. No application defect was reproduced, so no application/server implementation fix, rules/schema change, commit/push, or production redeployment was necessary. Added files are audit tooling/tests and documentation only.

Source accounting: the three repositories were inventoried; overall source review is PARTIAL, not full-file coverage. VERIFIED inputs for the scoped work are the server architecture/API/README/decisions, service/repository/canonical client, browser harness/fixtures/manifest, and both games' architecture/requirements/README plus the ranking-related decision sections. UI verification is live in both named apps. The 12 public asset byte comparisons verify identity, not complete source review. No other WEB LAB application, provider console or private production DB was inspected.

NOT_RUN: production load/abuse testing, every browser engine/physical device, provider CPU telemetry, expired-ticket/180-day real-time behavior, private DB row inspection and the unresolved local post-413-follow-up transport failure. Successful live legal submissions do not resolve or reproduce that local runtime issue and do not prove human-only play.

## 2026-10-13 — systematic edge-case audit

See [edge-cases-20261013.md](edge-cases-20261013.md) for 27 new Node cases, executed RED/GREEN, actual local SQLite/browser flows and explicit unresolved local 413-follow-up transport behavior. Full source CI, Worker deployment and read-only public verification are distinct evidence; historical results below are not new coverage.

## 2026-10-13 — Maintenance / LOCAL and provider authentication

- Node 20 subtests PASS (including two helper modules); static/source checks PASS. New red-first cases cover authenticated-start/delete interleaving, exact expiry and malformed Parcel rotation coordinates. Legal replay/score versions and persistent schemas are unchanged.
- Actual local workerd/SQLite: legal Parcel 1457 and Neon 4280, query, idempotent retry, invalid/incomplete fields, CORS and authenticated deletion PASS. Synthetic local rows removed. Eight frontend/server rule files and their manifest digests match exactly.
- Authenticated account dashboard: Workers Free / $0 / Current plan verified. Same Wrangler client refreshed with account/user read and Worker script write, without other product write scopes. CLI login completed successfully; Edge remains the user's default browser. No secrets printed or committed, paid changes, new DB or new migrations.
- Public maintenance QA uses health/board reads only; current production submission/deletion is NOT_RUN. Source CI and actual deployed version are separate evidence in [WEB LAB maintenance](https://github.com/HyungminYoon1/web-lab/blob/main/docs/maintenance-20261013.md).

## 2026-10-09 — initial local construction

Initial construction snapshot: implementation alone did not establish a functioning public server. Current concrete evidence follows.

Provider checks: official current Durable Objects pricing states SQLite classes are available on Workers Free and limit exhaustion fails with errors. A live account-plan check is required before provisioning; no paid plan changes or payment setup are approved.

Source scope: main reviewed each game's ranked contract, pure input replay and relevant model/advanced contract. Legacy authored level arrays are inventoried and preserved unchanged, not individually replayed in the browser by the server review. New server layers are separately tested.

## 2026-10-09 — implemented and deployed API

- ACCOUNT_PLAN: live Cloudflare account UI showed Workers Free / $0 / Current plan before provisioning. Paid upgrade, billing changes and card setup were not performed. No Neon or D1 resource was created.
- LOCAL_TEST: PASS, Node reports 17 subtests (including two helper modules); 12 domain/repository/service/controller tests and three client tests. SQLite is actual Node in-memory SQLite, not a production database test. Approved rules, legal outcomes, ties, malformed/illegal/incomplete/trailing commands, wrong credentials/tickets/versions, delete isolation, retention, logical expired-row exclusion and daily caps are covered. Source checks verify syntax/UTF-8/CRLF, frozen rule hashes and approved resources.
- LOCAL_WORKERD_HTTP_SQLITE: PASS, real legal Parcel 1457 and Neon 4280 submissions, SQLite persistence, retry, board projection, authenticated deletion, invalid score fields/incomplete action lists and CORS rejection. Synthetic QA identities and scores were removed.
- LOCAL_BROWSER_AND_LOCAL_API: actual legal keyboard/palette commands won both fixed challenges. Explicit SDK start, submission, real SQLite board and authenticated deletion worked. At 320px a result panel initially blocked controls; a separate result-close button was implemented in both apps. Closing preserves the completed replay and permits actual 1457/4280 registration at 320px. Test identities and records removed; both local boards verified empty. Confirmation automation initially had duplicate old listeners; they were removed and deletion was rerun successfully. That harness issue is not labelled an application failure.
- LIVE_WORKER: deployed https://web-lab-ranking.hyeongmin92.workers.dev, version 00ac79bf-db5f-42d8-bdf1-800beca12b0c. Workers Free and SQLite Durable Object only. Observability payload logging disabled; no provider credentials in source or Pages.
- LIVE_HTTP_SQLITE: PASS after logical-expiry change. Verified Parcel 1457 and Neon 4280, persistent board, idempotent retry, invalid client score/incomplete actions, rejected outside origin and authenticated deletion of the QA identity. Final public boards had no QA records. Full submission/query/retry HTTP round trips approximately 421/426ms; these are not Worker CPU measurements.
- REMOTE_SOURCE_CI: PASS for implementation commit 775a933a50263e2f8efbf1e6cec2ae6d87426ba0, [check run 37902068531](https://github.com/HyungminYoon1/web-lab-ranking/actions/runs/37902068531). API deployment is independent of GitHub CI; the actual deployed version is recorded above. Source and all 16 Pages publication evidence are recorded in [WEB LAB verification](https://github.com/HyungminYoon1/web-lab/blob/main/docs/verification.md).
- LIVE_BROWSER_AND_LIVE_SQLITE_API: PASS from the published GitHub Pages clients. Normal palette/rotation/keyboard/confirmed commands completed Parcel final contract14 (1457) and Neon final mission16 (4280). Explicit start, submission, live board and authenticated deletion worked for both; completed replays survived closing the result panel at 320px. 390/320px overflow and observed errors were zero. Ten API requests all used the exact approved Worker origin. QA identities/records were removed and both public boards verified empty. A first harness assertion ran before the asynchronous board response; its QA identity was deleted, the harness awaited the board and the full two-game flow passed on rerun. No deployed app changes were needed for that harness fix; no credentials or request payloads were logged.
- NOT_RUN: physical devices, all browser engines, independent human difficulty/fun assessment, human-only/Sybil protection, production abuse/load test, provider CPU telemetry and six-month real-time retention. Replay verification does not prove the player is human or prevent shared solutions. Free-tier limits fail closed; app quotas are not an account-wide billing control.
