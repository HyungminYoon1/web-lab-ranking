# Decisions

## D12 — Complete bounded local input before crossing the Durable Object boundary (2026-10-14)

Context: D11 fixed the supported local 413 transport path but reported one remaining native unread-stream error. Per-request diagnosis reproduced it on a body-bearing 404 and on 415 for 10 and 49,152 bytes; each response and immediate normal POST still succeeded. A local reduction, with no ranking logic or DB queries, emitted the error only when a Durable Object returned a nonempty rejection without consuming its input (explicit cancel did not help). Direct Worker rejection, full consumption and outer buffering produced no such message. This is a real native stream-lifetime diagnostic, not evidence of a failed score calculation or corrupted data. It should not be hidden by a console filter.
Options: leave the noisy exception; suppress messages; consume arbitrary input after responding; alter production routing/validation; finish only bounded input in the local entry before handing a detached copy to the unchanged application.
Decision: retain D11's Node gate, 49,152-byte cap, deadlines, no-retry policy and pinned runtime. Add tools/local-worker-entry.mjs, selected only by startLocalDev, and a bounded byte-only helper. The helper independently enforces advertised/actual size, reads accepted native input to EOF, releases its reader, and forwards an in-memory Request with the same method/URL/headers/raw bytes. It does not parse JSON or decide authentication, status validation, score or storage. Declared/streamed overflow is cancelled and rejected; broken input fails closed. The supported gate still rejects oversize before forwarding. wrangler.jsonc continues to deploy src/worker.js; no src/client/game/schema/quota/retention/production change or deployment is made.
Rationale: remove the demonstrated cross-boundary lifetime condition instead of hiding the symptom or weakening rejection. Local accepted bodies are small and already complete at the Node gate. This adds bounded copying in development, not unlimited draining or an application architecture change. The original app/controller cancellation behavior is preserved for production and unit coverage.
Affected: local entry/helper/dev runner; per-request and minimal diagnostic tools/fixtures; reader/byte/limit/deployment-boundary tests; stream/transport test commands, CI, README and verification. Existing uncommitted audit/transport changes are preserved.
Review: execute the real failing zero-diagnostic regression before the handoff fix, rerun unchanged cases and a repeated rejection matrix, count native diagnostics rather than suppressing them, check exact bounds and actual local SQLite cleanup, and rerun legal two-game flows. Do not describe the vendor runtime or direct raw Wrangler path as fixed. Windows-only observations do not establish production impact, arbitrary timing safety or absence of all possible resource leaks. Remove the development wrapper only after the raw runtime passes equivalent tests.

## D11 — Bounded local entry and graceful rejection, not retries (2026-10-14)

Context: real HTTP first failed 10 of 20 immediate 2-byte follow-ups after a 60,012-byte body received 413. Fresh connections and a no-database Worker also failed. Wrangler 4.151.0/workerd 1.20261012.1 did not fix it. Changing only workerd to 1.20261014.1 passed the original-size trials, but a broader 1 MiB test still failed. Therefore a native upgrade alone is not a complete fix. A first Node gate using response.end() also failed with an unread large upload; half-close regression and decoded-response regression were added before correcting those cases.
Options: weaken the cap; consume arbitrary rejected bodies; automatically retry writes; change production routing/storage; wait for a vendor fix; use a bounded local-only transport entry with explicit connection teardown.
Decision: preserve MAX_BODY=49,152 and every src/client/game/API/schema/retention setting. npm run dev now starts a loopback-only Node transport gate before the actual local Wrangler/SQLite Worker. It buffers at most MAX_BODY per request, rejects declared or observed overflow before upstream forwarding, never parses JSON or owns score/auth/storage logic, and forwards each accepted request once. A rejected upload receives a length-framed 413, then a TCP write-side half-close with a one-second final-close bound; no unbounded drain or blind write retry. Partial uploads have a ten-second read deadline and the local listener permits at most 64 simultaneous connections. These are local resource bounds, not new production policies. Retain Wrangler 4.149.0 and pin the tested workerd 1.20261014.1; native-version and CI tests prevent silent toolchain drift. Local-origin permission is explicit --allow-local and mirrors the Worker's existing rule, never wildcard.
Rationale: a bounded transport adapter avoids the failing early-cancellation path without modifying production business layers. Ordinary response.end() can reset an unread upload before the client receives its response; a complete Content-Length response followed by half-close makes rejection observable. The gate strips Fetch's stale compressed-body headers, since its response stream is already decoded. This is a project-local mitigation, not a claim that upstream Wrangler/workerd is fixed.
Affected: package.json/package-lock.json, test/runtime-pin.test.js, test/local-body-gate.test.js, tools/local-body-gate.mjs, tools/local-dev.mjs, tools/verify-local-transport.mjs, tools/run-local-transport.mjs, CI and development/verification docs. Previously added live-ranking audit files are preserved. No production deployment, new service, DB, billing or user-record write.
Review: preserve raw RED reports and test the supported entry against fresh local DBs, exact limits, chunked/slow/interrupted uploads, delayed response reads, existing SQLite/rules/client suites and legal score flows. Windows/Linux CI is configured; actual local and remote results are distinct. Direct npx wrangler dev bypasses the fix and remains a vendor reproduction path. Remove the gate/override only after the raw path passes the same broad tests; the occasional native unread-stream diagnostic in non-413 cases is recorded, not hidden.

