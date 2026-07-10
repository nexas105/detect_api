"""Face detection and anonymization using MediaPipe."""

from __future__ import annotations

import asyncio
import io
import logging
import threading
from functools import partial

from PIL import Image

from .models import blur_regions

logger = logging.getLogger("api.face")

_face_detector = None
_face_loaded = False
_face_lock = threading.Lock()
# MediaPipe graphs are not reentrant — serialize .process() across executor threads.
_face_process_lock = threading.Lock()


def _load_face_detector():
    global _face_detector, _face_loaded
    if _face_loaded:
        return _face_detector
    with _face_lock:
        if _face_loaded:
            return _face_detector
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
        finally:
            _face_loaded = True
    return _face_detector


def detect_faces(img: Image.Image) -> list[dict]:
    """Detect faces. Returns list of {box: [x,y,w,h], score: float}."""
    import numpy as np

    detector = _load_face_detector()
    if detector is None:
        return []

    rgb = np.array(img)
    with _face_process_lock:
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
    blur_regions(
        result, [face["box"] for face in faces],
        blur_radius=blur_radius, divisor=2, pad_min=10, pad_frac=0.15,
    )
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
