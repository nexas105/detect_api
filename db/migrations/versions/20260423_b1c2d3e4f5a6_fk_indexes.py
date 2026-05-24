"""indexes on frequently-joined foreign keys

Revision ID: b1c2d3e4f5a6
Revises: a1b2c3d4e5f6, aed924638adc
Create Date: 2026-04-23 15:00:00.000000

Adds indexes on foreign-key columns that are hit on nearly every
auth-service request (usage logging, detection saves, key lookups).
Also merges the two heads that existed from webhooks + detection_cache.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = ('a1b2c3d4e5f6', 'aed924638adc')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (table, column, index_name)
_INDEXES = [
    ('api_keys', 'created_by', 'ix_api_keys_created_by'),
    ('api_keys', 'tenant_id', 'ix_api_keys_tenant_id'),
    ('users', 'tenant_id', 'ix_users_tenant_id'),
    ('usage_logs', 'tenant_id', 'ix_usage_logs_tenant_id'),
    ('usage_logs', 'api_key_id', 'ix_usage_logs_api_key_id'),
    ('detection_results', 'tenant_id', 'ix_detection_results_tenant_id'),
    ('detection_results', 'api_key_id', 'ix_detection_results_api_key_id'),
]


def _table_exists(bind, name: str) -> bool:
    inspector = sa.inspect(bind)
    return name in inspector.get_table_names()


def _index_exists(bind, table: str, index: str) -> bool:
    inspector = sa.inspect(bind)
    try:
        existing = {ix['name'] for ix in inspector.get_indexes(table)}
    except Exception:
        return False
    return index in existing


def upgrade() -> None:
    bind = op.get_bind()
    for table, column, index in _INDEXES:
        if not _table_exists(bind, table):
            # create_all may not have produced this table in some envs; skip
            continue
        if _index_exists(bind, table, index):
            continue
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.create_index(index, [column], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    for table, _column, index in reversed(_INDEXES):
        if not _table_exists(bind, table):
            continue
        if not _index_exists(bind, table, index):
            continue
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_index(index)
