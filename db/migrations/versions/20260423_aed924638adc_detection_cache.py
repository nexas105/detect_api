"""detection cache

Revision ID: aed924638adc
Revises: 98b128d01083
Create Date: 2026-04-23 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'aed924638adc'
down_revision: Union[str, Sequence[str], None] = '98b128d01083'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create detection_cache table for ML inference result caching."""
    op.create_table(
        'detection_cache',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('hash', sa.String(length=64), nullable=False),
        sa.Column('model_version', sa.String(length=100), nullable=False),
        sa.Column('endpoint', sa.String(length=50), nullable=False),
        sa.Column('result_json', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('hash', 'model_version', 'endpoint', name='uq_detection_cache_hash_model_endpoint'),
    )
    with op.batch_alter_table('detection_cache', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_detection_cache_hash'), ['hash'], unique=False)
        batch_op.create_index(batch_op.f('ix_detection_cache_created_at'), ['created_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('detection_cache', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_detection_cache_created_at'))
        batch_op.drop_index(batch_op.f('ix_detection_cache_hash'))
    op.drop_table('detection_cache')
