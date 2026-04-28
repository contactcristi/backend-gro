# External References Audit

This document records the Replit, monorepo, placeholder, and external references found in the standalone GRO mobile app repository. It is an audit only; no application code or existing documentation was changed as part of this note.

## Scope

Audited repository: `mobile-app`

The review covered tracked project files, hidden files, untracked non-ignored files, app configuration, package metadata, server helpers, documentation, and source files. Ignored dependency folders such as `node_modules` are not considered application source.

## Summary

The repository is isolated from the parent folders and does not contain Replit project files such as `.replit` or `replit.nix`. There are also no imports from parent directories, no `@workspace` imports in application code, and no local absolute paths.

The remaining references fall into these categories:

- Historical Replit / monorepo notes in documentation.
- Placeholder domains used for future configuration.
- Product links and share URLs used by user-facing app flows.
- External platform URLs used for sharing, support, app previews, or documentation.
- Expo/EAS project configuration.
- npm registry URLs in the lockfile.

## Replit and Monorepo References

### `README.md`

References:

- `React Native (Expo Router) app extracted from the GRO monorepo.`
- `The old monorepo used a Replit-only build script...`
- `SPDX: inherit from the parent GRO project...`

Role:

These are documentation-only historical notes explaining how the mobile app was extracted and why the local static server exists.

Should this move to config?

No. These are not runtime values and are not consumed by the app. They should either remain as historical documentation or be rewritten if the repository should read as fully standalone. A config file would not help.

### `docs/SERVER_INTEGRATION.md`

References:

- `former monorepo @workspace/api-server`
- `The main GRO monorepo contains lib/api-spec...`
- Suggestions about copying OpenAPI files or adding a generated API client.

Role:

These notes describe a possible future backend integration path based on the previous codebase structure.

Should this move to config?

No. These are architecture notes, not configuration values. If the previous monorepo is no longer relevant, the better action is to rewrite this documentation around the new standalone repository and backend plan.

## Placeholder Domains and Future API Configuration

### `app.json`

Reference:

- `expo.plugins[expo-router].origin`: `https://app.example.com`

Role:

This is a placeholder HTTPS origin for Expo Router web/deep-link behavior. It should eventually match the real public web or app-link domain.

Should this move to config?

Maybe. For Expo Router, keeping the value in `app.json` is normal because Expo config is evaluated at build time. If different environments need different origins, use a dynamic Expo config file such as `app.config.ts` and read from an environment variable. If there is only one production domain, keeping it in Expo config is acceptable.

Recommended future shape:

- Keep build-time Expo values in Expo config.
- Move environment-specific values into `.env` / EAS environment variables.
- Consider replacing `app.json` with `app.config.ts` when staging and production domains diverge.

### `.env.example`

Reference:

- `EXPO_PUBLIC_API_BASE_URL=`
- Example comment: `https://api.yourdomain.com`

Role:

This documents the public API base URL expected by the app once a backend exists.

Should this move to config?

It already is config-oriented. The value should remain environment-driven because API endpoints usually differ between local, staging, and production builds.

### `constants/apiConfig.ts`

References:

- Reads `process.env.EXPO_PUBLIC_API_BASE_URL`
- Reads `expo.extra.apiBaseUrl`

Role:

This file centralizes the public API base URL lookup.

Should this move to config?

No additional move is needed. This is already the right kind of central configuration boundary. If the app gains more public endpoints, they should be added through the same pattern rather than hardcoded in screens.

### `lib/apiClient.ts`

Reference:

- Uses `getApiBaseUrl()` to build API request URLs.

Role:

This is a minimal future JSON client for backend requests.

Should this move to config?

No. The URL source is already externalized through `constants/apiConfig.ts`. The client itself should remain code.

### `docs/SERVER_INTEGRATION.md`

References:

- `https://api.yourdomain.com`
- `api.yourdomain.com`
- `http://127.0.0.1:3000`
- `DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/gro`

Role:

