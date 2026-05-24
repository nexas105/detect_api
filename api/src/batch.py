"""Batch processing — extract ZIP/RAR archives and scan all images."""

from __future__ import annotations

import io
import tempfile
import zipfile
from pathlib import Path

from PIL import Image

# Supported image extensions
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff"}


def _is_image(name: str) -> bool:
    return Path(name).suffix.lower() in IMAGE_EXTS


def extract_images_from_archive(data: bytes, filename: str) -> list[tuple[str, bytes]]:
    """Extract images from ZIP or RAR archive. Returns list of (filename, image_bytes)."""
    images: list[tuple[str, bytes]] = []
    suffix = Path(filename).suffix.lower()

    if suffix == ".zip":
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for info in zf.infolist():
                if info.is_dir() or not _is_image(info.filename):
                    continue
                images.append((Path(info.filename).name, zf.read(info)))

    elif suffix == ".rar":
        try:
            import rarfile
            with tempfile.NamedTemporaryFile(suffix=".rar", delete=False) as tmp:
                tmp.write(data)
                tmp.flush()
                with rarfile.RarFile(tmp.name) as rf:
                    for info in rf.infolist():
                        if info.is_dir() or not _is_image(info.filename):
                            continue
                        images.append((Path(info.filename).name, rf.read(info)))
        except ImportError:
            raise ValueError("RAR support requires 'rarfile' package and 'unrar' binary")

    else:
        raise ValueError(f"Unsupported archive format: {suffix}. Use .zip or .rar")

    return images


def validate_image(data: bytes) -> bool:
    """Check if bytes are a valid image."""
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        return True
    except Exception:
        return False
