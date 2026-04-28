# Coupling the GRO mobile app to a self-hosted API (VPS: Nginx + Node + PostgreSQL)

This app is **offline-first**: all product flows use local/mock state. The database lives **only** on the server. The app never connects to PostgreSQL directly.

## Target architecture

```text
[ Mobile app (Expo) ]  --HTTPS JSON-->  [ Nginx :443 ]  --HTTP-->  [ Node.js :127.0.0.1:PORT ]
                                                                               |
                                                                               v
                                                                         [ PostgreSQL :5432 ]
```

- **PostgreSQL**: stores users, sessions, business data. Connection string is **server-side only** (`DATABASE_URL`).
- **Node.js**: your HTTP API (Express, Fastify, or the former monorepo `@workspace/api-server` extended with routes).
- **Nginx**: TLS termination, reverse proxy to Node, optional rate limits and static file caching.

## 1. Configure the mobile app

### Environment variable (recommended)

Set a **public** base URL (no database credentials):

| Variable | Example |
|----------|---------|
| `EXPO_PUBLIC_API_BASE_URL` | `https://api.groadminapp.com` |

- No trailing slash.
- Use **HTTPS** in production.
- In **EAS Build / Submit**, add this under project secrets or `eas.json` env for each profile.
- For local development against a self-signed cert, you may use HTTP to your LAN IP only during testing; iOS and Android have different trust rules—prefer a real dev cert or tunnel.

The app reads this in `constants/apiConfig.ts` and exposes a minimal `lib/apiClient.ts` helper. Replace with generated OpenAPI code later if you prefer.

### `app.json` (optional)

You can set `expo.extra.apiBaseUrl` instead of env (less flexible for multiple environments). Prefer `EXPO_PUBLIC_*` for CI/EAS.

### `expo-router` `origin`

In `app.json`, the `expo-router` plugin `origin` should match the **public web URL** used for deep links and web builds (your marketing or app link domain), not necessarily the API host.

## 2. CORS and mobile clients

React Native’s `fetch` is **not** a browser: it does not enforce browser CORS the same way. You should still set **CORS** on the API for any web build of the app and for tooling:

```http
Access-Control-Allow-Origin: <your app origins or * in dev>
Access-Control-Allow-Headers: Authorization, Content-Type
```

Lock down `Allow-Origin` in production to known front-end origins if you add a web client.

## 3. Example Nginx (reverse proxy to Node)

```nginx
# /etc/nginx/sites-available/gro-api

map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 443 ssl http2;
  server_name api.groadminapp.com;

  ssl_certificate     /etc/letsencrypt/live/api.groadminapp.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.groadminapp.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

- Replace `3000` with the port your Node process listens on.
- Obtain certificates with **Certbot** (Let’s Encrypt) or your provider.
- Expose only **Nginx** to the internet; bind Node to `127.0.0.1` or a private socket.

## 4. Node API on the VPS

Minimum checklist:

1. `DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/gro` (use a dedicated DB user, least privilege).
2. `PORT=3000` (or your chosen local port; Nginx proxies to it).
3. `NODE_ENV=production` for the deployed process.
4. Implement at least: `GET /api/healthz` returning JSON `{ "status": "ok" }` to verify end-to-end.

Use **pg** or an ORM (Drizzle, Prisma) on the server; run migrations from your server repo, not from the phone.

## 5. Authentication (typical next step)

When you add real accounts:

- Issue **access tokens** (short-lived) and **refresh tokens** (longer, stored server-side or in a rotation table).
- In the app, store tokens in **expo-secure-store** (or your stack’s equivalent), not in AsyncStorage.
- Send `Authorization: Bearer <access_token>` from `apiClient` or your OpenAPI `custom-fetch` after you wire `setAuthTokenGetter`.

## 6. Reusing the original monorepo’s OpenAPI / client

The main GRO monorepo contains `lib/api-spec` (OpenAPI) and `lib/api-client-react` (Orval-generated hooks). To align with that stack:

1. Keep API development in the monorepo (or copy `openapi.yaml` to your server repo).
2. Run Orval in a **new** package in your mobile repo, or add a `packages/api-client` workspace.
3. Point `setBaseUrl` to `getApiBaseUrl()` and register a token getter when auth exists.

## 7. What stays out of the mobile app

- PostgreSQL host, user, password, and internal URLs.
- Admin keys, Stripe secret keys, etc.

Only public values belong in `EXPO_PUBLIC_*` and `app.json` extras that ship to the client.
