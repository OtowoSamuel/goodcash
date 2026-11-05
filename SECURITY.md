# Security policy

GoodCash is a non-custodial Celo wallet flow. This repository is pre-production and still requires a final router and deployment review before any real funds are moved.

## Reporting a security issue

Please report suspected vulnerabilities privately to:

- security@goodcash.app

Include as much detail as possible:

- affected component or file;
- steps to reproduce;
- security impact and severity;
- the exact transaction, wallet, or route path involved;
- any proof-of-concept reproduction.

Please do not disclose a vulnerability publicly until it has been triaged and a fix is in place or the risk has been responsibly mitigated.

## Current review status

The repo currently contains a placeholder Solidity contract and a quote-and-route engine in the web app. The quote logic is intentionally conservative and rejects stale, thin, high-impact, and paused routes. Before any contract deployment, the final router implementation must pass a fresh Slither and Foundry review, preserve the invariants in the project documentation, and maintain the emergency-rescue controls documented in `docs/SECURITY.md`.
