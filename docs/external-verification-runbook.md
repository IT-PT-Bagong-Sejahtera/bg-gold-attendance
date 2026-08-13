# External verification runbook

Three parity checks require vendor state or physical hardware and cannot be truthfully simulated by the local test suite. Do not commit any file referenced below.

## Android Firebase Cloud Messaging

Prerequisites:

- Firebase Android app package `com.bggold.attendance`.
- `google-services.json` stored outside the repository.
- Google service-account JSON with permission to send Firebase Cloud Messaging messages.
- An Android 6.0+ device with Google Play Store, or an Android emulator with Google APIs/Google Play services. The prepared API 36 Play Store AVD meets this runtime prerequisite.

Firebase documents the device/emulator prerequisite in its [Android FCM setup guide](https://firebase.google.com/docs/cloud-messaging/android/get-started).

Set these values only in the local shell or secret manager:

```text
GOOGLE_SERVICES_JSON=C:\secure\bg-gold\google-services.json
FCM_PROJECT_ID=<firebase-project-id>
FCM_SERVICE_ACCOUNT_FILE=C:\secure\bg-gold\firebase-service-account.json
```

Verification:

1. Prebuild/install the Android app and grant notifications.
2. Sign in; confirm one active `ANDROID` device registration is created and the token is never logged.
3. Publish an announcement targeted to that employee.
4. Run/wait for the notification outbox worker.
5. Confirm a foreground banner and a background/system-tray notification arrive, then open the app and confirm the unread badge/inbox state.
6. Revoke the device registration, publish another announcement, and confirm delivery no longer occurs.

Record Firebase message ID, device model/Android version, app build SHA, timestamp, and the corresponding notification/outbox IDs. Do not record the registration token.

The provider-acceptance half can also be run without printing the device token:

```text
TEST_FCM_PROJECT_ID=<project-id>
TEST_FCM_SERVICE_ACCOUNT_FILE=C:\secure\bg-gold\firebase-service-account.json
TEST_FCM_DEVICE_TOKEN=<test-device-token>
go test ./controllers -run TestLiveFCMDeliveryAcceptedByFirebase -count=1 -v
```

Run it from `backend`, confirm the matching timestamp marker on the device, then clear `TEST_FCM_DEVICE_TOKEN` from the shell.

## Google Play Integrity

Prerequisites:

- Package `com.bggold.attendance` linked in Play Console and Play Integrity enabled.
- Numeric Google Cloud project number for the Android Standard API request.
- Service-account JSON allowed to decode Play Integrity tokens.
- A Play-distributed internal-test build installed on a physical certified Android device. A sideloaded debug build is not valid release evidence.

Use Google's [Play Integrity setup and verdict definitions](https://developer.android.com/google/play/integrity/setup) when preparing the linked package, certificate, cloud project, and release evidence.

Set:

```text
PLAY_INTEGRITY_PACKAGE_NAME=com.bggold.attendance
PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER=<numeric-project-number>
PLAY_INTEGRITY_SERVICE_ACCOUNT_FILE=C:\secure\bg-gold\play-integrity-service-account.json
```

Verification:

1. Assign a `DEVICE_INTEGRITY` policy to the test employee.
2. Clock in on the certified device; confirm accepted package/request-hash binding and stored mapped verdict/risk score.
3. Repeat with a deliberately altered request hash and confirm rejection.
4. Exercise policy fail-open and fail-closed behavior while the Google decode endpoint is unavailable.
5. Query the attendance evidence and logs to confirm the raw integrity token is absent.

Record Play release track/version code, device certification verdict, policy ID/version, attendance event ID, and timestamp. Never record the raw token or service-account contents.

For a one-use provider decode smoke, place the short-lived token and its exact request hash in process environment only, then run from `backend`:

```text
TEST_PLAY_INTEGRITY_PACKAGE_NAME=com.bggold.attendance
TEST_PLAY_INTEGRITY_SERVICE_ACCOUNT_FILE=C:\secure\bg-gold\play-integrity-service-account.json
TEST_PLAY_INTEGRITY_TOKEN=<one-use-token>
TEST_PLAY_INTEGRITY_REQUEST_HASH=<exact-bound-request-hash>
go test ./controllers -run TestLivePlayIntegrityTokenDecode -count=1 -v
```

Clear both token/hash variables immediately afterward. The test output contains mapped verdicts and provider timestamp only, never the raw token.

## Accessibility sign-off

The API 36 Android emulator pass is recorded in `docs/android-emulator-verification.md`. It covers real login/clock-in/out, TalkBack binding and keyboard activation, semantic tab order, and 200% mobile font scaling. The rendered admin reflow/focus pass is recorded in `docs/admin-browser-verification.md`. Do not repeat those mechanical checks unless the affected UI changes.

Follow the physical-device and browser checklist in `docs/accessibility-audit.md`. At minimum, record:

- TalkBack device/Android version and VoiceOver device/iOS version.
- 200% font scaling/zoom results.
- Chrome and Firefox keyboard-only traversal results at 320 px and desktop widths.
- Any issue ID, WCAG criterion, severity, reproduction steps, and screenshot/video evidence location.

Only change the remaining parity-matrix rows from **Implemented** to **Verified** after the vendor and human/platform evidence above is attached to the release record.
