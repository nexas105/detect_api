"""Video processing utilities — frame extraction and video censoring."""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from bisect import bisect_left
from pathlib import Path

from PIL import Image

logger = logging.getLogger("api.video")

VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}


def get_video_info(data: bytes) -> dict:
    """Get video metadata: duration, fps, width, height, frame_count, format."""
    import cv2

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            raise ValueError("Cannot open video file")

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = frame_count / fps if fps > 0 else 0

        cap.release()
        return {
            "duration": round(duration, 2),
            "fps": round(fps, 2),
            "width": width,
            "height": height,
            "frame_count": frame_count,
        }
    finally:
        os.unlink(tmp_path)


def extract_frames(
    data: bytes, fps: float = 1.0, max_frames: int = 0
) -> list[tuple[float, Image.Image]]:
    """Extract frames from video at configurable FPS/interval.

    Args:
        data: Raw video bytes.
        fps: Frames per second to extract (e.g. 1 = one frame per second).
        max_frames: Maximum number of frames (0=unlimited).

    Returns:
        List of (timestamp_seconds, PIL.Image) tuples.
    """
    import cv2
    import numpy as np

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            raise ValueError("Cannot open video file")

        video_fps = cap.get(cv2.CAP_PROP_FPS)
        if video_fps <= 0:
            raise ValueError("Invalid video FPS")

        # Calculate frame interval: every N-th frame
        frame_interval = max(1, int(video_fps / fps))
        frames: list[tuple[float, Image.Image]] = []
        frame_idx = 0

        while max_frames <= 0 or len(frames) < max_frames:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % frame_interval == 0:
                timestamp = frame_idx / video_fps
                # Convert BGR (OpenCV) to RGB (PIL)
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                pil_img = Image.fromarray(rgb)
                frames.append((round(timestamp, 3), pil_img))

            frame_idx += 1

        cap.release()
        return frames
    finally:
        os.unlink(tmp_path)


def _find_nearest(sorted_ts: list[float], target: float) -> float:
    """O(log N) nearest-timestamp lookup using binary search."""
    idx = bisect_left(sorted_ts, target)
    if idx == 0:
        return sorted_ts[0]
    if idx == len(sorted_ts):
        return sorted_ts[-1]
    before, after = sorted_ts[idx - 1], sorted_ts[idx]
    return before if target - before <= after - target else after


def _build_persistent_tracks(
    detections_per_frame: list[tuple[float, list[dict]]],
    persist_seconds: float = 2.0,
    video_fps: float = 25.0,
) -> dict[float, list[list[int]]]:
    """Build persistent censor tracks that survive detection gaps.

    If a body part is detected at frame 1 and frame 10 but not frames 2-9,
    the box stays active for all frames in between. Boxes also persist
    for `persist_seconds` after their last detection.

    Uses label-based tracking: same label = same track, box position smoothed.
    Optimized: generates timestamps only at actual video FPS (not fixed 25fps),
    and uses binary search instead of linear scan for interval filling.
    """
    if not detections_per_frame:
        return {}

    sorted_frames = sorted(detections_per_frame, key=lambda x: x[0])

    # Build per-label tracks: label -> [(timestamp, box), ...]
    label_tracks: dict[str, list[tuple[float, list[int]]]] = {}
    for ts, dets in sorted_frames:
        for d in dets:
            label = d.get("label", "unknown")
            box = d["box"]
            if label not in label_tracks:
                label_tracks[label] = []
            label_tracks[label].append((ts, box))

    all_timestamps = sorted(set(ts for ts, _ in sorted_frames))
    if not all_timestamps:
        return {}

    min_ts = all_timestamps[0]
    max_ts = all_timestamps[-1] + persist_seconds

    # Generate timestamps at actual video FPS instead of fixed 25fps
    step = 1.0 / video_fps if video_fps > 0 else 0.04
    frame_timestamps: list[float] = []
    t = min_ts
    while t <= max_ts:
        frame_timestamps.append(round(t, 3))
        t += step

    # Pre-build result map with empty lists
    result_map: dict[float, list[list[int]]] = {ts: [] for ts in frame_timestamps}

    for label, track in label_tracks.items():
        if not track:
            continue

        for i in range(len(track)):
            curr_ts, curr_box = track[i]

            next_ts, next_box = None, None
            if i + 1 < len(track):
                next_ts, next_box = track[i + 1]

            end_ts = next_ts if next_ts is not None else curr_ts + persist_seconds

            # Use binary search to find the range of frame_timestamps within [curr_ts, end_ts]
            lo = bisect_left(frame_timestamps, curr_ts)
            hi = bisect_left(frame_timestamps, end_ts)
            # Include end_ts if it matches exactly
            if hi < len(frame_timestamps) and abs(frame_timestamps[hi] - end_ts) < 1e-6:
                hi += 1

            for k in range(lo, min(hi, len(frame_timestamps))):
                rts = frame_timestamps[k]

                if next_ts is not None and next_ts > curr_ts:
                    frac = (rts - curr_ts) / (next_ts - curr_ts)
                    frac = min(1.0, max(0.0, frac))
                    box = [int(curr_box[j] + (next_box[j] - curr_box[j]) * frac) for j in range(4)]
                else:
                    box = curr_box

                result_map[rts].append(box)

    # Remove empty timestamps
    return {ts: boxes for ts, boxes in result_map.items() if boxes}


