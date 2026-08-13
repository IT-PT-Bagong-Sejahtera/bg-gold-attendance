.PHONY: dev down test test-go test-web migrate seed

dev:
	docker compose up --build

down:
	docker compose down

test: test-go test-web

test-go:
	cd backend && go test ./...

test-web:
	npm run typecheck && npm run test:admin && npm run test:mobile

seed:
	cd backend && go run ./cmd/seed
