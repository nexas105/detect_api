"""Video processing endpoints — classify and censor videos frame by frame."""

from __future__ import annotations

import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response

from ..auth import KeyInfo, get_http_client, log_usage_bg, save_detection_bg, validate_api_key
from ..config import AUTH_SERVICE_URL, MAX_VIDEO_DURATION, MAX_VIDEO_SIZE
from ..demo import demo_limiter
from ..models import (
    DEFAULT_CENSOR, ModelName, preprocess, run_detection_async,
)
from ..storage import build_key, storage
from ..video import VIDEO_EXTS, censor_video, extract_frames, extract_scenes, get_video_info, identify_scenes
from ..schemas import DemoVideoClassifyResponse, VideoClassifyResponse

logger = logging.getLogger("api.video")
router = APIRouter()


# ── Helpers ────────────────────────────────────────────────────────────────


def _validate_video_upload(data: bytes, filename: str, max_size: int | None = MAX_VIDEO_SIZE):
    """Validate video file size and extension. max_size=None for unlimited."""
    if max_size is not None and len(data) > max_size:
        raise HTTPException(413, f"Video too large. Max {max_size / (1024 * 1024):.0f}MB.")
    if len(data) == 0:
        raise HTTPException(400, "Empty file")
    from pathlib import Path
    ext = Path(filename).suffix.lower() if filename else ""
    if ext not in VIDEO_EXTS:
        raise HTTPException(400, f"Unsupported video format: {ext}. Supported: {', '.join(sorted(VIDEO_EXTS))}")


def _video_ext(filename: str) -> str:
    return Path(filename).suffix.lower() if filename and "." in filename else ".mp4"


def _store_video(data: bytes, filename: str, category: str) -> tuple[str, str]:
    """Store video (synchronous; use _store_video_async in request handlers)."""
    video_id = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    key = build_key(category, video_id, _video_ext(filename))
    storage.put_bytes(key, data, content_type="video/mp4")
    return video_id, key


async def _store_video_async(data: bytes, filename: str, category: str) -> tuple[str, str]:
    """Upload a video to storage without blocking the event loop."""
    video_id = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    key = build_key(category, video_id, _video_ext(filename))
    await storage.put_bytes_async(key, data, content_type="video/mp4")
    return video_id, key


def _build_summary(all_frames: list[dict]) -> dict:
    """Build detection summary across all frames."""
    total_detections = 0
    labels_found: dict[str, int] = defaultdict(int)
    max_score = 0.0
    nsfw_frames = 0

    for frame in all_frames:
        dets = frame.get("detections", [])
        total_detections += len(dets)
        if dets:
            nsfw_frames += 1
        for d in dets:
            labels_found[d["label"]] += 1
            max_score = max(max_score, d["score"])

    return {
        "total_detections": total_detections,
        "labels_found": dict(labels_found),
        "max_score": round(max_score, 4),
        "nsfw_frames": nsfw_frames,
        "nsfw_percentage": round(nsfw_frames / len(all_frames) * 100, 1) if all_frames else 0,
    }


async def _process_video_classify(
    data: bytes, filename: str, model: ModelName, fps: float, max_frames: int,
    enforce_duration_limit: bool = False,
) -> tuple[str, dict]:
    """Core video classification logic shared by auth and demo endpoints."""
    import asyncio

    info = await asyncio.get_event_loop().run_in_executor(None, get_video_info, data)

    # Duration check (only enforced for demo, auth users are unlimited)
    if enforce_duration_limit and info["duration"] > MAX_VIDEO_DURATION:
        raise HTTPException(
            400,
            f"Video too long ({info['duration']:.1f}s). Max {MAX_VIDEO_DURATION}s.",
        )

    frames = await asyncio.get_event_loop().run_in_executor(
        None, extract_frames, data, fps, max_frames,
    )

    if not frames:
        raise HTTPException(400, "Could not extract frames from video")

    # Run detection on each frame
    frame_results = []
    for timestamp, pil_img in frames:
        img, scale = preprocess_frame(pil_img)
        detections = await run_detection_async(img, model, scale)
        frame_results.append({"timestamp": timestamp, "detections": detections})

    # Store original video
    video_id, orig_path = await _store_video_async(data, filename, "originals")

    summary = _build_summary(frame_results)

    result = {
        "video_id": video_id,
        "model": model.value,
        "video_info": info,
        "settings": {
            "analyze_fps": fps,
            "max_frames": max_frames,
            "frames_analyzed": len(frame_results),
        },
        "frames": frame_results,
        "summary": summary,
    }

    return video_id, result


