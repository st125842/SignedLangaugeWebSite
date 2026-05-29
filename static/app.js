/* ══════════════════════════════════════
   APP.JS
   Table of contents:
     1. API calls
     2. Selection screen
     3. Slideshow screen
     4. Camera
     5. Recording
     6. Feedback video renderer
     7. Analysis & result screen
     8. Event listeners + init
══════════════════════════════════════ */


/* ─────────────────────────────────────
   1. API CALLS
───────────────────────────────────── */
async function fetchLevel(level) {
  try {
    const res = await fetch(`${API}/api/slides/${level}`);
    return await res.json();
  } catch { return null; }
}

async function fetchVideo(word) {
  try {
    const res = await fetch(`${API}/api/video/${encodeURIComponent(word)}`);
    return await res.json();
  } catch { return null; }
}

async function fetchNpy(word) {
  try {
    const res = await fetch(`${API}/api/npy/${encodeURIComponent(word)}`);
    return await res.json();
  } catch { return null; }
}

async function postAnalyze(word, frames) {
  const res = await fetch(`${API}/api/analyze`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: word, frames, fps: 20.0 }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'เกิดข้อผิดพลาด');
  }
  return await res.json();
}


/* ─────────────────────────────────────
   2. SELECTION SCREEN
───────────────────────────────────── */
async function selectLevel(level) {
  currentLevel = level;
  document.querySelectorAll('.level-btn').forEach(btn =>
    btn.classList.remove('selected-easy', 'selected-medium', 'selected-hard'));
  document.querySelector(`[data-level="${level}"]`).classList.add(`selected-${level}`);

  const data = await fetchLevel(level);
  if (!data || data.error) return;

  document.getElementById('panel-title').textContent      = data.title;
  document.getElementById('content-subtitle').textContent = data.subtitle;

  const grid = document.getElementById('items-grid');
  grid.className = 'items-grid fade-in' + (data.type === 'sentences' ? ' sentences' : '');
  grid.innerHTML = '';

  if (data.type === 'letters') {
    _appendSectionLabel(grid, 'พยัญชนะไทย');
    data.consonants.forEach(ch => grid.appendChild(_makeChip(ch, level)));
    _appendSectionLabel(grid, 'ตัวเลข');
    data.numbers.forEach(n => grid.appendChild(_makeChip(String(n), level)));
  } else {
    data.items.forEach(item => grid.appendChild(_makeChip(String(item), level)));
  }
}

function _appendSectionLabel(grid, text) {
  const el = document.createElement('div');
  el.className   = 'grid-section-label';
  el.textContent = text;
  grid.appendChild(el);
}

function _makeChip(label, level) {
  const btn = document.createElement('button');
  btn.className   = `item-chip chip-${level}`;
  btn.textContent = label;
  btn.addEventListener('click', () => openSlideshow(label, level));
  return btn;
}


/* ─────────────────────────────────────
   3. SLIDESHOW SCREEN
───────────────────────────────────── */
async function openSlideshow(selectedItem, level) {
  const data = await fetchLevel(level);
  if (!data || data.error) return;

  let allItems = data.type === 'letters'
    ? [...data.consonants.map(String), ...data.numbers.map(String)]
    : data.items.map(String);

  selectedItems = allItems;
  currentIndex  = Math.max(0, selectedItems.indexOf(String(selectedItem)));

  const badge = document.getElementById('level-badge');
  badge.textContent = LEVEL_LABELS[level];
  badge.className   = 'level-badge ' + LEVEL_BADGE_CLASS[level];

  _renderLabels(); _renderDots(); _updateSlideContent(); _updateArrows();

  document.getElementById('screen-select').classList.remove('active');
  document.getElementById('screen-result').classList.remove('active');
  document.getElementById('screen-slide').classList.add('active');
}

function goHome() {
  if (isRecording) stopRecording(false);
  if (cameraConnected) stopCamera();
  document.getElementById('screen-slide').classList.remove('active');
  document.getElementById('screen-result').classList.remove('active');
  document.getElementById('screen-select').classList.add('active');
}

