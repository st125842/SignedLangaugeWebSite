/* ══════════════════════════════════════
   MEDIAPIPE — Tracking Pipeline
   Pose + Hands setup, landmark extraction,
   and all canvas drawing (live + error overlay).
   Isolated because it's the most complex,
   self-contained piece and rarely needs changing.
══════════════════════════════════════ */

// ── Connections used for live arm drawing ──
const ARM_CONNECTIONS = [
  [11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,12],
];
const ARM_JOINT_INDICES = new Set([11,12,13,14,15,16,17,18,19,20,21,22]);

// ── Connections used for error-colored overlay ──
const POSE_CONNECTIONS_DRAW = [
  [11,12],
  [11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],
];
const HAND_CONNECTIONS_REL = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

/* ── Landmark extraction (mirrors Python preprocessing) ── */
function extractXYImage(poseResults, handResults) {
  const pose      = new Array(POSE_COUNT).fill(null).map(() => [0, 0]);
  const leftHand  = new Array(HAND_COUNT).fill(null).map(() => [0, 0]);
  const rightHand = new Array(HAND_COUNT).fill(null).map(() => [0, 0]);

  if (poseResults?.poseLandmarks)
    poseResults.poseLandmarks.forEach((lm, i) => { pose[i] = [lm.x, lm.y]; });

  if (handResults?.multiHandLandmarks) {
    handResults.multiHandLandmarks.forEach((landmarks, idx) => {
      const label = handResults.multiHandedness?.[idx]?.label ?? '';
      const arr   = landmarks.map(lm => [lm.x, lm.y]);
      if (label === 'Left') leftHand.splice(0, HAND_COUNT, ...arr);
      else                  rightHand.splice(0, HAND_COUNT, ...arr);
    });
  }

  return [...pose, ...leftHand, ...rightHand]; // (75, 2)
}

/* ── Initialize Pose + Hands + Camera ── */
function setupPose(videoEl, canvasEl) {
  const ctx = canvasEl.getContext('2d');
  let frameCount = 0;

  const pose = new Pose({ locateFile: (f) => `/static/mediapipe/pose/${f}` });
  pose.setOptions({
    modelComplexity: 0, smoothLandmarks: true, enableSegmentation: false,
    minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  pose.onResults((results) => {
    latestPoseResults = results;
    latestXYImage     = extractXYImage(latestPoseResults, latestHandResults);
    drawLiveFrame(ctx, canvasEl, latestPoseResults, latestHandResults);
    if (isRecording) {
      recordedFrames.push({ joints: latestXYImage });
      createImageBitmap(results.image).then(bmp => recordedRawFrames.push(bmp));
    }
  });

  const hands = new Hands({ locateFile: (f) => `/static/mediapipe/hands/${f}` });
  hands.setOptions({
    maxNumHands: 2, modelComplexity: 0,
    minDetectionConfidence: 0.6, minTrackingConfidence: 0.5,
  });
  hands.onResults((results) => {
    latestHandResults = results;
    latestXYImage     = extractXYImage(latestPoseResults, latestHandResults);
    drawLiveFrame(ctx, canvasEl, latestPoseResults, latestHandResults);
  });

  const camera = new Camera(videoEl, {
    onFrame: async () => {
      frameCount++;
      await pose.send({ image: videoEl });
      if (frameCount % 2 === 0) await hands.send({ image: videoEl });
    },
    width: 640, height: 480,
  });

  camera.start();
  poseInstance   = { pose, hands, close: () => { pose.close(); hands.close(); } };
  cameraInstance = camera;
}

/* ── Live frame: camera image + pose/hand skeleton ── */
function drawLiveFrame(ctx, canvasEl, poseResults, handResults) {
  const W = canvasEl.width, H = canvasEl.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-W, 0);

  let drawW = W, drawH = H, offsetX = 0, offsetY = 0;
  if (poseResults?.image) {
    const imgW  = poseResults.image.videoWidth  || poseResults.image.width  || 640;
    const imgH  = poseResults.image.videoHeight || poseResults.image.height || 480;
    const scale = Math.max(W / imgW, H / imgH);
    drawW   = imgW * scale; drawH = imgH * scale;
    offsetX = (W - drawW) / 2; offsetY = (H - drawH) / 2;
    ctx.drawImage(poseResults.image, offsetX, offsetY, drawW, drawH);
  }

  if (poseResults?.poseLandmarks)
    _drawArmsSkeleton(ctx, poseResults.poseLandmarks, drawW, drawH, offsetX, offsetY);

  if (handResults?.multiHandLandmarks) {
    handResults.multiHandLandmarks.forEach((lms, i) => {
      const label = handResults.multiHandedness?.[i]?.label ?? '';
      _drawHandSkeleton(ctx, lms, drawW, drawH, offsetX, offsetY, label);
    });
  }
  ctx.restore();
}

function _drawArmsSkeleton(ctx, landmarks, dW, dH, oX, oY) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [a, b] of ARM_CONNECTIONS) {
    const lA = landmarks[a], lB = landmarks[b];
    if (!lA || !lB) continue;
    if ((lA.visibility ?? 1) < 0.4 || (lB.visibility ?? 1) < 0.4) continue;
    ctx.beginPath();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(167,139,250,0.9)';
    ctx.moveTo(oX + lA.x * dW, oY + lA.y * dH);
    ctx.lineTo(oX + lB.x * dW, oY + lB.y * dH);
    ctx.stroke();
  }
  landmarks.forEach((lm, idx) => {
    if (!ARM_JOINT_INDICES.has(idx) || (lm.visibility ?? 1) < 0.4) return;
    const x = oX + lm.x * dW, y = oY + lm.y * dH;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(167,139,250,0.15)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(167,139,250,0.95)';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
  });
}