def preprocess_frame(pil_img):
    """Preprocess a PIL image frame for detection (reuses image preprocess logic)."""
    import io
    from PIL import ImageOps
    from ..config import MAX_DETECT_SIZE

    img = ImageOps.exif_transpose(pil_img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    scale = 1.0
    max_dim = max(img.width, img.height)
    if max_dim > MAX_DETECT_SIZE:
        scale = MAX_DETECT_SIZE / max_dim
        from PIL import Image
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    return img, scale


# ── Cached demo key (same pattern as demo.py) ─────────────────────────────

_demo_key_info: KeyInfo | None = None


async def _get_demo_key() -> KeyInfo:
    """Fetch the demo system API key from auth service (cached)."""
    global _demo_key_info
    if _demo_key_info:
        return _demo_key_info
    try:
        client = await get_http_client()
        resp = await client.get(f"{AUTH_SERVICE_URL}/demo/key")
        if resp.status_code == 200:
            raw_key = resp.json()["key"]
            resp2 = await client.post(
                f"{AUTH_SERVICE_URL}/validate-key",
                headers={"Authorization": f"Bearer {raw_key}"},
            )
            if resp2.status_code == 200:
                _demo_key_info = KeyInfo(resp2.json(), raw_key)
                return _demo_key_info
    except Exception as e:
        logger.warning("Could not fetch demo key: %s", e)
    raise HTTPException(503, "Demo service not ready")


# ── Authenticated Endpoints ───────────────────────────────────────────────


@router.post("/video/classify", response_model=VideoClassifyResponse, tags=["Video"])
async def video_classify(
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
    fps: float = Query(1.0, ge=0.1, le=30.0, description="Frames per second to analyze"),
    max_frames: int = Query(0, ge=0, description="Max frames (0=unlimited)"),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Classify a video frame-by-frame for NSFW content.

    Extracts frames at the specified FPS rate, runs the selected detection model
    on each frame, and returns per-frame detections with timestamps. Includes
    video metadata (duration, resolution, FPS) and a summary with total
    detections, label counts, and NSFW frame percentage. No duration or file
    size limits for authenticated users.
    """
    data = await file.read()
    _validate_video_upload(data, file.filename or "video.mp4", max_size=None)  # unlimited for auth

    video_id, result = await _process_video_classify(
        data, file.filename or "video.mp4", model, fps, max_frames,
    )

    log_usage_bg(key_info, "/video/classify", "POST", 200)
    save_detection_bg(
        key_info, video_id, "video-classify", model.value,
        [d for f in result["frames"] for d in f["detections"]],
        original_path=f"originals/{video_id}",
    )

    return result


@router.post(
    "/video/censor",
    tags=["Video"],
    responses={200: {"content": {"video/mp4": {}}, "description": "Censored MP4 video with NSFW regions blurred"}},
)
async def video_censor(
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
    fps: float = Query(5.0, ge=0.1, le=30.0, description="Higher = smoother censoring, default 5"),
    max_frames: int = Query(0, ge=0, description="Max frames (0=unlimited)"),
    labels: Optional[str] = Form(None),
    blur_radius: int = Query(60, ge=5, le=200),
    interpolate: bool = Query(True, description="Interpolate censoring between analyzed frames"),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Censor NSFW regions in a video using Gaussian blur.

    Analyzes the video frame-by-frame, detects NSFW content, then applies
    Gaussian blur to matching regions throughout. Higher FPS yields smoother
    censoring. Enable interpolation to smooth blur boxes between analyzed frames.
    Returns the censored video as H.264 MP4. No duration or file size limits
    for authenticated users.
    """
    import asyncio

    data = await file.read()
    _validate_video_upload(data, file.filename or "video.mp4", max_size=None)

    video_id, classify_result = await _process_video_classify(
        data, file.filename or "video.mp4", model, fps, max_frames,
    )

    # Determine which labels to censor
    censor_labels = (
        [l.strip() for l in labels.split(",") if l.strip()]
        if labels else DEFAULT_CENSOR[model]
    )

    # Filter detections to only censor specified labels
    detections_per_frame: list[tuple[float, list[dict]]] = []
    total_detections = 0
    for frame in classify_result["frames"]:
        filtered = [d for d in frame["detections"] if d["label"] in censor_labels]
        if filtered:
            detections_per_frame.append((frame["timestamp"], filtered))
            total_detections += len(filtered)

    # Run censoring in thread pool
    censored_bytes = await asyncio.get_event_loop().run_in_executor(
        None, censor_video, data, detections_per_frame, blur_radius, interpolate,
    )

    # Store censored video
    censored_path = build_key("censored", video_id, ".mp4")
    await storage.put_bytes_async(censored_path, censored_bytes, content_type="video/mp4")

    log_usage_bg(key_info, "/video/censor", "POST", 200)
    save_detection_bg(
        key_info, video_id, "video-censor", model.value,
        [d for f in classify_result["frames"] for d in f["detections"]],
        original_path=f"originals/{video_id}",
        censored_path=censored_path,
    )

    return Response(
        content=censored_bytes,
        media_type="video/mp4",
        headers={
            "X-Video-Id": video_id,
            "X-Frames-Analyzed": str(classify_result["settings"]["frames_analyzed"]),
            "X-Detections-Found": str(total_detections),
        },
    )


# ── Demo Endpoint ─────────────────────────────────────────────────────────


@router.post("/demo/video/classify", response_model=DemoVideoClassifyResponse, tags=["Demo"])
async def demo_video_classify(
    request: Request,
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
    fps: float = Query(1.0, ge=0.1, le=5.0),
    max_frames: int = Query(20, ge=1, le=20, description="Max frames (demo limit: 20)"),
):
    """Demo video classification with no authentication required.

    Same frame-by-frame analysis as /video/classify but with demo limits:
    max 30-second video, max 20 frames, 50MB file size cap, and IP-based
    rate limiting.
    """
    demo_limiter.check_image(request)

    data = await file.read()
    _validate_video_upload(data, file.filename or "video.mp4", max_size=50 * 1024 * 1024)

    # Enforce demo limits
    max_frames = min(max_frames, 20)

    # Check duration
    import asyncio
    info = await asyncio.get_event_loop().run_in_executor(None, get_video_info, data)
    if info["duration"] > 30:
        raise HTTPException(400, "Demo limit: max 30 seconds video.")

    video_id, result = await _process_video_classify(
        data, file.filename or "video.mp4", model, fps, max_frames,
    )

    # Store under demo account
    try:
        key_info = await _get_demo_key()
        log_usage_bg(key_info, "/demo/video/classify", "POST", 200)
        save_detection_bg(
            key_info, video_id, "demo-video", model.value,
            [d for f in result["frames"] for d in f["detections"]],
            original_path=f"originals/{video_id}",
        )
    except Exception:
        pass  # non-critical

    result["demo"] = True
    result["limits"] = demo_limiter.get_remaining(request)

    return result


# ── Scene Extraction Endpoints ───────────────────────────────────────────


async def _process_video_scenes(
    data: bytes,
    filename: str,
    model: ModelName,
    fps: float,
    max_frames: int,
    min_scene_duration: float,
    scene_padding: float,
    enforce_duration_limit: bool = False,
) -> tuple[str, bytes, list[tuple[float, float]], dict]:
    """Core scene extraction logic shared by auth and demo endpoints.

    Returns (video_id, compiled_video_bytes, scenes, video_info).
    """
    import asyncio

    info = await asyncio.get_event_loop().run_in_executor(None, get_video_info, data)

    if enforce_duration_limit and info["duration"] > MAX_VIDEO_DURATION:
        raise HTTPException(
            400,
            f"Video too long ({info['duration']:.1f}s). Max {MAX_VIDEO_DURATION}s.",
        )

    frames = await asyncio.get_event_loop().run_in_executor(
        None, extract_frames, data, fps, max_frames,
    )

    if not frames:
        raise HTTPException(400, "Could not extract frames from video")

    # Run detection on each frame
    frame_results = []
    for timestamp, pil_img in frames:
        img, scale = preprocess_frame(pil_img)
        detections = await run_detection_async(img, model, scale)
        frame_results.append({"timestamp": timestamp, "detections": detections})

    # Identify NSFW scenes
    scenes = identify_scenes(
        frame_results,
        fps=fps,
        min_scene_duration=min_scene_duration,
    )

    if not scenes:
        raise HTTPException(404, "No NSFW scenes detected in video.")

    # Store original video
    video_id, orig_path = await _store_video_async(data, filename, "originals")

    # Extract and compile scenes
    compiled_bytes = await asyncio.get_event_loop().run_in_executor(
        None, extract_scenes, data, scenes, scene_padding,
    )

    return video_id, compiled_bytes, scenes, info


@router.post(
    "/video/scenes",
    tags=["Video"],
    responses={200: {"content": {"video/mp4": {}}, "description": "Compiled MP4 video containing only NSFW scenes"}},
)
async def video_scenes(
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
    fps: float = Query(2.0, ge=0.5, le=10.0, description="Frames per second to analyze"),
    min_scene_duration: float = Query(2.0, ge=0.5, description="Min scene length in seconds"),
    scene_padding: float = Query(1.0, ge=0, description="Seconds to add before/after each scene"),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Extract NSFW scenes from a video and return a compiled highlight reel.

    Analyzes the video frame-by-frame to identify contiguous NSFW scenes,
    then extracts and concatenates those scenes into a single MP4 output.
    Scene metadata (start/end timestamps, durations) is returned in the
    X-Scenes-Metadata response header as JSON. Configurable minimum scene
    duration and padding around each scene boundary.
    """
    data = await file.read()
    _validate_video_upload(data, file.filename or "video.mp4", max_size=None)

    video_id, compiled_bytes, scenes, info = await _process_video_scenes(
        data, file.filename or "video.mp4", model, fps,
        max_frames=0, min_scene_duration=min_scene_duration,
        scene_padding=scene_padding,
    )

    # Calculate scenes duration
    scenes_duration = sum(e - s for s, e in scenes)

    # Store compiled video
    await storage.put_bytes_async(
        build_key("scenes", video_id, ".mp4"), compiled_bytes, content_type="video/mp4"
    )

    log_usage_bg(key_info, "/video/scenes", "POST", 200)

    # Build scene metadata
    scene_metadata = [
        {"index": i, "start": round(s, 2), "end": round(e, 2), "duration": round(e - s, 2)}
        for i, (s, e) in enumerate(scenes)
    ]

    return Response(
        content=compiled_bytes,
        media_type="video/mp4",
        headers={
            "X-Video-Id": video_id,
            "X-Scenes-Found": str(len(scenes)),
            "X-Total-Duration": f"{info['duration']:.2f}",
            "X-Scenes-Duration": f"{scenes_duration:.2f}",
            "X-Scenes-Metadata": json.dumps(scene_metadata),
        },
    )


@router.post(
    "/demo/video/scenes",
    tags=["Demo"],
    responses={200: {"content": {"video/mp4": {}}, "description": "Compiled MP4 video containing only NSFW scenes"}},
)
async def demo_video_scenes(
    request: Request,
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
    fps: float = Query(2.0, ge=0.5, le=5.0),
    min_scene_duration: float = Query(2.0, ge=0.5, description="Min scene length in seconds"),
    scene_padding: float = Query(1.0, ge=0, description="Seconds to add before/after each scene"),
    max_frames: int = Query(20, ge=1, le=20, description="Max frames (demo limit: 20)"),
):
    """Demo NSFW scene extraction with no authentication required.

    Same as /video/scenes but with demo limits: max 30-second video, max 20 frames,
    50MB file size cap, and IP-based rate limiting.
    """
    import asyncio

    demo_limiter.check_image(request)

    data = await file.read()
    _validate_video_upload(data, file.filename or "video.mp4", max_size=50 * 1024 * 1024)

    max_frames = min(max_frames, 20)

    # Check duration
    info = await asyncio.get_event_loop().run_in_executor(None, get_video_info, data)
    if info["duration"] > 30:
        raise HTTPException(400, "Demo limit: max 30 seconds video.")

    video_id, compiled_bytes, scenes, info = await _process_video_scenes(
        data, file.filename or "video.mp4", model, fps,
        max_frames=max_frames, min_scene_duration=min_scene_duration,
        scene_padding=scene_padding, enforce_duration_limit=True,
    )

    scenes_duration = sum(e - s for s, e in scenes)

    # Store under demo account
    try:
        key_info = await _get_demo_key()
        log_usage_bg(key_info, "/demo/video/scenes", "POST", 200)
    except Exception:
        pass

    scene_metadata = [
        {"index": i, "start": round(s, 2), "end": round(e, 2), "duration": round(e - s, 2)}
        for i, (s, e) in enumerate(scenes)
    ]

    return Response(
        content=compiled_bytes,
        media_type="video/mp4",
        headers={
            "X-Video-Id": video_id,
            "X-Scenes-Found": str(len(scenes)),
            "X-Total-Duration": f"{info['duration']:.2f}",
            "X-Scenes-Duration": f"{scenes_duration:.2f}",
            "X-Scenes-Metadata": json.dumps(scene_metadata),
        },
    )
