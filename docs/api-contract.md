# REST API Contract

Base path: `/api/v1`. JSON timestamps are RFC 3339 UTC. Errors use a stable `code`, human `message`, `requestId`, and optional field details.

## Authentication

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `GET /me`
- `GET /me/organizations`
- `POST /me/active-organization`

Refresh rotates both tokens. Reuse of an already-rotated refresh token revokes its token family.

`POST /me/active-organization` requires an active membership, rotates the refresh token, and returns a new organization-scoped token pair. The prior access token becomes invalid immediately because the live session resolver must match the active organization.

`GET /me` includes the active organization's IANA `timezone` (for example, `Asia/Jakarta`). Clients use that value for every visible instant, calendar grouping, query-period boundary, `datetime-local` conversion, and current-year default. Stored and transmitted timestamps remain UTC.

Password reset tokens expire after 30 minutes, are stored only as SHA-256 hashes, become invalid after one use, and revoke all existing sessions after a successful reset. Responses to the forgot-password endpoint do not reveal whether an email exists. In local/test environments only, the response includes `developmentResetToken`; production still requires an outbound email delivery adapter before this flow can be considered verified.

## Organizations and people

- `GET /me/organizations`
- `POST /me/active-organization`
- `GET|POST /employees`
- `POST /employees/{employeeId}/activate`
- `POST /employees/{employeeId}/deactivate`
- `GET|POST /sections`

Employee, section, and all other protected resources infer organization scope exclusively from the live access session. Deactivation revokes sessions whose active organization matches the deactivated membership; another active organization membership remains intact.

## Policies and schedules

- `GET|POST /policies`
- `PATCH /policies/{policyId}`
- `POST /policies/{policyId}/archive`
- `GET /me/attendance-policy?sectionId=...`
- `GET /me/shifts?from=...&to=...`
- `GET|POST /shifts`

Policy creation accepts at most one `sectionId` or `membershipId`; omitting both creates the organization default. A new assignment closes the previous assignment at the same scope atomically, and resolution prioritizes employee, then section, then organization with newest effective assignment winning.

Updating an active policy increments its version and preserves omitted mode settings, so a timing-only edit cannot erase hashed Wi-Fi configuration. Replacing modes validates each new mode and retains existing settings where safe. Archiving is idempotent, closes all current assignments in the same transaction, and leaves immutable attendance policy snapshots untouched. Both operations write audit records.

## File evidence

- `POST /files/upload-intents`
- `POST /files/{attachmentId}/finalize`
- `DELETE /files/{attachmentId}` only before attachment use

## Attendance

- `GET /me/attendance/today`
- `GET /me/attendance/history?from=...&to=...&cursor=...`
- `POST /attendance/actions`
- `GET /me/requests`
- `GET /attendance/requests?status=PENDING|APPROVED|REJECTED|WITHDRAWN`
- `GET /attendance/records?from=...&to=...&membershipId=...`
- `POST /attendance/requests/{requestId}/decision`
- `POST /attendance/corrections`

The current approval endpoint accepts `APPROVED` or `REJECTED`; a rejection requires a reason. Decisions and corrections are appended, while the original attendance event remains immutable. Manager records return the effective approval decision and latest linked correction while retaining the original event ID.

Attendance history uses stable keyset pagination ordered by server timestamp and event UUID. A page may return an opaque top-level `nextCursor`; clients pass it unchanged on the next request. Invalid or tampered cursors return `400 INVALID_CURSOR`, and equal-timestamp events cannot duplicate across pages.

`POST /attendance/actions` accepts `CLOCK_IN`, `CLOCK_OUT`, `START_BREAK`, `END_BREAK`, and `WORK_MORE`. The required `Idempotency-Key` header scopes retries to the authenticated user.

Example request:

```json
{
  "type": "CLOCK_IN",
  "shiftId": "optional-uuid",
  "sectionId": "optional-uuid",
  "reason": null,
  "evidence": {
    "location": {
      "latitude": -7.2575,
      "longitude": 112.7521,
      "accuracyMeters": 18.4,
      "capturedAt": "2026-08-11T01:15:00Z"
    },
    "attachmentId": "optional-selfie-uuid",
    "dynamicQrToken": null,
    "wifi": null,
    "integrityToken": null,
    "faceVerificationId": null,
    "deviceId": "registered-device-uuid"
  }
}
```

Example approved response:

```json
{
  "data": {
    "actionId": "uuid",
    "decision": "APPROVED",
    "attendanceState": "WORKING",
    "recordedAt": "2026-08-11T01:15:04.321Z",
    "message": "Clock-in berhasil dicatat."
  },
  "requestId": "uuid"
}
```

Stable rejection codes include `INVALID_ATTENDANCE_STATE`, `OUTSIDE_GEOFENCE`, `LOCATION_ACCURACY_TOO_LOW`, `QR_INVALID`, `QR_EXPIRED`, `QR_ALREADY_USED`, `WIFI_REQUIRED`, `WIFI_MISMATCH`, `SELFIE_REQUIRED`, `FACE_VERIFICATION_REQUIRED`, `FACE_VERIFICATION_INVALID`, `DEVICE_INVALID`, `DEVICE_INTEGRITY_REQUIRED`, `DEVICE_INTEGRITY_FAILED`, `DEVICE_INTEGRITY_UNAVAILABLE`, and `OUTSIDE_TIME_WINDOW`.