## D10 — User-approved isolated production lifecycle audit (2026-10-14)

Context: user explicitly requests both public games' real score registration, observation from another browser, and deletion of test records only. The previous release audit deliberately performed no production writes.
Options: reuse a personal browser identity; post direct replay fixtures without playing; create separate fresh test-only browser contexts and use actual controls.
Decision: use fresh Chrome contexts, one new labelled anonymous identity per game, and separate read-only Edge contexts. Register actual UI-generated completions with unchanged rules. Check both records before deleting the first; ensure the other test identity survives; then delete the second. Reject any write not owned by an identity returned during this run. Never use administrative database deletion, existing user credentials, HAR, traces, or request-body logs. Keep credentials only in memory and isolated browser storage; clean up only these identities even if verification fails.
Rationale: establish live persistence and cross-browser visibility while preserving existing users and testing each app's delete UI independently. Baseline/final public-board comparisons supplement the ownership guards; they do not constitute a private-database inspection or a load/security audit.
Affected: tools/live-ranking-audit.mjs and local generated evidence; production app/server code, policies, schema, quotas, versions, and billing are unchanged unless a separately documented failing regression requires a fix.
Review: manual explicit allowProductionWrites only, never automatic CI. Check incomplete submission, invalid nickname, cancellation, repeated-submit disabled state, Chrome/Edge evidence, and cleanup. A defect must get a failing regression before implementation changes. Preserve the unresolved local post-413 issue as a separate limitation.

## D09 — Delayed authority, response validation and bounded rejection (2026-10-13)

Context: systematic red-first tests reproduced stale timestamps after asynchronous authentication, coerced game IDs, unconfirmed identity writes/deletion responses and cross-tab late client callbacks.
Options: change schemas/ranking versions, serialize every frontend operation across tabs, or preserve contracts and validate current authority/acknowledgments at each boundary.
Decision: read ticket time after authentication; accept only string allowlisted game IDs. Cancel unread header-rejected bodies while retaining the byte cap. Client uses an identity generation counter, conditional old-identity removal, write readback, UUID ticket shape and explicit deleted:true. A malformed board is built/validated before replacing the last good display. Copy the same client into only Neon/Parcel.
Rationale: explicit deletion/new identity cannot be undone by late responses, and server failure must not erase private play or claim success. No rules, schema, retention, resource, billing or access-control expansion. A related local development proxy failure is recorded, not concealed by unsafe unlimited draining or blanket retries.
Affected: service/domain/controller, canonical client and two copies, edge tests/browser harnesses, verification.
Review: failed-before/same-after cases; all tests/checks; real local legal UI+SQLite flows; current Free plan; public health/board GET only. The 413-follow-up local runtime edge remains unresolved with production reproduction NOT_RUN; do not imply an upstream root cause is proven.

## D07 — Match strict rotation input validation (2026-10-13)

Context: the Parcel maintenance regression found string/array/boolean coordinates were coerced into grid keys. The frontend now requires integer coordinates; the server must keep the same replay boundary.
Options: keep divergent validators; change game/score rules and invalidate existing boards; synchronize the one-line strict input check only.
Decision: copy the integer guard into the frozen server replay and update its manifest digest. Authored boards, legal inputs, scores, tie-breaks and rules versions are unchanged. Existing valid results remain compatible; malformed inputs are rejected.
Rationale: input validation should agree on both sides without resetting legitimate competition records. No schema, retention or quota changes.
Affected: src/games/parcel-panic/replay.js, manifest.json, test/ranking.test.js.
Review: red-first malformed-coordinate test, legal 1457/4280 witness replay, byte-identical frontend/server snapshots and local workerd smoke.

## D08 — Existing deployment authentication and public commit identity (2026-10-13)

Context: the existing Wrangler credential expired; the API repository did not have a scoped GitHub noreply commit identity.
Options: publish personal commit contact information or add GitHub deployment credentials; keep manual deployment and use the already verified public noreply identity.
Decision: use the sibling app's existing verified GitHub noreply identity for this repository only. Refresh the same Wrangler app with account/user read and Worker script write permissions, without KV, D1, Pages or other product write scopes. No credential values enter source, logs shown to the user or GitHub.
Rationale: preserve the manual deployment boundary and minimize disclosed identity and provider permissions. The live dashboard showed Free / $0 / Current plan before deployment.
Affected: repository-local Git configuration and local Wrangler authentication only; no account plan/billing/security setting changes.
Review: verify origin and staged source, retain separate source CI and actual Worker version evidence. Authentication requiring human input is handed off.

## D06 — Delete/start race and exact ticket expiry (2026-10-13)

