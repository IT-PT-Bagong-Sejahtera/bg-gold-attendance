# BG GOLD Attendance Backend

Backend mandiri untuk aplikasi Absen BG. Folder ini dapat dibuka, diuji, dibangun, dan dijalankan tanpa masuk ke folder mobile atau admin.

## Struktur

```text
backend/
├── cmd/              # command tambahan, termasuk database seeder
├── common/           # response JSON, error, dan request context
├── config/           # pembacaan serta validasi environment
├── controllers/      # HTTP handlers dan orkestrasi endpoint
├── database/         # koneksi MySQL dan entry point migrasi
├── documentation/    # OpenAPI dan catatan arsitektur
├── helpers/          # helper kecil yang dapat digunakan ulang
├── logs/             # output log lokal (tidak masuk Git)
├── middlewares/      # CORS, recovery, request ID, access log
├── migrations/       # migrasi SQL berurutan dan embedded runner
├── models/           # dokumentasi model/domain lintas fitur
├── routes/           # dokumentasi registry route API
├── scripts/          # script build dan verifikasi
├── services/         # attendance, auth, dan email service
├── uploads/          # file lokal sementara (bukti asli ada di MinIO)
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── go.mod
├── go.sum
└── main.go
```

## Menjalankan dengan Docker

1. Buka `.env` yang sudah disediakan dan ganti seluruh nilai `CHANGE_ME`.
2. Atur domain admin pada `CORS_ALLOWED_ORIGINS` serta SMTP server.
3. Validasi dengan `./scripts/check-env.sh` atau `./scripts/check-env.ps1`.
4. Jalankan `./scripts/deploy.sh` di Linux atau `./scripts/deploy.ps1` di PowerShell.
5. Isi akun Superadmin awal satu kali dengan `docker compose --profile tools run --rm seed`.
6. Periksa `http://localhost:8080/health` atau domain API melalui reverse proxy.

MySQL memakai port host `3307`, MinIO API `9000`, MinIO Console `9001`, Mailpit `8025`, dan Go API `8080` secara default. Semua dapat diganti melalui `.env`.

MySQL dan MinIO secara default hanya bind ke `127.0.0.1`; API bind ke `0.0.0.0`. Gunakan Nginx/Caddy/Traefik untuk HTTPS dan jangan membuka port database atau MinIO ke internet.

## Hierarki pendaftaran akun

- `OWNER` ditampilkan sebagai **Superadmin** dan hanya dibuat oleh seeder dari `SEED_SUPERADMIN_EMAIL` serta `SEED_SUPERADMIN_PASSWORD`.
- Superadmin dapat membuat akun `SUPERVISOR` atau `EMPLOYEE` beserta kata sandi awalnya.
- Supervisor dapat membuat akun `EMPLOYEE`, tetapi API menolak pembuatan supervisor atau Superadmin.
- Sistem menolak pembuatan akun `OWNER` kedua dari endpoint karyawan.

## Migrasi database

Terdapat 16 migrasi SQL versioned di folder `migrations`. Migrasi aman dijalankan berulang karena versi yang sudah tercatat pada tabel `schema_migrations` akan dilewati.

- Otomatis: API menjalankan migrasi sebelum mulai menerima request.
- Manual Docker: `docker compose --profile tools run --rm migrate`.
- Script Linux: `./scripts/migrate.sh`.
- Script PowerShell: `./scripts/migrate.ps1`.

Untuk deployment, script `deploy` menyalakan MySQL/MinIO, menjalankan migrasi, lalu menyalakan API. Script akan berhenti bila `.env` masih berisi placeholder.

Validasi lengkap `.env` juga tersedia melalui `docker compose --profile tools run --rm --no-deps config-check`. Nilai secret tidak pernah dicetak.

Runner memakai MySQL advisory lock agar dua instance tidak menjalankan migrasi bersamaan. Tetap lakukan backup volume MySQL dan MinIO sebelum upgrade production.

## Menjalankan tanpa container API

MySQL dan MinIO tetap harus tersedia sesuai `.env`.

```powershell
go run .
go run ./cmd/seed
```

## Verifikasi

```powershell
go test ./...
go build ./...
```

Kontrak API tersedia di `documentation/openapi.yaml`, sedangkan contoh request tersedia di `postman_collection.json`.

Jangan commit `.env`, credential, file biometric, token Firebase, log produksi, atau isi upload pengguna.
