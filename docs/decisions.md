# Decisions

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
