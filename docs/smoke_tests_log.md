# Smoke Tests Log

Acest fișier păstrează istoricul rulărilor de smoke tests (call-uri + rezultate) și trebuie actualizat la fiecare rulare nouă.

## Standard Run Commands

Pornire stack:

```bash
export JWT_SECRET="<secret>"
docker compose up --build -d
```

Rulare smoke tests din containerul API:

```bash
JWT_SECRET=smoke-test-secret docker compose exec -T api node -e '<scriptul de smoke tests>'
```

## Run History

### 2026-04-28T06:01:46.304Z

- **Environment**
  - `docker compose`: `api` up, `db` healthy, `nginx-proxy` up
  - DB reset anterior: da, pentru a elimina schema legacy incompatibilă (`users.id integer`)
  - Email test: `smoke-log-1777356106304@example.com`

- **Calls and Results**

1) `GET /healthz`

- Status: `200`
- Body:

```json
{"status":"ok"}
```

2) `POST /v1/auth/register`

- Status: `201`
- Key result:

```json
{
  "data": {
    "token_type": "Bearer",
    "expires_in": 900,
    "user": {
      "user": {
        "id": "61b2fcd0-397e-45a2-8023-22c2de8c2171",
        "email": "smoke-log-1777356106304@example.com"
      }
    }
  }
}
```

3) `POST /v1/auth/login`

- Status: `200`
- Key result:

```json
{
  "data": {
    "token_type": "Bearer",
    "expires_in": 900,
    "user": {
      "user": {
        "id": "61b2fcd0-397e-45a2-8023-22c2de8c2171"
      }
    }
  }
}
```

4) `GET /v1/me`

- Status: `200`
- Key result:

```json
{
  "data": {
    "user": {
      "id": "61b2fcd0-397e-45a2-8023-22c2de8c2171",
      "name": "Smoke Log User"
    },
    "settings": {
      "language": "en-GB"
    }
  }
}
```

5) `PATCH /v1/me/profile`

- Status: `200`
- Key result:

```json
{
  "data": {
    "user": {
      "name": "Smoke Log Tester",
      "dob": "1990-01-02",
      "nationality": "British"
    }
  }
}
```

6) `PATCH /v1/me/settings`

- Status: `200`
- Key result:

```json
{
  "data": {
    "settings": {
      "push_rent_reminders": false,
      "push_rewards": false,
      "email_monthly_statement": true,
      "language": "en-US"
    }
  }
}
```

7) `PUT /v1/me/tenancy`

- Status: `200`
- Key result:

```json
{
  "data": {
    "tenancy": {
      "id": "52ba98f1-4b5f-4860-b1ea-e0fb33993d93",
      "monthly_rent": 1450,
      "payment_day": 5
    }
  }
}
```

8) `GET /v1/me/rent/payments`

- Status: `200`
- Key result:

```json
{
  "data": {
    "payments_count": 12,
    "first_due_date": "2026-05-05",
    "first_status": "due"
  }
}
```

9) `POST /v1/me/rent/reports/manual`

- Status: `201`
- Key result:

```json
{
  "data": {
    "report": {
      "id": "e7398259-dcd4-4ae8-bdc0-163ce2d11772",
      "status": "pending",
      "source": "manual",
      "created_at": "2026-04-28T06:01:46.940Z"
    }
  }
}
```

- **Overall result**: PASS (`9/9` call-uri cu statusul așteptat)
