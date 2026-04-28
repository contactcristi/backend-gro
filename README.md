# GRO Backend

Node.js/Express API for the GRO mobile app. PostgreSQL is the system of record; the mobile app talks to this API over HTTPS and never connects to the database directly.

## Implemented Scope

- Phase 0: user registration, login, JWT auth, profile bootstrap, default settings, refresh token storage, audit log.
- Phase 1: profile updates, settings updates, notification inbox read APIs.
- Phase 2: tenancy upsert/read, generated rent payment schedule, manual rent reports.

## Stack

- Node.js 20
- Express
- PostgreSQL 16
- `pg` for database access
- `bcrypt` for password hashing
- `jsonwebtoken` for access tokens
- Docker Compose with API, PostgreSQL, and Nginx Proxy Manager

## Repository Layout

- `index.js`: production entrypoint.
- `src/app.js`: Express app, route handlers, validation, auth middleware.
- `src/postgresAccountStore.js`: PostgreSQL data access and rent schedule generation.
- `db/migrate.js`: forward SQL migration runner.
- `migrations/`: SQL migrations in execution order.
- `test/`: Node test runner HTTP and migration tests.
- `docs/api_spec.md`: human-readable mobile integration contract.
- `docs/RUNBOOK.md`: operations and troubleshooting guide.
- `openapi/openapi.yaml`: machine-readable API contract for client generation.

## Local Setup

Create environment variables:

```bash
cp .env.example .env
```

For shell-driven Docker commands, export `JWT_SECRET`:

```bash
export JWT_SECRET="replace-with-a-long-random-local-secret"
docker compose up --build -d
```

The API starts on port `3000` inside the Compose network. Nginx Proxy Manager publishes ports `80`, `443`, and `81`.

## Database Migrations

The API container runs migrations on startup:

```bash
npm run migrate
```

Current migration order:

1. `migrations/001_phase0_phase1.sql`
2. `migrations/002_phase2_rent.sql`

Migrations are written to be idempotent with `IF NOT EXISTS` where practical.

## Tests

Run all tests:

```bash
node --test test/*.test.js
```

Run syntax checks:

```bash
node --check index.js
node --check src/app.js
node --check src/postgresAccountStore.js
node --check db/migrate.js
```

Validate Docker config and build:

```bash
JWT_SECRET=test-secret docker compose config --quiet
docker build -t groadmin-api:test .
```

## Smoke Test

After `docker compose up --build -d`, verify:

```bash
curl http://localhost:3000/healthz
```

Then follow the register/login examples in `docs/api_spec.md` or use `openapi/openapi.yaml` for generated clients.

## Mobile App Integration

Set this in the mobile app environment:

```bash
EXPO_PUBLIC_API_BASE_URL=https://api.groadminapp.com
```

Use `expo-secure-store` or equivalent secure storage for `access_token` and `refresh_token`. Send the access token on authenticated calls:

```http
Authorization: Bearer <access_token>
```

The current API response/request contract is documented in `docs/api_spec.md` and `openapi/openapi.yaml`.
