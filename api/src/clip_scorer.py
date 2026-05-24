"""CLIP-based multi-analysis: sexiness, age estimation, deepfake detection, clothing.

All analyses use the same CLIP model — zero additional models needed.
Lazy-loaded, cached, runs in thread pool for async.
"""

from __future__ import annotations

import asyncio
import logging
from functools import partial

import torch
from PIL import Image

logger = logging.getLogger("api.clip")

_clip_model = None
_clip_processor = None
_clip_loaded = False


# ── Prompt Definitions ──────────────────────────────────────────────────────

SEXINESS_PROMPTS = [
    ("a very sexy and seductive photo", 1.0),
    ("an attractive and alluring person", 0.8),
    ("a sensual and provocative pose", 0.9),
    ("a beautiful and desirable person", 0.7),
    ("a normal everyday photo", -0.6),
    ("an unattractive or plain photo", -0.8),
]

AGE_PROMPTS = [
    ("a teenager or very young person", 16),
    ("a young person in their early 20s", 22),
    ("a person in their mid to late 20s", 27),
    ("a person in their 30s", 35),
    ("a middle-aged person in their 40s", 45),
    ("an older person over 50", 55),
    ("an elderly person", 70),
]

DEEPFAKE_PROMPTS = [
    ("a real authentic photograph taken by a camera", 0.0),
    ("a natural unedited photo of a real person", 0.0),
    ("an AI generated image or deepfake", 1.0),
    ("a computer generated or synthetic image", 1.0),
    ("a digitally manipulated or photoshopped image", 0.8),
    ("an artistic render or 3D render", 0.7),
]

CLOTHING_PROMPTS = [
    ("a person wearing formal clothing or a suit", "formal"),
    ("a person wearing casual everyday clothes", "casual"),
    ("a person wearing a swimsuit or bikini", "swimwear"),
    ("a person wearing lingerie or underwear", "lingerie"),
    ("a person wearing a dress", "dress"),
    ("a person wearing sportswear or athletic wear", "sportswear"),
    ("a person with very little clothing, nearly nude", "minimal"),
    ("a fully nude person with no clothing", "nude"),
]


# ── Model Loading ───────────────────────────────────────────────────────────


def _load_clip():
    global _clip_model, _clip_processor, _clip_loaded
    if _clip_loaded:
        return _clip_model, _clip_processor
    _clip_loaded = True

    try:
        from transformers import CLIPModel, CLIPProcessor

        model_name = "openai/clip-vit-base-patch32"
        logger.info("Loading CLIP model: %s", model_name)
        _clip_processor = CLIPProcessor.from_pretrained(model_name)
        _clip_model = CLIPModel.from_pretrained(model_name)
        _clip_model.eval()
        if torch.cuda.is_available():
            _clip_model = _clip_model.cuda()
        logger.info("CLIP loaded successfully")
    except Exception as e:
        logger.warning("CLIP not available: %s", e)
        _clip_model = None
        _clip_processor = None

    return _clip_model, _clip_processor


