"""CLIP utility endpoints — embedding, compare, zero-shot tagging."""

from __future__ import annotations

import asyncio
import io
import logging
from functools import partial

import numpy as np
import torch
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from PIL import Image, ImageOps

from ..auth import KeyInfo, log_usage_bg, validate_api_key
from ..clip_scorer import _load_clip
from ..demo import demo_limiter
from ..models import get_ext, store_image_async, validate_upload
from ..schemas import (
    CompareResponse, DemoCompareResponse, DemoEmbedResponse, DemoTagResponse,
    EmbedResponse, TagResponse,
)

logger = logging.getLogger("api.clip")

router = APIRouter()

CLIP_MODEL_NAME = "clip-vit-base-patch32"
EMBEDDING_DIM = 768


# ── Helpers ────────────────────────────────────────────────────────────────


def _open_image(data: bytes) -> Image.Image:
    """Open and normalise an uploaded image."""
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
    except Exception:
        raise HTTPException(400, "Invalid image file")
    if img.mode != "RGB":
        img = img.convert("RGB")
    return img


def _get_image_embedding(img: Image.Image, normalize: bool = True) -> list[float]:
    """Extract CLIP image embedding (sync, runs in thread pool)."""
    model, processor = _load_clip()
    if model is None or processor is None:
        raise HTTPException(503, "CLIP model not available")

    inputs = processor(images=img, return_tensors="pt")
    if torch.cuda.is_available():
        inputs = {k: v.cuda() for k, v in inputs.items()}

    with torch.no_grad():
        features = model.get_image_features(**inputs)
        if normalize:
            features = features / features.norm(dim=-1, keepdim=True)

    return features[0].cpu().numpy().tolist()


