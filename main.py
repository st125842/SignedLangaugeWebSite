import io
import os
import time
import tempfile
import traceback

import cv2
import numpy as np
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import List, Optional
import uvicorn

# ── Sign-check helpers (from realtime_sign_check2.py) ────────────────────────
from utils import (
    normalize_skeleton,
    run_dtw_and_errors,
    POSE_LANDMARK_COUNT,
    HAND_LANDMARK_COUNT,
    DIM,
    ERROR_COLOR,
    CORRECT_COLOR,
    RADIUS,
)

app = FastAPI(title="Sign Language App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files (JS, CSS) and video folder
app.mount("/static",  StaticFiles(directory="static"),  name="static")
app.mount("/Videos",  StaticFiles(directory="Videos"),  name="videos")

templates = Jinja2Templates(directory="templates")

# ── Slide Data by Level ───────────────────────────────────────────────────────

SLIDES = {
    "easy": {
        "type": "letters",
        "title": "เลือกตัวอักษร",
        "subtitle": "พยัญชนะไทย",
        "consonants": [
            "ก", "ข", "ค", "ฅ", "ฆ", "ง",
            "จ", "ฉ", "ช", "ซ", "ฌ", "ญ",
            "ฎ", "ฏ", "ฐ", "ฑ", "ฒ", "ณ",
            "ด", "ต", "ถ", "ท", "ธ", "น",
            "บ", "ป", "ผ", "ฝ", "พ", "ฟ",
            "ภ", "ม", "ย", "ร", "ล", "ว",
            "ศ", "ษ", "ส", "ห", "ฬ", "อ", "ฮ"
        ],
        "numbers": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        "items": [
            "ก", "ข", "ค", "ฅ", "ฆ", "ง",
            "จ", "ฉ", "ช", "ซ", "ฌ", "ญ",
            "ฎ", "ฏ", "ฐ", "ฑ", "ฒ", "ณ",
            "ด", "ต", "ถ", "ท", "ธ", "น",
            "บ", "ป", "ผ", "ฝ", "พ", "ฟ",
            "ภ", "ม", "ย", "ร", "ล", "ว",
            "ศ", "ษ", "ส", "ห", "ฬ", "อ", "ฮ",
            "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"
        ],
    },
    "medium": {
        "type": "words",
        "title": "เลือกคำ",
        "subtitle": "คำศัพท์ภาษามือ",
        "items": ["ต่อย", "ไหว้", "รัก", "ซื้อ", "ขาย", "มอง",
                  "ตบ", "ลาก", "หลับ", "ขโมย", "โจร", "พยายาม",
                  "กระโดด", "วิ่ง", "อ่าน", "เขียน"],
    },
    "hard": {
        "type": "sentences",
        "title": "เลือกประโยค",
        "subtitle": "ประโยคภาษามือ",
        "items": ["ไปกินข้าวที่โรงอาหาร", "สัมภาษณ์งาน",
                  "แข่งบาสเก็ตบอล", "วิ่งหนีโจรอย่างรวดเร็ว",
                  "กระโดดข้ามตึก"],
    },
}

# ── Video mapping ─────────────────────────────────────────────────────────────

VIDEO_MAP = {
    "ก": "th_dorDek.mp4",
    "ข": "th_khorRakhang.mp4",
    "ค": "en_k.mp4",
    "ด": "th_dorDek.mp4",
    # extend as needed …
}

# ── NPY mapping: item label → path to reference .npy skeleton file ───────────
# Each .npy file should be a float32 array of shape (T, 75, 2)
# produced by recording a reference sign and saving np.stack(recorded_xy_skel).

NPY_MAP = {
    # ── Easy: consonants ──────────────────────────────────────────────────────
    "ก":  "xy_skeleton/th_dorDek.npy",
    "ข":  "xy_skeleton/th_khorRakhang.npy",
    "ค":  "xy_skeleton/th_khorKwai.npy",
    "ง":  "xy_skeleton/th_ngorNgu.npy",
    "จ":  "xy_skeleton/th_jorJan.npy",
    "ช":  "xy_skeleton/th_chorChing.npy",
    "อ":  "xy_skeleton/th_orAng.npy",
    "ส":  "xy_skeleton/th_sorSala.npy",
    "ด":  "xy_skeleton/DorDek.npy",
    # ── Easy: numbers ────────────────────────────────────────────────────────
    "0":  "xy_skeleton/num_0.npy",
    "1":  "xy_skeleton/num_1.npy",
    "2":  "xy_skeleton/num_2.npy",
    "3":  "xy_skeleton/num_3.npy",
    "4":  "xy_skeleton/num_4.npy",
    "5":  "xy_skeleton/num_5.npy",
    "6":  "xy_skeleton/num_6.npy",
    "7":  "xy_skeleton/num_7.npy",
    "8":  "xy_skeleton/num_8.npy",
    "9":  "xy_skeleton/num_9.npy",
    "10": "xy_skeleton/num_10.npy",
    "11": "xy_skeleton/num_11.npy",
    # ── Medium: words ────────────────────────────────────────────────────────
    "ต่อย":    "xy_skeleton/toi.npy",
    "ไหว้":    "xy_skeleton/wai.npy",
    "รัก":     "xy_skeleton/rak.npy",
    "ซื้อ":    "xy_skeleton/sue.npy",
    "ขาย":     "xy_skeleton/khai.npy",
    "มอง":     "xy_skeleton/mong.npy",
    "ตบ":      "xy_skeleton/top.npy",
    "ลาก":     "xy_skeleton/lak.npy",
    "หลับ":    "xy_skeleton/lap.npy",
    "ขโมย":   "xy_skeleton/khamoi.npy",
    "โจร":     "xy_skeleton/jon.npy",
    "พยายาม": "xy_skeleton/phayayam.npy",
    "กระโดด": "xy_skeleton/kradot.npy",
    "วิ่ง":    "xy_skeleton/wing.npy",
    "อ่าน":   "xy_skeleton/an.npy",
    "เขียน":  "xy_skeleton/khian.npy",
    # ── Hard: sentences ──────────────────────────────────────────────────────
    "ไปกินข้าวที่โรงอาหาร":    "xy_skeleton/go_eat.npy",
    "สัมภาษณ์งาน":              "xy_skeleton/interview.npy",
    "แข่งบาสเก็ตบอล":           "xy_skeleton/basketball.npy",
    "วิ่งหนีโจรอย่างรวดเร็ว":   "xy_skeleton/run_thief.npy",
    "กระโดดข้ามตึก":            "xy_skeleton/jump_building.npy",
}

# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/slides/{level}")
def get_slides_by_level(level: str):
    level = level.lower()
    if level not in SLIDES:
        return {"error": f"Level '{level}' not found."}
    return SLIDES[level]


@app.get("/api/video/{item}")
def get_video(item: str):
    filename = VIDEO_MAP.get(item)
    if filename:
        return {"video": f"/Videos/{filename}"}
    return {"video": None}


@app.get("/api/npy/{item}")
def get_npy_path(item: str):
    """Return whether a reference .npy file exists for this item."""
    path = NPY_MAP.get(item)
    if path and os.path.exists(path):
        return {"has_reference": True}
    return {"has_reference": False}


# ── Analyze endpoint ──────────────────────────────────────────────────────────

class LandmarkFrame(BaseModel):
    """
    One frame: flat list of (x,y) pairs for 75 joints.
    pose[0..32], left_hand[33..53], right_hand[54..74]
    """
    joints: List[List[float]]  # shape (75, 2)


class AnalyzeRequest(BaseModel):
    item:   str
    frames: List[LandmarkFrame]
    fps:    Optional[float] = 20.0


class AnalyzeResponse(BaseModel):
    score:         float
    global_errors: List[int]
    message:       str
    feedback_id:   str   # key to fetch the rendered video


# Temporary store for rendered feedback videos: {id: bytes}
_feedback_store: dict[str, bytes] = {}


# ── Skeleton connection tables ────────────────────────────────────────────────
_POSE_CONNECTIONS = [
    (11, 12), (11, 13), (13, 15), (15, 17), (15, 19), (15, 21), (17, 19),
    (12, 14), (14, 16), (16, 18), (16, 20), (16, 22), (18, 20),
    (11, 23), (12, 24), (23, 24),
]
_HAND_CONNECTIONS_REL = [
    (0,1),(1,2),(2,3),(3,4),
    (0,5),(5,6),(6,7),(7,8),
    (0,9),(9,10),(10,11),(11,12),
    (0,13),(13,14),(14,15),(15,16),
    (0,17),(17,18),(18,19),(19,20),
    (5,9),(9,13),(13,17),
]
_FACE_JOINTS = set(range(11))

def _joint_color(idx: int, error_joints: set):
    return ERROR_COLOR if idx in error_joints else CORRECT_COLOR

def _draw_bone(out, p1, p2, c1, c2, thickness=3):
    """Draw a bone between two joints; blend colors at midpoint."""
    mid = ((p1[0] + p2[0]) // 2, (p1[1] + p2[1]) // 2)
    cv2.line(out, p1, mid, c1, thickness, cv2.LINE_AA)
    cv2.line(out, mid, p2, c2, thickness, cv2.LINE_AA)

def _draw_joint_dot(out, cx, cy, color, radius=RADIUS + 1):
    # Glow halo
    glow = tuple(min(255, int(c * 0.4)) for c in color)
    cv2.circle(out, (cx, cy), radius + 4, glow, -1, cv2.LINE_AA)
    # Solid dot
    cv2.circle(out, (cx, cy), radius, color, -1, cv2.LINE_AA)
    # White border
    cv2.circle(out, (cx, cy), radius, (255, 255, 255), 1, cv2.LINE_AA)

def _draw_joints_on_frame(frame_bgr: np.ndarray,
                           xy_image: np.ndarray,
                           error_joints: set) -> np.ndarray:
    """Overlay a MediaPipe-style skeleton (bones + joints) with error coloring."""
    h, w = frame_bgr.shape[:2]
    out = frame_bgr.copy()

    def pt(j):
        x, y = xy_image[j]
        return int(x * w), int(y * h)

    def missing(j):
        x, y = xy_image[j]
        return x <= 0 and y <= 0

    # ── Pose bones ────────────────────────────────────────────────────────────
    for a, b in _POSE_CONNECTIONS:
        if missing(a) or missing(b):
            continue
        _draw_bone(out, pt(a), pt(b), _joint_color(a, error_joints), _joint_color(b, error_joints))

    # ── Pose joints (body only, no face) ─────────────────────────────────────
    for i in range(11, POSE_LANDMARK_COUNT):
        if missing(i):
            continue
        cx, cy = pt(i)
        _draw_joint_dot(out, cx, cy, _joint_color(i, error_joints))

    # ── Hand bones + joints ───────────────────────────────────────────────────
    for hand_start in (33, 54):
        for ra, rb in _HAND_CONNECTIONS_REL:
            a, b = hand_start + ra, hand_start + rb
            if missing(a) or missing(b):
                continue
            _draw_bone(out, pt(a), pt(b), _joint_color(a, error_joints), _joint_color(b, error_joints))
        for r in range(HAND_LANDMARK_COUNT):
            i = hand_start + r
            if missing(i):
                continue
            cx, cy = pt(i)
            _draw_joint_dot(out, cx, cy, _joint_color(i, error_joints))

    return out


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    item = req.item
    npy_path = NPY_MAP.get(item)

    if not npy_path or not os.path.exists(npy_path):
        raise HTTPException(status_code=404,
                            detail=f"No reference skeleton for '{item}'")

    # Build test skeleton array
    try:
        test_skel = np.array(
            [frame.joints for frame in req.frames],
            dtype=np.float32
        )  # (T, 75, 2)

        if test_skel.shape[1:] != (75, 2):
            raise ValueError(f"Expected (T,75,2), got {test_skel.shape}")

        # Normalize each frame
        test_skel_norm = np.stack([normalize_skeleton(f) for f in test_skel])

        ref_skel = np.load(npy_path)  # (T_ref, 75, 2) — already normalized

        score, global_errors, per_frame_errors = run_dtw_and_errors(ref_skel, test_skel_norm)

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

    # ── Render feedback video in memory ──────────────────────────────────────
    # Use only alphanumeric chars in ID so FastAPI path routing never breaks
    import re as _re
    safe_item   = _re.sub(r'[^a-zA-Z0-9]', 'X', item)
    feedback_id = f"{safe_item}_{int(time.time()*1000)}"
    try:
        H, W = 480, 640
        fps  = req.fps or 20.0

        # Write raw frames to a temp file with MJPEG (always available in OpenCV)
        raw_path = tempfile.mktemp(suffix=".avi")
        fourcc   = cv2.VideoWriter_fourcc(*"MJPG")
        writer   = cv2.VideoWriter(raw_path, fourcc, fps, (W, H))

        for i, frame_data in enumerate(req.frames):
            xy_image = np.array(frame_data.joints, dtype=np.float32)
            errs     = per_frame_errors[i] if i < len(per_frame_errors) else set()

            bg        = np.zeros((H, W, 3), dtype=np.uint8)
            frame_out = _draw_joints_on_frame(bg, xy_image, errs)

            s_color = (60, 200, 60) if score >= 70 else (60, 180, 220) if score >= 40 else (60, 60, 255)
            cv2.putText(frame_out, f"Score: {score:.1f}%", (12, H - 16),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, s_color, 2, cv2.LINE_AA)
            writer.write(frame_out)

        writer.release()

        # Re-encode to browser-compatible H.264 mp4 via ffmpeg
        out_path = tempfile.mktemp(suffix=".mp4")
        ret = os.system(
            f'ffmpeg -y -i "{raw_path}" '
            f'-vcodec libx264 -pix_fmt yuv420p -preset fast -crf 28 '
            f'"{out_path}" -loglevel error'
        )

        if ret != 0:
            # ffmpeg not available — fall back to raw AVI served as video/x-msvideo
            with open(raw_path, "rb") as f:
                _feedback_store[feedback_id] = (f.read(), "video/x-msvideo")
        else:
            with open(out_path, "rb") as f:
                _feedback_store[feedback_id] = (f.read(), "video/mp4")
            os.unlink(out_path)

        os.unlink(raw_path)

    except Exception as e:
        traceback.print_exc()
        feedback_id = ""

    # Score → human message
    if score >= 80:
        msg = "ยอดเยี่ยม! ภาษามือของคุณถูกต้องมาก 🎉"
    elif score >= 60:
        msg = "ดีมาก! ยังมีบางท่าที่ควรปรับปรุง 👍"
    elif score >= 40:
        msg = "พอใช้ได้ ลองฝึกซ้ำอีกครั้ง 💪"
    else:
        msg = "ยังต้องฝึกเพิ่มเติม ไม่ต้องท้อ! 🙏"

    return AnalyzeResponse(
        score=round(score, 1),
        global_errors=sorted(global_errors),
        message=msg,
        feedback_id=feedback_id,
    )


@app.get("/api/feedback/{feedback_id}")
def get_feedback_video(feedback_id: str):
    """Stream the rendered feedback video."""
    entry = _feedback_store.get(feedback_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Feedback video not found")
    data, mime = entry
    ext = "mp4" if mime == "video/mp4" else "avi"
    return StreamingResponse(
        io.BytesIO(data),
        media_type=mime,
        headers={
            "Content-Disposition": f'inline; filename="feedback_{feedback_id}.{ext}"',
            "Content-Length": str(len(data)),
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
        }
    )


@app.get("/api/feedback/{feedback_id}/download")
def download_feedback_video(feedback_id: str):
    """Force-download the rendered feedback video."""
    entry = _feedback_store.get(feedback_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Feedback video not found")
    data, mime = entry
    ext = "mp4" if mime == "video/mp4" else "avi"
    return StreamingResponse(
        io.BytesIO(data),
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="sign_feedback_{feedback_id}.{ext}"',
            "Content-Length": str(len(data)),
        }
    )


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)