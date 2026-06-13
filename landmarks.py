import cv2
import numpy as np
import mediapipe as mp
from mediapipe import solutions
from mediapipe.framework.formats import landmark_pb2
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import os

# ==================================================
# Model paths
# ==================================================
hand_model_path = "models/hand_landmarker.task"
pose_model_path = "models/pose_landmarker.task"

# ==================================================
# Constants
# ==================================================
POSE_LANDMARK_COUNT = 33
HAND_LANDMARK_COUNT = 21
TOTAL_LANDMARKS = 75
DIM = 2  # x, y

# ==================================================
# Hand and pose landmarks
# ==================================================
hand_detector = vision.HandLandmarker.create_from_options(
    vision.HandLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=hand_model_path),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=2
    )
)

pose_detector = vision.PoseLandmarker.create_from_options(
    vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=pose_model_path),
        running_mode=vision.RunningMode.VIDEO
    )
)

# ==================================================
# Utilities
# ==================================================
def numpy_to_mp_image(np_img):
    if np_img.shape[-1] == 3:
        np_img = cv2.cvtColor(np_img, cv2.COLOR_BGR2RGB)
    elif np_img.shape[-1] == 4:
        np_img = cv2.cvtColor(np_img, cv2.COLOR_RGBA2RGB)

    return mp.Image(
        image_format=mp.ImageFormat.SRGB,
        data=np_img
    )

def landmarks_to_np_xy(landmarks, count):
    if landmarks is None:
        return np.zeros((count, DIM), dtype=np.float32)
    return np.array([[l.x, l.y] for l in landmarks], dtype=np.float32)

# ==================================================
# Drawing (uses image-normalized coordinates)
# ==================================================
def draw_hand_landmarks_on_image(rgb_image, detection_result):
    annotated = np.copy(rgb_image)
    if not detection_result.hand_landmarks:
        return annotated

    for hand_landmarks in detection_result.hand_landmarks:
        proto = landmark_pb2.NormalizedLandmarkList()
        proto.landmark.extend([
            landmark_pb2.NormalizedLandmark(x=l.x, y=l.y)
            for l in hand_landmarks
        ])
        solutions.drawing_utils.draw_landmarks(
            annotated,
            proto,
            solutions.hands.HAND_CONNECTIONS,
            solutions.drawing_styles.get_default_hand_landmarks_style(),
            solutions.drawing_styles.get_default_hand_connections_style()
        )
    return annotated

def draw_pose_landmarks_on_image(rgb_image, detection_result):
    annotated = np.copy(rgb_image)
    if not detection_result.pose_landmarks:
        return annotated

    proto = landmark_pb2.NormalizedLandmarkList()
    proto.landmark.extend([
        landmark_pb2.NormalizedLandmark(x=l.x, y=l.y)
        for l in detection_result.pose_landmarks[0]
    ])
    solutions.drawing_utils.draw_landmarks(
        annotated,
        proto,
        solutions.pose.POSE_CONNECTIONS,
        solutions.drawing_styles.get_default_pose_landmarks_style()
    )
    return annotated

# ==================================================
# Skeleton extraction (image-normalized XY)
# ==================================================
def extract_combined_xy_image(pose_result, hand_result):
    # Pose
    if pose_result.pose_landmarks:
        pose = landmarks_to_np_xy(
            pose_result.pose_landmarks[0], POSE_LANDMARK_COUNT
        )
    else:
        pose = np.zeros((POSE_LANDMARK_COUNT, DIM), dtype=np.float32)

    left_hand = np.zeros((HAND_LANDMARK_COUNT, DIM), dtype=np.float32)
    right_hand = np.zeros((HAND_LANDMARK_COUNT, DIM), dtype=np.float32)

    if hand_result.hand_landmarks:
        for i, hand_landmarks in enumerate(hand_result.hand_landmarks):
            label = hand_result.handedness[i][0].category_name
            hand_xy = landmarks_to_np_xy(hand_landmarks, HAND_LANDMARK_COUNT)
            if label == "Left":
                left_hand = hand_xy
            elif label == "Right":
                right_hand = hand_xy

    # Joint order: pose | left hand | right hand
    return np.vstack([pose, left_hand, right_hand])  # (75, 2)

# ==================================================
# Skeleton normalization (shoulder-centered)
# ==================================================
def normalize_skeleton_xy(xy_image):
    pose = xy_image[:POSE_LANDMARK_COUNT]

    # Root center = midpoint of shoulders
    left_shoulder = pose[11]
    right_shoulder = pose[12]
    root = (left_shoulder + right_shoulder) / 2.0

    # Scale = shoulder to hip center distance
    left_hip = pose[23]
    right_hip = pose[24]
    hip_center = (left_hip + right_hip) / 2.0

    scale = np.linalg.norm(root - hip_center)
    scale = max(scale, 1e-6)

    return (xy_image - root) / scale

# ==================================================
# Temporal smoothing (EMA)
# ==================================================
class TemporalSmoother:
    def __init__(self, alpha=0.7):
        self.alpha = alpha
        self.prev = None

    def __call__(self, current):
        if self.prev is None:
            self.prev = current
            return current
        smoothed = self.alpha * current + (1 - self.alpha) * self.prev
        self.prev = smoothed
        return smoothed

# ==================================================
# Process input video
# ==================================================
def process_video(input_path, output_video, output_xy_image, output_xy_skel):
    cap = cv2.VideoCapture(input_path)

    fps = cap.get(cv2.CAP_PROP_FPS)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    writer = cv2.VideoWriter(
        output_video,
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (w, h)
    )

    smoother = TemporalSmoother(alpha=0.7)

    xy_image_seq = []
    xy_skel_seq = []

    frame_idx = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        timestamp_ms = int((frame_idx / fps) * 1000)
        mp_image = numpy_to_mp_image(frame)

        hand_result = hand_detector.detect_for_video(mp_image, timestamp_ms)
        pose_result = pose_detector.detect_for_video(mp_image, timestamp_ms)

        xy_image = extract_combined_xy_image(pose_result, hand_result)
        xy_skel = normalize_skeleton_xy(xy_image)
        xy_skel = smoother(xy_skel)

        xy_image_seq.append(xy_image)
        xy_skel_seq.append(xy_skel)

        annotated = draw_pose_landmarks_on_image(mp_image.numpy_view(), pose_result)
        annotated = draw_hand_landmarks_on_image(annotated, hand_result)

        writer.write(cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR))
        frame_idx += 1

    cap.release()
    writer.release()

    np.save(output_xy_image, np.stack(xy_image_seq))  # (T, 75, 2)
    np.save(output_xy_skel, np.stack(xy_skel_seq))    # (T, 75, 2)

# ==================================================
# main
# ==================================================
if __name__ == "__main__":
    import argparse
    import os

    parser = argparse.ArgumentParser()
    parser.add_argument("input_video", help="Path to input video (e.g. input_data/2009.mp4)")
    parser.add_argument("output_video", help="Path to output video with landmarks (e.g. output_data/output_2009.mp4)")
    args = parser.parse_args()

    output_dir = os.path.dirname(args.output_video) or "."
    output_stem = os.path.splitext(os.path.basename(args.output_video))[0]
    output_xy_image = os.path.join(output_dir, f"{output_stem}_xy_imgnorm.npy")
    output_xy_skel = os.path.join(output_dir, f"{output_stem}_xy_skelnorm.npy")

    process_video(
        args.input_video,
        args.output_video,
        output_xy_image,
        output_xy_skel
    )
    print("\nOutput npy files:")
    print(output_xy_image)
    print(output_xy_skel)