def _score_labels(img: Image.Image, labels: list[str]) -> list[dict]:
    """Score image against text labels using CLIP (sync)."""
    model, processor = _load_clip()
    if model is None or processor is None:
        raise HTTPException(503, "CLIP model not available")

    inputs = processor(text=labels, images=img, return_tensors="pt", padding=True, truncation=True)
    if torch.cuda.is_available():
        inputs = {k: v.cuda() for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.softmax(outputs.logits_per_image[0], dim=0).cpu().numpy()

    tags = [{"label": labels[i], "score": round(float(probs[i]), 4)} for i in range(len(labels))]
    tags.sort(key=lambda t: t["score"], reverse=True)
    return tags


# ── Authenticated Endpoints ───────────────────────────────────────────────


@router.post("/embed", response_model=EmbedResponse, tags=["CLIP"])
async def embed(
    file: UploadFile = File(...),
    normalize: bool = Query(True),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Extract a 768-dimensional CLIP embedding vector for an image.

    Uses CLIP ViT-B/32 to produce a dense feature vector suitable for
    similarity search, clustering, or downstream classification. The
    embedding is L2-normalized by default. Useful for building custom
    content filters or image search systems.
    """
    data = await file.read()
    validate_upload(data)

    img = _open_image(data)
    loop = asyncio.get_event_loop()
    embedding = await loop.run_in_executor(None, partial(_get_image_embedding, img, normalize))

    image_id, _ = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/embed", "POST", 200)

    return {
        "image_id": image_id,
        "embedding": embedding,
        "dimensions": EMBEDDING_DIM,
        "model": CLIP_MODEL_NAME,
        "normalized": normalize,
    }


@router.post("/compare", response_model=CompareResponse, tags=["CLIP"])
async def compare(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Compute cosine similarity between two images using CLIP embeddings.

    Uploads two images and returns a similarity score (-1 to 1). A score >= 0.85
    indicates the images are visually similar. Useful for duplicate detection,
    near-duplicate matching, or content deduplication pipelines.
    """
    data1 = await file1.read()
    data2 = await file2.read()
    validate_upload(data1)
    validate_upload(data2)

    img1 = _open_image(data1)
    img2 = _open_image(data2)

    loop = asyncio.get_event_loop()
    emb1 = await loop.run_in_executor(None, partial(_get_image_embedding, img1, True))
    emb2 = await loop.run_in_executor(None, partial(_get_image_embedding, img2, True))

    a1, a2 = np.array(emb1), np.array(emb2)
    similarity = float(np.dot(a1, a2) / (np.linalg.norm(a1) * np.linalg.norm(a2)))
    similarity = round(similarity, 4)

    log_usage_bg(key_info, "/compare", "POST", 200)

    return {
        "similarity": similarity,
        "is_similar": similarity >= 0.85,
        "embedding_model": CLIP_MODEL_NAME,
    }


@router.post("/tag", response_model=TagResponse, tags=["CLIP"])
async def tag(
    file: UploadFile = File(...),
    labels: str = Form(...),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Zero-shot image tagging against custom text labels.

    Scores an image against up to 50 comma-separated text labels using CLIP.
    Returns softmax-normalized probabilities for each label, sorted by score.
    Useful for custom content classification without model fine-tuning.
    """
    parsed = [l.strip() for l in labels.split(",") if l.strip()]
    if not parsed:
        raise HTTPException(400, "No labels provided")
    if len(parsed) > 50:
        raise HTTPException(400, f"Too many labels ({len(parsed)}). Maximum is 50.")
    for l in parsed:
        if len(l) > 200:
            raise HTTPException(400, f"Label too long ({len(l)} chars): '{l[:50]}...'. Maximum is 200 chars.")

    data = await file.read()
    validate_upload(data)

    img = _open_image(data)
    loop = asyncio.get_event_loop()
    tags = await loop.run_in_executor(None, partial(_score_labels, img, parsed))

    image_id, _ = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/tag", "POST", 200)

    return {
        "image_id": image_id,
        "tags": tags,
        "model": CLIP_MODEL_NAME,
    }


# ── Demo Endpoints (no auth, IP rate limited) ─────────────────────────────

# Re-use the demo key helper from the demo endpoints module
from .demo import _get_demo_key

demo_router = APIRouter(prefix="/demo")


@demo_router.post("/embed", response_model=DemoEmbedResponse, tags=["Demo"])
async def demo_embed(
    request: Request,
    file: UploadFile = File(...),
    normalize: bool = Query(True),
):
    """Demo CLIP embedding extraction with no authentication required.

    Same as /embed but with IP-based rate limiting and a 10MB file size cap.
    """
    demo_limiter.check_image(request)
    data = await file.read()
    validate_upload(data, max_size=10 * 1024 * 1024)

    img = _open_image(data)
    loop = asyncio.get_event_loop()
    embedding = await loop.run_in_executor(None, partial(_get_image_embedding, img, normalize))

    key_info = await _get_demo_key()
    image_id, _ = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/demo/embed", "POST", 200)

    return {
        "image_id": image_id,
        "embedding": embedding,
        "dimensions": EMBEDDING_DIM,
        "model": CLIP_MODEL_NAME,
        "normalized": normalize,
        "demo": True,
        "limits": demo_limiter.get_remaining(request),
    }


@demo_router.post("/compare", response_model=DemoCompareResponse, tags=["Demo"])
async def demo_compare(
    request: Request,
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
):
    """Demo image comparison with no authentication required.

    Same as /compare but with IP-based rate limiting (counts as 2 images)
    and a 10MB file size cap per image.
    """
    demo_limiter.check_image(request)
    demo_limiter.check_image(request)
    data1 = await file1.read()
    data2 = await file2.read()
    validate_upload(data1, max_size=10 * 1024 * 1024)
    validate_upload(data2, max_size=10 * 1024 * 1024)

    img1 = _open_image(data1)
    img2 = _open_image(data2)

    loop = asyncio.get_event_loop()
    emb1 = await loop.run_in_executor(None, partial(_get_image_embedding, img1, True))
    emb2 = await loop.run_in_executor(None, partial(_get_image_embedding, img2, True))

    a1, a2 = np.array(emb1), np.array(emb2)
    similarity = float(np.dot(a1, a2) / (np.linalg.norm(a1) * np.linalg.norm(a2)))
    similarity = round(similarity, 4)

    key_info = await _get_demo_key()
    log_usage_bg(key_info, "/demo/compare", "POST", 200)

    return {
        "similarity": similarity,
        "is_similar": similarity >= 0.85,
        "embedding_model": CLIP_MODEL_NAME,
        "demo": True,
        "limits": demo_limiter.get_remaining(request),
    }


@demo_router.post("/tag", response_model=DemoTagResponse, tags=["Demo"])
async def demo_tag(
    request: Request,
    file: UploadFile = File(...),
    labels: str = Form(...),
):
    """Demo zero-shot tagging with no authentication required.

    Same as /tag but with IP-based rate limiting and a 10MB file size cap.
    """
    demo_limiter.check_image(request)
    parsed = [l.strip() for l in labels.split(",") if l.strip()]
    if not parsed:
        raise HTTPException(400, "No labels provided")
    if len(parsed) > 50:
        raise HTTPException(400, f"Too many labels ({len(parsed)}). Maximum is 50.")
    for l in parsed:
        if len(l) > 200:
            raise HTTPException(400, f"Label too long ({len(l)} chars): '{l[:50]}...'. Maximum is 200 chars.")

    data = await file.read()
    validate_upload(data, max_size=10 * 1024 * 1024)

    img = _open_image(data)
    loop = asyncio.get_event_loop()
    tags = await loop.run_in_executor(None, partial(_score_labels, img, parsed))

    key_info = await _get_demo_key()
    image_id, _ = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/demo/tag", "POST", 200)

    return {
        "image_id": image_id,
        "tags": tags,
        "model": CLIP_MODEL_NAME,
        "demo": True,
        "limits": demo_limiter.get_remaining(request),
    }