def censor_video(
    input_data: bytes,
    detections_per_frame: list[tuple[float, list[dict]]],
    blur_radius: int = 60,
    interpolate: bool = True,
) -> bytes:
    """Censor a video by applying Gaussian blur to detected regions.

    Uses persistent tracking: if a body part is detected at frames 1 and 10
    but not 2-9, the censor box stays active for all intermediate frames.
    Boxes also persist for 2 seconds after their last detection.

    Args:
        input_data: Raw video bytes.
        detections_per_frame: List of (timestamp_sec, detections) for analyzed frames.
        blur_radius: Gaussian blur kernel size (default 60).
        interpolate: If True, interpolate box positions and persist across gaps.

    Returns:
        Censored video as MP4 bytes.
    """
    import cv2

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_in:
        tmp_in.write(input_data)
        input_path = tmp_in.name

    output_path = tempfile.mktemp(suffix=".mp4")

    try:
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise ValueError("Cannot open video file")

        video_fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Try H.264 first (browser-compatible), fall back to mp4v
        fourcc = cv2.VideoWriter_fourcc(*"avc1")
        out = cv2.VideoWriter(output_path, fourcc, video_fps, (width, height))
        if not out.isOpened():
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            out = cv2.VideoWriter(output_path, fourcc, video_fps, (width, height))

        # Build persistent tracks with gap-filling (pass video_fps for optimized timestamps)
        if interpolate:
            persistent_map = _build_persistent_tracks(
                detections_per_frame, persist_seconds=2.0, video_fps=video_fps,
            )
        else:
            persistent_map = {}
            for ts, dets in detections_per_frame:
                persistent_map[ts] = [d["box"] for d in dets]

        sorted_timestamps = sorted(persistent_map.keys())
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current_ts = round(frame_idx / video_fps, 3) if video_fps > 0 else 0

            # O(log N) nearest-timestamp lookup via binary search
            boxes_to_blur = []
            if sorted_timestamps:
                nearest = _find_nearest(sorted_timestamps, current_ts)
                if abs(nearest - current_ts) < 0.05:  # within ~1 frame
                    boxes_to_blur = persistent_map[nearest]

            if boxes_to_blur:
                frame = _apply_blur_to_frame(frame, boxes_to_blur, blur_radius)

            out.write(frame)
            frame_idx += 1

            # Log progress every 10% for long videos
            if total_frames > 500 and frame_idx % max(1, total_frames // 10) == 0:
                logger.info(
                    "Censoring progress: %d/%d frames (%.0f%%)",
                    frame_idx, total_frames, frame_idx / total_frames * 100,
                )

        cap.release()
        out.release()

        # Re-encode to browser-compatible H.264 using ffmpeg if available
        final_path = output_path
        h264_path = output_path + ".h264.mp4"
        try:
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", output_path, "-c:v", "libx264", "-preset", "fast",
                 "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", h264_path],
                capture_output=True, timeout=300,
            )
            if result.returncode == 0 and os.path.exists(h264_path):
                final_path = h264_path
                logger.info("Re-encoded to H.264 via ffmpeg")
        except (FileNotFoundError, subprocess.TimeoutExpired):
            logger.debug("ffmpeg not available, using raw cv2 output")

        with open(final_path, "rb") as f:
            return f.read()
    finally:
        for p in [input_path, output_path, output_path + ".h264.mp4"]:
            if os.path.exists(p):
                os.unlink(p)



