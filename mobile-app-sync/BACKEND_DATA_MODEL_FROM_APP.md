# Backend data model (derived from the GRO mobile app)

This document inventories user-entered and app-managed data that the **current UI expects to exist** if a real backend and database are introduced. It is based on `context/UserContext.tsx` (the in-app domain model) plus key screens with forms (auth, profile, rent reporting, rewards, support, expert booking).

Current implementation note: the app is **offline-first with mock data** in `UserContext`. Some screens look like a full product (Open Banking, KYC provider text, security sessions) but are **not wired to a server** today.

## Method

Source of truth for shapes and persistence keys:

- TypeScript interfaces in `context/UserContext.tsx`
- `AsyncStorage` keys in `context/UserContext.tsx` and `app/referrals.tsx`
- Form fields in:
  - `app/(auth)/login.tsx`, `app/(auth)/register.tsx`
  - `app/profile-edit.tsx`
  - `app/settings.tsx`, `app/security.tsx` (security is UI mock only)
  - `app/report-rent-manual.tsx`, `app/report-rent-bank.tsx`
  - `app/withdraw.tsx`, `app/redeem-gift-card.tsx`, `app/expert-booking.tsx`, `app/deposit-builder.tsx`, `app/help.tsx`

## Authentication and identity

### Login screen (`app/(auth)/login.tsx`)

Captured fields (client-side only today):

- `email` (string; basic validation: must include `@`, not truly validated as RFC)
- `password` (string; UI requires length `>= 4` for “Log in”)
- “Social” buttons are fake: they call `signIn("demo.apple@joingro.io")` / `signIn("demo.google@joingro.io")` and do not perform OAuth.

What a backend would store (typical):

- `user.id` (UUID)
- `user.email` (unique, normalized lower-case)
- `auth_credential` (hashed password for email/password; never store plaintext)
- `oauth_identities` rows if Apple/Google are real (provider, provider_subject, email_at_provider)

Password reset flow is simulated in UI (no token lifecycle).

### Register screen (`app/(auth)/register.tsx`)

Captured fields:

- `name` (full name; UI requires `trim().length >= 2`)
- `email` (UI requires `@` and `.`)
- `password` (strength meter is UI-only; UI blocks registration unless strength score `>= 2` out of 4)
- `accept` boolean for Terms & Privacy (should map to `terms_accepted_at` timestamp and policy versions)

### Current app behavior (`UserContext`)

`signIn(email)` only updates local user email and stores partial auth state:

```json
{ "email": "<string>", "name": "<string>" }
```

`signUp(name, email)` updates `name` and `email`, clears tour/welcome keys, and marks authenticated.

There is **no password persistence** in `UserContext` today.

## User profile

### `User` (`context/UserContext.tsx`)

Fields:

- `id: string`
- `name: string`
- `email: string`
- `dob: string` (UI expects `YYYY-MM-DD` in `app/profile-edit.tsx`)
- `nationality: string` (selected from a fixed list in `profile-edit.tsx`)
- `kycStatus: "pending" | "verified" | "rejected"`

### Profile edit (`app/profile-edit.tsx`)

Server-side tables should treat **email changes** carefully (verification flow, uniqueness constraints).

## Rent tenancy details

### `RentDetails` (`context/UserContext.tsx`)

Fields:

- `propertyAddress: string`
- `monthlyRent: number` (GBP)
- `paymentDay: number` (day-of-month)
- `landlordName: string`
- `agentName: string`
- `tenancyEndDate: string` (date string)
- `landlordEmail?: string`
- `landlordPhone?: string`

These are displayed and used across reporting and landlord invite flows.

## Rent payments schedule

### `RentPayment`

Fields:

- `id: string`
- `amount: number`
- `dueDate: string`
- `paidDate: string | null`
- `status: "paid" | "due" | "overdue"`

Backend relevance: this is the canonical schedule if you move beyond mock monthly generation.

## Rent reporting (manual + open banking)

### Manual rent report (`app/report-rent-manual.tsx`)

User-entered fields captured into `RentReport` creation via `addRentReport`:

- `amount: number` (validated `> 0` and `<= 50000`)
- `paymentDate: string` (validated as `YYYY-MM-DD`, not in the future)
- `paymentMethod: string` (one of `PAYMENT_METHODS`)
- `reference?: string`
- `notes?: string`
- `source: "manual"`

### Open banking rent report (`app/report-rent-bank.tsx`)

Not real banking integration in code; it synthesizes transactions and creates `RentReport` rows with:

- `amount`, `paymentDate`, `paymentMethod: "Open Banking"`
- `reference: <txn id>`
- `notes: "Auto-detected via <bankName>: <description>"`
- `source: "open_banking"`

Backend relevance for real Open Banking:

- store **consents**, **connections**, **institution id**, **account identifiers**, **transaction ids**, provider timestamps, and verification status separately from `RentReport`.

### `RentReport`

Fields:

- `id: string`
- `amount: number`
- `paymentDate: string`
- `paymentMethod: string`
- `reference?: string`
- `notes?: string`
- `source: "manual" | "open_banking"`
- `status: "pending" | "verified" | "rejected"` (mock logic sets OB as verified immediately)
- `createdAt: string` (ISO timestamp)

## Passport / credit product state

### `PassportProfile`

Fields:

- `score: number` (0–100)
- `verificationLevel: "basic" | "standard" | "enhanced"`
- `openBankingVerified: boolean`
- `incomeVerified: boolean`
- `adminVerified: boolean`
- `shareToken: string | null` (public share link token)
- `completionSteps: { id, label, completed, points }[]`

### KYC (`app/kyc-selfie.tsx`)

UI references **Onfido** as a provider name in copy. No SDK integration exists in this repo snapshot.

Backend relevance:

- store provider (`onfido`), applicant ids, check results, document metadata, and audit timestamps (do **not** store raw images in primary OLTP unless required; use secure object storage).

## Rewards, streaks, missions

### `RewardsBalance`

- `groPoints: number`
- `cashbackEarned: number` (GBP)
- `streakDays: number` (also duplicated via `StreakState`)

### `StreakState`

- `current: number`
- `best: number`
- `lastCheckIn: string | null`
- `weekProgress: boolean[]`

### `DailyDropState`, `Mission`

These drive gamification UI.

Backend relevance:

- maintain immutable **ledger entries** for points/cashback rather than only totals.

### `RewardTransaction`

Fields:

- `id`, `type: "points" | "cashback" | "referral"`, `amount`, `partner`, `description`, `createdAt`

### `GiftCard` / redemption (`app/redeem-gift-card.tsx`)

Redeem flow selects:

- brand (`giftCards`), denomination (`denom` GBP `5–500`), toggles supercharge mode.

Persist as orders:

- `gift_card_orders(id, user_id, brand_id, amount_gbp, points_earned, cashback_components_json, status, created_at)`

## Bills switching

### `Bill`

Fields:

- `id`, `category`, `provider`, `monthlyCost`, `potentialSaving`
- `recommendedProvider`, `recommendedCost` (nullable)
- `switchStatus: "current" | "in_progress" | "switched"`

## Referrals

### `Referral`

Fields:

- `id`, `refereeName`, `status: "pending" | "completed"`, `rewardPaid`, `createdAt`

### Referral counters (`app/referrals.tsx`)

Reads `AsyncStorage` key:

- `gro_friends_joined` (number as string)

Backend relevance: replace with server-side referral attribution.

### Referral codes / links (`UserContext` provider values)

The UI exposes:

- `referralCode: string`
- `referralLink: string` (constructed URL in mock state)

## Deposit replacement

### `DepositReplacement`

Fields:

- `status: "not_started" | "eligible" | "active" | "declined"`
- `depositAmount`, `monthlyFee`, `annualFeeRate`
- `startedAt: string | null`
- `provider: string`

## Move planning

### `MovePlan`, `MovePlanItem`

`MovePlan` includes:

- `status`, `moveDate`, `newAddress`, items[], `cashbackEarned`, `estimatedSavings`

Persisted locally via AsyncStorage key `gro_move_plan` as JSON merged with defaults.

## Landlord verification invites

### `LandlordVerification`

Fields:

- `id`
- `paymentId`
- `invitedAt`
- `confirmedAt`
- `channel: "sms" | "email" | "link"`
- `landlordName`

Persisted locally via AsyncStorage key `gro_landlord_verifications`.

## Expert bookings (`app/expert-booking.tsx`)

Creates `ExpertBooking`:

- `expertId`, `expertName`, `category`
- `preferredTime: "morning" | "afternoon" | "evening" | "anytime"`
- `preferredWindow: "today" | "this_week" | "next_week"`
- `contactMethod: "phone" | "video"`
- `note?: string` (max length 240 in UI)
- `status`, `createdAt`

## Notifications (`NotificationItem`)

Fields:

- `id`, `title`, `body`
- `type: "rent" | "passport" | "rewards" | "promo" | "system"`
- `icon`, `timestamp`, `read: boolean`

Backend relevance: store per-device delivery separately from inbox records.

## Settings (`AppSettings`) (`app/settings.tsx`)

Fields:

- Push toggles: `pushRentReminders`, `pushPassportUpdates`, `pushRewards`, `pushPromos`
- Email toggle: `emailMonthlyStatement`
- `language: "en-GB" | "en-US"`

Persisted locally via AsyncStorage key `gro_settings`.

## Help & support (`app/help.tsx`)

Contact actions use mailto/tel URLs (not stored today).

Support form captures:

- `subject: string`
- `message: string`

Backend relevance: `support_tickets` table + spam/abuse controls.

## Withdrawals (`app/withdraw.tsx`)

User-entered:

- withdrawal `amount` (GBP) bounded by available cashback

Important: UI shows a masked bank descriptor (`Monzo Current ··· 4421`) but does not collect bank details here.

Backend relevance:

- store payout requests with bank account tokens from your PSP/banking partner, KYC status, and immutable ledger entries.

## Security screen (`app/security.tsx`)

All security switches and “sessions” are **local UI demo state** (not persisted in `UserContext`).

If implemented for real, typical backend tables:

- `user_security_preferences` (biometric/app lock flags as device-local mostly)
- `mfa_factors`, `login_events`, `sessions`/`refresh_tokens`

## AsyncStorage keys currently used (local persistence)

These indicate what the app treats as durable client-side state today:

- `gro_auth_user`: JSON `{ email, name }` (partial; does not include `dob`, `nationality`, `id`)
- `gro_settings`: JSON `AppSettings`
- `gro_tour_seen`: `"1"` when onboarding tour dismissed
- `gro_life_goal`: `"settling" | "saving_deposit" | "mortgage_ready"`
- `gro_move_plan`: JSON partial `MovePlan`
- `gro_landlord_verifications`: JSON array `LandlordVerification[]`
- `gro_welcome_claimed`: `"1"` after welcome bonus claimed
- `gro_friends_joined`: numeric string counter (`app/referrals.tsx`)

Backend implication: replace these with authenticated APIs; keep only device-specific preferences locally if needed.

## Suggested relational sketch (non-prescriptive)

This is a pragmatic normalization target based on the interfaces above:

- `users`
- `user_profiles` (PII: name, dob, nationality)
- `auth_passwords` / `oauth_accounts`
- `devices` / `push_tokens`
- `settings_notification`
- `rent_tenancies` / `rent_payment_schedule`
- `rent_reports`
- `open_banking_connections` / `open_banking_transactions` (if implemented)
- `passport_profiles` / `passport_steps`
- `ledger_transactions` (points + cashback + referrals)
- `gift_card_orders`
- `bills`
- `referrals`
- `deposit_replacement_policies`
- `move_plans` / `move_plan_items`
- `landlord_verifications`
- `expert_bookings`
- `notifications`
- `support_tickets`

## Privacy and compliance notes (high level)

Likely personal data appears in: profile (`dob`, `nationality`), landlord contacts (`landlordEmail`, `landlordPhone`), rent address, bank/open banking artifacts, KYC artifacts (if implemented).

Treat rent reporting and credit bureau reporting as **regulated workflows**: consent records, audit trails, data retention, and lawful bases should be modeled explicitly (outside this UI inventory).