function retrySign() {
  document.getElementById('screen-result').classList.remove('active');
  document.getElementById('screen-slide').classList.add('active');
}

function goTo(index) {
  if (index < 0 || index >= selectedItems.length) return;
  currentIndex = index;
  _renderLabels(); _renderDots(); _updateSlideContent(); _updateArrows();
}

function _renderLabels() {
  const container = document.getElementById('slide-labels');
  container.innerHTML = '';
  let ws = currentIndex - Math.floor(WINDOW_SIZE / 2);
  ws = Math.max(0, Math.min(ws, Math.max(0, selectedItems.length - WINDOW_SIZE)));
  selectedItems.slice(ws, ws + WINDOW_SIZE).forEach((item, i) => {
    const realIdx = ws + i;
    const el      = document.createElement('button');
    el.className  = 'slide-label-item' + (realIdx === currentIndex ? ' active' : '');
    el.textContent = item;
    el.addEventListener('click', () => goTo(realIdx));
    container.appendChild(el);
  });
}

function _renderDots() {
  const container = document.getElementById('progress-dots');
  container.innerHTML = '';
  selectedItems.forEach((_, i) => {
    const dot     = document.createElement('div');
    dot.className = 'dot' + (i === currentIndex ? ' active' : '');
    dot.addEventListener('click', () => goTo(i));
    container.appendChild(dot);
  });
}

function _updateArrows() {
  document.getElementById('btn-prev').disabled = currentIndex === 0;
  document.getElementById('btn-next').disabled = currentIndex === selectedItems.length - 1;
}

async function _updateSlideContent() {
  const word = selectedItems[currentIndex];
  if (!word) return;
  document.getElementById('slide-word').textContent = word;

  const icon = document.getElementById('slide-icon');
  icon.classList.remove('fade-in');
  void icon.offsetWidth;
  icon.classList.add('fade-in');
  icon.innerHTML = '';

  const videoData = await fetchVideo(word);
  if (videoData?.video) {
    const vid = document.createElement('video');
    vid.src = videoData.video; vid.autoplay = true; vid.loop = true;
    vid.muted = true; vid.playsInline = true;
    vid.style.cssText = 'width:100%;height:100%;object-fit:cover';
    icon.appendChild(vid);
  } else {
    icon.textContent = '🤟';
  }

  const npyData = await fetchNpy(word);
  document.getElementById('record-btn').title = npyData?.has_reference
    ? '' : 'ยังไม่มีไฟล์อ้างอิงสำหรับคำนี้';
}


/* ─────────────────────────────────────
   4. CAMERA
───────────────────────────────────── */
async function handleCameraToggle() {
  const btn         = document.getElementById('connect-btn');
  const video       = document.getElementById('camera-feed');
  const canvas      = document.getElementById('tracking-canvas');
  const placeholder = document.getElementById('camera-placeholder');
  const recBtn      = document.getElementById('record-btn');

  if (!cameraConnected) {
    btn.textContent = 'กำลังโหลด...';
    btn.disabled    = true;
    try {
      const area   = canvas.parentElement;
      canvas.width  = area.clientWidth;
      canvas.height = area.clientHeight;

      const stream   = canvas.captureStream(20);
      const mimeType = _getSupportedMimeType();
      try { mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {}); }
      catch { mediaRecorder = new MediaRecorder(stream); }
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedBlobs.push(e.data); };

      setupPose(video, canvas);

      canvas.style.display      = 'block';
      placeholder.style.display = 'none';
      btn.textContent            = '✓ กล้องเชื่อมต่อแล้ว';
      btn.classList.add('connected');
      btn.disabled    = false;
      cameraConnected = true;
      recBtn.disabled = false;
    } catch (err) {
      console.error(err);
      btn.textContent = 'ไม่สามารถเข้าถึงกล้องได้';
      btn.disabled    = false;
      setTimeout(() => { btn.textContent = 'เชื่อมต่อกล้อง'; }, 2500);
    }
  } else {
    if (isRecording) stopRecording(false);
    stopCamera();
  }
}

