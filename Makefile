BASE_URL ?= http://localhost:8080
REGION ?= ap-south-1

.PHONY: setup up down logs test check build seed snapshot deploy-web deploy-api aws-up aws-down

setup:
	npm run setup

up:
	docker compose up -d --build
	@echo "web http://localhost:3000  api $(BASE_URL)/api/v1/health"

down:
	docker compose down

logs:
	docker compose logs -f api

test:
	npm test

check:
	BASE_URL=$(BASE_URL) node scripts/check.mjs

build:
	npm run build

# Recompute the expected values from the engine and diff them against data/expected.json.
seed:
	npm test -- tests/engine.test.ts tests/reconcile.test.ts

snapshot:
	npm test 2>&1 | tail -n 12 > docs/test-output.txt
	-BASE_URL=$(BASE_URL) node scripts/check.mjs >> docs/test-output.txt
	@echo "wrote docs/test-output.txt"

deploy-web:
	REGION=$(REGION) bash infra/deploy-web.sh

deploy-api:
	REGION=$(REGION) bash infra/deploy-api.sh

aws-up:
	REGION=$(REGION) bash infra/aws-up.sh

aws-down:
	REGION=$(REGION) bash infra/aws-down.sh