Context: the approved maintenance review reproduced a start request that finished authentication, waited while another request deleted the identity, then inserted an orphan ticket. A ticket was also accepted exactly at its advertised expiry instant.
Options: introduce new identity/state schemas; serialize all asynchronous request handling; recheck identity existence within ticket insertion and enforce the expiry boundary.
Decision: require the player row inside the existing ticket transaction, returning the existing unauthorized error after deletion. Reject submission at expires_at <= now. Existing request/run quotas, schema, retention duration, authentication model, frozen games and client contracts stay unchanged.
Rationale: explicit deletion cannot be followed by ticket creation from already completed authentication; declared expiry is unambiguous. This is an in-scope lifecycle correction, not a new storage policy or ranked game version.
Affected: src/repository.js, src/service.js, regression tests and verification record.
Review: red-first deterministic authentication pause/delete/start interleaving with actual in-memory SQLite; no player/ticket/best after completion; exact expiry rejected without a saved best; complete server/client tests and local workerd. Publish through the existing Workers Free resource only after current plan verification.

## D01 — Fixed hardest challenges only

Context: user narrowed public rankings to extremely difficult games with equal opportunities.
Options: every app; wall-clock/random bests; two fixed hardest challenges.
Decision: Parcel 14 and Neon 16 use independent versioned boards, identical starting resources and server replay. Hints/references are excluded, undo/redo permissions are identical for everyone, and no real-time speed affects score. No public ranking for hearing/reaction/random simulations or learning XP.
Rationale: legal results can be reproduced across devices. Fixed-challenge replay does not establish human difficulty or prevent solution sharing/automation.
Affected: src/domain.js, src/games/, client/, the two target app integrations.
Review: preserve original practice campaigns, compare server/frontend hashes, test invalid/extra/trailing commands and live successful replay.

## D02 — Free Worker with native SQLite Durable Object

Context: server+DB must remain free; existing Worker authentication is available, additional Neon/D1 authentication is not required by the data model.
Options: Worker+Neon (separate credentials/cold I/O); Worker+D1 (additional permission); Worker+native SQLite object.
Decision: a SQLite-backed Durable Object provides serialized service execution, transactions and game replay outside the entry Worker's short CPU budget. Only provision after Workers Free is confirmed. No paid upgrade, external DB credentials or billing changes.
Rationale: minimal managed resources and atomic single-use tickets/best writes. SQLite storage and requests are included in Free; exhaustion fails closed.
Affected: wrangler.jsonc, src/worker.js, service/repository.
Review: local workerd and live runtime, account plan verification, warm/cold replay timing, quota failure. Official references: https://developers.cloudflare.com/durable-objects/platform/pricing/ and https://developers.cloudflare.com/durable-objects/platform/limits/.

## D03 — Optional anonymous records and bounded retention

Context: public scores need independent storage, without collecting personal identity.
Options: accounts/email; trusted browser score; anonymous random credential and legal action replay.
Decision: explicit opt-in challenge, optional public nickname, random browser identity+hashed bearer credential, single-use expiring tickets. Winning best action logs are private; public results only. Six-month inactive expiry and explicit delete. Bounded identity/ticket/row/daily limits; full caps reject new writes.
Rationale: no passwords or personal profile; replay permits later audit. This is anonymous-browser bests, not verified distinct-human count.
Affected: domain/service/repository/client/tests.
Review: corrupt/denied storage, copy/plain text rendering, replayed ticket idempotency, delete permissions, expiry, concurrent writes and capped tables. Database deletion does not remove provider-owned transport logs or retention backups.

## D04 — Logical expiry independent of bounded cleanup

Context: many records may expire between requests; deleting at most 25 identities per cleanup must not keep them public until all batches finish.
Options: unlimited deletion in a request; bounded physical cleanup only; bounded cleanup plus query-time expiry.
Decision: public board queries join the identity and exclude last activity older than 180 days. Physical cleanup remains bounded and request-triggered. A previously fetched board cache lasts at most 30 seconds. Expired identities cannot authenticate. No background cron or paid service is added.
Rationale: predictable work per request and visibility independent of cleanup backlog; physical removal is opportunistic and must not be described as a scheduled deletion guarantee.
Affected: src/repository.js, src/service.js, test/ranking.test.js, README.
Review: expired-but-not-yet-deleted rows are absent from direct board queries; verify deployed runtime again after this change.

## D05 — Public source CI without deployment credentials

Context: the separate API needs a reproducible source history and CI, without granting GitHub provider access.
Options: GitHub-triggered provider deploy with a new secret; manual authenticated deployment with read-only source CI.
Decision: publish source with pinned checkout/setup-node, Node 22, npm ci --ignore-scripts, model/client tests and source checks. Worker deployment remains explicit with existing local Wrangler authentication. No provider token or account credential goes into GitHub.
Rationale: least access and separation of CI from public API deployment.
Affected: .github/workflows/check.yml, package-lock.json, repository setup.
Review: inspect git remote before push, check remote CI and the separate live Worker version.
