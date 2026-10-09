# WEB LAB ranking architecture

## Approved scope

2026-10-09: user approved a free public ranking service, then limited it to very difficult, equally reproducible games. Only PARCEL PANIC contract 14 and NEON TACTICS mission 16 qualify as current candidates. Their fixed maps, resource limits, command rules and versions define separate boards. Human difficulty is not established by automated witnesses.

The frontends remain independent GitHub Pages repositories. The gallery has no ranking network calls. This new repository owns one Cloudflare Worker and one SQLite-backed Durable Object namespace, with one named object used by the service. No Neon database, D1, account registration, paid upgrade or payment setup.

## Layers

- src/worker.js: HTTP routing, response/security headers, bounded transport and Durable Object binding only. No rule evaluation or SQL.
- src/controller.js: maps requests to the service; no direct database access or score calculation.
- src/service.js: anonymous identity/run lifecycle, fairness/version checks, score verification, retention and quota decisions.
- src/repository.js: SQLite schema, bound SQL, transactions, indexed ranking and counters. No HTTP/UI logic.
- src/domain.js: pure payload/nickname/ordering/policy validation.
- src/games/: frozen copies of the approved pure game rules, with a source-hash manifest. No UI/storage/network code. The server replays accepted commands from the fixed initial state.
- client/ranking-client.js: optional frontend UI/transport, deliberately copied into only the two target apps. Its requests never block ordinary private play.
- test/: pure rules, SQLite adapter and service/controller tests. Local workerd and LIVE integration are separately recorded.

## Security and data

The Worker allows only the exact published GitHub Pages origin. Explicit local development may allow loopback origins, never wildcard. Origin is a browser control, not authentication. A random opaque credential authenticates each anonymous browser identity; the database stores only a SHA-256 digest. No names/emails/passwords/IPs/user agents/files are stored by this application. Cloudflare's transport/provider logs are separate.

Public fields: optional bounded nickname (default anonymous label), game/version, verified best score and deterministic tie-break values, UTC achievement time. Private: credential digest, bounded run tickets and full winning command log. One best per anonymous identity/game/version; identity is not verified to be one human. Replays can establish legal game results, not human-only play or freedom from automation.

Single-use tickets bind identity/game/version/challenge, expire after four hours, and never contribute to score. Retryable submission is idempotent. Invalid, unfinished, assisted or mismatched input is rejected. Only the server recomputed value is persisted. Commands are limited to 48 KiB and authored per-game action limits.

Retention: tickets expire after four hours; winning records/identities after 180 inactive days. Public queries exclude expired identities independently of cleanup, with existing cached boards valid at most 30 seconds. Physical cleanup is request-triggered, at most 100 tickets and 25 identities per pass, so absence of requests or a backlog can delay removal. Explicit authenticated deletion removes the identity, tickets and scores immediately. Existing verified records are never evicted to make room for new ones. Caps: 2,000 anonymous identities, 4,000 best records, 1,000 active tickets, 1,000 new tickets/day, 500 new identities/day, 10,000 repository-handled requests/day; fail closed at limits. No permanent connections, timers, cron, files, analytics or console payload logging.

Only Workers Free is allowed for live provisioning. Official quota exhaustion stops requests/writes, not paid auto-scaling. Application limits reduce normal consumption but are not an account-wide billing control. A paid account requires a new explicit decision; don't deploy there while claiming zero cost.

UTF-8 without BOM / CRLF. Secrets/auth values never appear in source, environment examples, logs or documentation.
