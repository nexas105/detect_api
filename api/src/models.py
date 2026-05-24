"""ML model loading, detection, and image processing."""

from __future__ import annotations

import io
import logging
import os
import platform
import tempfile
import uuid
from datetime import datetime, timezone
from enum import Enum
from functools import partial
from pathlib import Path
from typing import Optional

import anyio
from fastapi import HTTPException
from PIL import Image, ImageFilter, ImageOps

from .config import MAX_DETECT_SIZE, MODEL_DIR
from .storage import build_key, storage

logger = logging.getLogger("api.models")

# Use ramdisk on Linux (Docker production) to avoid disk I/O for NudeNet temp files
_TMPDIR = "/dev/shm" if platform.system() == "Linux" and os.path.isdir("/dev/shm") else None


# ── Model Enum ──────────────────────────────────────────────────────────────


class ModelName(str, Enum):
    nudenet = "nudenet"
    erax = "erax"


# Cache key versioning — bump when model weights or inference params change
# so that stale cached results are invalidated.
MODEL_VERSIONS = {
    "nudenet": "nudenet_640m_v1",
    "erax": "erax_yolo11s_v1_1",
    "clip": "clip_vit_b32_v1",
}


def model_version_for(model: "ModelName | str") -> str:
    """Return the cache-key model-version string for a given model."""
    name = model.value if isinstance(model, ModelName) else str(model)
    return MODEL_VERSIONS.get(name, name)


# ── NudeNet ─────────────────────────────────────────────────────────────────

_nudenet_detector = None


def _ensure_model(name: str):
    """Auto-download model if missing. Called before loading."""
    try:
        from .download_model import get_model
        get_model(name)
    except Exception as e:
        logger.warning("Auto-download for %s failed: %s", name, e)


def get_nudenet():
    global _nudenet_detector
    if _nudenet_detector is None:
        from nudenet import NudeDetector

        model_640 = MODEL_DIR / "640m.onnx"
        legacy_640 = Path(os.path.expanduser("~/.NudeNet/640m.onnx"))

        # Auto-download if missing
        if not model_640.exists() and not legacy_640.exists():
            logger.info("NudeNet model not found — downloading automatically...")
            _ensure_model("nudenet")

        if model_640.exists():
            _nudenet_detector = NudeDetector(model_path=str(model_640), inference_resolution=640)
        elif legacy_640.exists():
            _nudenet_detector = NudeDetector(model_path=str(legacy_640), inference_resolution=640)
        else:
            _nudenet_detector = NudeDetector()  # bundled 320n fallback
        logger.info("NudeNet loaded: %s", "640m" if model_640.exists() or legacy_640.exists() else "320n")
    return _nudenet_detector


def _detect_nudenet(tmp_path: str) -> list[dict]:
    return [
        {
            "label": r["class"],
            "score": round(float(r["score"]), 4),
            "box": [int(v) for v in r["box"]],
            "box_format": "xywh",
        }
        for r in get_nudenet().detect(tmp_path)
    ]


# ── EraX ────────────────────────────────────────────────────────────────────

_erax_model = None

_ERAX_LABEL_MAP = {
    "nipple": "NIPPLE", "penis": "PENIS", "vagina": "VAGINA",
    "anus": "ANUS", "make_love": "MAKE_LOVE",
}


def get_erax():
    global _erax_model
    if _erax_model is None:
        from ultralytics import YOLO

        local_path = MODEL_DIR / "erax-anti-nsfw-yolo11s-v1.1.pt"

        # Auto-download if missing
        if not local_path.exists():
            logger.info("EraX model not found — downloading automatically...")
            _ensure_model("erax")

        if local_path.exists():
            _erax_model = YOLO(str(local_path))
        else:
            # Direct HuggingFace fallback
            from huggingface_hub import hf_hub_download
            model_path = hf_hub_download(repo_id="erax-ai/EraX-Anti-NSFW-V1.1", filename="erax-anti-nsfw-yolo11s-v1.1.pt")
            _erax_model = YOLO(model_path)
        logger.info("EraX loaded")
    return _erax_model


def _detect_erax(img: Image.Image) -> list[dict]:
    results = get_erax()(img, conf=0.25, iou=0.3, verbose=False)
    detections = []
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append({
                "label": _ERAX_LABEL_MAP.get(r.names[int(box.cls)], r.names[int(box.cls)].upper()),
                "score": round(float(box.conf), 4),
                "box": [int(x1), int(y1), int(x2 - x1), int(y2 - y1)],
                "box_format": "xywh",
            })
    return detections


# ── Image Processing ────────────────────────────────────────────────────────


def validate_upload(data: bytes, max_size: int | None = None):
    from .config import MAX_UPLOAD_SIZE
    limit = max_size or MAX_UPLOAD_SIZE
    if len(data) > limit:
        raise HTTPException(413, f"File too large. Max {limit / (1024 * 1024):.0f}MB.")
    if len(data) == 0:
        raise HTTPException(400, "Empty file")


def preprocess(data: bytes) -> tuple[Image.Image, float]:
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
    except Exception:
        raise HTTPException(400, "Invalid image file")
    if img.mode != "RGB":
        img = img.convert("RGB")
    scale = 1.0
    max_dim = max(img.width, img.height)
    if max_dim > MAX_DETECT_SIZE:
        scale = MAX_DETECT_SIZE / max_dim
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    return img, scale


