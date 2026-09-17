# YR-002 local reward fixtures

This directory provides a deterministic, disposable **local** database fixture
for reward-catalog and claim-state work. It is not a Supabase seed, staging
fixture, or deployment tool.

## Safety boundary

`run.sh` has no database URL parameter. It only invokes this directory's Docker
Compose project (`yr002-fixtures`), which has all of the following fixed:

- a loopback-only PostgreSQL port (`127.0.0.1:55432`);
- the disposable database name `yourrank_yr002_fixtures`;
- a dedicated Compose volume (`yr002_postgres`); and
- a read-only bind mount of the checked-out repository solely to apply its SQL.

Before any Compose command, the runner rejects a non-local `DOCKER_HOST` or
Docker context. `seed.sql` independently rejects every database name other than
`yourrank_yr002_fixtures`. Do not bypass the runner or alter these guards.

`reset` removes only this fixture Compose project's volume. It does not use the
root `docker-compose.yml` (`yourrank` on port 5432), Supabase CLI, or any
external/staging/production database. It sends no notifications, creates no
provider account, and makes no real purchase or claim.

## Requirements

- Docker Engine with Docker Compose v2, using a local Unix-socket or named-pipe
  context.
- A checkout at a schema revision compatible with this fixture.

Run commands from the repository root:

```sh
# Creates a fresh isolated database, applies migrations in lexical order,
# seeds YR-002, then runs read-only assertions.
sh supabase/fixtures/yr-002/run.sh reset

# Proves the fixed-ID seed can be applied again without duplicate rows, then
# rechecks it. Neither command resets normal local development data.
sh supabase/fixtures/yr-002/run.sh seed
sh supabase/fixtures/yr-002/run.sh smoke

# Optional cleanup of only the isolated fixture database and its volume.
sh supabase/fixtures/yr-002/run.sh down
```

The smoke command executes `BEGIN READ ONLY` and rolls back after assertions.
It checks the database name, community and catalog cardinalities, missing media,
long reward name, stock states, member balances, sufficient/insufficient costs,
the global signed-in non-member, and the three distinct claim states.

## Fixture inventory

All identifiers are fixed and namespaced `yr002` so the `seed` command can
remove and recreate only its own rows.

| Item | Fixture state |
| --- | --- |
| Creator | `yr002-creator@local.test`, verified synthetic local account |
| Populated community | `yr002-rewards`, public non-draft catalog with four active rewards |
| Empty community | `yr002-empty`, public non-draft catalog with no rewards |
| Members | positive balance (375) and zero balance (0) in populated community; positive balance (50) in empty community |
| Signed-in non-member | global local viewer session with no `site_viewers` membership |
| Rewards | finite available (stock 4), long-name finite available (stock 1), unlimited available (stock `NULL`, cost 500), exhausted (stock 0) |
| Media | every reward has `image_key = NULL` |
| Claims | one `pending`, one `fulfilled`, and one `cancelled`, with matching fixture ledger/audit state |

The populated positive member can afford the 25- and 100-credit rewards but not
the 500-credit reward. The zero member cannot afford any positive-cost reward.
The session's documented raw local marker is
`yr002-local-nonmember-session`; it is a deliberately known fixture value
whose SHA-256 digest is stored in the disposable database. It is not a provider
credential, production secret, or account usable outside this fixture database.

## Explicit non-fixture blockers

No dedicated provider accounts or isolated message sink were available for this
work. Accordingly, these fixtures do **not** simulate, configure, or verify
Kick/Discord OAuth, provider identity linking, outbound webhook/email/bot
notifications, provider purchases, or a real claim fulfillment. The viewer
usernames are display-only synthetic labels and no provider ID, token, or linked
timestamp is stored. Integration coverage for those systems remains blocked
until dedicated non-production accounts and a message sink are supplied.