def _clip_score(img: Image.Image, texts: list[str]) -> list[float] | None:
    """Run CLIP on image against text prompts. Returns softmax probabilities."""
    model, processor = _load_clip()
    if model is None or processor is None:
        return None

    inputs = processor(text=texts, images=img, return_tensors="pt", padding=True, truncation=True)
    if torch.cuda.is_available():
        inputs = {k: v.cuda() for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.softmax(outputs.logits_per_image[0], dim=0).cpu().numpy()
    return [float(p) for p in probs]


# ── Sexiness Scoring ────────────────────────────────────────────────────────


def score_sexiness(img: Image.Image) -> dict:
    """Score image sexiness. Returns 0-1."""
    texts = [p[0] for p in SEXINESS_PROMPTS]
    probs = _clip_score(img, texts)

    if probs is None:
        return {"score": 0.0, "available": False, "detail": "CLIP not available"}

    raw = sum(float(probs[i]) * w for i, (_, w) in enumerate(SEXINESS_PROMPTS))
    score = round(min(1.0, max(0.0, (raw + 0.3) / 0.8)), 4)

    top = sorted(
        [{"prompt": SEXINESS_PROMPTS[i][0], "similarity": round(probs[i], 4)} for i in range(len(probs))],
        key=lambda x: x["similarity"], reverse=True,
    )[:3]

    return {"score": score, "available": True, "top_prompts": top}


# ── Age Estimation ──────────────────────────────────────────────────────────


def estimate_age(img: Image.Image) -> dict:
    """Estimate age from image. Returns estimated age + confidence."""
    texts = [p[0] for p in AGE_PROMPTS]
    probs = _clip_score(img, texts)

    if probs is None:
        return {"estimated_age": None, "confidence": 0.0, "available": False}

    # Weighted average of age values by probability
    ages = [p[1] for p in AGE_PROMPTS]
    estimated = sum(probs[i] * ages[i] for i in range(len(ages)))
    confidence = max(probs)  # how confident the top match is

    # Age bracket
    if estimated < 18:
        bracket = "minor"
    elif estimated < 25:
        bracket = "young_adult"
    elif estimated < 35:
        bracket = "adult"
    elif estimated < 50:
        bracket = "middle_aged"
    else:
        bracket = "senior"

    return {
        "estimated_age": round(estimated, 1),
        "bracket": bracket,
        "confidence": round(confidence, 4),
        "is_minor_risk": estimated < 18 or (estimated < 20 and confidence < 0.3),
        "available": True,
    }


# ── Deepfake Detection ─────────────────────────────────────────────────────


def detect_deepfake(img: Image.Image) -> dict:
    """Detect if image is AI-generated/deepfake. Returns 0-1 fake probability."""
    texts = [p[0] for p in DEEPFAKE_PROMPTS]
    probs = _clip_score(img, texts)

    if probs is None:
        return {"fake_probability": 0.0, "is_likely_fake": False, "available": False}

    # Weighted: real prompts contribute 0, fake prompts contribute their weight
    fake_scores = [p[1] for p in DEEPFAKE_PROMPTS]
    fake_prob = sum(probs[i] * fake_scores[i] for i in range(len(probs)))
    fake_prob = round(min(1.0, max(0.0, fake_prob)), 4)

    return {
        "fake_probability": fake_prob,
        "is_likely_fake": fake_prob > 0.5,
        "confidence": round(max(probs), 4),
        "verdict": "likely_fake" if fake_prob > 0.6 else "possibly_fake" if fake_prob > 0.35 else "likely_real",
        "available": True,
    }


# ── Clothing Detection ──────────────────────────────────────────────────────


def detect_clothing(img: Image.Image) -> dict:
    """Detect clothing type. Returns top clothing category + all scores."""
    texts = [p[0] for p in CLOTHING_PROMPTS]
    probs = _clip_score(img, texts)

    if probs is None:
        return {"clothing": "unknown", "confidence": 0.0, "available": False}

    labels = [p[1] for p in CLOTHING_PROMPTS]
    scores = {labels[i]: round(probs[i], 4) for i in range(len(labels))}
    top_idx = max(range(len(probs)), key=lambda i: probs[i])

    # Exposure level (0=fully clothed, 1=nude)
    exposure_weights = {
        "formal": 0.0, "casual": 0.05, "dress": 0.1,
        "sportswear": 0.15, "swimwear": 0.5, "lingerie": 0.65,
        "minimal": 0.85, "nude": 1.0,
    }
    exposure = sum(probs[i] * exposure_weights.get(labels[i], 0) for i in range(len(labels)))

    return {
        "clothing": labels[top_idx],
        "confidence": round(probs[top_idx], 4),
        "exposure_level": round(min(1.0, exposure), 4),
        "scores": scores,
        "available": True,
    }


# ── Full Analysis (all in one CLIP pass) ────────────────────────────────────


def full_analysis(img: Image.Image) -> dict:
    """Run all CLIP analyses in a single model load. Most efficient."""
    model, processor = _load_clip()
    if model is None or processor is None:
        return {
            "sexiness": {"score": 0.0, "available": False},
            "age": {"estimated_age": None, "available": False},
            "deepfake": {"fake_probability": 0.0, "available": False},
            "clothing": {"clothing": "unknown", "available": False},
        }

    # Combine all prompts for one batch inference
    all_texts = (
        [p[0] for p in SEXINESS_PROMPTS]
        + [p[0] for p in AGE_PROMPTS]
        + [p[0] for p in DEEPFAKE_PROMPTS]
        + [p[0] for p in CLOTHING_PROMPTS]
    )

    inputs = processor(text=all_texts, images=img, return_tensors="pt", padding=True, truncation=True)
    if torch.cuda.is_available():
        inputs = {k: v.cuda() for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)
        all_logits = outputs.logits_per_image[0].cpu()

    # Split results per category and softmax within each
    idx = 0

    # Sexiness
    n = len(SEXINESS_PROMPTS)
    sex_probs = torch.softmax(all_logits[idx:idx + n], dim=0).numpy()
    raw = sum(float(sex_probs[i]) * w for i, (_, w) in enumerate(SEXINESS_PROMPTS))
    sex_score = round(min(1.0, max(0.0, (raw + 0.3) / 0.8)), 4)
    idx += n

    # Age
    n = len(AGE_PROMPTS)
    age_probs = torch.softmax(all_logits[idx:idx + n], dim=0).numpy()
    ages = [p[1] for p in AGE_PROMPTS]
    est_age = sum(float(age_probs[i]) * ages[i] for i in range(n))
    idx += n

    # Deepfake
    n = len(DEEPFAKE_PROMPTS)
    df_probs = torch.softmax(all_logits[idx:idx + n], dim=0).numpy()
    fake_scores = [p[1] for p in DEEPFAKE_PROMPTS]
    fake_prob = sum(float(df_probs[i]) * fake_scores[i] for i in range(n))
    fake_prob = round(min(1.0, max(0.0, fake_prob)), 4)
    idx += n

    # Clothing
    n = len(CLOTHING_PROMPTS)
    cl_probs = torch.softmax(all_logits[idx:idx + n], dim=0).numpy()
    cl_labels = [p[1] for p in CLOTHING_PROMPTS]
    cl_top = cl_labels[max(range(n), key=lambda i: cl_probs[i])]
    exposure_weights = {"formal": 0.0, "casual": 0.05, "dress": 0.1, "sportswear": 0.15,
                        "swimwear": 0.5, "lingerie": 0.65, "minimal": 0.85, "nude": 1.0}
    exposure = sum(float(cl_probs[i]) * exposure_weights.get(cl_labels[i], 0) for i in range(n))

    # Age bracket
    bracket = "minor" if est_age < 18 else "young_adult" if est_age < 25 else "adult" if est_age < 35 else "middle_aged" if est_age < 50 else "senior"

    return {
        "sexiness": {"score": sex_score, "available": True},
        "age": {
            "estimated_age": round(est_age, 1),
            "bracket": bracket,
            "confidence": round(float(max(age_probs)), 4),
            "is_minor_risk": est_age < 18 or (est_age < 20 and float(max(age_probs)) < 0.3),
            "available": True,
        },
        "deepfake": {
            "fake_probability": fake_prob,
            "is_likely_fake": fake_prob > 0.5,
            "verdict": "likely_fake" if fake_prob > 0.6 else "possibly_fake" if fake_prob > 0.35 else "likely_real",
            "available": True,
        },
        "clothing": {
            "clothing": cl_top,
            "exposure_level": round(min(1.0, exposure), 4),
            "scores": {cl_labels[i]: round(float(cl_probs[i]), 4) for i in range(n)},
            "available": True,
        },
    }


async def full_analysis_async(img: Image.Image) -> dict:
    """Run full CLIP analysis in thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(full_analysis, img))


async def score_sexiness_async(img: Image.Image) -> dict:
    """Run sexiness scoring in thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(score_sexiness, img))
