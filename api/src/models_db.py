"""Local ORM models the API service needs direct DB access to.

Kept separate from the auth-service models so that the API container
can operate without depending on the auth package being importable.
SQLAlchemy is happy with multiple Base classes mapping to the same
physical table — we just keep the schema/constraints aligned with the
canonical definition in ``auth/src/models.py``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class APIBase(DeclarativeBase):
    """Separate Base so we don't share metadata with auth's Base."""


class DetectionCache(APIBase):
    """Mirror of auth.DetectionCache — points at the same table.

    Keep columns + UniqueConstraint in sync with ``auth/src/models.py``.
    """

    __tablename__ = "detection_cache"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    model_version: Mapped[str] = mapped_column(String(100), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(50), nullable=False)
    result_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    __table_args__ = (
        UniqueConstraint("hash", "model_version", "endpoint", name="uq_detection_cache_hash_model_endpoint"),
    )


class AsyncJob(APIBase):
    """Tenant-scoped metadata for asynchronous batch and video jobs."""

    __tablename__ = "async_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    input_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    output_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
