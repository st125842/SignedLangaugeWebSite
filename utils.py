import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from fastdtw import fastdtw
import argparse
import time

# ==================================================
# Config
# ==================================================
POSE_LANDMARK_COUNT = 33
HAND_LANDMARK_COUNT = 21
TOTAL_JOINTS        = 75
DIM                 = 2

SPATIAL_THRESH      = 0.08
TEMPORAL_THRESH     = 8

ERROR_COLOR         = (0, 0, 255)      # Red
CORRECT_COLOR       = (0, 255, 0)      # Green
RECORD_COLOR        = (0, 0, 220)      # Red indicator
RADIUS              = 3

HAND_MODEL_PATH     = "models/hand_landmarker.task"
POSE_MODEL_PATH     = "models/pose_landmarker.task"

# ==================================================
# MediaPipe setup
# ==================================================
# Using IMAGE mode for frame-by-frame processing within the loop
hand_det_img = vision.HandLandmarker.create_from_options(
    vision.HandLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=HAND_MODEL_PATH),
        running_mode=vision.RunningMode.IMAGE,
        num_hands=2
    )
)

pose_det_img = vision.PoseLandmarker.create_from_options(
    vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=POSE_MODEL_PATH),
        running_mode=vision.RunningMode.IMAGE
    )
)

# ==================================================
# Skeleton & Comparison Helpers
# ==================================================
def numpy_to_mp_image(frame):
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

def landmarks_to_np_xy(landmarks, count):
    if landmarks is None:
        return np.zeros((count, DIM), dtype=np.float32)
    return np.array([[l.x, l.y] for l in landmarks], dtype=np.float32)

def extract_combined_xy(pose_result, hand_result):
    pose = landmarks_to_np_xy(
        pose_result.pose_landmarks[0] if pose_result.pose_landmarks else None,
        POSE_LANDMARK_COUNT
    )
    left_hand  = np.zeros((HAND_LANDMARK_COUNT, DIM), dtype=np.float32)
    right_hand = np.zeros((HAND_LANDMARK_COUNT, DIM), dtype=np.float32)

    if hand_result.hand_landmarks:
        for i, hand_lm in enumerate(hand_result.hand_landmarks):
            label = hand_result.handedness[i][0].category_name
            xy = landmarks_to_np_xy(hand_lm, HAND_LANDMARK_COUNT)
            if label == "Left": left_hand = xy
            else: right_hand = xy

    return np.vstack([pose, left_hand, right_hand])

def normalize_skeleton(xy_image):
    pose          = xy_image[:POSE_LANDMARK_COUNT]
    root          = (pose[11] + pose[12]) / 2.0
    hip_center    = (pose[23] + pose[24]) / 2.0
    scale         = max(np.linalg.norm(root - hip_center), 1e-6)
    return (xy_image - root) / scale

def compute_frame_distance(f1, f2):
    return np.mean(np.linalg.norm(f1 - f2, axis=1))

# Face landmark indices (pose 0-10): not relevant to sign language evaluation
FACE_JOINT_INDICES = set(range(11))  # 0..10: nose, eyes, ears, mouth

def run_dtw_and_errors(ref_skel, test_skel):
    dist, path = fastdtw(ref_skel, test_skel, dist=compute_frame_distance)
    error_counts = np.zeros(TOTAL_JOINTS)
    total_counts = np.zeros(TOTAL_JOINTS)
    per_frame_errors = [set() for _ in range(len(test_skel))]

    for t_ref, t_test in path:
        diffs = np.linalg.norm(ref_skel[t_ref] - test_skel[t_test], axis=1)
        total_counts += 1
        for j, d in enumerate(diffs):
            if j in FACE_JOINT_INDICES:
                continue  # skip face landmarks entirely
            if d > SPATIAL_THRESH:
                error_counts[j] += 1
                per_frame_errors[t_test].add(j)
        if abs(t_ref - t_test) > TEMPORAL_THRESH:
            # Apply temporal penalty only to non-face joints
            for j in range(TOTAL_JOINTS):
                if j not in FACE_JOINT_INDICES:
                    error_counts[j] += 1

    error_ratio   = error_counts / np.maximum(total_counts, 1)
    global_errors = set(np.where(error_ratio > 0.40)[0]) - FACE_JOINT_INDICES
    # score         = max(0.0, 100.0 * (1.0 - dist / (len(path) * SPATIAL_THRESH * TOTAL_JOINTS)))
    score = max(0.0, 100.0 * (1.0 - dist / (len(path) * SPATIAL_THRESH)))
    
    return score, global_errors, per_frame_errors