Wi-Fi policies accept one or more `{ssid,bssid}` access points in `wifiNetworks`. BSSIDs are normalized and stored only as SHA-256 hashes inside policy settings and attendance evidence. A Wi-Fi clock action must contain the current SSID and BSSID; missing evidence returns `WIFI_REQUIRED`, while a non-matching network returns `WIFI_MISMATCH`. Mobile Wi-Fi evidence uses a native development/production build because Expo Go cannot load the required native Wi-Fi module.

Dynamic QR codes are issued with `POST /sections/{sectionId}/dynamic-qr` to users with organization attendance visibility. Each HMAC-signed token is bound to its organization and active section and expires after 45 seconds. A unique nonce-plus-membership consumption is recorded atomically with the first successful `CLOCK_IN`, `CLOCK_OUT`, or `WORK_MORE`, allowing the same displayed outlet code to serve multiple employees while blocking reuse by the same employee. An idempotent replay of the original attendance request returns its stored result.

Face verification uses `POST /attachments/face-image`, `POST /me/face/enroll`, and `POST /me/face/verify`. The provider adapter returns similarity and liveness results; both must meet the configured threshold. Successful verifications expire after five minutes and are validated against the active organization and membership before their ID can be linked to attendance evidence.

`DEVICE_INTEGRITY` policies accept `integrityFailClosed` and `maxRiskScore`. The Android client hashes the organization, user, membership, idempotency key, and action, then passes that digest as the Play Integrity `requestHash`. The API decrypts the token through Google, rejects a mismatched package or request hash, maps app/licensing/device/activity signals into a deterministic 0–100 risk score, and persists only the verdict—not the encrypted client token. A fail-open policy records provider unavailability explicitly; fail-closed returns `503 DEVICE_INTEGRITY_UNAVAILABLE`.

## Leave

- `GET|POST /leave-types`
- `POST /leave-balances`
- `GET /me/leave-balances?year=...`
- `GET|POST /me/leave-requests`
- `POST /me/leave-requests/{requestId}/withdraw`
- `GET /leave-requests?status=PENDING|APPROVED|REJECTED|WITHDRAWN`
- `POST /leave-requests/{requestId}/decision`

Leave requests count weekdays, split balance reservations by calendar year, and reject overlapping active requests. Submission atomically moves days into `pending_days`; approval moves them to `used_days`; rejection or employee withdrawal releases them. A rejection requires a reason, and every type, balance, withdrawal, and decision mutation writes an organization-scoped audit record.

## Later parity groups

- `/reports/attendance.csv`, `/reports/timesheets.csv` return Excel-friendly UTF-8 CSV and require `report.read`.

The OpenAPI document in `backend/documentation/openapi.yaml` becomes the machine-readable authority as endpoints are implemented.

## Claims

- `GET|POST /claim-types`
- `POST /attachments/claim-receipt`
- `GET|POST /me/claims`
- `POST /me/claims/{claimId}/withdraw`
- `GET /claims?status=PENDING|APPROVED|REJECTED|WITHDRAWN`
- `POST /claims/{claimId}/decision`
- `GET /claims/{claimId}/receipt-url`

Claim receipts are private JPEG/PNG/WebP objects, limited to 8 MB and retained for seven years. A receipt can be used by one claim only and must belong to the submitting user and organization. Owners and authorized reviewers receive a five-minute signed read URL. OCR state is persisted truthfully as `NOT_CONFIGURED`, `PENDING`, `COMPLETE`, or `FAILED`. When `OCR_ENDPOINT` is configured, the provider-neutral gateway receives only a five-minute signed object URL and returns structured merchant, total, currency, transaction date, confidence, and provider reference fields. Raw receipt text and provider credentials are never returned to clients or written into audit metadata; OCR failure leaves the claim available for manual review.

## Announcements and notifications

- `POST /announcements`
- `GET /me/announcements`
- `POST /me/announcements/{announcementId}/receipt`
- `GET /me/notifications`
- `GET /me/notifications/unread-count`
- `POST /me/notifications/{notificationId}/read`
- `POST /me/devices`
- `DELETE /me/devices/{deviceId}`

Announcements support all-member, role, and section audiences, priority, expiry, and compulsory acknowledgment. Publishing resolves recipients and creates announcement receipts, inbox notifications, and push outbox rows in one database transaction. The outbox worker delivers native device tokens through FCM HTTP v1, retries failures with bounded exponential backoff, and leaves inbox delivery intact when FCM is not configured. `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_FILE` must be configured together.

`POST /me/devices` always accepts a stable random `installationId`; `pushToken` is optional. This keeps Android Studio AVDs and phones with denied notification permission identifiable without pretending they can receive push. The API stores only the installation SHA-256 hash, returns the organization/user-scoped device UUID, and accepts that UUID in attendance `evidence.deviceId`. Attendance rejects revoked, foreign-organization, or foreign-user IDs with `DEVICE_INVALID`.

## Audit

- `GET /audit-logs?from=...&to=...&action=...&resourceType=...&actorUserId=...&cursor=...`

Audit reads require `audit.read`, are always scoped to the active organization, and use the same stable timestamp-plus-UUID cursor pattern as attendance history. Records expose the actor, action, resource reference, safe metadata, request ID, and server timestamp; source business records are never mutated by this endpoint.
