"""Body pose estimation using MediaPipe."""

from __future__ import annotations

import asyncio
import logging
from functools import partial

from PIL import Image

logger = logging.getLogger("api.pose")

_pose_estimator = None
_pose_loaded = False

POSE_LANDMARKS = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky",
    "left_index", "right_index", "left_thumb", "right_thumb",
    "left_hip", "right_hip", "left_knee", "right_knee",
    "left_ankle", "right_ankle", "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
]


def _load_pose():
    global _pose_estimator, _pose_loaded
    if _pose_loaded:
        return _pose_estimator
    _pose_loaded = True
    try:
        import mediapipe as mp

        _pose_estimator = mp.solutions.pose.Pose(
            static_image_mode=True,
            model_complexity=1,
            min_detection_confidence=0.5,
        )
        logger.info("MediaPipe Pose loaded")
    except Exception as e:
        logger.warning("Pose estimation not available: %s", e)
        _pose_estimator = None
    return _pose_estimator


def estimate_pose(img: Image.Image) -> dict:
    """Estimate body pose. Returns keypoints + analysis."""
    import numpy as np

    estimator = _load_pose()
    if estimator is None:
        return {"available": False, "keypoints": [], "analysis": {}}

    rgb = np.array(img)
    results = estimator.process(rgb)

    if not results.pose_landmarks:
        return {"available": True, "detected": False, "keypoints": [], "analysis": {"body_detected": False}}

    h, w = rgb.shape[:2]
    keypoints = []
    for i, landmark in enumerate(results.pose_landmarks.landmark):
        name = POSE_LANDMARKS[i] if i < len(POSE_LANDMARKS) else f"point_{i}"
        keypoints.append({
            "name": name,
            "x": round(landmark.x * w),
            "y": round(landmark.y * h),
            "z": round(float(landmark.z), 4),
            "visibility": round(float(landmark.visibility), 4),
        })

    # Analyze pose characteristics
    analysis = _analyze_pose(keypoints, w, h)

    return {"available": True, "detected": True, "keypoints": keypoints, "analysis": analysis}


def _analyze_pose(keypoints: list[dict], img_w: int, img_h: int) -> dict:
    """Analyze pose characteristics from keypoints."""
    kp = {k["name"]: k for k in keypoints}

    # Body orientation
    ls = kp.get("left_shoulder", {})
    rs = kp.get("right_shoulder", {})
    lh = kp.get("left_hip", {})
    rh = kp.get("right_hip", {})

    # Standing vs sitting vs lying
    if ls.get("visibility", 0) > 0.5 and lh.get("visibility", 0) > 0.5:
        shoulder_y = (ls.get("y", 0) + rs.get("y", 0)) / 2
        hip_y = (lh.get("y", 0) + rh.get("y", 0)) / 2
        torso_length = abs(hip_y - shoulder_y)

        la = kp.get("left_ankle", {})
        ra = kp.get("right_ankle", {})
        if la.get("visibility", 0) > 0.3 and ra.get("visibility", 0) > 0.3:
            ankle_y = (la.get("y", 0) + ra.get("y", 0)) / 2
            leg_length = abs(ankle_y - hip_y)
            if leg_length < torso_length * 0.5:
                posture = "sitting"
            elif abs(shoulder_y - hip_y) < img_h * 0.1:
                posture = "lying"
            else:
                posture = "standing"
        else:
            posture = "upper_body_only"
    else:
        posture = "unknown"

    # Facing direction
    nose = kp.get("nose", {})
    if nose.get("visibility", 0) > 0.5:
        nose_x_rel = nose.get("x", img_w / 2) / img_w
        if nose_x_rel < 0.35:
            facing = "left"
        elif nose_x_rel > 0.65:
            facing = "right"
        else:
            facing = "front"
    else:
        facing = "back"

    # Arms position
    lw = kp.get("left_wrist", {})
    rw = kp.get("right_wrist", {})
    arms_raised = False
    if lw.get("visibility", 0) > 0.3 and ls.get("visibility", 0) > 0.3:
        if lw.get("y", 999) < ls.get("y", 0):
            arms_raised = True
    if rw.get("visibility", 0) > 0.3 and rs.get("visibility", 0) > 0.3:
        if rw.get("y", 999) < rs.get("y", 0):
            arms_raised = True

    # Visible body parts count
    visible_parts = sum(1 for k in keypoints if k.get("visibility", 0) > 0.5)

    return {
        "body_detected": True,
        "posture": posture,
        "facing": facing,
        "arms_raised": arms_raised,
        "visible_keypoints": visible_parts,
        "total_keypoints": len(keypoints),
    }


async def estimate_pose_async(img: Image.Image) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(estimate_pose, img))