# ==================================================
# Drawing & UI
# ==================================================
def draw_joints(frame, xy_image, error_joints):
    h, w = frame.shape[:2]
    for j, (x, y) in enumerate(xy_image):
        if x <= 0 and y <= 0: continue
        color = ERROR_COLOR if j in error_joints else CORRECT_COLOR
        cv2.circle(frame, (int(x * w), int(y * h)), RADIUS, color, -1, cv2.LINE_AA)
        cv2.circle(frame, (int(x * w), int(y * h)), RADIUS, (255,255,255), 1, cv2.LINE_AA)

def draw_ui(frame, recording, frame_count, score=None, global_errors=None):
    h, w = frame.shape[:2]
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 50), (30, 30, 30), -1)
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)

    if recording:
        cv2.circle(frame, (20, 25), 10, RECORD_COLOR, -1)
        cv2.putText(frame, f"RECORDING  {frame_count} frames", (38, 32),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 1, cv2.LINE_AA)
    else:
        cv2.putText(frame, "Press SPACE to start recording", (12, 32),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (200, 200, 200), 1, cv2.LINE_AA)

    if score is not None:
        overlay2 = frame.copy()
        cv2.rectangle(overlay2, (0, h - 55), (w, h), (30, 30, 30), -1)
        cv2.addWeighted(overlay2, 0.6, frame, 0.4, 0, frame)
        score_color = (60, 200, 60) if score >= 70 else (60, 180, 220) if score >= 40 else (60, 60, 255)
        cv2.putText(frame, f"Score: {score:.1f}%", (12, h - 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, score_color, 2, cv2.LINE_AA)

# ==================================================
# Video Export
# ==================================================
def export_videos(raw_frames, xy_images, per_frame_errors, fps=20.0):
    if not raw_frames: return
    h, w = raw_frames[0].shape[:2]
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    
    out_raw = cv2.VideoWriter('output_raw.mp4', fourcc, fps, (w, h))
    out_feedback = cv2.VideoWriter('output_feedback.mp4', fourcc, fps, (w, h))

    print("💾 Exporting videos...")
    for i in range(len(raw_frames)):
        # Save Raw
        out_raw.write(raw_frames[i])
        
        # Save Feedback (Draw errors)
        feedback_frame = raw_frames[i].copy()
        errs = per_frame_errors[i] if i < len(per_frame_errors) else set()
        draw_joints(feedback_frame, xy_images[i], errs)
        out_feedback.write(feedback_frame)

    out_raw.release()
    out_feedback.release()
    print("✅ Export complete: 'output_raw.mp4' & 'output_feedback.mp4'")

# ==================================================
# Main Loop
# ==================================================
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ref", required=True)
    parser.add_argument("--camera", type=int, default=0)
    args = parser.parse_args()

    ref_skel = np.load(args.ref)
    cap = cv2.VideoCapture(args.camera)
    
    # Grab FPS for the video writer
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0: fps = 20.0

    recording = False
    recorded_frames = []    # Buffering images for export
    recorded_xy_img = []    # Buffering landmarks for export drawing
    recorded_xy_skel = []   # Buffering normalized skel for DTW
    
    result_score, result_errors, result_per_frame = None, None, None
    result_frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret: break

        mp_image = numpy_to_mp_image(frame)
        hand_result = hand_det_img.detect(mp_image)
        pose_result = pose_det_img.detect(mp_image)

        xy_image = extract_combined_xy(pose_result, hand_result)
        xy_skel  = normalize_skeleton(xy_image)

        if recording:
            recorded_frames.append(frame.copy())
            recorded_xy_img.append(xy_image)
            recorded_xy_skel.append(xy_skel)

        # UI Rendering
        display_frame = frame.copy()
        if result_per_frame and not recording:
            fi = min(result_frame_idx, len(result_per_frame) - 1)
            draw_joints(display_frame, xy_image, result_per_frame[fi])
            result_frame_idx = (result_frame_idx + 1) % len(result_per_frame)
        else:
            draw_joints(display_frame, xy_image, set())

        draw_ui(display_frame, recording, len(recorded_frames), result_score, result_errors)
        cv2.imshow("Sign Language Checker", display_frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'): break
        elif key == ord(' '):
            if not recording:
                recording, recorded_frames, recorded_xy_img, recorded_xy_skel = True, [], [], []
                result_score = None
                print("⏺  Recording...")
            else:
                recording = False
                if len(recorded_xy_skel) > 5:
                    test_skel = np.stack(recorded_xy_skel)
                    score, g_errs, p_errs = run_dtw_and_errors(ref_skel, test_skel)
                    result_score, result_errors, result_per_frame = score, g_errs, p_errs
                    # Export the files
                    export_videos(recorded_frames, recorded_xy_img, p_errs, fps=fps)

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()