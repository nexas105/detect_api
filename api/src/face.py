"""Face detection and anonymization using MediaPipe."""

from __future__ import annotations

import asyncio
import io
import logging
from functools import partial

from PIL import Image, ImageFilter

logger = logging.getLogger("api.face")

_face_detector = None
_face_loaded = False


def _load_face_detector():
    global _face_detector, _face_loaded
    if _face_loaded:
        return _face_detector
    _face_loaded = True
    try:
        import mediapipe as mp

        _face_detector = mp.solutions.face_detection.FaceDetection(
            model_selection=1,  # full-range model
            min_detection_confidence=0.5,
        )
        logger.info("MediaPipe Face Detection loaded")
    except Exception as e:
        logger.warning("Face detection not available: %s", e)
        _face_detector = None
    return _face_detector


def detect_faces(img: Image.Image) -> list[dict]:
    """Detect faces. Returns list of {box: [x,y,w,h], score: float}."""
    import numpy as np

    detector = _load_face_detector()
    if detector is None:
        return []

    rgb = np.array(img)
    results = detector.process(rgb)

    faces = []
    if results.detections:
        h, w = rgb.shape[:2]
        for det in results.detections:
            bbox = det.location_data.relative_bounding_box
            x = int(bbox.xmin * w)
            y = int(bbox.ymin * h)
            fw = int(bbox.width * w)
            fh = int(bbox.height * h)
            faces.append({
                "box": [max(0, x), max(0, y), fw, fh],
                "box_format": "xywh",
                "score": round(float(det.score[0]), 4),
            })
    return faces


def anonymize_image(img: Image.Image, faces: list[dict], blur_radius: int = 40) -> bytes:
    """Blur detected faces. Returns PNG bytes."""
    result = img.copy()
    for face in faces:
        bx, by, bw, bh = face["box"]
        # Add padding
        pad = max(10, int(max(bw, bh) * 0.15))
        x1 = max(0, bx - pad)
        y1 = max(0, by - pad)
        x2 = min(result.width, bx + bw + pad)
        y2 = min(result.height, by + bh + pad)
        if x2 <= x1 or y2 <= y1:
            continue
        region = result.crop((x1, y1, x2, y2))
        radius = max(blur_radius, min(region.width, region.height) // 2)
        result.paste(region.filter(ImageFilter.GaussianBlur(radius=radius)), (x1, y1))
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    return buf.getvalue()


async def detect_faces_async(img: Image.Image) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(detect_faces, img))


async def anonymize_image_async(
    img: Image.Image, faces: list[dict], blur_radius: int = 40,
) -> bytes:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(anonymize_image, img, faces, blur_radius))
