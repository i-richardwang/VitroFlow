.PHONY: check check-python check-web check-image check-reference check-s3

check: check-python check-web

check-python:
	uv run ruff check src tests scripts
	uv run ruff format --check src tests scripts
	uv run pyright
	uv run pytest

check-web:
	cd web && bun run format:check
	cd web && bunx tsc --noEmit
	cd web && bun test
	cd web && bun run build

check-image:
	@test -n "$(HEROUI_KEY)" || (echo "Set HEROUI_KEY" >&2; exit 2)
	docker build --secret id=heroui_key,env=HEROUI_KEY --file Dockerfile.web --tag vitroflow-web:check .

check-reference:
	@test -n "$(REFERENCE_IMAGE_DIR)" || (echo "Set REFERENCE_IMAGE_DIR to the reference photograph directory" >&2; exit 2)
	VITROFLOW_REFERENCE_IMAGE_DIR="$(REFERENCE_IMAGE_DIR)" uv run pytest --override-ini addopts='' -m reference tests/test_regression.py

check-s3:
	@test -n "$(VITROFLOW_TEST_S3_ENDPOINT)" || (echo "Set VITROFLOW_TEST_S3_ENDPOINT" >&2; exit 2)
	@test -n "$(VITROFLOW_TEST_S3_BUCKET)" || (echo "Set VITROFLOW_TEST_S3_BUCKET" >&2; exit 2)
	cd web && VITROFLOW_REQUIRE_S3_CONTRACT=1 bun test src/server/blobs.test.ts