function _drawHandSkeleton(ctx, landmarks, dW, dH, oX, oY, label) {
  const boneColor  = label === 'Left' ? 'rgba(52,211,153,0.9)'  : 'rgba(96,165,250,0.9)';
  const jointColor = label === 'Left' ? 'rgba(52,211,153,0.95)' : 'rgba(96,165,250,0.95)';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (typeof HAND_CONNECTIONS !== 'undefined') {
    for (const [a, b] of HAND_CONNECTIONS) {
      const lA = landmarks[a], lB = landmarks[b];
      if (!lA || !lB) continue;
      ctx.beginPath(); ctx.lineWidth = 2.5; ctx.strokeStyle = boneColor;
      ctx.moveTo(oX + lA.x * dW, oY + lA.y * dH);
      ctx.lineTo(oX + lB.x * dW, oY + lB.y * dH);
      ctx.stroke();
    }
  }
  landmarks.forEach(lm => {
    const x = oX + lm.x * dW, y = oY + lm.y * dH;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = jointColor; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1; ctx.fill(); ctx.stroke();
  });
}

/* ── Error-colored skeleton overlay (red = wrong, green = correct) ── */
function drawJointsWithErrors(ctx, W, H, joints75, errorSet) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  const px      = (j) => joints75[j][0] * W;
  const py      = (j) => joints75[j][1] * H;
  const missing = (j) => joints75[j][0] <= 0 && joints75[j][1] <= 0;

  const colorFor = (idx) => {
    const err = errorSet.has(idx);
    return {
      bone: err ? 'rgba(255,60,60,0.85)'  : 'rgba(50,230,80,0.85)',
      fill: err ? 'rgba(255,50,50,0.95)'  : 'rgba(50,230,80,0.95)',
      glow: err ? 'rgba(255,60,60,0.18)'  : 'rgba(60,255,100,0.18)',
    };
  };

  const drawBone = (x1, y1, x2, y2, cA, cB) => {
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, cA); grad.addColorStop(1, cB);
    ctx.beginPath(); ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.strokeStyle = grad; ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };

  const drawDot = (cx, cy, idx) => {
    const c = colorFor(idx);
    ctx.beginPath(); ctx.arc(cx, cy, 8,   0, Math.PI * 2); ctx.fillStyle = c.glow; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = c.fill; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
  };

  for (const [a, b] of POSE_CONNECTIONS_DRAW) {
    if (missing(a) || missing(b)) continue;
    drawBone(px(a), py(a), px(b), py(b), colorFor(a).bone, colorFor(b).bone);
  }
  for (let i = 11; i < POSE_COUNT; i++) {
    if (missing(i) || FACE_JOINTS.has(i)) continue;
    drawDot(px(i), py(i), i);
  }
  for (const handStart of [33, 54]) {
    for (const [ra, rb] of HAND_CONNECTIONS_REL) {
      const a = handStart + ra, b = handStart + rb;
      if (missing(a) || missing(b)) continue;
      drawBone(px(a), py(a), px(b), py(b), colorFor(a).bone, colorFor(b).bone);
    }
    for (let r = 0; r < HAND_COUNT; r++) {
      const i = handStart + r;
      if (missing(i)) continue;
      drawDot(px(i), py(i), i);
    }
  }
  ctx.restore();
}
