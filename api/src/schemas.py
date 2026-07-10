"""Pydantic response models for OpenAPI documentation and SDK generation."""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── Detection ──────────────────────────────────────────────────────────────


class Detection(BaseModel):
    label: str = Field(..., description="Detection label (e.g. FEMALE_BREAST_EXPOSED)")
    score: float = Field(..., ge=0, le=1, description="Confidence score 0-1")
    box: list[int] = Field(..., description="Bounding box [x, y, width, height]")
    box_format: str = Field(default="xywh", description="Box coordinate format")
    model: str | None = Field(default=None, description="Source model (nudenet/erax)")
    concept: str | None = Field(default=None, description="Normalized cross-model concept")
    sources: list[str] | None = Field(default=None, description="Models supporting this detection")


class AgeAnalysis(BaseModel):
    estimated_age: float | None = Field(None, description="Estimated age")
    bracket: str | None = Field(None, description="Age bracket: minor/young_adult/adult/middle_aged/senior")
    confidence: float | None = Field(None, ge=0, le=1)
    is_minor_risk: bool = Field(default=False)
    available: bool = Field(default=False)


class DeepfakeAnalysis(BaseModel):
    fake_probability: float = Field(0, ge=0, le=1)
    is_likely_fake: bool = Field(default=False)
    verdict: str | None = Field(None, description="likely_real/possibly_fake/likely_fake")
    confidence: float | None = Field(None, ge=0, le=1)
    available: bool = Field(default=False)


class ClothingAnalysis(BaseModel):
    clothing: str = Field("unknown", description="Detected clothing type")
    confidence: float | None = Field(None, ge=0, le=1)
    exposure_level: float | None = Field(None, ge=0, le=1)
    scores: dict[str, float] | None = None
    available: bool = Field(default=False)


# ── Classify ──────────────────────────────────────────────────────────────


class ClassifyResponse(BaseModel):
    image_id: str
    model: str
    detections: list[Detection]
    age: AgeAnalysis | None = None
    deepfake: DeepfakeAnalysis | None = None
    clothing: ClothingAnalysis | None = None


# ── Moderate ──────────────────────────────────────────────────────────────


class ModerationSummary(BaseModel):
    nudity_score: float = Field(ge=0, le=1)
    violence_score: float = Field(default=0, ge=0, le=1)
    text_flags: list[str] = Field(default_factory=list)


class ModerateResponse(BaseModel):
    image_id: str
    action: str = Field(..., description="Recommended action: allow, flag, or block")
    confidence: float = Field(..., ge=0, le=1, description="Confidence in the action recommendation")
    reasons: list[str] = Field(..., description="Human-readable reasons for the action")
    detections: list[Detection]
    rating: dict = Field(..., description="Full multi-factor rating breakdown")
    clip_analysis: dict = Field(..., description="CLIP analysis results (sexiness, age, deepfake, clothing)")
    summary: ModerationSummary


class DemoModerateResponse(ModerateResponse):
    image_id: str | None = None
    demo: bool = True
    limits: dict = Field(default_factory=dict, description="Remaining demo rate limits")


# ── Embed ────────────────────────────────────────────────────────────────


class EmbedResponse(BaseModel):
    image_id: str
    embedding: list[float] = Field(..., description="768-dimensional CLIP embedding vector")
    dimensions: int = Field(default=768)
    model: str = Field(default="clip-vit-base-patch32")
    normalized: bool = Field(default=True)


class DemoEmbedResponse(EmbedResponse):
    demo: bool = True
    limits: dict = Field(default_factory=dict, description="Remaining demo rate limits")


# ── Compare ──────────────────────────────────────────────────────────────


class CompareResponse(BaseModel):
    similarity: float = Field(..., ge=-1, le=1, description="Cosine similarity score between two images")
    is_similar: bool = Field(..., description="True if similarity >= 0.85")
    embedding_model: str


class DemoCompareResponse(CompareResponse):
    demo: bool = True
    limits: dict = Field(default_factory=dict, description="Remaining demo rate limits")


# ── Tag ──────────────────────────────────────────────────────────────────


class TagScore(BaseModel):
    label: str
    score: float = Field(..., ge=0, le=1)


class TagResponse(BaseModel):
    image_id: str
    tags: list[TagScore]
    model: str


class DemoTagResponse(TagResponse):
    demo: bool = True
    limits: dict = Field(default_factory=dict, description="Remaining demo rate limits")


# ── Faces ────────────────────────────────────────────────────────────────


class FaceDetection(BaseModel):
    box: list[int] = Field(..., description="[x, y, width, height]")
    box_format: str = Field(default="xywh")
    score: float = Field(..., ge=0, le=1)


