FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 curl ffmpeg \
    libsm6 libxext6 libxrender1 && \
    rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# GPU build: replace CPU-pinned torch/torchvision (from requirements.txt) with the
# CUDA build, and swap onnxruntime (pulled in by nudenet) for onnxruntime-gpu so
# NudeNet runs on CUDA too. Default is CPU — the docker-compose.gpu.yml override
# sets TORCH_VARIANT=cuda and the LD_LIBRARY_PATH that lets onnxruntime-gpu find
# the CUDA/cuDNN libs bundled by the CUDA torch wheel.
# TORCH_CUDA_INDEX optionally pins a torch channel (e.g.
# https://download.pytorch.org/whl/cu124); empty = default PyPI CUDA wheels.
# NOTE: onnxruntime-gpu's cuDNN/CUDA major must match what the torch wheel bundles
# (recent torch = CUDA 12 / cuDNN 9). Verify on a real GPU host — this cannot be
# validated in a CPU build.
ARG TORCH_VARIANT=cpu
ARG TORCH_CUDA_INDEX=
RUN --mount=type=cache,target=/root/.cache/pip \
    if [ "$TORCH_VARIANT" = "cuda" ]; then \
      if [ -n "$TORCH_CUDA_INDEX" ]; then \
        pip install --force-reinstall torch==2.11.0 torchvision==0.26.0 --index-url "$TORCH_CUDA_INDEX"; \
      else \
        pip install --force-reinstall torch==2.11.0 torchvision==0.26.0; \
      fi; \
      pip uninstall -y onnxruntime && pip install onnxruntime-gpu; \
    fi

# Download 640m model via GitHub API (direct link broken, API still works)
RUN mkdir -p /root/.NudeNet && \
    curl -L -H "Accept: application/octet-stream" \
    "https://api.github.com/repos/notAI-tech/NudeNet/releases/assets/176832019" \
    -o /root/.NudeNet/640m.onnx

# Copy shared db package + api source
COPY db ./db
COPY api ./api

# Warm up EraX + bundled NudeNet
RUN python -m api.src.download_model

# Pre-download CLIP model into the image so it doesn't fetch from HuggingFace on every deploy.
# Cache lives at /root/.cache/huggingface — also mounted as volume for persistence across restarts.
ENV HF_HOME=/root/.cache/huggingface
RUN python -c "from transformers import CLIPModel, CLIPProcessor; m='openai/clip-vit-base-patch32'; CLIPProcessor.from_pretrained(m); CLIPModel.from_pretrained(m); print('CLIP cached')"

# Verify MediaPipe loads (face detection + pose estimation)
RUN python -c "import mediapipe as mp; mp.solutions.face_detection.FaceDetection(model_selection=1); mp.solutions.pose.Pose(static_image_mode=True); print('MediaPipe OK')"

VOLUME /app/storage

EXPOSE 8000

CMD ["uvicorn", "api.src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
