"""Shared database connection — PostgreSQL in Docker, SQLite for local dev."""

from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./db/data/auth.db")

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session


def _auto_create_enabled() -> bool:
    """create_all is a dev convenience only. In prod (PostgreSQL) schema is
    owned by Alembic, so it defaults off. DB_AUTO_CREATE overrides either way."""
    flag = os.getenv("DB_AUTO_CREATE")
    if flag is not None:
        return flag.strip().lower() in ("1", "true", "yes", "on")
    return DATABASE_URL.startswith("sqlite")


async def init_db():
    if not _auto_create_enabled():
        return
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