class FacesResponse(BaseModel):
    image_id: str
    faces: list[FaceDetection]
    count: int


class DemoFacesResponse(FacesResponse):
    demo: bool = True
    limits: dict = Field(default_factory=dict, description="Remaining demo rate limits")


# ── Pose ─────────────────────────────────────────────────────────────────


class Keypoint(BaseModel):
    name: str
    x: int
    y: int
    z: float
    visibility: float = Field(..., ge=0, le=1)


class PoseAnalysis(BaseModel):
    body_detected: bool
    posture: str = Field(..., description="standing/sitting/lying/upper_body_only/unknown")
    facing: str = Field(..., description="front/left/right/back")
    arms_raised: bool
    visible_keypoints: int
    total_keypoints: int


class PoseData(BaseModel):
    available: bool
    detected: bool = False
    keypoints: list[Keypoint] = Field(default_factory=list)
    analysis: PoseAnalysis | None = None


class PoseResponse(BaseModel):
    image_id: str
    pose: PoseData


class DemoPoseResponse(PoseResponse):
    demo: bool = True
    limits: dict = Field(default_factory=dict, description="Remaining demo rate limits")


# ── RateMe ───────────────────────────────────────────────────────────────


class RateMeResponse(BaseModel):
    image_id: str
    models: list[str]
    rating: dict = Field(..., description="Multi-factor rating with score, category, factors breakdown")
    detections: list[Detection]


class DemoRateMeResponse(BaseModel):
    models: list[str]
    rating: dict = Field(..., description="Multi-factor rating with score, category, factors breakdown")
    detections: list[Detection]
    demo: bool = True
    limits: dict = Field(default_factory=dict, description="Remaining demo rate limits")


# ── Batch ────────────────────────────────────────────────────────────────


class BatchFileResult(BaseModel):
    filename: str
    image_id: str | None = None
    detections: list[Detection] | None = None
    error: str | None = None


class BatchResponse(BaseModel):
    model: str
    total: int
    processed: int
    errors: int = 0
    results: list[BatchFileResult]


class DemoBatchResponse(BatchResponse):
    demo: bool = True
    limits: dict = Field(default_factory=dict, description="Remaining demo rate limits")


# ── Demo Classify ────────────────────────────────────────────────────────


class DemoClassifyResponse(BaseModel):
    model: str
    detections: list[Detection]
    image_id: str
    demo: bool = True
    limits: dict = Field(default_factory=dict, description="Remaining demo rate limits")


# ── Video ────────────────────────────────────────────────────────────────


class VideoFrameResult(BaseModel):
    timestamp: float
    detections: list[Detection]


class VideoSummary(BaseModel):
    total_detections: int
    labels_found: dict[str, int]
    max_score: float
    nsfw_frames: int
    nsfw_percentage: float


class VideoInfo(BaseModel):
    duration: float
    fps: float
    width: int
    height: int


class VideoSettings(BaseModel):
    analyze_fps: float
    max_frames: int
    frames_analyzed: int


class VideoClassifyResponse(BaseModel):
    video_id: str
    model: str
    video_info: VideoInfo
    settings: VideoSettings
    frames: list[VideoFrameResult]
    summary: VideoSummary


class DemoVideoClassifyResponse(VideoClassifyResponse):
    demo: bool = True
    limits: dict = Field(default_factory=dict, description="Remaining demo rate limits")


# ── Health ───────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str = "ok"
    models: dict[str, bool]
    workers: dict


class ModelInfo(BaseModel):
    id: str
    name: str
    description: str
    labels: list[str]
    default_censor: list[str]


class ModelsResponse(BaseModel):
    models: list[ModelInfo]


# ── Async Jobs ───────────────────────────────────────────────────────────


class JobAcceptedResponse(BaseModel):
    job_id: str
    status: str = "queued"
    status_url: str


class JobStatusResponse(JobAcceptedResponse):
    endpoint: str
    progress: int = Field(ge=0, le=100)
    result: dict | None = None
    error: str | None = None
    output_url: str | None = None
    created_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


# ── Images / Storage ─────────────────────────────────────────────────────


class ImageEntry(BaseModel):
    id: str
    filename: str
    size: int
    created: str


class ImageListResponse(BaseModel):
    category: str = "censored"
    images: list[ImageEntry]


# ── Demo Limits ──────────────────────────────────────────────────────────


class DemoLimits(BaseModel):
    images_remaining: int
    archives_remaining: int
    reset_seconds: int = 3600


class DemoAdminUsageResponse(BaseModel):
    demo_users: dict