def _apply_blur_to_frame(
    frame, boxes: list[list[int]], blur_radius: int
):
    """Apply Gaussian blur to specified regions of a video frame.

    Uses a single blur pass with a larger kernel + higher sigma for equivalent
    strength to the previous double-pass approach, but ~2x faster per box.
    """
    import cv2

    h, w = frame.shape[:2]
    # Single pass with ~1.4x kernel gives equivalent strength to two passes
    # of the original kernel (convolution of two Gaussians).
    effective_radius = int(blur_radius * 1.4)
    kernel_size = effective_radius * 2 + 1  # Must be odd
    # Higher sigma for stronger blur in single pass
    sigma = effective_radius * 0.5

    for box in boxes:
        bx, by, bw, bh = box
        # Expand box slightly for better coverage
        pad = max(10, int(max(bw, bh) * 0.1))
        x1, y1 = max(0, bx - pad), max(0, by - pad)
        x2, y2 = min(w, bx + bw + pad), min(h, by + bh + pad)
        if x2 <= x1 or y2 <= y1:
            continue
        region = frame[y1:y2, x1:x2]
        blurred = cv2.GaussianBlur(region, (kernel_size, kernel_size), sigma)
        frame[y1:y2, x1:x2] = blurred

    return frame


# ── Scene extraction ──────────────────────────────────────────────────────


def identify_scenes(
    frame_results: list[dict],
    fps: float,
    min_scene_duration: float = 2.0,
    gap_seconds: float = 3.0,
    merge_gap: float = 2.0,
) -> list[tuple[float, float]]:
    """Identify NSFW scenes from frame detection results.

    Args:
        frame_results: List of {"timestamp": float, "detections": [...]} dicts.
        fps: Analysis FPS used for frame extraction.
        min_scene_duration: Minimum scene length in seconds.
        gap_seconds: Seconds of consecutive clean frames to end a scene.
        merge_gap: Merge scenes closer than this many seconds apart.

    Returns:
        List of (start_sec, end_sec) tuples for each scene.
    """
    if not frame_results:
        return []

    # Sort by timestamp
    sorted_results = sorted(frame_results, key=lambda f: f["timestamp"])
    frame_interval = 1.0 / fps if fps > 0 else 1.0

    # Find contiguous groups of NSFW frames
    raw_scenes: list[tuple[float, float]] = []
    scene_start: float | None = None
    last_nsfw_ts: float | None = None

    for frame in sorted_results:
        ts = frame["timestamp"]
        has_detections = len(frame.get("detections", [])) > 0

        if has_detections:
            if scene_start is None:
                scene_start = ts
            last_nsfw_ts = ts
        else:
            # Check if gap exceeds threshold — end current scene
            if scene_start is not None and last_nsfw_ts is not None:
                if ts - last_nsfw_ts >= gap_seconds:
                    raw_scenes.append((scene_start, last_nsfw_ts + frame_interval))
                    scene_start = None
                    last_nsfw_ts = None

    # Close any open scene
    if scene_start is not None and last_nsfw_ts is not None:
        raw_scenes.append((scene_start, last_nsfw_ts + frame_interval))

    if not raw_scenes:
        return []

    # Merge scenes that are very close together
    merged: list[tuple[float, float]] = [raw_scenes[0]]
    for start, end in raw_scenes[1:]:
        prev_start, prev_end = merged[-1]
        if start - prev_end < merge_gap:
            merged[-1] = (prev_start, end)
        else:
            merged.append((start, end))

    # Filter out scenes shorter than min duration
    return [(s, e) for s, e in merged if e - s >= min_scene_duration]


