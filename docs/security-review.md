# Security Review

## Trust boundaries

- Mobile and admin clients are untrusted. Organization, user, role, event time, policy resolution, and approval decisions are always derived by the API.
- MySQL is the system of record. Attendance events and audit rows are append-only at the application boundary; corrections create linked records.
- MinIO objects are private. The API creates non-guessable organization/purpose-prefixed keys, validates ownership before attendance or claim use, limits image uploads to 8 MB and JPEG/PNG/WebP, and enforces purpose-specific retention. A scheduled worker removes expired objects and marks metadata deleted; deleted evidence is rejected by all consumers.
- A JWT alone is insufficient: every authenticated request resolves its live refresh session, active user, active organization, and active membership from MySQL. Logout and refresh-token replay therefore invalidate access immediately.

## Implemented controls

- Short-lived HS256 access token and opaque rotating refresh token; refresh secrets are stored only as SHA-256 hashes.
- The mobile API client coordinates concurrent 401 responses behind one refresh operation, persists the rotated pair, and retries each request at most once. This prevents concurrent screen loads from replaying the old refresh token; failed renewal clears the local session.
- Refresh-token replay revokes the session family and is covered by an HTTP/MySQL integration test.
- Permission checks and organization scoping on employee, location, policy, shift, attachment, and attendance endpoints.
- Server-authoritative UTC event time, forced `+00:00` MySQL connection sessions, database transaction, locked attendance state, request hash, unique idempotency key, and exact replay response.
- `/me` returns the active organization's IANA timezone. Mobile and admin keep storage/transmission in UTC while formatting instants, grouping calendar dates, calculating query boundaries, and converting `datetime-local` fields in that organization timezone. Tests cover Jakarta, Makassar, and a daylight-saving zone.
- Direct client IP evidence, foreground device location, optional private selfie, short-lived face/liveness verification, and Google Play Integrity evidence bound to the exact attendance request.
- Mobile creates a random installation identifier in OS encrypted storage and sends it even from an Android Studio AVD or when notification permission is denied. MySQL stores only its SHA-256 hash. Attendance evidence links the returned device UUID only after the API validates active organization and user ownership.
- Play Integrity tokens are decrypted only by Google's API adapter. Package name and request hash must match, raw tokens are never stored, and only the mapped verdict plus deterministic risk score reaches attendance evidence.
- Wi-Fi access-point BSSIDs are normalized in memory and persisted only as SHA-256 hashes; policy matching is server-authoritative and SSID-only matches are rejected.
- Request size limits, strict JSON decoding, stable error codes, recovery middleware, request IDs, and structured access logs.
- Patched Go 1.25.12 toolchain and `golang.org/x/net` v0.53.0. `govulncheck ./...` reports zero reachable vulnerabilities.
- No application secrets in source control; runtime configuration rejects missing secrets and access secrets shorter than 32 bytes.

## Open risks before production

- Docker Compose v5.1.4 standalone (official checksum verified) successfully parses and interpolates the Compose model and enumerates MySQL, MinIO, Mailpit, API, and admin services. A Docker daemon is unavailable on this host, so full `compose up` remains a deployment-host smoke check. Equivalent live MySQL, current Community MinIO source, and Mailpit services were exercised directly.
- `npm audit --omit=dev` currently reports 16 advisories in the React Native/Expo dependency graph (10 high, 6 moderate, 0 critical). They are inherited through Expo/Metro, React Native CLI tooling, the `image-size` parser, `uuid`, and Expo's Xcode tooling. The proposed aggregate remediation crosses the installed Expo/React Native compatibility boundary, including suggested major-version changes, so it was not applied blindly. Metro must process only reviewed repository assets in CI while compatible upstream releases are evaluated.
- A live SMTP/Mailpit socket and current Community MinIO source build now pass password/invitation delivery and private claim upload/download/cleanup smoke tests. Production SMTP credentials, public TLS/proxy trust, rate limiting, secret management, and backup rehearsal remain deployment work.
- Live Google Play Integrity still requires Play Console linkage, provider credentials, and release-recognized package/signing evidence. Live FCM requires Firebase configuration/service-account credentials; the prepared API 36 Google Play AVD satisfies its Android runtime prerequisite, so a physical phone is optional for that check. The exact no-secret procedures are in `external-verification-runbook.md`. The FCM client intentionally registers Android native tokens only; iOS push requires a separate APNs/Firebase Messaging adapter before an iOS rollout.
- Dynamic QR tokens use a dedicated configurable HMAC-SHA256 signing key, bind organization and active section, expire after 45 seconds, and store a unique nonce-plus-membership consumption in the same transaction as attendance. A displayed outlet code remains usable by multiple employees but not twice by the same employee.
- The mobile attendance outbox is persisted per organization and membership, reuses the original idempotency key, and stops automatic retry after a permanent server rejection so conflicting actions require human review. Device-level encryption still depends on the operating system's application-storage protection.
- Add database backup/restore rehearsal, MinIO lifecycle enforcement, key rotation, centralized secret management, and an external penetration review before rollout.

## Verification commands

```text
go test ./...
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
npm run typecheck
npm run test:admin
npm run test:mobile
npm run build:admin
npx expo install --check
npx expo export --platform android
```
