"""async jobs

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-07-10
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, Sequence[str], None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("async_jobs"):
        return
    op.create_table(
        "async_jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("endpoint", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("input_path", sa.String(length=1000), nullable=False),
        sa.Column("output_path", sa.String(length=1000), nullable=True),
        sa.Column("result_json", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_async_jobs_tenant_id", "async_jobs", ["tenant_id"])
    op.create_index("ix_async_jobs_status", "async_jobs", ["status"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("async_jobs"):
        return
    op.drop_index("ix_async_jobs_status", table_name="async_jobs")
    op.drop_index("ix_async_jobs_tenant_id", table_name="async_jobs")
    op.drop_table("async_jobs")
