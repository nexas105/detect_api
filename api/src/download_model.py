"""Smart model manager — check local → compressed → online, with format conversion.

Priority chain per model:
  1. Model file already in MODEL_DIR → done
  2. Compressed version in MODEL_DIR (.gz, .zip) → extract
  3. Legacy location (~/.NudeNet/) → copy
  4. Download from source → save + compress for next time

Usage:
  python -m api.src.download_model              # from project root
  MODEL_DIR=./api/models python -m api.src.download_model
"""

from __future__ import annotations

import gzip
import os
import shutil
import zipfile
from pathlib import Path

MODEL_DIR = Path(os.getenv("MODEL_DIR", os.path.expanduser("~/.nudenet_api/models")))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

MODELS = {
    "nudenet": {
        "filename": "640m.onnx",
        "size_mb": 99,
        "legacy_path": "~/.NudeNet/640m.onnx",
        "source": "github",
        "repo": "notAI-tech/NudeNet",
        "asset_match": lambda name: "640m" in name and name.endswith(".onnx"),
        "fallback": "bundled_320n",
    },
    "erax": {
        "filename": "erax-anti-nsfw-yolo11s-v1.1.pt",
        "size_mb": 18,
        "legacy_path": None,
        "source": "huggingface",
        "repo_id": "erax-ai/EraX-Anti-NSFW-V1.1",
        "hf_filename": "erax-anti-nsfw-yolo11s-v1.1.pt",
        "fallback": None,
    },
    "clip": {
        "filename": "clip-check",  # special: we check for processor dir
        "size_mb": 350,
        "legacy_path": None,
        "source": "transformers",
        "model_name": "openai/clip-vit-base-patch32",
        "fallback": None,
    },
}


def _find_compressed(target: Path) -> Path | None:
    """Check for compressed versions of a model file (.7z preferred, then .gz, .zip).

    Supports both naming conventions:
      640m.onnx.7z (suffix appended) and 640m.7z (suffix replaced)
    """
    stem = target.stem  # e.g. "640m" from "640m.onnx"
    for ext in [".7z", ".gz", ".zip"]:
        # Try appended: 640m.onnx.7z
        appended = target.with_suffix(target.suffix + ext)
        if appended.exists():
            return appended
        # Try replaced: 640m.7z
        replaced = target.parent / f"{stem}{ext}"
        if replaced.exists():
            return replaced
    return None


def _extract_compressed(compressed: Path, target: Path) -> bool:
    """Extract a compressed model file (.7z, .gz, .zip)."""
    try:
        suffix = compressed.suffix.lower()
        print(f"  Extracting {compressed.name}...")

        if suffix == ".7z":
            import subprocess
            # Try 7z binary (p7zip / 7zip)
            for cmd in ["7z", "7za", "7zz"]:
                try:
                    result = subprocess.run(
                        [cmd, "e", str(compressed), f"-o{target.parent}", "-y"],
                        capture_output=True, text=True, timeout=120,
                    )
                    if result.returncode == 0 and target.exists():
                        return True
                except FileNotFoundError:
                    continue
            # Fallback: try py7zr
            try:
                import py7zr
                with py7zr.SevenZipFile(str(compressed), "r") as z:
                    z.extractall(path=str(target.parent))
                if target.exists():
                    return True
            except ImportError:
                print("  Install 7z (`brew install p7zip`) or `pip install py7zr` to extract .7z")
            return False

        elif suffix == ".gz":
            with gzip.open(str(compressed), "rb") as f_in:
                with open(str(target), "wb") as f_out:
                    shutil.copyfileobj(f_in, f_out)
            return True

        elif suffix == ".zip":
            with zipfile.ZipFile(str(compressed)) as zf:
                for info in zf.infolist():
                    if not info.is_dir():
                        with zf.open(info) as f_in:
                            with open(str(target), "wb") as f_out:
                                shutil.copyfileobj(f_in, f_out)
                        return True

    except Exception as e:
        print(f"  Extract failed: {e}")
        if target.exists():
            target.unlink()
    return False


def _compress_model(target: Path):
    """Create a compressed copy for faster future restores."""
    gz_path = target.with_suffix(target.suffix + ".gz")
    if gz_path.exists():
        return
    try:
        print(f"  Compressing for future use...")
        with open(str(target), "rb") as f_in:
            with gzip.open(str(gz_path), "wb", compresslevel=6) as f_out:
                shutil.copyfileobj(f_in, f_out)
        orig_mb = target.stat().st_size / (1024 * 1024)
        gz_mb = gz_path.stat().st_size / (1024 * 1024)
        print(f"  Compressed: {orig_mb:.1f} MB → {gz_mb:.1f} MB ({gz_path.name})")
    except Exception as e:
        print(f"  Compression failed (non-critical): {e}")


