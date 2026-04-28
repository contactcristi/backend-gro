## Purpose

You are an autonomous engineering agent working in a **fresh workspace** with **no prior knowledge** of the GRO mobile app.

Your task is to implement **Rollout step 1** from `docs/BACKEND_IMPLEMENTATION_PLAN.md`:

- **Phase 0 — Foundations**
- **Phase 1 — Profile + settings + notifications inbox**
- **Phase 2 — Tenancy + rent schedule + basic reporting (manual)**

You must deliver a production-grade baseline that matches the **mobile app’s domain fields and validation expectations** described in:

- `docs/BACKEND_DATA_MODEL_FROM_APP.md` (authoritative field inventory)
- `docs/BACKEND_IMPLEMENTATION_PLAN.md` (phasing + intent)

This document is both:

- A **product/engineering specification**
- An **execution prompt** with acceptance criteria

### Final deliverable requirement (mandatory)

At the end, you must return **complete backend documentation** sufficient for a new engineer to operate and integrate:

- Full **PostgreSQL schema documentation** (tables, columns, enums, constraints, indexes, migrations order)
- Full **HTTP API documentation** (OpenAPI 3.1 YAML recommended)
- **Auth model** documentation (token formats, refresh rotation, revocation rules)
- **Docker deployment documentation** (compose topology, networks, volumes, env vars, healthchecks)
- **Nginx** reverse proxy documentation (TLS termination, upstream routing, security headers, rate limits)
- **Runbooks**: backups/restore, migrations, rotating secrets, troubleshooting
- **Integration notes** for the mobile client (base URL layout, headers, example requests)

If anything is ambiguous, you must **choose sensible defaults**, document them explicitly, and ensure they do not conflict with the mobile UI validations listed below.

---

## Hard constraints

### Stack (must)

- **PostgreSQL** (managed or containerized) as the system of record
- **Node.js** API service (TypeScript strongly preferred)
- **Nginx** as TLS terminator + reverse proxy to Node
- **Docker** on a VPS, services attached to a **custom Docker network**
- All secrets injected via environment variables / Docker secrets (no secrets committed)

### Scope boundaries (must)

Implement **only Phases 0–2**. Do **not** implement:

- Open Banking ingestion (Phase 9)
- KYC vendor integrations (Phase 10)
- Wallet ledger / withdrawals / gift cards purchases (Phase 3+)
- Referrals server-side (Phase 6+)
- Expert bookings persistence beyond what Phases 0–2 require (none)

You may add **small internal hooks** (nullable columns, reserved enums) only if they do not expand scope materially; justify in documentation.

### Mobile alignment constraints (must)

The backend must support the mobile app’s current domain objects:

- `User` fields: `id`, `name`, `email`, `dob`, `nationality`, `kycStatus`
- `AppSettings` fields: push toggles + `emailMonthlyStatement` + `language`
- `NotificationItem` fields: `id`, `title`, `body`, `type`, `icon`, `timestamp`, `read`
- `RentDetails` fields: address, monthly rent, payment day, landlord name, agent name, tenancy end date, optional landlord email/phone
- `RentPayment` schedule fields: `id`, `amount`, `dueDate`, `paidDate`, `status`
- Manual rent report capture fields from UI: amount, payment date, payment method (fixed set), optional reference, optional notes; reports must support verification workflow fields even if reviewer UX is not built yet

---

## Source-of-truth references (read carefully)

### Authentication screens

These impose validation rules you must mirror server-side:

- `app/(auth)/login.tsx`
  - Email must include `@` (client-side check)
  - Password minimum length **4** for enabling login UI path (weak; keep server stronger overall)
- `app/(auth)/register.tsx`
  - Name must be `trim().length >= 2`
  - Email must include `@` and `.`
  - Password strength score must be `>= 2` where score is computed as:
    - `+1` if length `>= 8`
    - `+1` if contains uppercase A–Z
    - `+1` if contains digit
    - `+1` if contains non-alphanumeric
  - Must accept Terms/Privacy (`accept` boolean)

### Profile edit

