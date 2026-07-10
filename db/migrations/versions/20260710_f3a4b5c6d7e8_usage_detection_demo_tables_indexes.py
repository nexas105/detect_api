"""usage_logs / detection_results / demo_logs tables + time-window indexes

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-07-10

These three tables historically only existed via SQLAlchemy create_all and never
had a CREATE migration. Now that create_all is gated off in prod
(db/src/database.py::_auto_create_enabled), a fresh PostgreSQL DB would never get
them — so this migration creates them, guarded by inspector.has_table so existing
DBs (where create_all already built them) are untouched. Same guard pattern as the
async_jobs migration.

It also adds the indexes that were missing:
  - composite (tenant_id, created_at) on usage_logs and detection_results
    (time-windowed per-tenant stats)
  - detection_results.user_id (index=True in the model but missed by the
    fk_indexes migration)
All index creation is idempotent so existing DBs that already have the tables
get the new indexes without crashing.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, Sequence[str], None] = "e2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_index(bind, table: str, index: str) -> bool:
    inspector = sa.inspect(bind)
    try:
        existing = {ix["name"] for ix in inspector.get_indexes(table)}
    except Exception:
        return False
    return index in existing


def _ensure_index(bind, table: str, index: str, columns: list[str], unique: bool = False) -> None:
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    if _has_index(bind, table, index):
        return
    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.create_index(index, columns, unique=unique)


def _drop_index(bind, table: str, index: str) -> None:
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    if not _has_index(bind, table, index):
        return
    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.drop_index(index)


def _create_usage_logs() -> None:
    op.create_table(
        "usage_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("api_key_id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("endpoint", sa.String(length=255), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["api_key_id"], ["api_keys.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("usage_logs", schema=None) as batch_op:
        batch_op.create_index("ix_usage_logs_api_key_id", ["api_key_id"], unique=False)
        batch_op.create_index("ix_usage_logs_tenant_id", ["tenant_id"], unique=False)
        batch_op.create_index("ix_usage_logs_created_at", ["created_at"], unique=False)


def _create_detection_results() -> None:
    op.create_table(
        "detection_results",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("image_id", sa.String(length=255), nullable=False),
        sa.Column("api_key_id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("endpoint", sa.String(length=50), nullable=False),
        sa.Column("model_name", sa.String(length=50), nullable=False),
        sa.Column("detections_json", sa.String(length=10000), nullable=False),
        sa.Column("original_path", sa.String(length=500), nullable=True),
        sa.Column("censored_path", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["api_key_id"], ["api_keys.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("detection_results", schema=None) as batch_op:
        batch_op.create_index("ix_detection_results_image_id", ["image_id"], unique=False)
        batch_op.create_index("ix_detection_results_api_key_id", ["api_key_id"], unique=False)
        batch_op.create_index("ix_detection_results_tenant_id", ["tenant_id"], unique=False)
        batch_op.create_index("ix_detection_results_created_at", ["created_at"], unique=False)


def _create_demo_logs() -> None:
    op.create_table(
        "demo_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("ip", sa.String(length=45), nullable=False),
        sa.Column("endpoint", sa.String(length=50), nullable=False),
        sa.Column("model_name", sa.String(length=50), nullable=False),
        sa.Column("image_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("demo_logs", schema=None) as batch_op:
        batch_op.create_index("ix_demo_logs_ip", ["ip"], unique=False)
        batch_op.create_index("ix_demo_logs_created_at", ["created_at"], unique=False)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Create tables only where create_all never ran (fresh prod DB). Guarded so
    # existing DBs that already have them are left alone.
    if not inspector.has_table("usage_logs"):
        _create_usage_logs()
    if not inspector.has_table("detection_results"):
        _create_detection_results()
    if not inspector.has_table("demo_logs"):
        _create_demo_logs()

    # New indexes — idempotent, so DBs that already had the tables (via create_all)
    # but predate these indexes get them without erroring.
    _ensure_index(bind, "usage_logs", "ix_usage_logs_tenant_created", ["tenant_id", "created_at"])
    _ensure_index(bind, "detection_results", "ix_detection_results_tenant_created", ["tenant_id", "created_at"])
    _ensure_index(bind, "detection_results", "ix_detection_results_user_id", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()

    _drop_index(bind, "detection_results", "ix_detection_results_user_id")
    _drop_index(bind, "detection_results", "ix_detection_results_tenant_created")
    _drop_index(bind, "usage_logs", "ix_usage_logs_tenant_created")

    # Tables predate this migration's CREATE on already-provisioned DBs, so we do
    # not drop them here — dropping would destroy data on DBs where create_all,
    # not this migration, owns them. Fresh-DB teardown is acceptable to leave to
    # a full drop_all. (Indexes above are the only reversible additions.)
