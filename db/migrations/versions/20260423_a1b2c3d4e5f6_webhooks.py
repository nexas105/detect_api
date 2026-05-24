"""webhooks

Revision ID: a1b2c3d4e5f6
Revises: 98b128d01083
Create Date: 2026-04-23 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '98b128d01083'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'webhook_endpoints',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('tenant_id', sa.String(length=36), nullable=False),
        sa.Column('api_key_id', sa.String(length=36), nullable=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('url', sa.String(length=1000), nullable=False),
        sa.Column('secret', sa.String(length=128), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('trigger_endpoint', sa.Enum('classify', 'rateme', 'any', name='webhooktrigger'), nullable=False),
        sa.Column('trigger_threshold', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.ForeignKeyConstraint(['api_key_id'], ['api_keys.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('webhook_endpoints', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_webhook_endpoints_tenant_id'), ['tenant_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_webhook_endpoints_api_key_id'), ['api_key_id'], unique=False)

    op.create_table(
        'webhook_deliveries',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('endpoint_id', sa.String(length=36), nullable=False),
        sa.Column('event_type', sa.String(length=64), nullable=False),
        sa.Column('payload_json', sa.Text(), nullable=False),
        sa.Column('response_status', sa.Integer(), nullable=True),
        sa.Column('response_body', sa.String(length=2000), nullable=True),
        sa.Column('attempt', sa.Integer(), nullable=False),
        sa.Column('succeeded', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('next_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['endpoint_id'], ['webhook_endpoints.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('webhook_deliveries', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_webhook_deliveries_endpoint_id'), ['endpoint_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_webhook_deliveries_created_at'), ['created_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('webhook_deliveries', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_webhook_deliveries_created_at'))
        batch_op.drop_index(batch_op.f('ix_webhook_deliveries_endpoint_id'))
    op.drop_table('webhook_deliveries')

    with op.batch_alter_table('webhook_endpoints', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_webhook_endpoints_api_key_id'))
        batch_op.drop_index(batch_op.f('ix_webhook_endpoints_tenant_id'))
    op.drop_table('webhook_endpoints')
    sa.Enum(name='webhooktrigger').drop(op.get_bind(), checkfirst=True)
