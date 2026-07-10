"""Alembic env — reads DATABASE_URL from environment, imports auth models."""

import os
from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context

from db.src.database import Base
from auth.src.models import (  # noqa: F401 — register all models so target_metadata is complete
    Tenant,
    User,
    APIKey,
    UsageLog,
    DetectionResult,
    DetectionCache,
    DemoLog,
    WebhookEndpoint,
    WebhookDelivery,
    AsyncJob,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Resolve relative SQLite paths from project root (not from db/)
_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./db/data/auth.db")
# Alembic uses sync drivers
SYNC_URL = DATABASE_URL.replace("+aiosqlite", "").replace("+asyncpg", "+psycopg")
if SYNC_URL.startswith("sqlite:///./"):
    rel_path = SYNC_URL.replace("sqlite:///./", "")
    SYNC_URL = f"sqlite:///{os.path.join(_root, rel_path)}"


def run_migrations_offline() -> None:
    context.configure(
        url=SYNC_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # needed for SQLite ALTER TABLE
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(SYNC_URL, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
