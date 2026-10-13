# Ranking edge-case audit — 2026-10-13

New audit after maintenance baseline `1368539`. Existing schema, two boards, scores/versions, quotas, retention, single Worker/SQLite Durable Object and Workers Free remain unchanged. Production QA is read-only. Final commit/CI/Worker version/live reads are recorded separately in [WEB LAB](https://github.com/HyungminYoon1/web-lab/blob/main/docs/edge-cases-20261013.md).

## New tests and observed RED/GREEN

`test/edge-cases.test.js` adds 16 tests; `test/client-edges.test.js` adds 11. Existing 20 Node subtests include two fixture/helper modules; expected full total 47, not 47 independent end-to-end flows. Ordinary `npm test` discovers additions in CI.

Actual failures executed before their implementation changes:

1. Authentication delay advanced time across ticket expiry, but submit used time captured before awaiting authentication: missing rejection. A newly issued ticket also lost the authentication delay from its four-hour lifetime. Read the clock after authentication. Same tests PASS.
2. Array/object-coercible game IDs were accepted: missing exception. Require a string before allowlist lookup. Same test PASS.
3. Header-rejected streams were not canceled: expected true / actual false. Release unread bodies on MIME/declared-byte rejection, without reading unbounded data. Same Node test PASS. This does **not** establish a fix for the separate local proxy issue below.
4. Client first batch: silent identity writes were claimed durable; storage.clear did not invalidate the ticket; late start after another-tab deletion reset the game; late deletion removed a newer identity; malformed board erased the prior valid table. 5 FAIL / 3 PASS before changes, 8 PASS after epoch checks, verified storage and atomic table construction.
5. Additional response tests: malformed ticket IDs reset the game (`1 !== 0`); `{deleted:false}` erased the credential. Both executed FAIL, then PASS with strict ticket shape / explicit deletion acknowledgment. A controlled 12-second AbortController timeout passed unchanged and is coverage, not a defect fix.

Deterministic delayed authentication, synthetic storage/DOM/network and controlled timers are labelled fixtures. They exercise actual callbacks but do not prove production network or hardware behavior. No actual credential values are logged.

## Matrix

| Boundary | Executable evidence | Result / qualification |
| --- | --- | --- |
| JSON transport | controller route tests: 49152/49153 bytes, multi-byte UTF-8, chunked stream, invalid UTF-8, absent body, wrong MIME/root/extra fields | PASS Node; declared/chunked rejections release unread input |
| Identity/authentication | hashed bearer, foreign/missing/expired credential, player/game/ticket binding, deletion while awaiting authentication | PASS actual Node in-memory SQLite; delay injected |
| Replay fairness | both legal witnesses 1457/4280, malformed/nonfinite/trailing/assisted/incomplete commands, forbidden client score | PASS; frozen rules preserved, not human-only/Sybil protection |
| Idempotency | eight concurrent same-ticket submits, changed retry payload, one best record and original response | PASS SQLite; local HTTP also three concurrent submissions per game |
| Time | exact expiry, delay crossing expiry, new ticket lifetime, cache29999/30000ms, retention180days/exact+1ms | PASS controlled clock; real four-hour/180-day waiting NOT_RUN |
| Capacity | last daily request/identity then reject and UTC reset, 2000 identities, 1000 tickets, 4000 bests, existing retry at full capacity | PASS SQL fixtures; no eviction, rejected ticket remains unconsumed |
| Results/cleanup | top50, ties1/1/3, wrong versions, public-field projection, bounded25 identity/100 ticket cleanup, authenticated own-only delete | PASS SQLite; synthetic rows only |
| Client lifecycle | storage denial/readback, clear/null event, late start/delete, malformed board/response, double click, cancel, timeout, retry and private-play continuity | 11 new Node tests PASS; DOM/storage/fetch doubles explicitly used |
| Browser with actual API | actual UI legal commands complete Neon16/4280 and Parcel14/1457, submit/query through local workerd, terminal submit lock, shared-identity deletion | 16 checks PASS; actual isolated Chrome → exact-origin interception → local API/SQLite, productionWrites0 |
| Browser failure UX | canceled opt-in has no call, disconnected API, malformed board retains previous result, 429 explanation/retry, private controls continue | 6 checks per game PASS response fixtures, not an actual provider outage |
| Layout | ranking panel1440/390/320, no horizontal overflow; inspected320 captures | PASS Chrome emulation, not all devices/engines |

`tools/verify-local-edges.mjs` performs 32 assertions against loopback only and cleans synthetic identities in finally. `tools/browser-edges.mjs` is driven by sibling WEB LAB `tools/verify-browser-edges.mjs`. Both preserve public data; optional browser/local Worker harnesses are not ordinary CI. Server/client source and all frozen manifest bytes are checked separately by `npm run check` and integration equality.

## Local runtime issue — not hidden by retries

The complete 32-check HTTP run passed, but repeated runs intermittently returned non-JSON `500 Network connection lost` for the next small request after a 413. Wrangler logged an unread request-stream error. It occurred before and after explicit header cancellation; the failed run is not relabelled PASS. Normal real-browser play/register/delete passed without retry. Request parsing of an empty403 preflight was also corrected in the *harness*, not counted as a product defect.

A [Cloudflare SDK report](https://github.com/cloudflare/workers-sdk/issues/15709) describes a similar local oversized-body cancellation/follow-up failure. That is a lead, not proof of this instance's internal cause or production impact. Preserve the 48KiB cap and fail-closed behavior; do not drain an unbounded hostile stream or weaken limits just to make development QA green. This local transport edge remains **PARTIAL / unresolved**, and production reproduction is **NOT_RUN**. Client timeout/network handling is verified and leaves private play usable. No automatic public write/retry test was added.

## Source, deployment and remaining limits

- VERIFIED: architecture.md, api-spec.md, README.md, decisions, all four authored layers/worker/client, repository SQL, baseline/new tests/SQLite adapter/fixtures, config/workflow/check scripts. requirements.md absent.
- PARTIAL: frozen game sources reviewed for contract/hash agreement and replayed, not exhaustive campaign/manual rule review; dependencies/provider internals and historical documents are not a full security audit.
- Account UI again showed **Free / $0 / Current plan** before release; no billing/permission/resource/schema change. No Neon/D1 and no secrets in GitHub.
- NOT_RUN: production POST/DELETE, production abuse/load/CPU telemetry, physical browsers/devices, every race schedule, cross-origin security audit, real long-term expiry, physical durability/backup-restore disaster recovery, human-only fairness and exhaustive score optimality. Node SQL fixtures are not a production database test.
- Boundary: local transport's intermittent 413-follow-up issue above remains open. Successful ordinary HTTP/browser paths do not prove all transport edges healthy. Central release evidence must preserve that qualification.
