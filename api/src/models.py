"""ML model loading, detection, and image processing."""

from __future__ import annotations

import io
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from enum import Enum
from functools import partial
from pathlib import Path
from typing import Optional

import anyio
import numpy as np
from fastapi import HTTPException
from PIL import Image, ImageFilter, ImageOps

from .config import (
    ERAX_MODEL_FILENAME,
    ERAX_MODEL_REVISION,
    ERAX_MODEL_SIZE,
    MAX_DETECT_SIZE,
    MODEL_DIR,
)
from .storage import build_key, storage

logger = logging.getLogger("api.models")

# ── Model Enum ──────────────────────────────────────────────────────────────


class ModelName(str, Enum):
    nudenet = "nudenet"
    erax = "erax"
    ensemble = "ensemble"


# Cache key versioning — bump when model weights or inference params change
# so that stale cached results are invalidated.
MODEL_VERSIONS = {
    "nudenet": "nudenet_640m_v1",
    "erax": f"erax_yolo11{ERAX_MODEL_SIZE}_v1_1",
    "ensemble": f"nudenet_640m_v1+erax_yolo11{ERAX_MODEL_SIZE}_v1_1",
    "clip": "clip_vit_b32_v1",
}


def model_version_for(model: "ModelName | str") -> str:
    """Return the cache-key model-version string for a given model."""
    name = model.value if isinstance(model, ModelName) else str(model)
    return MODEL_VERSIONS.get(name, name)


# ── NudeNet ─────────────────────────────────────────────────────────────────

_nudenet_detector = None
_nudenet_lock = threading.Lock()


def _ensure_model(name: str):
    """Auto-download model if missing. Called before loading."""
    try:
        from .download_model import get_model
        get_model(name)
    except Exception as e:
        logger.warning("Auto-download for %s failed: %s", name, e)


def get_nudenet():
    global _nudenet_detector
    if _nudenet_detector is not None:
        return _nudenet_detector
    with _nudenet_lock:
        if _nudenet_detector is not None:
            return _nudenet_detector
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


def _detect_nudenet(img: Image.Image) -> list[dict]:
    """Run NudeNet directly from memory, avoiding a lossy JPEG temp file."""
    return [
        {
            "label": r["class"],
            "score": round(float(r["score"]), 4),
            "box": [int(v) for v in r["box"]],
            "box_format": "xywh",
            "model": "nudenet",
            "concept": _normalized_concept(r["class"]),
            "sources": ["nudenet"],
        }
        for r in get_nudenet().detect(np.asarray(img))
    ]


# ── EraX ────────────────────────────────────────────────────────────────────

_erax_model = None
_erax_lock = threading.Lock()

_ERAX_LABEL_MAP = {
    "nipple": "NIPPLE", "penis": "PENIS", "vagina": "VAGINA",
    "anus": "ANUS", "make_love": "MAKE_LOVE",
}


def get_erax():
    global _erax_model
    if _erax_model is not None:
        return _erax_model
    with _erax_lock:
        if _erax_model is not None:
            return _erax_model
        from ultralytics import YOLO

        local_path = MODEL_DIR / ERAX_MODEL_FILENAME

        # Auto-download if missing
        if not local_path.exists():
            logger.info("EraX model not found — downloading automatically...")
            _ensure_model("erax")

        if local_path.exists():
            _erax_model = YOLO(str(local_path))
        else:
            # Direct HuggingFace fallback
            from huggingface_hub import hf_hub_download
            model_path = hf_hub_download(
                repo_id="erax-ai/EraX-Anti-NSFW-V1.1",
                filename=ERAX_MODEL_FILENAME,
                revision=ERAX_MODEL_REVISION,
            )
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
                "model": "erax",
                "concept": _normalized_concept(
                    _ERAX_LABEL_MAP.get(r.names[int(box.cls)], r.names[int(box.cls)].upper())
                ),
                "sources": ["erax"],
            })
    return detections


_CONCEPT_MAP = {
    "FEMALE_BREAST_EXPOSED": "exposed_breast", "NIPPLE": "exposed_breast",
    "FEMALE_GENITALIA_EXPOSED": "exposed_female_genitalia", "VAGINA": "exposed_female_genitalia",
    "MALE_GENITALIA_EXPOSED": "exposed_male_genitalia", "PENIS": "exposed_male_genitalia",
    "ANUS_EXPOSED": "exposed_anus", "ANUS": "exposed_anus",
    "MAKE_LOVE": "sexual_activity",
}


def _normalized_concept(label: str) -> str:
    """Map model-specific labels to a stable cross-model concept."""
    return _CONCEPT_MAP.get(label, label.lower())


def _box_iou(box1: list[int], box2: list[int]) -> float:
    x1, y1, w1, h1 = box1
    x2, y2, w2, h2 = box2
    xa, ya = max(x1, x2), max(y1, y2)
    xb, yb = min(x1 + w1, x2 + w2), min(y1 + h1, y2 + h2)
    intersection = max(0, xb - xa) * max(0, yb - ya)
    union = w1 * h1 + w2 * h2 - intersection
    return intersection / union if union > 0 else 0.0


