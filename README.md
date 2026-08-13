# BG GOLD Attendance

BG GOLD Attendance is a clean-room workforce and attendance platform inspired by observed workforce-management behavior, with original BG GOLD code and design.

The Go API is self-contained under [`backend`](backend/README.md), including its own Docker Compose file, environment template, migrations, OpenAPI documentation, and verification scripts.

## Stack

- React Native + TypeScript mobile application
- React + TypeScript administration application
- Go modular-monolith REST API
- MySQL 8/InnoDB
- MinIO/S3-compatible private evidence storage
- Firebase Cloud Messaging integration boundary

## Local setup

1. Copy `.env.example` to `.env` and replace every secret placeholder.
2. Run `docker compose up --build`. This starts MySQL, MinIO, Go API, admin, and the React Native Metro service on port `8081`.
3. Run `docker compose --profile tools run --rm seed` after setting `SEED_ADMIN_EMAIL` and a seed password of at least 12 characters.
4. Open the admin application at `http://localhost:5173` and API health at `http://localhost:8080/health`.

The Android emulator reaches the host API through `http://10.0.2.2:8080/api/v1` and containerized Metro through `http://10.0.2.2:8081`. Build/install the native Android shell from Android Studio or use the standalone APK; Compose owns Metro and backend services, not the emulator itself. A physical device must use the development machine's reachable LAN address.

## Android demo without MySQL

The mobile login includes **Demo karyawan**, **Demo supervisor**, and **Demo 2 · Satu HP** entry points. None requires the Go API, MySQL, MinIO, an account, or internet access.

- The demo session is kept in Android/iOS secure storage.
- Sample schedules, attendance state/history, open-shift requests, leave, claims, announcements, and notification state are kept in app-local storage.
- Clock-in/out, breaks, work-more, leave/claim submission and withdrawal remain interactive across app restarts.
- **Demo 2 · Satu HP** demonstrates a complete daily attendance flow: the front camera opens automatically, photo and employee name are required, organization time is always visible, and the employee chooses Flagship, Warehouse, or event location. The local installation is bound after clock-in; the same name and HP can clock-out, while a second clock-in on the same organization day remains blocked.
- The supervisor demo opens the **Setujui** tab with sample attendance, leave, claim, and open-shift requests. Approve/reject decisions are saved locally across app restarts and remain visible under **Disetujui**. Attendance evidence can be opened from both the approval queue and attendance result.
- The supervisor **Hadir** tab lists event/shift participants and can publish a new shift to selected employees.
- Inside **Setujui → Hasil absensi**, supervisors can review the attendance result for every demo employee and export a formatted `.xlsx` workbook with **Ringkasan** and **Semua Karyawan** sheets through Android's save/share dialog. Choose **Files → Download** in that dialog to keep it in Android's Download folder; the pre-share copy is only temporary app cache.
- Demo uploads are simulated locally and never transmit the selected image.
- A clear banner identifies demo mode; Profile offers **Reset data demo** and **Keluar dari demo**.
- Normal email/password login is unchanged and continues to use the production-style REST API when infrastructure is available.

For Android Studio, start an AVD and run `npm --workspace @bg-gold/mobile run android`. A standalone test APK is also produced as `apps/mobile/android/app/build/outputs/apk/release/Absen BG.apk`; it runs all three demos without Metro. Choose **Demo 2 · Satu HP** for the photo-and-name flow or **Demo supervisor** for team approvals—no database setup is needed.

## Development without containers

- API: `cd backend && go run .`
- Admin: `npm install && npm run dev:admin`
- Mobile: `npm install && npm run dev:mobile`

MySQL and MinIO must be reachable using the configured environment variables. Database migrations run at API startup and are version-locked.

## Verification

- Go: `cd backend && go test ./...`
- TypeScript: `npm run typecheck`
- Admin tests: `npm run test:admin`
- Mobile tests: `npm run test:mobile`
- Compose model without starting services: `docker-compose -f compose.yaml config --quiet`

See [functional parity](docs/functional-parity-matrix.md) and [roadmap](docs/implementation-roadmap.md) for authoritative delivery status.
The current trust boundaries, dependency findings, and production blockers are recorded in [security review](docs/security-review.md).
Vendor/device sign-off steps are recorded in [external verification](docs/external-verification-runbook.md).

## Security notes

Never commit `.env`, passwords, signing keys, Firebase credentials, biometric data, or production endpoints. Attendance time is assigned by the API. Corrections append new records instead of overwriting history.
