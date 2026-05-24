"""SQLAlchemy models for auth service."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Boolean, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.src.database import Base


class Role(str, PyEnum):
    admin = "admin"
    customer = "customer"
    user = "user"
    free = "free"
    premium = "premium"


class Plan(str, PyEnum):
    free = "free"
    starter = "starter"
    business = "business"
    enterprise = "enterprise"


# Plan limits — what the tenant gets
PLAN_LIMITS: dict[Plan, dict] = {
    Plan.free:       {"max_users": 1,   "max_keys": 1,   "rate_limit": 100},
    Plan.starter:    {"max_users": 5,   "max_keys": 5,   "rate_limit": 1000},
    Plan.business:   {"max_users": 25,  "max_keys": 25,  "rate_limit": 10000},
    Plan.enterprise: {"max_users": 0,   "max_keys": 0,   "rate_limit": 0},  # 0 = unlimited
}


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    plan: Mapped[Plan] = mapped_column(Enum(Plan), default=Plan.free)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Custom overrides (None = use plan defaults, 0 = unlimited)
    custom_max_users: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    custom_max_keys: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    custom_rate_limit: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    users: Mapped[list[User]] = relationship(back_populates="tenant")
    api_keys: Mapped[list[APIKey]] = relationship(back_populates="tenant")

    @property
    def effective_limits(self) -> dict:
        """Return effective limits: custom overrides > plan defaults."""
        defaults = PLAN_LIMITS.get(self.plan, PLAN_LIMITS[Plan.free])
        return {
            "max_users": self.custom_max_users if self.custom_max_users is not None else defaults["max_users"],
            "max_keys": self.custom_max_keys if self.custom_max_keys is not None else defaults["max_keys"],
            "rate_limit": self.custom_rate_limit if self.custom_rate_limit is not None else defaults["rate_limit"],
            "is_custom": any(v is not None for v in [self.custom_max_users, self.custom_max_keys, self.custom_rate_limit]),
        }


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.free)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    tenant: Mapped[Tenant] = relationship(back_populates="users")


class APIKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Legacy plaintext column — nullable during hash migration, will be dropped
    # in a follow-up release once all keys have been hashed and all services
    # authenticate via key_hash.
    key: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    # First 12 characters of the plaintext key, used as a human-recognisable
    # identifier in the UI ("abc123de..."). NOT a secret.
    key_prefix: Mapped[str | None] = mapped_column(String(12), nullable=True, index=True)
    # sha256(plaintext).hexdigest() — 64 hex chars. Primary lookup column.
    key_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True, unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    is_master: Mapped[bool] = mapped_column(Boolean, default=False)  # tenant-wide key
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    rate_limit: Mapped[int] = mapped_column(Integer, default=0)  # requests/hour, 0 = unlimited
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    tenant: Mapped[Tenant] = relationship(back_populates="api_keys")
    creator: Mapped[User] = relationship()


class UsageLog(Base):
    __tablename__ = "usage_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    api_key_id: Mapped[str] = mapped_column(String(36), ForeignKey("api_keys.id"), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class DetectionResult(Base):
    __tablename__ = "detection_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    image_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    api_key_id: Mapped[str] = mapped_column(String(36), ForeignKey("api_keys.id"), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    endpoint: Mapped[str] = mapped_column(String(50), nullable=False)  # classify or censor
    model_name: Mapped[str] = mapped_column(String(50), nullable=False)
    detections_json: Mapped[str] = mapped_column(String(10000), nullable=False, default="[]")
    original_path: Mapped[str] = mapped_column(String(500), nullable=True)
    censored_path: Mapped[str] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    api_key: Mapped[APIKey] = relationship()
    tenant: Mapped[Tenant] = relationship()


class DetectionCache(Base):
    """Cached ML inference results keyed by image hash + model version + endpoint.

    Redis is primary; this table is the durable fallback. Populated on cache miss,
    read on cache hit when Redis is unavailable.
    """
    __tablename__ = "detection_cache"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)  # sha256 hex
    model_version: Mapped[str] = mapped_column(String(100), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(50), nullable=False)  # classify / rateme
    result_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    __table_args__ = (
        UniqueConstraint("hash", "model_version", "endpoint", name="uq_detection_cache_hash_model_endpoint"),
    )


class DemoLog(Base):
    __tablename__ = "demo_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    ip: Mapped[str] = mapped_column(String(45), nullable=False, index=True)  # IPv4/IPv6
    endpoint: Mapped[str] = mapped_column(String(50), nullable=False)
    model_name: Mapped[str] = mapped_column(String(50), nullable=False)
    image_count: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class WebhookTrigger(str, PyEnum):
    classify = "classify"
    rateme = "rateme"
    any = "any"


class WebhookEndpoint(Base):
    """Customer-configured outbound webhook endpoint."""
    __tablename__ = "webhook_endpoints"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    # If set, webhook only fires for this specific api_key; if null, fires for all tenant keys.
    api_key_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("api_keys.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    secret: Mapped[str] = mapped_column(String(128), nullable=False)  # plaintext — standard for HMAC signing
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    trigger_endpoint: Mapped[WebhookTrigger] = mapped_column(Enum(WebhookTrigger), default=WebhookTrigger.any)
    # For classify: "any_detection" or a label name; for rateme: a category (safe/mild/.../extreme) — threshold is ">=".
    trigger_threshold: Mapped[str] = mapped_column(String(64), nullable=False, default="any_detection")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class WebhookDelivery(Base):
    """Log of a single webhook delivery attempt."""
    __tablename__ = "webhook_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    endpoint_id: Mapped[str] = mapped_column(String(36), ForeignKey("webhook_endpoints.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[str | None] = mapped_column(String(2000), nullable=True)  # truncated
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    succeeded: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
