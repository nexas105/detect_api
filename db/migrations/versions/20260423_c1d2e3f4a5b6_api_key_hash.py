"""hashed API keys — add key_prefix + key_hash columns

Revision ID: c1d2e3f4a5b6
Revises: b1c2d3e4f5a6
Create Date: 2026-04-23 16:00:00.000000

Adds key_prefix (first 12 chars for UI display) and key_hash (sha256
hex) to api_keys. Back-fills hash/prefix for any existing plaintext
rows. Keeps the plaintext ``key`` column (made nullable) for one more
release so running API instances that still authenticate via the old
column continue to work during the rollout.
"""
from __future__ import annotations

import hashlib
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('api_keys', schema=None) as batch_op:
        batch_op.add_column(sa.Column('key_prefix', sa.String(length=12), nullable=True))
        batch_op.add_column(sa.Column('key_hash', sa.String(length=64), nullable=True))
        batch_op.alter_column('key', existing_type=sa.String(length=64), nullable=True)
        batch_op.create_index(batch_op.f('ix_api_keys_key_prefix'), ['key_prefix'], unique=False)
        batch_op.create_index(batch_op.f('ix_api_keys_key_hash'), ['key_hash'], unique=True)

    # Back-fill existing plaintext keys
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, key FROM api_keys WHERE key IS NOT NULL")).fetchall()
    for row in rows:
        key_id, plaintext = row[0], row[1]
        if not plaintext:
            continue
        prefix = plaintext[:12]
        digest = hashlib.sha256(plaintext.encode()).hexdigest()
        bind.execute(
            sa.text("UPDATE api_keys SET key_prefix = :p, key_hash = :h WHERE id = :id"),
            {"p": prefix, "h": digest, "id": key_id},
        )


def downgrade() -> None:
    with op.batch_alter_table('api_keys', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_api_keys_key_hash'))
        batch_op.drop_index(batch_op.f('ix_api_keys_key_prefix'))
        batch_op.alter_column('key', existing_type=sa.String(length=64), nullable=False)
        batch_op.drop_column('key_hash')
        batch_op.drop_column('key_prefix')