These are examples for a future self-hosted backend, Nginx reverse proxy, and PostgreSQL deployment.

Should this move to config?

No for the document itself. Real deployed values should never live in client source. They belong in server-side environment variables, EAS secrets, CI variables, or infrastructure configuration.

## Product and Share Links

### `context/UserContext.tsx`

Reference:

- `https://joinGRO.io/r/...`

Role:

This mock/user context builds referral links exposed by referral and sharing flows.

Should this move to config?

Yes, if the domain is not final or differs by environment. A public marketing/app-link base URL should be centralized so all share links use the same domain and casing.

### `app/(tabs)/passport.tsx`

Reference:

- `https://joinGRO.io/p/${token}`

Role:

Creates a public Rent Passport share URL.

Should this move to config?

Yes. This should use a shared public web base URL such as `EXPO_PUBLIC_WEB_BASE_URL` or an Expo extra value. Hardcoding the domain in a screen makes staging and domain changes error-prone.

### `app/p/[token].tsx`

Reference:

- Text footer: `joinGRO.io`

Role:

Branding text on the public passport page.

Should this move to config?

Maybe. If this is just display copy, it can remain as content. If the same domain appears in many places, centralizing brand/domain strings reduces drift.

### `app/wrapped.tsx`

References:

- `https://joingro.io/?ref=${referralCode}`
- Display text: `joingro.io`

Role:

Creates share text and invite links for the GRO Wrapped flow.

Should this move to config?

Yes. The base website URL should be shared with referral and passport flows. This file also uses a different casing from other files (`joingro.io` vs `joinGRO.io`), which is harmless for DNS but inconsistent for branding.

### `app/landlord-invite.tsx`

References:

- `https://joinGRO.io/landlord/confirm/${id}`
- `mailto:` links built from landlord email.
- `sms:` links built from landlord phone.

Role:

Builds landlord verification invite links and opens native email/SMS flows.

Should this move to config?

The public confirmation URL should move to shared config. The `mailto:` and `sms:` schemes are platform behaviors and should remain in code.

### `app/referrals.tsx`

References:

- `https://wa.me/?text=...`
- `https://twitter.com/intent/tweet?text=...`

Role:

Opens WhatsApp and X/Twitter share intents.

Should this move to config?

Usually no. These are stable third-party share endpoints, not app environment configuration. If the app later supports multiple share providers or needs compliance control over external destinations, a small `shareProviders` config module could be useful.

### `app/help.tsx`

References:

- `mailto:chat@joingro.io?subject=...`
- `tel:+442038080000`
- `mailto:support@joingro.io`

Role:

Defines support contact actions in the Help & Support screen.

Should this move to config?

Yes, if these are real operational contact details. Support email addresses and phone numbers often change independently of app code and should be centralized in a public app config module or loaded from backend-controlled settings.

### `app/(auth)/login.tsx`

References:

- `demo.apple@joingro.io`
- `demo.google@joingro.io`

Role:

Demo email values used by the login UI.

Should this move to config?

No, unless demo accounts become environment-specific. If these are only placeholders for UI demos, they can stay in fixture/mock data. If they are real test accounts, they should be clearly isolated from production builds.

## Static Preview Server References

### `server/serve.js`

References:

- Builds `baseUrl` from request headers.
- Builds `exps://` URL through template replacement.
- Uses `process.env.BASE_PATH`.
- Uses `process.env.PORT`.

Role:

This standalone Node server hosts a static Expo export and serves a landing page / manifest routes.

Should this move to config?

No for `PORT` and `BASE_PATH`; environment variables are appropriate. If the server is kept, its behavior is already externally configurable enough for local/static hosting. If production builds use EAS and app stores only, this server may remain optional tooling.

### `server/templates/landing-page.html`

References:

- `https://apps.apple.com/app/id982107779`
- `https://play.google.com/store/apps/details?id=host.exp.exponent`
- `https://unpkg.com/qr-code-styling@1.6.0/lib/qr-code-styling.js`
- `exps://EXPS_URL_PLACEHOLDER`