def _download_github(model_cfg: dict, target: Path) -> bool:
    """Download from GitHub releases via API."""
    try:
        import httpx

        api_url = f"https://api.github.com/repos/{model_cfg['repo']}/releases"
        releases = httpx.get(api_url, timeout=30, follow_redirects=True).json()

        asset_url = None
        for release in releases:
            for asset in release.get("assets", []):
                if model_cfg["asset_match"](asset["name"]):
                    asset_url = asset["url"]
                    break
            if asset_url:
                break

        if not asset_url:
            raise Exception("Asset not found in releases")

        print(f"  Downloading (~{model_cfg['size_mb']} MB)...")
        headers = {"Accept": "application/octet-stream"}
        with httpx.stream("GET", asset_url, headers=headers, follow_redirects=True, timeout=300) as resp:
            resp.raise_for_status()
            total = 0
            with open(str(target), "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=65536):
                    f.write(chunk)
                    total += len(chunk)

        # Validate size (at least 1MB)
        if target.stat().st_size < 1024 * 1024:
            target.unlink()
            raise Exception(f"Downloaded file too small ({total} bytes), likely corrupt")

        return True
    except Exception as e:
        print(f"  GitHub download failed: {e}")
        return False


def _download_huggingface(model_cfg: dict, target: Path) -> bool:
    """Download from HuggingFace Hub."""
    try:
        from huggingface_hub import hf_hub_download

        print(f"  Downloading from HuggingFace (~{model_cfg['size_mb']} MB)...")
        cached_path = hf_hub_download(
            repo_id=model_cfg["repo_id"],
            filename=model_cfg["hf_filename"],
        )
        shutil.copy2(cached_path, str(target))
        return True
    except Exception as e:
        print(f"  HuggingFace download failed: {e}")
        return False


def _download_transformers(model_cfg: dict) -> bool:
    """Pre-download CLIP model from HuggingFace transformers."""
    try:
        from transformers import CLIPModel, CLIPProcessor

        model_name = model_cfg["model_name"]
        print(f"  Downloading {model_name} (~{model_cfg['size_mb']} MB)...")
        CLIPProcessor.from_pretrained(model_name)
        CLIPModel.from_pretrained(model_name)
        # Cache locally for offline use
        proc_dir = MODEL_DIR / "clip-processor"
        if not proc_dir.exists():
            processor = CLIPProcessor.from_pretrained(model_name)
            processor.save_pretrained(str(proc_dir))
        return True
    except Exception as e:
        print(f"  CLIP download failed: {e}")
        return False


def _fallback_bundled(model_cfg: dict) -> bool:
    """Fall back to bundled model (NudeNet 320n)."""
    if model_cfg.get("fallback") == "bundled_320n":
        print("  Falling back to bundled 320n model...")
        from nudenet import NudeDetector
        NudeDetector()
        print("  Bundled 320n ready at ~/.NudeNet/")
        return True
    return False


def get_model(name: str):
    """Smart model acquisition: local → compressed → legacy → download."""
    cfg = MODELS[name]

    # CLIP is special — check for optimized ONNX or cached transformers
    if cfg["source"] == "transformers":
        print(f"\n[{name}] CLIP model")
        # Check for optimized ONNX version first
        int16_vision = MODEL_DIR / "clip-vision_int16.onnx"
        int16_text = MODEL_DIR / "clip-text_int16.onnx"
        if int16_vision.exists() and int16_text.exists():
            print(f"  ✓ Optimized ONNX (INT16) found")
            return True
        # Check for cached processor (means transformers model is cached too)
        proc_dir = MODEL_DIR / "clip-processor"
        if proc_dir.exists():
            print(f"  ✓ Cached (transformers)")
            return True
        # Download
        if _download_transformers(cfg):
            print(f"  ✓ Downloaded")
            return True
        print(f"  ✗ CLIP not available (rateme will use fallback scoring)")
        return False

    target = MODEL_DIR / cfg["filename"]
    print(f"\n[{name}] {cfg['filename']}")

    # 1. Already exists?
    if target.exists() and target.stat().st_size > 1024:
        size_mb = target.stat().st_size / (1024 * 1024)
        print(f"  ✓ Found ({size_mb:.1f} MB)")
        return True

    # 2. Compressed version?
    compressed = _find_compressed(target)
    if compressed:
        if _extract_compressed(compressed, target):
            size_mb = target.stat().st_size / (1024 * 1024)
            print(f"  ✓ Extracted ({size_mb:.1f} MB)")
            return True

    # 3. Legacy location?
    if cfg.get("legacy_path"):
        legacy = Path(os.path.expanduser(cfg["legacy_path"]))
        if legacy.exists() and legacy.stat().st_size > 1024:
            print(f"  Found at legacy location: {legacy}")
            shutil.copy2(str(legacy), str(target))
            _compress_model(target)
            print(f"  ✓ Copied from legacy")
            return True

    # 4. Download
    success = False
    if cfg["source"] == "github":
        success = _download_github(cfg, target)
    elif cfg["source"] == "huggingface":
        success = _download_huggingface(cfg, target)

    if success:
        _compress_model(target)
        print(f"  ✓ Downloaded")
        return True

    # 5. Fallback
    if _fallback_bundled(cfg):
        return True

    print(f"  ✗ Could not obtain model")
    return False


# ── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Model directory: {MODEL_DIR}")
    results = {}
    for name in MODELS:
        results[name] = get_model(name)

    print(f"\n{'─' * 50}")
    print(f"Models in {MODEL_DIR}:")
    for f in sorted(MODEL_DIR.iterdir()):
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"  {f.name} ({size_mb:.1f} MB)")

    if not all(results.values()):
        failed = [k for k, v in results.items() if not v]
        print(f"\n⚠ Failed: {', '.join(failed)}")
else:
    # Also run when imported as module (python -m api.src.download_model)
    print(f"Model directory: {MODEL_DIR}")
    for name in MODELS:
        get_model(name)
    print(f"\nModels in {MODEL_DIR}:")
    for f in sorted(MODEL_DIR.iterdir()):
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"  {f.name} ({size_mb:.1f} MB)")
