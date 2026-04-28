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

Partial onboarding note: register only collects `name`, `email`, and `password`, so `user_profiles.dob` is nullable and `nationality` defaults to an empty string until the mobile profile-edit flow supplies those values.

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
