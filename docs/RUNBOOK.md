# GRO Backend Runbook

Operational guide for running, testing, debugging, and maintaining the GRO backend on a VPS.

## Required Environment

The API requires:

- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_SECRET`: long random secret used to sign HS256 access tokens.
- `PORT`: API port, default `3000`.
- `NODE_ENV`: `development` or `production`.

Use `.env.example` as the template. Do not commit real `.env` files.

## Start And Stop

Start or rebuild the stack:

```bash
export JWT_SECRET="<long-random-secret>"
docker compose up --build -d
```

Stop the stack:

```bash
JWT_SECRET=dummy docker compose down
```

Show service status:

```bash
JWT_SECRET=dummy docker compose ps
```

## Health Checks

API health:

```bash
curl http://localhost:3000/healthz
```

Database connectivity through API:

```bash
curl http://localhost:3000/test-db
```

PostgreSQL health inside Docker:

```bash
JWT_SECRET=dummy docker compose exec db pg_isready -U user_admin -d groadmin_db
```

## Logs

API logs:

```bash
JWT_SECRET=dummy docker compose logs -f api
```

Database logs:

```bash
JWT_SECRET=dummy docker compose logs -f db
```

Nginx Proxy Manager logs:

```bash
JWT_SECRET=dummy docker compose logs -f nginx-proxy
```

## Migrations

Migrations run automatically when the API container starts. To run manually:

```bash
JWT_SECRET=dummy docker compose exec api npm run migrate
```

Migration files are forward SQL files in `migrations/`:

1. `001_phase0_phase1.sql`
2. `002_phase2_rent.sql`

If a migration fails, inspect API logs first, then connect to Postgres and verify whether the failing table/index/constraint already exists.

## Backups

Create a logical backup:

```bash
JWT_SECRET=dummy docker compose exec -T db pg_dump -U user_admin -d groadmin_db > backup.sql
```

Restore into an empty database:

```bash
JWT_SECRET=dummy docker compose exec -T db psql -U user_admin -d groadmin_db < backup.sql
```

For production, store backups off-server and test restore regularly.

## Rotating `JWT_SECRET`

Current implementation signs access tokens with one HS256 secret.

Rotation impact:

- Existing access tokens become invalid immediately after changing `JWT_SECRET`.
- Users can log in again to receive fresh tokens.
- Refresh token rotation endpoints are not implemented yet, so mobile clients should handle a `401` by returning to login.

Procedure:

1. Choose a new long random value.
2. Update environment/secret store.
3. Restart API:

```bash
export JWT_SECRET="<new-long-random-secret>"
docker compose up -d api
```

## Common Troubleshooting

### `JWT_SECRET is required`

Compose interpolation requires `JWT_SECRET`. Prefix commands:

```bash
JWT_SECRET=dummy docker compose ps
```

For real startup, export a strong secret.

### API cannot connect to Postgres

Check:

- `db` container is healthy.
- `DATABASE_URL` uses hostname `db` inside Compose.
- Postgres credentials match `docker-compose.yml`.

Commands:

```bash
JWT_SECRET=dummy docker compose ps
JWT_SECRET=dummy docker compose logs db
JWT_SECRET=dummy docker compose logs api
```

### Port conflicts

Nginx Proxy Manager publishes `80`, `443`, and `81`. If those are already in use, stop the conflicting service or change the published ports in `docker-compose.yml`.

### Duplicate registration email

The API returns:

```json
{
  "error": {
    "code": "email_taken",
    "message": "Email is already registered.",
    "details": {
      "field": "email"
    }
  }
}
```

Use a unique email in smoke tests or delete test rows from the database.

## Smoke Test Checklist

Use `curl` to verify:

1. `GET /healthz`
2. `POST /v1/auth/register`
3. `POST /v1/auth/login`
4. `GET /v1/me`
5. `PATCH /v1/me/profile`
6. `PATCH /v1/me/settings`
7. `PUT /v1/me/tenancy`
8. `GET /v1/me/rent/payments`
9. `POST /v1/me/rent/reports/manual`

Expected result: all authenticated calls return `2xx` and JSON in the response shapes documented in `docs/api_spec.md`.
