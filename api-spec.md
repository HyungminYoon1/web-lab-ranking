# Ranking API v1

JSON only, UTF-8, body at most 49,152 bytes. Published CORS origin: https://hyungminyoon1.github.io. Development loopback origins are enabled only by ALLOW_LOCAL=true, never in production. Errors expose only a short code, not payloads/credentials/SQL.

- GET /health → status/apiVersion/two fixed game definitions.
- GET /v1/boards/:game → definition/entries (top 50)/retentionDays. Public fields: rank/nickname/score/tieBreak/achievedAt. Equal score+tie-break receives an equal competitive rank; timestamp is display/order only, not a speed reward.
- POST /v1/identities, {} → random playerId/token/retentionDays. Credential is returned once and stored only in browser device storage or memory. Server stores digest only.
- POST /v1/runs, Bearer credential, {playerId,game,rulesVersion,challengeId} → runId/definition/expiresAt. Ticket single use, 4 hours; no clock-derived score.
- POST /v1/scores, Bearer credential, {playerId,runId,game,rulesVersion,challengeId,nickname,actions} → accepted/improved/server score/tieBreak/summary. No client score, state, hint, elapsed-time or layout envelope fields. Legal incomplete/invalid input rejected. Successful identical ticket retries return original result.
- DELETE /v1/identity, Bearer credential, {playerId} → deleted:true. Deletes both games' records, own tickets and identity, not any other player's data.

400 malformed/schema, 401 invalid/expired identity, 403 disallowed/missing browser origin, 404 unknown, 409 wrong rules/ticket, 410 expired ticket, 413 body limit, 415 not JSON, 422 illegal/incomplete replay, 429 daily cap, 503 paused/provider/storage/rule fault. No implementation detail in errors.

Versions are authoritative in game snapshot manifest. Scores sorted descending; tie-break values ascending. Real elapsed time, device speed, submission arrival time and random seeds never change score or tie-break. Public nickname accepts up to 16 NFC letters/numbers/spaces/_/-, never markup.
