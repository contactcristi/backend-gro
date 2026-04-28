# GRO Backend API Spec

Base URL: `https://<api-domain>/v1`

Local container URL: `http://localhost:3000/v1`

## Authentication Model

- Passwords are hashed with `bcrypt` cost `12`.
- Access tokens are JWTs signed with `HS256` using `JWT_SECRET`.
- Access token lifetime is `900` seconds.
- Refresh tokens are opaque random tokens returned once to the client. The database stores only a SHA-256 hash in `refresh_tokens`.
- Authenticated requests must send:

```http
Authorization: Bearer <access_token>
```

## PostgreSQL Schema

Migration order:

1. `migrations/001_phase0_phase1.sql`
2. `migrations/002_phase2_rent.sql`

Created extensions:

- `pgcrypto` for `gen_random_uuid()`
- `citext` for case-insensitive email uniqueness

Created tables:

- `users`: auth identity, unique `email`, `password_hash`, timestamps, `last_login_at`
- `user_profiles`: `full_name`, nullable `dob`, `nationality`, `kyc_status`
- `user_consents`: Terms/Privacy versions and acceptance timestamp
- `refresh_tokens`: hashed refresh tokens, expiry, revocation metadata
- `audit_log`: core user/auth/profile/settings events
- `user_settings`: mobile `AppSettings` defaults
- `notifications`: Phase 1 notification inbox rows
- `tenancies`: one active tenancy per user for the MVP
- `rent_payments`: explicit rent schedule rows generated from tenancy details
- `rent_reports`: manual rent reports with verification status fields

Partial onboarding note: register only collects `name`, `email`, and `password`, so `user_profiles.dob` is nullable and `nationality` defaults to an empty string until the mobile profile-edit flow supplies those values.

Rent schedule note: `PUT /v1/me/tenancy` generates up to 12 future monthly payment rows. If `payment_day` is past for the current month, generation starts next month. For short months, the due date is clamped to the month's last day.

## Endpoints

### POST `/v1/auth/register`

Creates a user, profile, default settings row, consent row, refresh token row, and returns tokens.

Request:

```json
{
  "name": "Alex Morgan",
  "email": "alex@example.com",
  "password": "Password1",
  "accept_terms": true,
  "terms_version": "2026-04-28",
  "privacy_version": "2026-04-28"
}
```

Validation:

- `name.trim().length >= 2`
- Email must be a pragmatic valid email and is normalized to lowercase
- Password must match the mobile strength score `>= 2`:
  - length `>= 8`
  - contains uppercase
  - contains digit
  - contains non-alphanumeric
- `accept_terms` must be `true`

Success `201`:

```json
{
  "data": {
    "access_token": "jwt",
    "refresh_token": "opaque-token",
    "expires_in": 900,
    "token_type": "Bearer",
    "user": {
      "user": {
        "id": "uuid",
        "name": "Alex Morgan",
        "email": "alex@example.com",
        "dob": null,
        "nationality": "",
        "kyc_status": "pending"
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
}
```

Possible errors:

- `400 invalid_name`
- `400 invalid_email`
- `400 weak_password`
- `400 terms_required`
- `409 email_taken`

### POST `/v1/auth/login`

Authenticates with email and password, records `last_login_at`, stores a new refresh token hash, and returns tokens.

Request:

```json
{
  "email": "alex@example.com",
  "password": "Password1"
}
```

Success `200`: same response shape as register.

Possible errors:

- `400 invalid_credentials`
- `401 invalid_credentials`

### GET `/v1/me`

Returns the authenticated user's profile and settings.

Headers:

```http
Authorization: Bearer <access_token>
```

Success `200`:

