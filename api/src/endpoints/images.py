"""Image storage endpoints."""

from __future__ import annotations

import mimetypes
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse, Response

from ..auth import KeyInfo, validate_api_key
from ..schemas import ImageListResponse
from ..storage import public_url_for, storage

router = APIRouter()

_VALID_CATEGORIES = ("originals", "censored", "scenes")


def _resolve_key(category: str, image_id: str) -> str:
    """Find a storage key for ``category/image_id`` (with or without extension)."""
    if category not in _VALID_CATEGORIES:
        raise HTTPException(400, f"Category must be one of {_VALID_CATEGORIES}")
    # If caller already passed an extension, use it directly.
    if "." in image_id:
        key = f"{category}/{image_id}"
        if storage.exists(key):
            return key
        raise HTTPException(404, "Image not found")
    # Otherwise scan the prefix for a matching stem.
    for obj in storage.list_prefix(category, limit=1000):
        stem = PurePosixPath(obj.key).stem
        if stem == image_id:
            return obj.key
    raise HTTPException(404, "Image not found")


def _serve(key: str) -> Response:
    """Either redirect to a presigned URL (S3) or stream bytes inline."""
    presigned = public_url_for(key)
    if presigned:
        return RedirectResponse(presigned, status_code=307)
    data = storage.get_bytes(key)
    ctype, _ = mimetypes.guess_type(key)
    return Response(content=data, media_type=ctype or "application/octet-stream")


@router.get(
    "/images/{category}/{image_id}",
    tags=["Storage"],
    responses={200: {"content": {"image/*": {}}, "description": "The requested image file"}},
)
async def get_image(category: str, image_id: str, _key: KeyInfo = Depends(validate_api_key)):
    """Retrieve a stored image by category and ID.

    Fetches an original or censored image from storage. The category must be
    'originals', 'censored', or 'scenes'. The image_id is returned by
    detection endpoints (e.g. /classify, /censor).
    """
    return _serve(_resolve_key(category, image_id))


@router.get(
    "/storage/{category}/{filename}",
    tags=["Storage"],
    responses={200: {"content": {"image/*": {}}, "description": "The requested stored file"}},
)
async def get_stored_file(category: str, filename: str):
    """Retrieve a stored file by category and full filename.

    Public access endpoint -- no API key required. File IDs contain UUIDs
    and are not guessable. Category must be 'originals', 'censored', or
    'scenes'.
    """
    if category not in _VALID_CATEGORIES:
        raise HTTPException(400, "Invalid category")
    if "/" in filename or filename.startswith(".."):
        raise HTTPException(400, "Invalid filename")
    key = f"{category}/{filename}"
    if not storage.exists(key):
        raise HTTPException(404, "File not found")
    return _serve(key)


@router.get("/images", response_model=ImageListResponse, tags=["Storage"])
async def list_images(
    category: str = Query("censored"),
    limit: int = Query(50, le=200),
    _key: KeyInfo = Depends(validate_api_key),
):
    """List stored images by category, sorted by most recent first.

    Returns image metadata (ID, filename, size, creation date) for up to
    ``limit`` images in the specified category ('originals', 'censored',
    or 'scenes').
    """
    if category not in _VALID_CATEGORIES:
        raise HTTPException(400, f"Category must be one of {_VALID_CATEGORIES}")
    objs = storage.list_prefix(category, limit=limit)
    return {
        "category": category,
        "images": [
            {
                "id": PurePosixPath(o.key).stem,
                "filename": PurePosixPath(o.key).name,
                "size": o.size,
                "created": o.last_modified.isoformat(),
            }
            for o in objs
        ],
    }
