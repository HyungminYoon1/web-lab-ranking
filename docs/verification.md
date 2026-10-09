# Verification

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
- REMOTE_SOURCE_CI: pending publication; API deployment is independent of GitHub CI. Final remote evidence is linked from WEB LAB's verification record after publication.
- NOT_RUN: physical devices, all browser engines, independent human difficulty/fun assessment, human-only/Sybil protection, production abuse/load test, provider CPU telemetry and six-month real-time retention. Replay verification does not prove the player is human or prevent shared solutions. Free-tier limits fail closed; app quotas are not an account-wide billing control.
