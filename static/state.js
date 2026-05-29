/* ══════════════════════════════════════
   STATE & CONSTANTS
   Shared across all modules.
══════════════════════════════════════ */

const API = '';  // FastAPI same origin

// ── App state ──
let currentLevel    = 'easy';
let selectedItems   = [];
let currentIndex    = 0;
let cameraConnected = false;
let poseInstance    = null;
let cameraInstance  = null;

// ── Recording state ──
let isRecording       = false;
let recordedFrames    = [];   // Array<{joints: float[][]}> — landmarks per frame
let recordedBlobs     = [];   // Raw video chunks for download
let mediaRecorder     = null;
let latestXYImage     = null; // Most-recent raw landmark array (75×2, image-space)
let recordedRawFrames = [];   // ImageBitmap snapshots of each recorded camera frame
let latestPoseResults = null;
let latestHandResults = null;

// ── UI constants ──
const WINDOW_SIZE = 7;

const LEVEL_LABELS      = { easy: 'ระดับง่าย', medium: 'ระดับปานกลาง', hard: 'ระดับยาก' };
const LEVEL_BADGE_CLASS = { easy: 'badge-easy', medium: 'badge-medium', hard: 'badge-hard' };

// ── Joint metadata ──
const JOINT_NAMES = [
  'Nose','L-Eye-Inner','L-Eye','L-Eye-Outer','R-Eye-Inner','R-Eye','R-Eye-Outer',
  'L-Ear','R-Ear','Mouth-L','Mouth-R',
  'L-Shoulder','R-Shoulder','L-Elbow','R-Elbow','L-Wrist','R-Wrist',
  'L-Pinky','R-Pinky','L-Index','R-Index','L-Thumb','R-Thumb',
  'L-Hip','R-Hip','L-Knee','R-Knee','L-Ankle','R-Ankle',
  'L-Heel','R-Heel','L-Foot','R-Foot',
  'LH-Wrist','LH-Thumb0','LH-Thumb1','LH-Thumb2','LH-Thumb3',
  'LH-Index0','LH-Index1','LH-Index2','LH-Index3',
  'LH-Mid0','LH-Mid1','LH-Mid2','LH-Mid3',
  'LH-Ring0','LH-Ring1','LH-Ring2','LH-Ring3',
  'LH-Pinky0','LH-Pinky1','LH-Pinky2','LH-Pinky3',
  'RH-Wrist','RH-Thumb0','RH-Thumb1','RH-Thumb2','RH-Thumb3',
  'RH-Index0','RH-Index1','RH-Index2','RH-Index3',
  'RH-Mid0','RH-Mid1','RH-Mid2','RH-Mid3',
  'RH-Ring0','RH-Ring1','RH-Ring2','RH-Ring3',
  'RH-Pinky0','RH-Pinky1','RH-Pinky2','RH-Pinky3',
];

const POSE_COUNT  = 33;
const HAND_COUNT  = 21;
const FACE_JOINTS = new Set([0,1,2,3,4,5,6,7,8,9,10]);
