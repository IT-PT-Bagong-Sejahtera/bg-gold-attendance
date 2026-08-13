#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "File .env belum ada. Salin .env.example lalu isi konfigurasi server." >&2
  exit 1
fi

if grep -Eiq 'CHANGE_ME|replace-with|example\.com|your-domain' .env; then
  echo "Deployment dihentikan: masih ada placeholder di .env." >&2
  exit 1
fi

docker compose config --quiet
docker compose --profile tools run --rm --no-deps config-check
docker compose up -d mysql minio
docker compose --profile tools run --rm migrate
docker compose up -d --build api

echo "Backend aktif. Periksa: http://127.0.0.1:${API_HOST_PORT:-8080}/health"
