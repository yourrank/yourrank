# YourRank — Superseded product-positioning decision

**Original decision date:** 2026-08-09

**Superseded:** 2026-08-28

**Status:** Historical record only — not approved for implementation

**Current authority:** [`YOURRANK_PRODUCT_ARCHITECTURE.md`](YOURRANK_PRODUCT_ARCHITECTURE.md)

## Historical decision

This document previously approved positioning YourRank as a suite of three independent peer products: Leaderboards/Sites, Telegram, and Credits & Shop. It also required separate per-product analytics and explicitly rejected a global Insights destination.

That framing is superseded. It remains recorded here only to explain older repository language and existing navigation/runtime structures. It must not be used as target product truth.

## Current target positioning

> **YourRank is the community operating system for streamers.**

The target creator workspace is organized around:

**Home → Community → Activities → People → Rewards → Insights → Settings**

The target model reorganizes the product around a creator community operating loop while preserving current technical truth until migration waves deliberately change it. In particular:

- `Community` is a product/navigation grouping around the selected site, not automatically a new database entity.
- Current route semantics and account/site scopes remain authoritative.
- Telegram connection administration and Telegram operational workflows remain different concerns; current operations stay functional until a safe generic communication surface exists.
- Insights begins selected-site scoped and must not claim unsupported global aggregation.
- Product-label changes do not automatically require URL, schema, API, or persisted-domain changes.

The complete owner-approved decisions, migration sequence, deferred gates, and restricted legacy boundary live only in [`YOURRANK_PRODUCT_ARCHITECTURE.md`](YOURRANK_PRODUCT_ARCHITECTURE.md).