- `app/profile-edit.tsx`
  - Name: non-empty, trimmed length `>= 2`
  - Email: includes `@` and length `>= 5` (still validate as email server-side)
  - DOB: must match `YYYY-MM-DD`
  - Nationality: chosen from fixed list in UI (server should accept same strings)

### Manual rent reporting

- `app/report-rent-manual.tsx`
  - Amount numeric `> 0` and `<= 50000`
  - Payment date must be `YYYY-MM-DD`, not in the future, and must be a real calendar date
  - Payment method must be one of:
    - `Bank transfer`, `Standing order`, `Direct debit`, `Cash`, `Other`

---

## Recommended API base path

Mobile apps typically configure a public API origin via `EXPO_PUBLIC_API_BASE_URL` (example: `https://api.groadminapp.com`).

To avoid future collisions, implement API routing under:

- `/v1/...` for all endpoints in this delivery

Nginx should route:

- `https://api.groadminapp.com/v1/*` → Node upstream
- `https://api.groadminapp.com/healthz` → Node upstream (or Nginx static health)

---

## Domain model → PostgreSQL (required)

Use PostgreSQL types:

- IDs: `uuid` primary keys (`gen_random_uuid()`), unless you document a strong alternative
- Timestamps: `timestamptz` (`created_at`, `updated_at`)
- Money amounts for GBP: `numeric(12,2)` (avoid floating point)
- Emails: case-insensitive uniqueness via `citext` extension **or** store normalized `email_lower` with a unique index

### Phase 0 tables (minimum)

#### `users`

Stores authentication identity.

Required columns (suggested):

- `id uuid pk`
- `email citext unique not null` (or `text` + unique index on lower(email))
- `password_hash text not null` (unless you implement passwordless-only; password auth is required for Phase 0 register/login)
- `created_at`, `updated_at`
- `last_login_at timestamptz null`

#### `user_profiles`

PII separated from auth table.

Required columns (must match `User`):

- `user_id uuid pk fk -> users.id on delete cascade`
- `full_name text not null`
- `dob date not null` (allow null only if you decide partial onboarding; if nullable, document migration UX impact)
- `nationality text not null`
- `kyc_status text not null` with check constraint in (`pending`, `verified`, `rejected`)

#### Legal acceptance (required)

Persist Terms/Privacy acceptance as described in the phase plan.

Suggested table `user_consents`:

- `user_id uuid fk`
- `terms_version text not null`
- `privacy_version text not null`
- `accepted_at timestamptz not null`
- Unique constraint per `(user_id, terms_version, privacy_version)` or store latest row only + audit

#### `auth_sessions` / refresh tokens

Implement refresh token rotation:

Suggested tables:

- `refresh_tokens`
  - `id uuid pk`
  - `user_id uuid fk`
  - `token_hash text not null` (hash of refresh token)
  - `created_at`, `expires_at`, `revoked_at`
  - `replaced_by_token_id uuid null` (rotation chain)
  - `user_agent text null`, `ip inet null` (optional)

#### `audit_log`

Minimum viable auditing:

- `id uuid pk`
- `actor_user_id uuid null`
- `action text not null` (examples: `user.register`, `user.login`, `profile.update`, `settings.update`, `tenancy.update`, `rent_report.create`)
- `entity_type text not null`
- `entity_id uuid null`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null`

### Phase 1 tables

#### `user_settings`

Must mirror `AppSettings`:

- `user_id uuid pk fk`
- `push_rent_reminders boolean not null default true`
- `push_passport_updates boolean not null default true`
- `push_rewards boolean not null default true`
- `push_promos boolean not null default true`
- `email_monthly_statement boolean not null default false`
- `language text not null` with check constraint in (`en-GB`, `en-US`)

#### `notifications`

Must mirror `NotificationItem`:

- `id uuid pk`
- `user_id uuid fk`
- `title text not null`
- `body text not null`
- `type text not null` with check constraint in (`rent`, `passport`, `rewards`, `promo`, `system`)
- `icon text not null`
- `created_at timestamptz not null`
- `read_at timestamptz null` (derive `read` boolean as `read_at is not null`)

Indexes:

- `(user_id, created_at desc)`
- partial index for unread: `(user_id) where read_at is null`

Optional (only if you implement push infra now; default off-scope):

- `devices`, `push_tokens` tables

### Phase 2 tables

#### `tenancies`

Represents `RentDetails` for the user (assume one active tenancy for MVP unless you document multi-tenancy rules).

Suggested columns:

- `id uuid pk`
- `user_id uuid fk unique` (MVP: one tenancy per user; enforce with unique index on `user_id`)
- `property_address text not null`
- `monthly_rent_gbp numeric(12,2) not null`
- `payment_day smallint not null` check between 1 and 31 (document Feb handling policy)
- `landlord_name text not null`
- `agent_name text not null` (allow empty string vs null—pick one and validate)
- `tenancy_end_date date not null`
- `landlord_email text null`
- `landlord_phone text null`
- `created_at`, `updated_at`

Phone validation: accept international formats as text; document normalization rules (strip spaces).

#### `rent_payments` (explicit schedule rows)

Match `RentPayment`:

- `id uuid pk`
- `user_id uuid fk`
- `tenancy_id uuid fk`
- `amount_gbp numeric(12,2) not null`
- `due_date date not null`
- `paid_date date null`
- `status text not null` check in (`paid`, `due`, `overdue`)
- `created_at timestamptz not null`

Indexes:

- `(user_id, due_date)`
- unique constraint to prevent duplicates: `(tenancy_id, due_date)` if one payment per month is guaranteed

#### `rent_reports`

Manual reporting must store:

- `id uuid pk`
- `user_id uuid fk`
- `tenancy_id uuid fk`
- `amount_gbp numeric(12,2) not null`
- `payment_date date not null`
- `payment_method text not null` with check constraint matching UI set (recommended enum migration)
- `reference text null`
- `notes text null`
- `source text not null` check in (`manual`)  -- only manual in this delivery
- `status text not null` check in (`pending`, `verified`, `rejected`) default `pending`
- `created_at timestamptz not null`
- `verified_at timestamptz null`
- `verified_by text null` (or uuid if admin users exist later)

Duplicate protection:

- Add a unique partial index or deterministic rule consistent with app logic (see `UserContext` duplicate detection concept). Minimum acceptable rule:

Unique index on:

- `(user_id, amount_gbp, payment_date, source, coalesce(reference, ''))`

Document the rule explicitly.

---

## HTTP API contract (required)

### Common response conventions

#### Success

Use JSON objects with stable shapes. Prefer:

```json
{ "data": { /* payload */ } }
```

#### Errors

Return machine-readable errors:

```json
{
  "error": {
    "code": "string_machine_code",
    "message": "human readable",
    "details": { "field": "email" }
  }
}
```

Recommended HTTP status usage:

- `400` validation errors
- `401` missing/invalid auth
- `403` forbidden (unlikely in MVP except ownership bugs)
- `409` conflicts (email taken)
- `429` rate limited
- `500` unexpected

### Authentication

Implement JWT access tokens:

- Access token: short-lived (15 min typical)
- Refresh token: long-lived (7–30 days), rotation on each refresh

Headers:

- `Authorization: Bearer <access_token>`

#### `POST /v1/auth/register`

Request JSON:

```json
{
  "name": "Alex Morgan",
  "email": "alex@example.com",
  "password": "string",
  "accept_terms": true,
  "terms_version": "2026-04-28",
  "privacy_version": "2026-04-28"
}
```

Server validation must enforce:

- Register password strength rules **exactly as** `register.tsx` scoring rules (document equivalence with examples)
- Email validation beyond `@`/`.` (use a reputable validator library or RFC 5322 pragmatic validator)
- `accept_terms` must be true

Response JSON:

```json
{
  "data": {
    "access_token": "jwt",
    "refresh_token": "opaque_or_jwt",
    "expires_in": 900,
    "token_type": "Bearer",
    "user": { /* same shape as GET /v1/me */ }
  }
}
```

#### `POST /v1/auth/login`

Request:

```json
{ "email": "...", "password": "..." }
```

Password rules:

- Must authenticate against hash
- Do not replicate the weak login UI rule on server; server should allow login if credentials match.
  - Document this discrepancy explicitly.

#### `POST /v1/auth/refresh`

Request:

```json
{ "refresh_token": "..." }
```

Behavior:

- Validate token hash exists and not revoked/expired
- Issue new refresh token + rotate old token as unusable

#### `POST /v1/auth/logout`

Request:

```json
{ "refresh_token": "..." }
```

Behavior:

- Revoke refresh token(s)

### Current user

#### `GET /v1/me`

Returns a consolidated object matching mobile expectations:

```json
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "...",
      "email": "...",
      "dob": "YYYY-MM-DD",
      "nationality": "...",
      "kyc_status": "pending|verified|rejected"
    },
    "settings": {
      "push_rent_reminders": true,
      "push_passport_updates": true,
      "push_rewards": true,
      "push_promos": true,
      "email_monthly_statement": false,
      "language": "en-GB"
    }
  }
}
```

Notes:

- Until Phase 10, `kyc_status` remains `pending` unless manually updated via DB/admin tooling; document this.

### Profile + settings (Phase 1)

#### `PATCH /v1/me/profile`

Accept partial updates for:

- `name`, `email`, `dob`, `nationality`

Validation must mirror:

- `profile-edit.tsx` rules for provided fields

Important:

- Email changes should require re-verification in a mature system. For Phase 1 MVP, implement one of:

  - **Option A (acceptable MVP):** allow email change immediately but write `audit_log` and mark email unverified if you add `email_verified_at` later
  - **Option B (stricter):** reject email changes unless verified via token flow

Pick one and document.

#### `PATCH /v1/me/settings`

Body matches `AppSettings`:

```json
{
  "push_rent_reminders": true,
  "push_passport_updates": true,
  "push_rewards": true,
  "push_promos": true,
  "email_monthly_statement": false,
  "language": "en-GB"
}
```

### Notifications (Phase 1)

#### `GET /v1/me/notifications?limit=50&cursor=...`

Return notifications sorted newest-first.

Cursor pagination recommended.

Each item:

```json
{
  "id": "uuid",
  "title": "...",
  "body": "...",
  "type": "rent|passport|rewards|promo|system",
  "icon": "bell",
  "timestamp": "ISO-8601",
  "read": true
}
```

#### `POST /v1/me/notifications/:id/read`

Marks single notification read (`read_at=now()`).

#### `POST /v1/me/notifications/read-all`

Marks all as read for user.

Seed strategy:

- For MVP, allow empty inbox initially.
- Optionally provide `POST /v1/dev/seed-notifications` behind admin auth **only for dev** (disabled in prod).

### Tenancy + rent payments + manual reports (Phase 2)

#### `GET /v1/me/tenancy`

Returns:

```json
{
  "data": {
    "property_address": "...",
    "monthly_rent": 1450.0,
    "payment_day": 1,
    "landlord_name": "...",
    "agent_name": "...",
    "tenancy_end_date": "YYYY-MM-DD",
    "landlord_email": null,
    "landlord_phone": null
  }
}
```

If none exists:

- Return `404` with code `tenancy_not_found` OR return `null` under `data.tenancy`; pick one and document.

#### `PUT /v1/me/tenancy`

Upsert tenancy for user (MVP unique per user).

Validate:

- `monthly_rent > 0`
- `payment_day` 1..31
- `tenancy_end_date` is a date and not before today? (Business rule: document; UI mock uses future date)

#### `GET /v1/me/rent/payments`

Return schedule rows:

```json
{
  "data": {
    "payments": [
      {
        "id": "uuid",
        "amount": 1450.0,
        "due_date": "YYYY-MM-DD",
        "paid_date": "YYYY-MM-DD|null",
        "status": "paid|due|overdue"
      }
    ]
  }
}
```

#### `POST /v1/me/rent/payments/:id/mark-paid` (optional)

If implemented:

- Validate ownership
- Set `paid_date=today` (or provided date if you allow) and `status=paid`

If not implemented, document alternative path for marking paid.

#### `POST /v1/me/rent/reports/manual`

Request:

```json
{
  "amount": 1450.0,
  "payment_date": "YYYY-MM-DD",
  "payment_method": "Bank transfer",
  "reference": "TXN-12345",
  "notes": "optional"
}
```

Validation must mirror `report-rent-manual.tsx`.

Response includes created report:

```json
{
  "data": {
    "id": "uuid",
    "status": "pending",
    "created_at": "ISO-8601"
  }
}
```

---

## Scheduler / jobs (Phase 2 requirement)

Implement a rent payment schedule generator:

### MVP recommendation

On `PUT /me/tenancy`, generate schedule rows from:

- start: first due date derived from `payment_day` relative to “today” policy (document explicitly)
- horizon: next **12 months** of due dates OR until `tenancy_end_date`, whichever is sooner

Also implement a periodic job to extend horizon monthly:

- Command: `node dist/jobs/extend-rent-schedule.js` (example)
- Schedule: nightly cron

Security:

- Internal endpoint allowed only from loopback or shared secret header

---

## Docker + Nginx architecture (required)

### Topology

Create `docker-compose.yml` with networks:

- `edge` network: connects `nginx` to the internet-facing ports
- `internal` network: connects `api` to `postgres` (postgres not published to host)

Services:

- `postgres`: volume `pgdata`, healthcheck `pg_isready`
- `api`: Node service, env vars for `DATABASE_URL`, `JWT_SECRET`, etc.
- `nginx`: publishes `80`/`443`, proxies to `api:3000` (or similar)

TLS:

- Let’s Encrypt certificates mounted into nginx container OR use `certbot` companion; document chosen approach.

Nginx requirements:

- Reverse proxy headers:
  - `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Request-Id` (request id forwarded to API logs)
- Security headers:
  - `Strict-Transport-Security` (when TLS enabled)
  - `X-Content-Type-Options`, `Referrer-Policy`
- Rate limits on `/v1/auth/*` endpoints (even basic)

---

## Security requirements (minimum baseline)

- Hash passwords with **Argon2id** (preferred) or **bcrypt** with documented cost parameters
- JWT signing algorithm `HS256` (acceptable MVP) or `RS256` (preferred if you document key management)
- Store refresh tokens **hashed** at rest
- Never log raw tokens or passwords
- Add DB migrations as forward-only SQL files with checksum discipline

---

## Testing requirements (minimum)

Provide automated tests:

- Unit tests for password policy equivalence to register screen scoring
- Integration tests against a disposable Postgres (docker) covering:
  - register → login → `/me`
  - patch profile/settings round trip
  - create tenancy → generated payments exist
  - create manual rent report validation failures

---

## Deliverables checklist (must)

Code:

- Node API service with typed routes and validation
- SQL migrations creating all tables/enums/indexes
- `Dockerfile` for API
- `docker-compose.yml` for `nginx`, `api`, `postgres`
- `README.md` with local dev and prod deploy steps

Documentation (must):

- `docs/backend/README.md` overview
- `docs/backend/DATABASE.md` schema documentation (include ER diagram as Mermaid or image)
- `docs/backend/API.md` human docs
- `openapi/openapi.yaml` covering all implemented endpoints
- `docs/backend/RUNBOOK.md`
- `docs/backend/ENVIRONMENT.md` describing every env var

Final step:

- Provide a single **Integration Guide** section tailored for the mobile app:

  - Example: set `EXPO_PUBLIC_API_BASE_URL=https://api.groadminapp.com`
  - Example requests with curl for register/login/me
  - Guidance on storing tokens using `expo-secure-store` (client-side; mention as integration expectation)

---

## Explicit non-requirements (do not implement)

- Open Banking connections, transaction ingestion, webhooks
- KYC processing and document storage
- Wallet ledger, withdrawals, gift card fulfillment
- Referral attribution and payouts
- Push notification delivery (APNs/FCM) — optional future

---

## Acceptance criteria (must all be true)

- A new user can register and login and receive valid tokens
- `/v1/me` returns user + settings consistent with DB
- Notifications endpoints work and persist reads
- Tenancy can be saved and retrieved with correct fields
- Rent payments exist as rows and can be listed
- Manual rent reports persist with `pending` status and validation rules matching UI
- Docker compose brings up all services on a VPS with internal DB network isolation
- Documentation package is complete per deliverables checklist