function stopCamera() {
  const btn         = document.getElementById('connect-btn');
  const video       = document.getElementById('camera-feed');
  const canvas      = document.getElementById('tracking-canvas');
  const placeholder = document.getElementById('camera-placeholder');
  const recBtn      = document.getElementById('record-btn');

  if (cameraInstance) { cameraInstance.stop(); cameraInstance = null; }
  if (poseInstance)   { poseInstance.close?.(); poseInstance  = null; }
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }

  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.display      = 'none';
  placeholder.style.display = 'flex';
  btn.textContent            = 'เชื่อมต่อกล้อง';
  btn.classList.remove('connected');
  btn.disabled    = false;
  cameraConnected = false;
  recBtn.disabled = true;
  _setRecordingUI(false);
}


/* ─────────────────────────────────────
   5. RECORDING
───────────────────────────────────── */
async function handleRecord() {
  if (!isRecording) {
    await _runCountdown(3);
    _startRecording();
  } else {
    stopRecording(true);
  }
}

function _runCountdown(secs) {
  return new Promise(resolve => {
    const overlay = document.getElementById('countdown-overlay');
    overlay.style.display = 'flex';
    let n = secs;
    const tick = () => {
      overlay.textContent = n;
      overlay.classList.remove('pop');
      void overlay.offsetWidth;
      overlay.classList.add('pop');
      if (--n < 0) { overlay.style.display = 'none'; resolve(); }
      else         { setTimeout(tick, 1000); }
    };
    tick();
  });
}

function _startRecording() {
  isRecording       = true;
  recordedFrames    = [];
  recordedBlobs     = [];
  recordedRawFrames = [];

  if (mediaRecorder) {
    const stream   = mediaRecorder.stream;
    const mimeType = _getSupportedMimeType();
    try { mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {}); }
    catch { mediaRecorder = new MediaRecorder(stream); }
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedBlobs.push(e.data); };
  }
  if (mediaRecorder && mediaRecorder.state === 'inactive')
    mediaRecorder.start(100);

  _setRecordingUI(true);
  setTimeout(() => { if (isRecording) stopRecording(true); }, 3000);
}

function stopRecording(doAnalyze = true) {
  isRecording = false;
  _setRecordingUI(false);
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  if (doAnalyze && recordedFrames.length > 5)
    setTimeout(() => analyzeRecording(), 200);
}

