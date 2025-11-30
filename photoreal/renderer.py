"""Lightweight photoreal rendering coordinator.

This module does not perform ray-traced rendering on its own but provides a
consistent interface for the HTTP server to queue jobs and eventually dispatch
them to Blender/Cycles. When Blender is not available (the default inside the
preview environment) it copies one of the reference images inside
`image-test/` so that the front-end can exercise the full request/response flow
and surface a realistic-looking placeholder.
"""
from __future__ import annotations

import json
import os
import random
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_DIR = ROOT / 'image-test'
OUTPUT_DIR = ROOT / 'renders' / 'photoreal'
BLENDER_DRIVER = ROOT / 'photoreal' / 'blender_driver.py'
SUPPORTED_IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.webp')


def _ensure_dirs() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _detect_blender_executable() -> Optional[str]:
    """Return the blender executable path if available, else None."""
    env_path = os.environ.get('BLENDER_PATH') or os.environ.get('BLENDER_EXEC')
    if env_path:
        return env_path
    return shutil.which('blender')


def _write_payload(job_id: str, payload: Dict[str, Any]) -> Path:
    path = OUTPUT_DIR / f'{job_id}.json'
    with path.open('w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2)
    return path


def _copy_placeholder(job_id: str) -> Optional[Path]:
    candidates = [p for p in SAMPLE_DIR.glob('*') if p.suffix.lower() in SUPPORTED_IMAGE_EXTS]
    if not candidates:
        return None
    source = random.choice(candidates)
    ext = source.suffix.lower() or '.jpg'
    target = OUTPUT_DIR / f'{job_id}{ext}'
    shutil.copy2(source, target)
    return target


def _invoke_blender(blender_path: str, payload_file: Path, output_file: Path, quality: float) -> (bool, str):
    if not BLENDER_DRIVER.exists():
        return False, 'Blender driver script missing.'
    cmd = [
        blender_path,
        '--background',
        '--python', str(BLENDER_DRIVER),
        '--',
        str(payload_file),
        str(output_file),
        str(max(0.5, min(quality, 4.0)))
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, check=False, text=True, timeout=600)
    except FileNotFoundError:
        return False, 'Blender executable not found.'
    except subprocess.TimeoutExpired:
        return False, 'Blender render timed out.'
    if result.returncode != 0:
        return False, result.stderr.strip() or 'Blender render failed.'
    if not output_file.exists():
        return False, 'Blender reported success but no image was produced.'
    return True, 'Blender render complete.'


def create_job(payload: Dict[str, Any], *, quality: float = 1.0) -> Dict[str, Any]:
    """Create a photoreal render job and return metadata for the HTTP layer."""
    _ensure_dirs()
    job_id = str(uuid.uuid4())
    started_at = time.time()
    payload = payload or {}
    payload.setdefault('meta', {})
    payload['meta']['jobId'] = job_id
    payload['meta']['queuedAt'] = int(started_at * 1000)
    payload['meta']['quality'] = quality

    payload_file = _write_payload(job_id, payload)
    output_path = OUTPUT_DIR / f'{job_id}.png'

    blender_path = _detect_blender_executable()
    has_blender = bool(blender_path)
    note: Optional[str] = None
    success = False

    if blender_path:
        success, note = _invoke_blender(blender_path, payload_file, output_path, quality)

    if not success:
        placeholder = _copy_placeholder(job_id)
        if placeholder:
            output_path = placeholder
            success = True
            if not note:
                note = 'Returned placeholder image because Blender is unavailable.'
        else:
            note = note or 'Unable to provide photoreal image (no Blender or placeholder assets).'

    duration_ms = int((time.time() - started_at) * 1000)
    image_url = None
    if success and output_path.exists():
        image_url = '/' + output_path.relative_to(ROOT).as_posix()

    return {
        'jobId': job_id,
        'status': 'completed' if success else 'failed',
        'durationMs': duration_ms,
        'imageUrl': image_url,
        'hasBlender': has_blender,
        'message': note,
        'payloadFile': '/' + payload_file.relative_to(ROOT).as_posix()
    }