def merge_ensemble_detections(*groups: list[dict]) -> list[dict]:
    """Fuse overlapping model detections while retaining provenance."""
    merged: list[dict] = []
    for detection in (item for group in groups for item in group):
        candidate = dict(detection)
        candidate.setdefault("concept", _normalized_concept(candidate["label"]))
        candidate.setdefault("sources", [candidate.get("model", "unknown")])
        for index, existing in enumerate(merged):
            if (
                existing["concept"] == candidate["concept"]
                and _box_iou(existing["box"], candidate["box"]) > 0.3
            ):
                sources = sorted(set(existing.get("sources", []) + candidate["sources"]))
                winner = candidate if candidate["score"] > existing["score"] else existing
                winner = dict(winner)
                winner["sources"] = sources
                winner["model"] = "+".join(sources)
                merged[index] = winner
                break
        else:
            merged.append(candidate)
    return sorted(merged, key=lambda item: item["score"], reverse=True)


# ── Image Processing ────────────────────────────────────────────────────────


def validate_upload(data: bytes, max_size: int | None = None):
    from .config import MAX_UPLOAD_SIZE
    limit = max_size or MAX_UPLOAD_SIZE
    if len(data) > limit:
        raise HTTPException(413, f"File too large. Max {limit / (1024 * 1024):.0f}MB.")
    if len(data) == 0:
        raise HTTPException(400, "Empty file")


def open_image(data: bytes) -> Image.Image:
    """Open, EXIF-transpose, and convert an uploaded image to RGB.

    Canonical shared decoder for endpoints that need the raw PIL image without
    detection-size downscaling (clip, face_pose).
    """
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
    except Exception:
        raise HTTPException(400, "Invalid image file")
    if img.mode != "RGB":
        img = img.convert("RGB")
    return img


def blur_regions(
    img: Image.Image,
    boxes: list[list[int]],
    *,
    blur_radius: int = 30,
    divisor: int = 3,
    pad_min: int = 0,
    pad_frac: float = 0.0,
) -> Image.Image:
    """Gaussian-blur each xywh box on ``img`` (mutated in place) and return it.

    Per box: pad = max(pad_min, int(max(bw, bh) * pad_frac)) applied to each
    side, then radius = max(blur_radius, min(region_w, region_h) // divisor).
    Defaults reproduce ``apply_censoring``; face anonymization passes
    blur_radius=40, divisor=2, pad_min=10, pad_frac=0.15.
    """
    for bx, by, bw, bh in boxes:
        pad = max(pad_min, int(max(bw, bh) * pad_frac))
        x1 = max(0, bx - pad)
        y1 = max(0, by - pad)
        x2 = min(img.width, bx + bw + pad)
        y2 = min(img.height, by + bh + pad)
        if x2 <= x1 or y2 <= y1:
            continue
        region = img.crop((x1, y1, x2, y2))
        radius = max(blur_radius, min(region.width, region.height) // divisor)
        img.paste(region.filter(ImageFilter.GaussianBlur(radius=radius)), (x1, y1))
    return img


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
        raw = _detect_nudenet(img)
    elif model == ModelName.erax:
        raw = _detect_erax(img)
    else:
        return merge_ensemble_detections(
            run_detection(img, ModelName.nudenet, scale),
            run_detection(img, ModelName.erax, scale),
        )

    if scale != 1.0:
        inv = 1.0 / scale
        for d in raw:
            d["box"] = [int(v * inv) for v in d["box"]]
    return raw


async def run_detection_async(img: Image.Image, model: ModelName, scale: float) -> list[dict]:
    """Run detection in thread pool to avoid blocking the event loop."""
    import asyncio
    if model == ModelName.ensemble:
        nudenet_dets, erax_dets = await asyncio.gather(
            run_detection_async(img, ModelName.nudenet, scale),
            run_detection_async(img, ModelName.erax, scale),
        )
        return merge_ensemble_detections(nudenet_dets, erax_dets)
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, partial(run_detection, img, model, scale))


def apply_censoring(
    orig: Image.Image, detections: list[dict], censor_labels: list[str],
) -> bytes:
    boxes = [d["box"] for d in detections if d["label"] in censor_labels]
    blur_regions(orig, boxes)
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
    ModelName.ensemble: [
        "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED",
        "MALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED", "ANUS_EXPOSED",
        "NIPPLE", "PENIS", "VAGINA", "ANUS",
    ],
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
        "id": "erax", "name": f"EraX Anti-NSFW v1.1 ({ERAX_MODEL_SIZE})",
        "description": f"YOLO11{ERAX_MODEL_SIZE} – 5 labels, exposed only",
        "labels": ["NIPPLE", "PENIS", "VAGINA", "ANUS", "MAKE_LOVE"],
        "default_censor": DEFAULT_CENSOR[ModelName.erax],
    },
    {
        "id": "ensemble", "name": "NudeNet + EraX Ensemble",
        "description": "Cross-model fusion with normalized concepts and provenance",
        "labels": sorted(set(
            DEFAULT_CENSOR[ModelName.nudenet] + DEFAULT_CENSOR[ModelName.erax]
        )),
        "default_censor": DEFAULT_CENSOR[ModelName.ensemble],
    },
]