function _getSupportedMimeType() {
  const types = ['video/webm; codecs=vp9','video/webm; codecs=vp8','video/webm','video/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function _setRecordingUI(recording) {
  const recBtn   = document.getElementById('record-btn');
  const recIcon  = document.getElementById('rec-icon');
  const recLabel = document.getElementById('rec-label');
  const recBadge = document.getElementById('rec-badge');
  const recRing  = document.getElementById('rec-ring');

  if (recording) {
    recBtn.classList.add('recording');
    recIcon.classList.add('blink');
    recLabel.textContent   = 'หยุดบันทึก';
    recBadge.style.display = 'block';
    recRing.style.display  = 'block';
  } else {
    recBtn.classList.remove('recording');
    recIcon.classList.remove('blink');
    recLabel.textContent   = 'บันทึก';
    recBadge.style.display = 'none';
    recRing.style.display  = 'none';
  }
}


/* ─────────────────────────────────────
   6. FEEDBACK VIDEO RENDERER
   Produces side-by-side webm:
   reference (left) | user + error dots (right)
───────────────────────────────────── */
async function renderFeedbackVideoWithErrors(errorSet, fps = 20) {
  if (recordedRawFrames.length === 0 || recordedFrames.length === 0) return null;

  const word = selectedItems[currentIndex];
  const W = 640, H = 480;
  const frameDelay = 1000 / fps;

  // Fetch & seek-capture reference video frames
  let refBitmaps = [];
  const videoData = await fetchVideo(word);
  if (videoData?.video) {
    const refVid = document.createElement('video');
    refVid.muted = true; refVid.playsInline = true;
    refVid.src   = videoData.video;
    await new Promise(r => { refVid.onloadedmetadata = r; refVid.onerror = r; refVid.load(); });

    const refTotalFrames = Math.round((refVid.duration || 0) * fps);
    if (refTotalFrames > 0 && refVid.readyState >= 1) {
      const tmp = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const tCtx = tmp.getContext('2d');
      for (let i = 0; i < refTotalFrames; i++) {
        refVid.currentTime = i / fps;
        await new Promise(r => {
          let done = false;
          const finish = () => { if (!done) { done = true; r(); } };
          refVid.addEventListener('seeked', finish, { once: true });
          setTimeout(finish, 300);
        });
        tCtx.drawImage(refVid, 0, 0, W, H);
        refBitmaps.push(await createImageBitmap(tmp));
      }
    }
  }

  const userTotal   = Math.min(recordedRawFrames.length, recordedFrames.length);
  const total       = Math.max(userTotal, refBitmaps.length);
  const lastUserIdx = userTotal - 1;

  const offscreen  = Object.assign(document.createElement('canvas'), { width: W * 2, height: H });
  const ctx        = offscreen.getContext('2d');
  const mimeType   = _getSupportedMimeType() || 'video/webm';
  const stream     = offscreen.captureStream(fps);
  const recorder   = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks     = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.start();

  for (let i = 0; i < total; i++) {
    ctx.clearRect(0, 0, W * 2, H);

    // Left — reference
    ctx.save();
    if (refBitmaps.length > 0) {
      ctx.drawImage(refBitmaps[Math.min(i, refBitmaps.length - 1)], 0, 0, W, H);
    } else {
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(10, 10, 160, 35);
    ctx.fillStyle = 'white'; ctx.font = 'bold 18px Sans-Serif';
    ctx.fillText('ท่าทางอ้างอิง', 25, 33);
    ctx.restore();

    // Right — user frame (mirrored) + error dots
    const userIdx = Math.min(i, lastUserIdx);
    ctx.save();
    ctx.translate(W, 0);
    ctx.save();
    ctx.scale(-1, 1); ctx.translate(-W, 0);
    ctx.drawImage(recordedRawFrames[userIdx], 0, 0, W, H);
    ctx.restore();
    const mirroredJoints = recordedFrames[userIdx].joints.map(([x, y]) => [1 - x, y]);
    drawJointsWithErrors(ctx, W, H, mirroredJoints, errorSet);

    if (i > lastUserIdx) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(10, H - 45, 190, 32);
      ctx.fillStyle = '#facc15'; ctx.font = 'bold 16px Sans-Serif';
      ctx.fillText('✓ บันทึกเสร็จสิ้น', 20, H - 23);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(10, 10, 160, 35);
    ctx.fillStyle = 'white'; ctx.font = 'bold 18px Sans-Serif';
    ctx.fillText('ท่าทางของคุณ', 25, 33);
    ctx.restore();

    await new Promise(r => setTimeout(r, frameDelay));
  }

  recorder.stop();
  refBitmaps.forEach(bmp => bmp.close?.());
  return new Promise(resolve => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
}


/* ─────────────────────────────────────
   7. ANALYSIS & RESULT SCREEN
───────────────────────────────────── */
async function analyzeRecording() {
  const word = selectedItems[currentIndex];

  document.getElementById('processing-overlay').style.display = 'flex';
  document.getElementById('screen-slide').classList.remove('active');
  document.getElementById('screen-result').classList.add('active');
  document.getElementById('result-title').textContent = `ผลการวิเคราะห์: "${word}"`;

  // Reset result UI to loading state
  document.getElementById('score-number').textContent           = '…';
  document.getElementById('score-grade').textContent            = '';
  document.getElementById('score-desc').textContent             = 'กำลังวิเคราะห์…';
  document.getElementById('ring-fill').style.strokeDasharray    = '0 314';
  document.getElementById('error-summary').style.display        = 'none';
  document.getElementById('result-feedback-video').style.display = 'none';
  document.getElementById('download-feedback-btn').style.display = 'none';
  document.getElementById('feedback-placeholder').style.display  = 'flex';
  document.getElementById('feedback-placeholder').textContent    = 'กำลังวิเคราะห์…';

  try {
    const data = await postAnalyze(word, recordedFrames);
    _renderScore(data.score, data.message);
    _renderErrorChips(data.global_errors);

    document.getElementById('feedback-placeholder').textContent = 'กำลังสร้างวิดีโอ…';
    const IGNORED  = new Set([0,1,2,3,4,5,6,7,8,9,10]);
    const errorSet = new Set((data.global_errors || []).filter(i => !IGNORED.has(i)));
    const videoBlob = await renderFeedbackVideoWithErrors(errorSet, 20);

    if (videoBlob) {
      const url = URL.createObjectURL(videoBlob);
      const ext = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const vid = document.getElementById('result-feedback-video');
      vid.src = url; vid.load(); vid.style.display = 'block';
      document.getElementById('feedback-placeholder').style.display = 'none';
      _hookVideoProgress(vid, 'feedback-progress', 'feedback-time');

      const dl = document.getElementById('download-feedback-btn');
      dl.href = url; dl.download = `sign_feedback_${word}_${Date.now()}.${ext}`;
      dl.style.display = 'inline-flex';
    } else {
      document.getElementById('feedback-placeholder').textContent = 'ไม่สามารถสร้างวิดีโอได้';
    }

  } catch (err) {
    console.error(err);
    document.getElementById('score-desc').textContent           = `⚠ ${err.message}`;
    document.getElementById('score-number').textContent         = '—';
    document.getElementById('feedback-placeholder').textContent = err.message;
  } finally {
    document.getElementById('processing-overlay').style.display = 'none';
  }
}

function _renderScore(score, message) {
  document.getElementById('score-number').textContent = `${score}%`;
  document.getElementById('score-desc').textContent   = message;

  let grade, color;
  if      (score >= 80) { grade = '🌟 ยอดเยี่ยม';   color = '#22c55e'; }
  else if (score >= 60) { grade = '👍 ดีมาก';        color = '#f59e0b'; }
  else if (score >= 40) { grade = '💪 พอใช้ได้';     color = '#f97316'; }
  else                  { grade = '🙏 ฝึกเพิ่มเติม'; color = '#ef4444'; }

  const gradeEl = document.getElementById('score-grade');
  gradeEl.textContent = grade; gradeEl.style.color = color;

  const circumference = 2 * Math.PI * 50;
  const ring = document.getElementById('ring-fill');
  ring.style.stroke = color;
  setTimeout(() => {
    ring.style.strokeDasharray = `${(score / 100) * circumference} ${circumference}`;
  }, 50);
}

function _renderErrorChips(globalErrors) {
  const summary = document.getElementById('error-summary');
  const chips   = document.getElementById('error-chips');
  chips.innerHTML = '';

  const IGNORED  = new Set([0,1,2,3,4,5,6,7,8,9,10]);
  const filtered = (globalErrors || []).filter(i => !IGNORED.has(i));

  if (filtered.length === 0) { summary.style.display = 'none'; return; }
  summary.style.display = 'block';
  filtered.forEach(idx => {
    const chip = document.createElement('span');
    chip.className   = 'error-chip';
    chip.textContent = JOINT_NAMES[idx] || `Joint ${idx}`;
    chips.appendChild(chip);
  });
}

function _hookVideoProgress(videoEl, barId, timeId) {
  const bar    = document.getElementById(barId);
  const timeEl = document.getElementById(timeId);
  videoEl.addEventListener('timeupdate', () => {
    if (!videoEl.duration) return;
    bar.style.width = `${(videoEl.currentTime / videoEl.duration) * 100}%`;
    const s = Math.floor(videoEl.currentTime);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
}


/* ─────────────────────────────────────
   8. EVENT LISTENERS + INIT
───────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (!document.getElementById('screen-slide').classList.contains('active')) return;
  if (e.key === 'ArrowLeft')  goTo(currentIndex - 1);
  if (e.key === 'ArrowRight') goTo(currentIndex + 1);
});

window.addEventListener('resize', () => {
  const canvas = document.getElementById('tracking-canvas');
  if (cameraConnected && canvas) {
    canvas.width  = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  }
});

selectLevel('easy');
