"""Storage abstraction: local filesystem or S3-compatible backend (MinIO).

All upload, retrieval and listing in endpoints/models should go through the
``storage`` singleton exposed here. Backend is chosen at process start via
``STORAGE_BACKEND`` env var.

Object keys are POSIX-style paths like ``"originals/abc.jpg"`` — both backends
treat them as opaque keys, so callers must not include leading slashes.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

import anyio

from .config import (
    S3_ACCESS_KEY,
    S3_BUCKET,
    S3_ENDPOINT,
    S3_PRESIGN_EXPIRES,
    S3_REGION,
    S3_SECRET_KEY,
    S3_USE_PRESIGNED_URLS,
    STORAGE_BACKEND,
    STORAGE_DIR,
)


@dataclass
class StoredObject:
    key: str
    size: int
    last_modified: datetime


class _LocalStorage:
    backend = "local"
    supports_presign = False

    def __init__(self, root: Path) -> None:
        self._root = root

    def _path(self, key: str) -> Path:
        # Reject absolute / traversal keys.
        p = (self._root / key).resolve()
        if not p.is_relative_to(self._root.resolve()):
            raise ValueError(f"Invalid storage key: {key!r}")
        return p

    def put_bytes(self, key: str, data: bytes, content_type: Optional[str] = None) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    async def put_bytes_async(self, key: str, data: bytes, content_type: Optional[str] = None) -> None:
        await anyio.to_thread.run_sync(self.put_bytes, key, data, content_type)

    def get_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        try:
            return self._path(key).is_file()
        except ValueError:
            return False

    def delete(self, key: str) -> None:
        p = self._path(key)
        if p.is_file():
            p.unlink()

    def list_prefix(self, prefix: str, limit: int = 1000) -> list[StoredObject]:
        base = self._path(prefix) if prefix else self._root
        if not base.exists():
            return []
        files: Iterable[Path]
        if base.is_dir():
            files = (p for p in base.iterdir() if p.is_file())
        else:
            files = [base]
        sorted_files = sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
        out: list[StoredObject] = []
        for p in sorted_files:
            st = p.stat()
            key = str(p.relative_to(self._root)).replace("\\", "/")
            out.append(
                StoredObject(
                    key=key,
                    size=st.st_size,
                    last_modified=datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
                )
            )
        return out

    def presign_url(self, key: str, expires: int = 3600) -> Optional[str]:
        return None


class _S3Storage:
    backend = "s3"
    supports_presign = True

    def __init__(
        self,
        endpoint: str,
        bucket: str,
        access_key: str,
        secret_key: str,
        region: str,
    ) -> None:
        if not (endpoint and bucket and access_key and secret_key):
            raise RuntimeError(
                "STORAGE_BACKEND=s3 requires S3_ENDPOINT, S3_BUCKET, "
                "S3_ACCESS_KEY and S3_SECRET_KEY to be set."
            )
        import boto3
        from botocore.config import Config

        self._bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    def put_bytes(self, key: str, data: bytes, content_type: Optional[str] = None) -> None:
        extra: dict = {}
        if content_type:
            extra["ContentType"] = content_type
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, **extra)

    async def put_bytes_async(self, key: str, data: bytes, content_type: Optional[str] = None) -> None:
        await anyio.to_thread.run_sync(self.put_bytes, key, data, content_type)

    def get_bytes(self, key: str) -> bytes:
        resp = self._client.get_object(Bucket=self._bucket, Key=key)
        return resp["Body"].read()

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)

    def list_prefix(self, prefix: str, limit: int = 1000) -> list[StoredObject]:
        norm = prefix.rstrip("/") + "/" if prefix else ""
        resp = self._client.list_objects_v2(
            Bucket=self._bucket, Prefix=norm, MaxKeys=min(limit, 1000)
        )
        items = resp.get("Contents", []) or []
        items.sort(key=lambda o: o["LastModified"], reverse=True)
        return [
            StoredObject(
                key=o["Key"],
                size=o["Size"],
                last_modified=o["LastModified"],
            )
            for o in items[:limit]
        ]

    def presign_url(self, key: str, expires: int = 3600) -> Optional[str]:
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires,
        )


def _build_storage():
    if STORAGE_BACKEND == "s3":
        return _S3Storage(
            endpoint=S3_ENDPOINT,
            bucket=S3_BUCKET,
            access_key=S3_ACCESS_KEY,
            secret_key=S3_SECRET_KEY,
            region=S3_REGION,
        )
    return _LocalStorage(STORAGE_DIR)


storage = _build_storage()


def build_key(category: str, image_id: str, suffix: str) -> str:
    """Build a storage key from category / id / extension."""
    return f"{category}/{image_id}{suffix}"


def public_url_for(key: str) -> Optional[str]:
    """Return a presigned URL for S3 (if enabled), or None to indicate the
    caller should serve bytes directly."""
    if storage.backend == "s3" and S3_USE_PRESIGNED_URLS:
        return storage.presign_url(key, expires=S3_PRESIGN_EXPIRES)
    return None