def preprocess_full(data: bytes) -> tuple[Image.Image, float, Image.Image]:
    """Decode image once, return (detect_img, scale, full_img).

    Use this instead of ``preprocess`` + a second ``Image.open`` when both the
    detection-sized image *and* the full-resolution original are needed (e.g.
    classify, censor, rateme).
    """
    try:
        full_img = Image.open(io.BytesIO(data))
        full_img = ImageOps.exif_transpose(full_img)
    except Exception:
        raise HTTPException(400, "Invalid image file")
    if full_img.mode != "RGB":
        full_img = full_img.convert("RGB")
    scale = 1.0
    max_dim = max(full_img.width, full_img.height)
    if max_dim > MAX_DETECT_SIZE:
        scale = MAX_DETECT_SIZE / max_dim
        detect_img = full_img.resize(
            (int(full_img.width * scale), int(full_img.height * scale)), Image.LANCZOS
        )
    else:
        detect_img = full_img
    return detect_img, scale, full_img


def run_detection(img: Image.Image, model: ModelName, scale: float) -> list[dict]:
    if model == ModelName.nudenet:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False, dir=_TMPDIR) as tmp:
            img.save(tmp, format="JPEG", quality=90)
            tmp_path = tmp.name
        try:
            raw = _detect_nudenet(tmp_path)
        finally:
            os.unlink(tmp_path)
    else:
        raw = _detect_erax(img)

    if scale != 1.0:
        inv = 1.0 / scale
        for d in raw:
            d["box"] = [int(v * inv) for v in d["box"]]
    return raw


async def run_detection_async(img: Image.Image, model: ModelName, scale: float) -> list[dict]:
    """Run detection in thread pool to avoid blocking the event loop."""
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(run_detection, img, model, scale))


def apply_censoring(
    orig: Image.Image, detections: list[dict], censor_labels: list[str],
) -> bytes:
    for d in detections:
        if d["label"] not in censor_labels:
            continue
        bx, by, bw, bh = d["box"]
        x1, y1, x2, y2 = bx, by, bx + bw, by + bh
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(orig.width, x2), min(orig.height, y2)
        if x2 <= x1 or y2 <= y1:
            continue
        region = orig.crop((x1, y1, x2, y2))
        radius = max(30, min(region.width, region.height) // 3)
        orig.paste(region.filter(ImageFilter.GaussianBlur(radius=radius)), (x1, y1))
    buf = io.BytesIO()
    orig.save(buf, format="PNG")
    return buf.getvalue()


# ── Storage ─────────────────────────────────────────────────────────────────


def get_ext(filename: str | None) -> str:
    if filename and "." in filename:
        return "." + filename.rsplit(".", 1)[-1].lower()
    return ".jpg"


_CONTENT_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif",
}


def _ctype_for(suffix: str) -> str | None:
    return _CONTENT_TYPES.get(suffix.lower())


def store_image(data: bytes, suffix: str, category: str) -> tuple[str, str]:
    """Synchronous variant — prefer store_image_async in request handlers."""
    image_id = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    key = build_key(category, image_id, suffix)
    storage.put_bytes(key, data, content_type=_ctype_for(suffix))
    return image_id, key


def store_image_with_id(data: bytes, suffix: str, category: str, image_id: str) -> str:
    """Synchronous variant — prefer store_image_with_id_async in request handlers."""
    key = build_key(category, image_id, suffix)
    storage.put_bytes(key, data, content_type=_ctype_for(suffix))
    return key


async def store_image_async(data: bytes, suffix: str, category: str) -> tuple[str, str]:
    """Upload an image to storage without blocking the event loop."""
    image_id = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    key = build_key(category, image_id, suffix)
    await storage.put_bytes_async(key, data, content_type=_ctype_for(suffix))
    return image_id, key


async def store_image_with_id_async(data: bytes, suffix: str, category: str, image_id: str) -> str:
    """Upload an image with a caller-provided id off the event loop."""
    key = build_key(category, image_id, suffix)
    await storage.put_bytes_async(key, data, content_type=_ctype_for(suffix))
    return key


DEFAULT_CENSOR = {
    ModelName.nudenet: [
        "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED",
        "MALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED", "ANUS_EXPOSED",
    ],
    ModelName.erax: ["NIPPLE", "PENIS", "VAGINA", "ANUS"],
}


# ── Model Info ──────────────────────────────────────────────────────────────

MODELS_INFO = [
    {
        "id": "nudenet", "name": "NudeNet 640m",
        "description": "YOLOv8m – 18 labels, covered + exposed distinction",
        "labels": [
            "FEMALE_BREAST_EXPOSED", "FEMALE_BREAST_COVERED",
            "FEMALE_GENITALIA_EXPOSED", "FEMALE_GENITALIA_COVERED",
            "MALE_GENITALIA_EXPOSED", "MALE_GENITALIA_COVERED",
            "BUTTOCKS_EXPOSED", "BUTTOCKS_COVERED",
            "ANUS_EXPOSED", "ANUS_COVERED",
            "BELLY_EXPOSED", "BELLY_COVERED",
            "ARMPITS_EXPOSED", "ARMPITS_COVERED",
            "FEET_EXPOSED", "FEET_COVERED",
            "FACE_FEMALE", "FACE_MALE",
        ],
        "default_censor": DEFAULT_CENSOR[ModelName.nudenet],
    },
    {
        "id": "erax", "name": "EraX Anti-NSFW v1.1",
        "description": "YOLO11s – 5 labels, higher accuracy, exposed only",
        "labels": ["NIPPLE", "PENIS", "VAGINA", "ANUS", "MAKE_LOVE"],
        "default_censor": DEFAULT_CENSOR[ModelName.erax],
    },
]