Role:

This template supports previewing the app through Expo Go and displaying a QR code.

Should this move to config?

Partly.

- Expo Go store links can remain hardcoded if this page is only for developer preview.
- The `unpkg.com` script is an external runtime dependency for this landing page. If the page is used in production or offline-sensitive contexts, vendor the QR library locally or replace it with a bundled/static QR implementation.
- If the template becomes a production landing page, app store URLs should move to config and point to the real app listings.

## Expo/EAS References

### `app.json`

Reference:

- `extra.eas.projectId`: `2ef12ef7-685f-49d5-9e58-38a920cb8b38`

Role:

Links this local Expo app config to an EAS project.

Should this move to config?

Usually no. Expo expects this value in app config. However, if this repository should be completely detached from any previous Expo/EAS project, create a new Expo project with EAS and replace this ID. If the current ID belongs to the intended project, keep it.

### `eas.json`

References:

- EAS build profiles.
- Node and pnpm versions.

Role:

Defines cloud build behavior for Expo Application Services.

Should this move to config?

No. This file is the expected EAS configuration file.

### `package.json`

References:

- EAS scripts.
- `eas-cli`
- `@expo/ngrok`

Role:

Supports Expo development and EAS builds. `@expo/ngrok` is used by Expo tooling for tunneled development sessions, not by the app runtime.

Should this move to config?

No. These are package dependencies and scripts. If the project will not use EAS or tunnels, remove the dependency/scripts intentionally in a separate cleanup.

## Documentation and Dependency URLs

### `.gitignore`

Reference:

- GitHub documentation URL in a comment.
- `.vercel` ignore entry.

Role:

The GitHub URL is explanatory documentation. `.vercel` prevents local Vercel metadata from being committed.

Should this move to config?

No. The URL is harmless documentation. `.vercel` is an ignore rule, not a runtime link. If Vercel will never be used, the ignore entry can stay without impact or be removed in a cleanup-only change.

### `components/ErrorBoundary.tsx`

Reference:

- React documentation URL in a code comment.

Role:

Developer reference for the Error Boundary pattern.

Should this move to config?

No. Documentation comments should not move to config.

### `package-lock.json`

References:

- Many `https://registry.npmjs.org/...` package tarball URLs.
- Some funding URLs such as OpenCollective.

Role:

These are normal npm lockfile metadata entries needed for reproducible installs.

Should this move to config?

No. Do not manually edit these. If the package manager changes, regenerate the lockfile through the package manager.

## Recommended Config Strategy

If this project should remain standalone but still flexible across environments, the most useful config boundary would be a small public app configuration module.

Suggested public values:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_WEB_BASE_URL`
- `EXPO_PUBLIC_SUPPORT_EMAIL`
- `EXPO_PUBLIC_SUPPORT_CHAT_EMAIL`
- `EXPO_PUBLIC_SUPPORT_PHONE`

Suggested code-level config module:

- `constants/appConfig.ts`

Potential responsibilities:

- Normalize public website and API URLs.
- Build share URLs from one base domain.
- Centralize support contacts.
- Keep third-party platform share schemes in one place only if they become configurable product behavior.

Values that should not be moved into the mobile app config:

- PostgreSQL URLs.
- API secrets.
- Admin keys.
- Stripe secret keys.
- Server-only OAuth secrets.
- Private service tokens.

## Cleanup Priority

Recommended order if cleanup is requested later:

1. Rewrite documentation references to Replit, monorepo, and parent project so the repository reads as fully standalone.
2. Replace `app.example.com` with the real app-link/web origin or move Expo config to `app.config.ts`.
3. Centralize `joinGRO.io` / `joingro.io` into one public web base URL.
4. Centralize support email and phone values.
5. Decide whether the static preview server is still needed. If kept, decide whether `unpkg.com` is acceptable for its landing page.
6. Confirm whether the existing EAS project ID belongs to the new standalone app. Replace it only if a new Expo/EAS project is intended.