def extract_scenes(
    input_data: bytes,
    scenes: list[tuple[float, float]],
    padding: float = 1.0,
) -> bytes:
    """Extract and concatenate scene segments from video using ffmpeg.

    Args:
        input_data: Raw video bytes of the source video.
        scenes: List of (start_sec, end_sec) tuples.
        padding: Seconds to add before/after each scene.

    Returns:
        Compiled video as MP4 bytes.
    """
    if not scenes:
        raise ValueError("No scenes to extract")

    # Get video duration for clamping
    info = get_video_info(input_data)
    total_duration = info["duration"]

    tmp_dir = tempfile.mkdtemp(prefix="scenes_")
    try:
        # Write input video to temp file
        input_path = os.path.join(tmp_dir, "input.mp4")
        with open(input_path, "wb") as f:
            f.write(input_data)

        scene_files: list[str] = []

        for i, (start, end) in enumerate(scenes):
            # Apply padding, clamped to video bounds
            padded_start = max(0, start - padding)
            padded_end = min(total_duration, end + padding)
            duration = padded_end - padded_start
            if duration <= 0:
                continue

            scene_path = os.path.join(tmp_dir, f"scene_{i:04d}.mp4")

            # Try stream copy first (fast, no re-encoding)
            result = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-ss", f"{padded_start:.3f}",
                    "-i", input_path,
                    "-t", f"{duration:.3f}",
                    "-c", "copy",
                    "-avoid_negative_ts", "make_zero",
                    scene_path,
                ],
                capture_output=True, timeout=120,
            )

            if result.returncode != 0 or not os.path.exists(scene_path) or os.path.getsize(scene_path) == 0:
                # Fall back to re-encoding
                logger.info("Stream copy failed for scene %d, re-encoding", i)
                result = subprocess.run(
                    [
                        "ffmpeg", "-y",
                        "-ss", f"{padded_start:.3f}",
                        "-i", input_path,
                        "-t", f"{duration:.3f}",
                        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                        "-c:a", "aac",
                        "-movflags", "+faststart",
                        scene_path,
                    ],
                    capture_output=True, timeout=300,
                )
                if result.returncode != 0:
                    logger.warning(
                        "Failed to extract scene %d: %s", i, result.stderr.decode(errors="replace"),
                    )
                    continue

            if os.path.exists(scene_path) and os.path.getsize(scene_path) > 0:
                scene_files.append(scene_path)

        if not scene_files:
            raise ValueError("Failed to extract any scenes")

        # If only one scene, return it directly
        if len(scene_files) == 1:
            with open(scene_files[0], "rb") as f:
                return f.read()

        # Concatenate scenes using ffmpeg concat demuxer
        concat_list_path = os.path.join(tmp_dir, "concat.txt")
        with open(concat_list_path, "w") as f:
            for sp in scene_files:
                f.write(f"file '{sp}'\n")

        output_path = os.path.join(tmp_dir, "output.mp4")

        # Try concat with stream copy
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", concat_list_path,
                "-c", "copy",
                "-movflags", "+faststart",
                output_path,
            ],
            capture_output=True, timeout=300,
        )

        if result.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            # Fall back to re-encoding concat
            logger.info("Concat copy failed, re-encoding all scenes")
            result = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-f", "concat", "-safe", "0",
                    "-i", concat_list_path,
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac",
                    "-movflags", "+faststart",
                    output_path,
                ],
                capture_output=True, timeout=600,
            )
            if result.returncode != 0:
                raise ValueError(
                    f"Failed to concatenate scenes: {result.stderr.decode(errors='replace')}"
                )

        with open(output_path, "rb") as f:
            return f.read()
    finally:
        # Cleanup temp directory
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)
