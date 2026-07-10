"""backfill key_hash/key_prefix and null out plaintext api_keys.key

Revision ID: d1e2f3a4b5c6
Revises: c1d2e3f4a5b6
Create Date: 2026-07-10 00:00:00.000000

c1d2e3f4a5b6 added key_prefix + key_hash and back-filled them, but kept the
plaintext ``key`` column populated for the rollout. Now that all services
authenticate via key_hash, this migration:

  1. back-fills key_hash/key_prefix for any row that still lacks a hash
     (e.g. rows created after c1d2 by the old code path), and
  2. NULLs the plaintext ``key`` column so raw keys are no longer stored.

Existing keys stay valid because their sha256 hash is preserved. This is a
one-way data migration: the plaintext cannot be recovered, so downgrade only
reverts nothing (the columns themselves are removed by c1d2's downgrade).
"""
from __future__ import annotations

import hashlib
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Back-fill any row still missing a hash from its plaintext.
    rows = bind.execute(
        sa.text("SELECT id, key FROM api_keys WHERE key IS NOT NULL AND key_hash IS NULL")
    ).fetchall()
    for row in rows:
        key_id, plaintext = row[0], row[1]
        if not plaintext:
            continue
        bind.execute(
            sa.text("UPDATE api_keys SET key_prefix = :p, key_hash = :h WHERE id = :id"),
            {
                "p": plaintext[:8],
                "h": hashlib.sha256(plaintext.encode()).hexdigest(),
                "id": key_id,
            },
        )

    # 2. Drop plaintext for every row now that hashes exist.
    bind.execute(sa.text("UPDATE api_keys SET key = NULL WHERE key IS NOT NULL"))


def downgrade() -> None:
    # Irreversible: plaintext keys are gone and cannot be reconstructed from
    # their sha256 hash. Nothing to restore.
    pass
