# Architecture

## Decision

BG GOLD Attendance starts as a modular monolith. It has three deployable applications and shared contracts:

- `apps/mobile`: React Native + strict TypeScript.
- `apps/admin`: React + strict TypeScript.
- `backend`: standalone Go REST API, database migrations, and background workers.
- Password recovery uses a provider-independent SMTP boundary with optional STARTTLS. Production startup requires SMTP sender and reset-link configuration; local Compose includes Mailpit for safe inspection.
- MySQL 8/InnoDB: transactional source of truth.
- MinIO/S3: private evidence objects.
- Firebase Cloud Messaging: push delivery only.

The mobile and admin clients never contain authoritative attendance rules. They render policy and collect evidence; Go validates and commits outcomes using server time.

## Backend modules

`auth`, `organizations`, `users`, `employees`, `roles`, `sections`, `attendance-policies`, `schedules`, `shifts`, `attendance`, `breaks`, `approvals`, `timesheets`, `leave`, `claims`, `announcements`, `notifications`, `files`, `devices`, `reports`, and `audit` remain package boundaries inside one Go binary.

Dependencies point inward: transport -> application service -> domain -> repository interface. MySQL, object storage, FCM, and Play Integrity are adapters.

## Request security

- Short-lived access tokens carry user and active organization identifiers.
- Refresh tokens are opaque random values stored only as hashes and rotated at every use.
- Middleware authenticates first, resolves active membership second, then checks explicit permission.
- Every organization-owned query includes `organization_id`; repository methods do not expose unscoped list operations.
- Mutation requests use transactions and append an audit event in the same transaction.

## Attendance consistency

`attendance_events` is append-only. An event records the server timestamp, action, resolved policy, evidence summary, decision, and actor. A per-user current-state row is locked during submission to prevent simultaneous actions. `idempotency_keys` stores the request fingerprint and serialized response so safe retries return the first result.

Auto clock-out runs as a database-backed worker. A unique source key prevents duplicate automatic events.

## Files

Clients request a short-lived upload intent. The API creates a pending attachment record and a scoped object key. The client uploads directly to MinIO/S3, then finalizes the attachment. Attendance submission accepts only finalized objects owned by the same user and organization. Objects are private and retention is policy-driven.

## Mobile platform boundary

React Native owns navigation, forms, state, caching, and presentation. Native modules are reserved for platform-specific integrity, Wi-Fi evidence, and capabilities not safely exposed by maintained React Native libraries. Foreground location is requested only during relevant attendance actions.

## Observability

The API emits JSON logs with request ID, actor ID, organization ID, route, status, latency, and stable error code. Secrets, tokens, raw biometric data, and exact coordinates are excluded from general logs.

## Design system

The existing BG GOLD logo is the visual source. UI tokens use warm ivory, espresso-charcoal, restrained champagne gold, deep emerald, and muted ruby. Gold is an accent rather than a large background treatment. Interfaces use clear editorial hierarchy, restrained radii, thin borders, and functional motion. The existing raster logo will be copied into each client; it must not be modified destructively.
