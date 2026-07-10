.PHONY: help env env-remote install get-models optimize-models \
       dev-local dev-api dev-auth dev-studio \
       dev-docker prod down build logs \
       db-upgrade data-migrate migrate reset-db clean

# Pick the first env file that exists. Lets users keep working with the
# legacy split .env.local / .env.prod files, but falls back to a single
# .env (current convention) and finally .env.example for first-time setup.
LOCAL_ENV := $(firstword $(wildcard .env.local) $(wildcard .env) $(wildcard .env.example))
PROD_ENV  := $(firstword $(wildcard .env.prod)  $(wildcard .env) $(wildcard .env.example))

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ── Setup ────────────────────────────────────────────────────────────────────

env: ## Interactive setup — creates .env.local + .env.prod (or use a single .env)
	@bash scripts/setup-env.sh

env-remote: ## Setup with remote SSH port scan (SSH_HOST=user@server make env-remote)
	@SSH_HOST="$${SSH_HOST}" bash scripts/setup-env.sh

install: ## Create venvs and install Python dependencies
	@echo "Installing API dependencies..."
	@cd api && python3 -m venv .venv && . .venv/bin/activate && pip install -q -r requirements.txt
	@echo "Installing Auth dependencies..."
	@cd auth && python3 -m venv .venv && . .venv/bin/activate && pip install -q -r requirements.txt
	@echo "Done."

get-models: ## Check/download/extract ML models (auto-runs on API start too)
	@set -a && . $(LOCAL_ENV) && set +a && \
	. api/.venv/bin/activate && python3 -m api.src.download_model

optimize-models: ## Convert models to ONNX + INT16 (CLIP) for production
	@set -a && . $(LOCAL_ENV) && set +a && \
	. api/.venv/bin/activate && python3 -m api.src.optimize_models

# ── Local Development (SQLite, no Docker) ────────────────────────────────────

dev-local: ## Run all services locally (uses .env.local, .env, or .env.example)
	@set -a && . $(LOCAL_ENV) && set +a && \
	mkdir -p db/data && \
	API_PID="" AUTH_PID="" STUDIO_PID="" ; \
	cleanup() { \
		echo "" ; echo "Shutting down..." ; \
		[ -n "$$API_PID" ] && kill $$API_PID 2>/dev/null ; \
		[ -n "$$AUTH_PID" ] && kill $$AUTH_PID 2>/dev/null ; \
		[ -n "$$STUDIO_PID" ] && kill $$STUDIO_PID 2>/dev/null ; \
		wait 2>/dev/null ; \
		echo "Done." ; \
	} ; \
	trap cleanup EXIT INT TERM ; \
	(. auth/.venv/bin/activate && uvicorn auth.src.main:app --reload --host $${API_HOST:-0.0.0.0} --port $${AUTH_PORT:-8001}) & AUTH_PID=$$! ; \
	(. api/.venv/bin/activate && uvicorn api.src.main:app --reload --host $${API_HOST:-0.0.0.0} --port $${API_PORT:-8000}) & API_PID=$$! ; \
	(cd studio && corepack enable && yarn install && yarn dev --hostname 0.0.0.0 --port $${STUDIO_PORT:-3000}) & STUDIO_PID=$$! ; \
	wait

dev-api: ## Run only API locally
	@set -a && . $(LOCAL_ENV) && set +a && \
	. api/.venv/bin/activate && \
	uvicorn api.src.main:app --reload --host $${API_HOST:-0.0.0.0} --port $${API_PORT:-8000}

dev-auth: ## Run only Auth locally
	@set -a && . $(LOCAL_ENV) && set +a && \
	mkdir -p db/data && \
	. auth/.venv/bin/activate && \
	uvicorn auth.src.main:app --reload --host $${API_HOST:-0.0.0.0} --port $${AUTH_PORT:-8001}

dev-studio: ## Run only Studio locally
	@set -a && . $(LOCAL_ENV) && set +a && \
	cd studio && corepack enable && yarn install && yarn dev --hostname 0.0.0.0 --port $${STUDIO_PORT:-3000}

# ── Docker / Production ──────────────────────────────────────────────────────

dev-docker: ## Docker without SSL (uses .env.prod, .env, or .env.example)
	@mkdir -p db/data
	docker compose --env-file $(PROD_ENV) up --build -d

prod: ## Production: Docker + Traefik + SSL + Redis (set DOMAIN_* in .env.prod or .env)
	@mkdir -p db/data
	docker compose --env-file $(PROD_ENV) \
		-f docker-compose.yml \
		-f docker-compose.redis.yml \
		-f docker-compose.traefik.yml \
		up --build -d

down: ## Stop Docker services
	docker compose down

build: ## Build all Docker images
	docker compose build

logs: ## Tail Docker logs
	docker compose logs -f

# ── Database ─────────────────────────────────────────────────────────────────

db-upgrade: ## Apply Alembic schema migrations to the configured database
	@set -a && . $(PROD_ENV) && set +a && \
	. auth/.venv/bin/activate && alembic -c db/alembic.ini upgrade head

data-migrate: ## Migrate SQLite data to PostgreSQL (requires running postgres)
	@set -a && . $(PROD_ENV) && set +a && \
	. auth/.venv/bin/activate && python3 -c " \
	import sqlite3, asyncio; \
	from sqlalchemy import text; \
	from db.src.database import engine; \
	db = sqlite3.connect('../db/data/auth.db'); \
	db.row_factory = sqlite3.Row; \
	async def migrate(): \
	    async with engine.begin() as conn: \
	        for table in ['tenants', 'users', 'api_keys']: \
	            rows = db.execute(f'SELECT * FROM {table}').fetchall(); \
	            if not rows: continue; \
	            cols = rows[0].keys(); \
	            for r in rows: \
	                vals = {c: r[c] for c in cols}; \
	                placeholders = ', '.join(f':{c}' for c in cols); \
	                col_names = ', '.join(cols); \
	                await conn.execute(text(f'INSERT INTO {table} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'), vals); \
	            print(f'{table}: {len(rows)} rows migrated'); \
	asyncio.run(migrate()); \
	db.close(); \
	print('Migration complete.'); \
	"

migrate: data-migrate ## Backward-compatible alias for data-migrate

reset-db: ## Delete local SQLite database
	rm -f db/data/auth.db
	@echo "Local DB reset. Restart auth to re-seed admin."

# ── Cleanup ──────────────────────────────────────────────────────────────────

clean: ## Remove Docker containers, volumes, and images
	docker compose down -v --rmi local
	@echo "Docker cleaned."
