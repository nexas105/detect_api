"""Face detection, anonymization, and pose estimation endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import Response

from ..auth import KeyInfo, log_usage_bg, save_detection_bg, validate_api_key
from ..demo import demo_limiter
from ..face import anonymize_image_async, detect_faces_async
from ..models import get_ext, open_image, store_image_async, validate_upload
from ..pose import estimate_pose_async
from .demo import _get_demo_key
from ..schemas import DemoFacesResponse, DemoPoseResponse, FacesResponse, PoseResponse

router = APIRouter()


# ── Authenticated Endpoints ───────────────────────────────────────────────


@router.post(
    "/anonymize",
    tags=["Face & Pose"],
    responses={200: {"content": {"image/png": {}}, "description": "Anonymized PNG image with faces blurred"}},
)
async def anonymize(
    file: UploadFile = File(...),
    blur_radius: int = Query(40, ge=5, le=200),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Detect and blur all faces in an image for anonymization.

    Uses MediaPipe Face Detection to locate faces, then applies Gaussian blur
    with configurable radius (5-200px) to each face region. Returns the
    anonymized image as PNG. The number of faces found is returned in the
    X-Faces-Found response header.
    """
    data = await file.read()
    validate_upload(data)
    img = open_image(data)

    faces = await detect_faces_async(img)
    anon_bytes = await anonymize_image_async(img, faces, blur_radius)

    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/anonymize", "POST", 200)
    save_detection_bg(key_info, image_id, "anonymize", "mediapipe_face", faces, original_path=orig_path)

    headers = {
        "X-Faces-Found": str(len(faces)),
        "X-Image-Id": image_id,
    }
    return Response(content=anon_bytes, media_type="image/png", headers=headers)


@router.post("/faces", response_model=FacesResponse, tags=["Face & Pose"])
async def faces(
    file: UploadFile = File(...),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Detect faces in an image and return their locations.

    Uses MediaPipe Face Detection to find all faces. Returns bounding boxes
    in [x, y, width, height] format with confidence scores and a total count.
    No blurring is applied -- use /anonymize for that.
    """
    data = await file.read()
    validate_upload(data)
    img = open_image(data)

    face_list = await detect_faces_async(img)

    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/faces", "POST", 200)
    save_detection_bg(key_info, image_id, "faces", "mediapipe_face", face_list, original_path=orig_path)

    return {"image_id": image_id, "faces": face_list, "count": len(face_list)}


@router.post("/pose", response_model=PoseResponse, tags=["Face & Pose"])
async def pose(
    file: UploadFile = File(...),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Estimate body pose from an image using MediaPipe Pose.

    Returns detected keypoints (x, y, z, visibility) for 33 body landmarks
    and a pose analysis summary including posture (standing/sitting/lying),
    facing direction, and whether arms are raised.
    """
    data = await file.read()
    validate_upload(data)
    img = open_image(data)

    pose_result = await estimate_pose_async(img)

    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/pose", "POST", 200)
    save_detection_bg(key_info, image_id, "pose", "mediapipe_pose", [], original_path=orig_path)

    return {"image_id": image_id, "pose": pose_result}


# ── Demo Endpoints ─────────────────────────────────────────────────────────


@router.post(
    "/demo/anonymize",
    tags=["Demo"],
    responses={200: {"content": {"image/png": {}}, "description": "Anonymized PNG image with faces blurred"}},
)
async def demo_anonymize(
    request: Request,
    file: UploadFile = File(...),
    blur_radius: int = Query(40, ge=5, le=200),
):
    """Demo face anonymization with no authentication required.

    Same as /anonymize but with IP-based rate limiting and a 10MB file size cap.
    """
    await demo_limiter.check_image(request)
    data = await file.read()
    validate_upload(data, max_size=10 * 1024 * 1024)
    img = open_image(data)

    faces = await detect_faces_async(img)
    anon_bytes = await anonymize_image_async(img, faces, blur_radius)

    key_info = await _get_demo_key()
    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/demo/anonymize", "POST", 200)
    save_detection_bg(key_info, image_id, "demo", "mediapipe_face", faces, original_path=orig_path)

    headers = {
        "X-Faces-Found": str(len(faces)),
        "X-Image-Id": image_id,
    }
    return Response(content=anon_bytes, media_type="image/png", headers=headers)


@router.post("/demo/faces", response_model=DemoFacesResponse, tags=["Demo"])
async def demo_faces(
    request: Request,
    file: UploadFile = File(...),
):
    """Demo face detection with no authentication required.

    Same as /faces but with IP-based rate limiting and a 10MB file size cap.
    """
    await demo_limiter.check_image(request)
    data = await file.read()
    validate_upload(data, max_size=10 * 1024 * 1024)
    img = open_image(data)

    face_list = await detect_faces_async(img)

    key_info = await _get_demo_key()
    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/demo/faces", "POST", 200)
    save_detection_bg(key_info, image_id, "demo", "mediapipe_face", face_list, original_path=orig_path)

    return {
        "image_id": image_id, "faces": face_list, "count": len(face_list),
        "demo": True, "limits": await demo_limiter.get_remaining(request),
    }


@router.post("/demo/pose", response_model=DemoPoseResponse, tags=["Demo"])
async def demo_pose(
    request: Request,
    file: UploadFile = File(...),
):
    """Demo pose estimation with no authentication required.

    Same as /pose but with IP-based rate limiting and a 10MB file size cap.
    """
    await demo_limiter.check_image(request)
    data = await file.read()
    validate_upload(data, max_size=10 * 1024 * 1024)
    img = open_image(data)

    pose_result = await estimate_pose_async(img)

    key_info = await _get_demo_key()
    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/demo/pose", "POST", 200)
    save_detection_bg(key_info, image_id, "demo", "mediapipe_pose", [], original_path=orig_path)

    return {
        "image_id": image_id, "pose": pose_result,
        "demo": True, "limits": await demo_limiter.get_remaining(request),
    }
