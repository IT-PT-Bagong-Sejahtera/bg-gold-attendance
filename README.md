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
3. Run `docker compose --profile tools run --rm seed` after setting `SEED_SUPERADMIN_EMAIL` and `SEED_SUPERADMIN_PASSWORD` (minimum 8 characters). This creates the single BG GOLD Superadmin account.
4. Open the admin application at `http://localhost:5173` and API health at `http://localhost:8080/health`.

The mobile and admin builds use `https://attendanceapi.bggold.cloud/api/v1`. Containerized Metro remains available through `http://10.0.2.2:8081` for emulator development. Build/install the native Android shell from Android Studio or use the standalone APK; Compose owns Metro and backend services, not the emulator itself.

## Android demo without MySQL

The mobile login includes **Demo karyawan** and **Demo supervisor**. Neither requires the Go API, MySQL, MinIO, an account, or internet access. Mode satu HP diaktifkan oleh supervisor dari **Profil → Mode 1 HP**, sama seperti alur produksi.

- The demo session is kept in Android/iOS secure storage.
- Sample schedules, attendance state/history, open-shift requests, leave, claims, announcements, and notification state are kept in app-local storage.
- Clock-in/out, breaks, work-more, leave/claim submission and withdrawal remain interactive across app restarts.
- **Mode 1 HP** mengikat instalasi Android ke satu Master Showroom, bukan ke satu karyawan. Setiap karyawan memilih nama/nomor, memasukkan PIN pribadi (demo: `123456`), mengambil foto, lalu clock-in/out. Setelah berhasil, kiosk otomatis kembali ke daftar karyawan berikutnya.
- The supervisor demo opens the **Setujui** tab with sample attendance, leave, claim, and open-shift requests. Approve/reject decisions are saved locally across app restarts and remain visible under **Disetujui**. Attendance evidence can be opened from both the approval queue and attendance result.
- The supervisor **Hadir** tab lists event/shift participants and can publish a new shift to selected employees.
- Inside **Setujui → Hasil absensi**, supervisors can review the attendance result for every demo employee and export a formatted `.xlsx` workbook with **Ringkasan** and **Semua Karyawan** sheets through Android's save/share dialog. Choose **Files → Download** in that dialog to keep it in Android's Download folder; the pre-share copy is only temporary app cache.
- Demo uploads are simulated locally and never transmit the selected image.
- A clear banner identifies demo mode; Profile offers **Reset data demo** and **Keluar dari demo**.
- Normal email/password login is unchanged and continues to use the production-style REST API when infrastructure is available.

For Android Studio, start an AVD and run `npm --workspace @bg-gold/mobile run android`. A standalone test APK is also produced as `apps/mobile/android/app/build/outputs/apk/release/Absen BG.apk`; it runs without Metro. Untuk mencoba kiosk, pilih **Demo supervisor**, buka **Profil**, pilih Master Showroom, lalu tekan **Aktifkan mode kiosk**.

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