```json
{
  "data": {
    "user": {
      "id": "uuid",
      "name": "Alex Morgan",
      "email": "alex@example.com",
      "dob": null,
      "nationality": "",
      "kyc_status": "pending"
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

Possible errors:

- `401 auth_required`
- `401 invalid_token`
- `404 user_not_found`

### PATCH `/v1/me/profile`

Updates profile fields supplied by the mobile profile-edit screen.

Headers:

```http
Authorization: Bearer <access_token>
```

Request accepts any subset:

```json
{
  "name": "Alexandra Morgan",
  "email": "alexandra@example.com",
  "dob": "1991-02-03",
  "nationality": "British"
}
```

Validation:

- `name`, when provided, must trim to at least 2 characters
- `email`, when provided, must be valid, at least 5 characters, and unique
- `dob`, when provided, must be a real `YYYY-MM-DD` date
- `nationality`, when provided, is trimmed and stored as text

Success `200`: same response shape as `GET /v1/me`.

Possible errors:

- `400 invalid_name`
- `400 invalid_email`
- `400 invalid_dob`
- `400 empty_update`
- `401 auth_required`
- `401 invalid_token`
- `409 email_taken`

### PATCH `/v1/me/settings`

Updates the authenticated user's app settings.

Headers:

```http
Authorization: Bearer <access_token>
```

Request accepts any subset:

```json
{
  "push_rent_reminders": false,
  "push_passport_updates": true,
  "push_rewards": false,
  "push_promos": false,
  "email_monthly_statement": true,
  "language": "en-US"
}
```

Validation:

- Push/email fields must be booleans
- `language` must be `en-GB` or `en-US`

Success `200`: same response shape as `GET /v1/me`.

Possible errors:

- `400 invalid_setting`
- `400 invalid_language`
- `400 empty_update`
- `401 auth_required`
- `401 invalid_token`

### GET `/v1/me/notifications`

Lists the authenticated user's notification inbox newest-first.

Headers:

```http
Authorization: Bearer <access_token>
```

Query:

- `limit`: optional integer, default `50`, clamped to `1..100`

Success `200`:

```json
{
  "data": {
    "notifications": [
      {
        "id": "uuid",
        "title": "Rent reminder",
        "body": "Your rent payment is due soon.",
        "type": "rent",
        "icon": "home",
        "timestamp": "2026-04-28T05:30:00.000Z",
        "read": false
      }
    ]
  }
}
```

### POST `/v1/me/notifications/:id/read`

Marks one notification as read for the authenticated user.

Success `200`:

```json
{
  "data": {
    "notification": {
      "id": "uuid",
      "title": "Rent reminder",
      "body": "Your rent payment is due soon.",
      "type": "rent",
      "icon": "home",
      "timestamp": "2026-04-28T05:30:00.000Z",
      "read": true
    }
  }
}
```

Possible errors:

- `401 auth_required`
- `401 invalid_token`
- `404 notification_not_found`

### POST `/v1/me/notifications/read-all`

Marks all notifications as read for the authenticated user.

Success `200`:

```json
{
  "data": {
    "updated_count": 3
  }
}
```

### GET `/v1/me/tenancy`

Returns the authenticated user's active tenancy.

Headers:

```http
Authorization: Bearer <access_token>
```

Success `200`:

```json
{
  "data": {
    "tenancy": {
      "id": "uuid",
      "property_address": "Flat 4, 10 Grove Street, London",
      "monthly_rent": 1450,
      "payment_day": 5,
      "landlord_name": "Sam Landlord",
      "agent_name": "",
      "tenancy_end_date": "2027-04-30",
      "landlord_email": "landlord@example.com",
      "landlord_phone": "+44 7700 900123"
    }
  }
}
```

Possible errors:

- `401 auth_required`
- `401 invalid_token`
- `404 tenancy_not_found`

### PUT `/v1/me/tenancy`

Creates or replaces the authenticated user's active tenancy. This also creates or updates explicit `rent_payments` rows for up to the next 12 months.

Request:

```json
{
  "property_address": "Flat 4, 10 Grove Street, London",
  "monthly_rent": 1450,
  "payment_day": 5,
  "landlord_name": "Sam Landlord",
  "agent_name": "",
  "tenancy_end_date": "2027-04-30",
  "landlord_email": "landlord@example.com",
  "landlord_phone": "+44 7700 900123"
}
```

Validation:

- `property_address` is required
- `monthly_rent > 0`
- `payment_day` must be an integer `1..31`
- `landlord_name` is required
- `agent_name` may be an empty string
- `tenancy_end_date` must be a real `YYYY-MM-DD` date
- `landlord_email` and `landlord_phone` are optional strings

Success `200`: same tenancy shape as `GET /v1/me/tenancy`.

Possible errors:

- `400 invalid_property_address`
- `400 invalid_monthly_rent`
- `400 invalid_payment_day`
- `400 invalid_landlord_name`
- `400 invalid_tenancy_end_date`
- `401 auth_required`
- `401 invalid_token`

### GET `/v1/me/rent/payments`

Lists generated rent payment schedule rows sorted by `due_date`.

Success `200`:

```json
{
  "data": {
    "payments": [
      {
        "id": "uuid",
        "amount": 1450,
        "due_date": "2026-05-05",
        "paid_date": null,
        "status": "due"
      }
    ]
  }
}
```

### POST `/v1/me/rent/reports/manual`

Creates a manual rent report for the authenticated user's tenancy.

Request:

```json
{
  "amount": 1450,
  "payment_date": "2026-04-27",
  "payment_method": "Bank transfer",
  "reference": "TXN-123",
  "notes": "April rent"
}
```

Validation:

- `amount > 0` and `amount <= 50000`
- `payment_date` must be a real `YYYY-MM-DD` date and not in the future
- `payment_method` must be one of `Bank transfer`, `Standing order`, `Direct debit`, `Cash`, `Other`
- `reference` and `notes` are optional strings

Success `201`:

```json
{
  "data": {
    "report": {
      "id": "uuid",
      "amount": 1450,
      "payment_date": "2026-04-27",
      "payment_method": "Bank transfer",
      "reference": "TXN-123",
      "notes": "April rent",
      "source": "manual",
      "status": "pending",
      "created_at": "2026-04-28T05:43:00.000Z"
    }
  }
}
```

Possible errors:

- `400 invalid_amount`
- `400 invalid_payment_date`
- `400 invalid_payment_method`
- `401 auth_required`
- `401 invalid_token`
- `404 tenancy_not_found`

## Error Format

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Human readable message.",
    "details": {
      "field": "email"
    }
  }
}
```

## Docker Notes

`docker-compose.yml` runs:

- `nginx-proxy`: existing Nginx Proxy Manager on ports `80`, `443`, `81`
- `db`: PostgreSQL 16 with a `pg_isready` healthcheck
- `api`: Node API, waits for healthy Postgres, runs `npm run migrate`, then `npm start`

Required environment:

```bash
export JWT_SECRET="<long-random-secret>"
docker compose up --build -d
```

The API container connects to Postgres through the internal Compose service name `db`.

## Mobile Integration Notes

Set:

```bash
EXPO_PUBLIC_API_BASE_URL=https://<api-domain>
```

Example register:

```bash
curl -X POST "$EXPO_PUBLIC_API_BASE_URL/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alex Morgan","email":"alex@example.com","password":"Password1","accept_terms":true,"terms_version":"2026-04-28","privacy_version":"2026-04-28"}'
```

Store tokens in `expo-secure-store` or an equivalent secure storage layer, not `AsyncStorage`. Send the access token in `Authorization` for `/v1/me`.
