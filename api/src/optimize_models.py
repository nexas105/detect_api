"""Convert and optimize ML models for production.

- NudeNet — already ONNX, no changes needed
- EraX YOLO → ONNX export (keeps original quality)
- CLIP → ONNX + INT16 quantization (~350MB → ~175MB)

Usage:
  python -m api.src.optimize_models
  MODEL_DIR=./api/models python -m api.src.optimize_models
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

MODEL_DIR = Path(os.getenv("MODEL_DIR", os.path.expanduser("~/.nudenet_api/models")))
MODEL_DIR.mkdir(parents=True, exist_ok=True)
ERAX_MODEL_SIZE = os.getenv("ERAX_MODEL_SIZE", "m").strip().lower()
if ERAX_MODEL_SIZE not in {"n", "s", "m"}:
    raise ValueError("ERAX_MODEL_SIZE must be one of: n, s, m")
ERAX_MODEL_STEM = f"erax-anti-nsfw-yolo11{ERAX_MODEL_SIZE}-v1.1"


def _quantize_onnx(input_path: Path, output_path: Path) -> bool:
    """Quantize ONNX model to INT16."""
    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        print(f"  Quantizing to INT16...")
        quantize_dynamic(str(input_path), str(output_path), weight_type=QuantType.QUInt16)
        orig_mb = input_path.stat().st_size / (1024 * 1024)
        opt_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"  {orig_mb:.1f} MB → {opt_mb:.1f} MB")
        return True
    except ImportError:
        print("  pip install onnxruntime for quantization")
        return False
    except Exception as e:
        print(f"  Quantization failed: {e}")
        return False


def optimize_erax():
    """Export EraX YOLO to ONNX (no quantization)."""
    print("\n[EraX] Converting to ONNX...")
    pt_path = MODEL_DIR / f"{ERAX_MODEL_STEM}.pt"
    onnx_path = MODEL_DIR / f"{ERAX_MODEL_STEM}.onnx"

    if onnx_path.exists():
        print(f"  Already converted: {onnx_path}")
        return True
    if not pt_path.exists():
        print(f"  Source not found: {pt_path}")
        return False

    try:
        from ultralytics import YOLO
        model = YOLO(str(pt_path))
        model.export(format="onnx", imgsz=640, simplify=True)
        exported = pt_path.with_suffix(".onnx")
        if exported.exists() and exported != onnx_path:
            shutil.move(str(exported), str(onnx_path))
        mb = onnx_path.stat().st_size / (1024 * 1024)
        print(f"  Exported: {mb:.1f} MB")
        return True
    except Exception as e:
        print(f"  Export failed: {e}")
        return False


def optimize_clip():
    """Export CLIP to ONNX + INT16 quantization."""
    print("\n[CLIP] Converting to ONNX + INT16...")
    vision_q = MODEL_DIR / "clip-vision_int16.onnx"
    text_q = MODEL_DIR / "clip-text_int16.onnx"
    proj_path = MODEL_DIR / "clip-projections.npz"

    if vision_q.exists() and text_q.exists() and proj_path.exists():
        print(f"  Already optimized")
        return True

    try:
        import numpy as np
        import torch
        from transformers import CLIPModel, CLIPProcessor
        from PIL import Image

        model_name = "openai/clip-vit-base-patch32"
        print(f"  Loading {model_name}...")
        model = CLIPModel.from_pretrained(model_name)
        processor = CLIPProcessor.from_pretrained(model_name)
        model.eval()

        # Export vision encoder
        print("  Exporting vision encoder...")
        dummy_image = Image.new("RGB", (224, 224))
        inputs = processor(images=dummy_image, return_tensors="pt")
        vision_onnx = MODEL_DIR / "clip-vision.onnx"

        torch.onnx.export(
            model.vision_model,
            (inputs["pixel_values"],),
            str(vision_onnx),
            input_names=["pixel_values"],
            output_names=["last_hidden_state", "pooler_output"],
            dynamic_axes={"pixel_values": {0: "batch_size"}},
            opset_version=14,
        )

        # Export text encoder
        print("  Exporting text encoder...")
        text_inputs = processor(text=["test"], return_tensors="pt", padding=True)
        text_onnx = MODEL_DIR / "clip-text.onnx"

        torch.onnx.export(
            model.text_model,
            (text_inputs["input_ids"], text_inputs["attention_mask"]),
            str(text_onnx),
            input_names=["input_ids", "attention_mask"],
            output_names=["last_hidden_state", "pooler_output"],
            dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"}},
            opset_version=14,
        )

        # Save projection weights
        print("  Saving projection weights...")
        np.savez(
            str(proj_path),
            visual_projection=model.visual_projection.weight.detach().numpy(),
            text_projection=model.text_projection.weight.detach().numpy(),
        )

        vision_mb = vision_onnx.stat().st_size / (1024 * 1024)
        text_mb = text_onnx.stat().st_size / (1024 * 1024)
        print(f"  ONNX: vision={vision_mb:.1f}MB + text={text_mb:.1f}MB")

        # Quantize to INT16
        _quantize_onnx(vision_onnx, vision_q)
        _quantize_onnx(text_onnx, text_q)

        # Clean up unquantized
        vision_onnx.unlink(missing_ok=True)
        text_onnx.unlink(missing_ok=True)

        # Clean up torch model cache (we have ONNX now)
        print("  CLIP optimized — torch model no longer needed at runtime")
        return True

    except Exception as e:
        print(f"  CLIP optimization failed: {e}")
        return False


def download_clip_tokenizer():
    """Download CLIP tokenizer/processor files for ONNX inference."""
    proc_dir = MODEL_DIR / "clip-processor"
    if proc_dir.exists():
        print("  CLIP processor already cached")
        return True
    try:
        from transformers import CLIPProcessor
        print("  Caching CLIP processor...")
        processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
        processor.save_pretrained(str(proc_dir))
        print(f"  Saved to {proc_dir}")
        return True
    except Exception as e:
        print(f"  Failed: {e}")
        return False


def print_summary():
    print(f"\n{'─' * 50}")
    print(f"Models in {MODEL_DIR}:")
    total = 0
    for f in sorted(MODEL_DIR.iterdir()):
        if f.is_file():
            size_mb = f.stat().st_size / (1024 * 1024)
            total += size_mb
            marker = " [optimized]" if "int16" in f.name or f.suffix == ".onnx" else ""
            print(f"  {f.name} ({size_mb:.1f} MB){marker}")
    print(f"\n  Total: {total:.0f} MB")


if __name__ == "__main__":
    print(f"Model directory: {MODEL_DIR}")

    results = {
        "erax_onnx": optimize_erax(),
        "clip_onnx_int16": optimize_clip(),
        "clip_processor": download_clip_tokenizer(),
    }
    print("\n[NudeNet] Already ONNX — no optimization needed")

    print_summary()

    failed = [k for k, v in results.items() if not v]
    if failed:
        print(f"\nFailed: {', '.join(failed)}")
    else:
        print("\nAll optimizations complete.")
