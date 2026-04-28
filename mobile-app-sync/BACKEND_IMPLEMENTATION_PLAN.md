# Backend implementation plan (database + API), phased

This plan turns the domain described in `docs/BACKEND_DATA_MODEL_FROM_APP.md` into an incremental delivery sequence for a managed database and HTTP API. It is intentionally stack-agnostic at the database boundary (PostgreSQL recommended), but assumes a typical Node.js API (REST + JSON) behind TLS.

Principles:

- Start with **identity + auditability**, then **money-moving flows**, then **third-party integrations** (Open Banking, KYC), then **growth features** (referrals, campaigns).
- Prefer **append-only ledgers** for points/cashback instead of only storing totals.
- Keep regulated workflows explicit: **consents**, **verification states**, **immutable evidence references** (not raw files in OLTP unless required).

## Phase 0 — Foundations (week 0–1)

Deliverables:

- Repository layout for API service + migrations tool (SQL migrations or schema-as-code).
- Baseline infrastructure: TLS, secrets management, structured logs, request tracing.
- Common cross-cutting modules:
  - Authentication middleware (Bearer access tokens + refresh rotation pattern).
  - Authorization model (user owns resources; admin roles later).
  - Idempotency keys for payments/payout-like endpoints (recommended).
  - Pagination + filtering conventions.
  - Error format (stable machine-readable codes).

Database (minimum tables):

- `users`
- `user_profiles` (PII fields separated from auth identifiers)
- `auth_sessions` / `refresh_tokens` (hashed refresh tokens)
- `audit_log` (who changed what; especially profile email changes and verification states)

