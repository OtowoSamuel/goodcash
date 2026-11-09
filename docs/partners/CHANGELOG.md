# Partner API changelog

The API is versioned in the path (`/v1`). Within `v1` we only add things (new fields, endpoints, event types,
error codes); we never remove or rename them. Ignore fields you don't know. Breaking changes get a new version.

## v1 (unreleased)

- Endpoints: `partner`, `limits`, `banks`, `banks/verify`, `quote`, `network-fee`, `cashouts` (create, list, get,
  report transaction), `test/cashouts/{id}/simulate`, `webhooks` (get, set, test).
- Events: `cashout.paid`, `cashout.failed`, `cashout.refunded`, `cashout.expired`, `cashout.delayed`, `cashout.test`.
- Packages: `@goodcash/sdk` 0.1.0, `@goodcash/react` 0.1.0, `widget.js` 0.1.0.
