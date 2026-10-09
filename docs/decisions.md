# Decisions

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