API (minimum endpoints):

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`

Notes:

- Align password policy with UI expectations (registration uses stronger rules than login today).
- Persist Terms/Privacy acceptance as timestamps + policy version IDs.

Exit criteria:

- A user can register/login and fetch `/me` from a mobile client using secure token storage.

## Phase 1 — Profile + settings + notifications inbox (week 1–2)

Goal: persist user-editable profile fields and notification preferences without touching regulated banking flows yet.

Database:

- Extend `user_profiles` with `dob`, `nationality`, `kyc_status` (even if still `"pending"` initially).
- `user_settings` mirroring `AppSettings` from the app:
  - push toggles, email monthly statement toggle, language.
- `notifications`:
  - store inbox rows matching `NotificationItem` (`title`, `body`, `type`, `read_at`, `created_at`).
- Optional: `devices` + `push_tokens` if mobile push is implemented server-side.

API:

- `PATCH /me/profile`
- `PATCH /me/settings`
- `GET /me/notifications`
- `POST /me/notifications/:id/read`
- `POST /me/notifications/read-all`

Exit criteria:

- App settings toggles can round-trip to backend (replacing most `gro_settings` usage).

## Phase 2 — Tenancy + rent schedule + basic reporting (manual) (week 2–4)

Goal: model `RentDetails`, monthly schedule (`RentPayment`), and manual `RentReport` with verification workflow.

Database:

- `tenancies` (links `user_id` to address + landlord contact fields)
- `rent_payment_schedule` or derive schedule from tenancy rules (choose one):
  - simplest: store explicit `rent_payments` rows generated monthly by a job
- `rent_reports`
  - store exactly what UI collects for manual entry:
    - amount, payment_date, payment_method, optional reference/notes, source=`manual`
  - verification fields: `status`, reviewer metadata (later), evidence attachments pointer

API:

- `GET /me/tenancy`
- `PUT /me/tenancy`
- `GET /me/rent/payments`
- `POST /me/rent/payments/:id/mark-paid` (optional; only if you want explicit transitions)
- `POST /me/rent/reports/manual`

Operational jobs:

- Nightly/monthly generator for schedule rows if using explicit rows.

Exit criteria:

- Manual reporting persists and shows up consistently across devices (replacing purely local mock arrays over time).

## Phase 3 — Ledger: points + cashback + withdrawals (week 4–6)

Goal: replace “single balance numbers” with auditable transactions.

Database:

- `wallet_accounts` (optional normalization) OR attach balances to `users` but always with ledger.
- `ledger_entries`
  - types aligned with UI: points vs cashback vs referral rewards
  - signed amounts, currency (`GBP`), running balances optional (or computed)
  - references to source objects (`rent_report_id`, `gift_card_order_id`, etc.)
- `withdrawal_requests`
  - amount, status (`requested`, `processing`, `paid`, `failed`)
  - PSP references
- `gift_card_orders`
  - denomination, brand id, pricing/fees, fulfillment status

API:

- `GET /me/wallet/summary` (computed totals + recent ledger page)
- `GET /me/wallet/ledger`
- `POST /me/wallet/withdraw`
- `POST /me/rewards/gift-cards/:brandId/purchase` (or `/orders`)

Exit criteria:

- Cashback withdrawal creates an immutable ledger trail and a withdrawal record.

## Phase 4 — Passport scoring + completion steps (week 6–7)

Goal: persist passport score and completion steps server-side to prevent client tampering.

Database:

- `passport_profiles`
  - score, verification level, booleans (`open_banking_verified`, etc.)
- `passport_steps`
  - rows keyed by `step_id` matching UI IDs (`kyc_selfie`, `bank_connect`, …)

API:

- `GET /me/passport`
- `POST /me/passport/steps/:stepId/complete` (server-validated rules)

Rules:

- Points updates should be driven by verified domain events (ledger entries), not arbitrary client ints.

Exit criteria:

- Passport score cannot be raised solely by editing local state; server is authoritative.

## Phase 5 — Landlord verification workflow (week 7–8)

Goal: persist landlord invites + confirmations (currently local JSON).

Database:

- `landlord_verifications`
  - maps to `LandlordVerification`
  - consider secure tokens for public confirmation links instead of guessable IDs

API:

- `POST /me/landlord-invites`
- `POST /public/landlord-confirm/:token` (unauthenticated public endpoint as appropriate)

Exit criteria:

- Invite + confirm produces durable records and triggers passport updates via server rules.

## Phase 6 — Referrals (week 8–9)

Goal: server-side referral codes and attribution; replace AsyncStorage counters.

Database:

- `referral_codes` (unique per user or campaign table)
- `referrals` rows (`referrer_user_id`, `referee_user_id`, status transitions)
- payout hooks via ledger entries when rewards become payable

API:

- `GET /me/referrals`
- `POST /referrals/claim` (if needed)

Exit criteria:

- Referral counts and rewards reconcile with ledger.

## Phase 7 — Expert bookings (week 9–10)

Goal: persist `ExpertBooking` requests as operational tickets.

Database:

- `expert_bookings`
- optional `experts` catalog table if experts become dynamic (currently constants file)

API:

- `POST /me/expert-bookings`
- `POST /me/expert-bookings/:id/cancel`

Exit criteria:

- Ops can see booking queue without relying on device-local arrays.

## Phase 8 — Move plan + life goals (week 10–11)

Goal: persist `life_goal` and `move_plan` server-side (currently AsyncStorage).

Database:

- `user_goals` (`life_goal` enum)
- `move_plans` + `move_plan_items`

API:

- `PUT /me/goals/life`
- `GET /me/move-plan`
- `PUT /me/move-plan`

Exit criteria:

- Cross-device continuity for move planning state.

## Phase 9 — Open Banking integration (week 11–14)

Goal: replace mocked bank picker/transactions with real provider flows.

Database:

- `ob_connections` (institution, consent expiry, status)
- `ob_accounts` / external identifiers (tokenized)
- `ob_transactions` (normalized transaction rows + matching confidence)

API:

- OAuth/connect initiation endpoints (provider-specific)
- Webhooks from provider (token refresh + transaction updates)
- `POST /me/rent/reports/from-open-banking` becomes server-driven matching

Exit criteria:

- Rent reports created from bank data include stable external references and audit metadata.

## Phase 10 — KYC integration (week 14–17)

Goal: replace simulated KYC with provider-backed checks.

Database:

- `kyc_cases` (provider, applicant ids, status timeline)
- secure artifact storage references

API:

- Webhooks/callback endpoints from provider
- `GET /me/kyc/status`

Exit criteria:

- `user_profiles.kyc_status` transitions are driven by provider outcomes.

## Phase 11 — Support tickets + compliance artifacts (week 17–18)

Goal: persist Help form submissions (`subject`, `message`) and operational SLAs.

Database:

- `support_tickets`
- optional attachments metadata

API:

- `POST /support/tickets`

## Cross-cutting backlog (parallel tracks)

Security:

- MFA (even if UI is mocked today), session revocation, suspicious-login alerts (maps to future Security screen).

Privacy:

- retention policies for rent evidence and KYC artifacts
- DSAR export/delete workflows

Observability:

- metrics on verification backlog, withdrawal failures, OB consent expirations

Testing strategy:

- contract tests for `/me` + wallet ledger invariants (no negative cashback totals unless modeled explicitly)

## Mapping to current mobile app state

Today the mobile app uses:

- Local mock arrays in `UserContext`
- Partial persistence via AsyncStorage keys (`gro_*`)

Rollout approach:

1. Implement Phase 0–2 and switch reads/writes for profile/settings/notifications first.
2. Introduce wallet ledger (Phase 3) before trusting any withdrawals in production.
3. Replace OB/KYC mocks only after audit-grade handling exists (Phases 9–10).
