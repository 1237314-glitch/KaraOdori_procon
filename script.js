import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

/* --- 1. 定数定義を冒頭に移動 (初期化エラー防止) --- */
const CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],
  [23,25],[25,27],[24,26],[26,28],
  [27,31],[28,32]
];

const LANDMARK_NAMES = [
  '鼻','左目(内)','左目','左目(外)','右目(内)','右目','右目(外)',
  '左耳','右耳','左口','右口',
  '左肩','右肩','左肘','右肘','左手首','右手首',
  '左小指','右小指','左人差し指','右人差し指','左親指','右親指',
  '左腰','右腰','左膝','右膝','左足首','右足首',
  '左かかと','右かかと','左足先','右足先'
];

/* --- 2. 変数・DOM取得 --- */
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const placeholder = document.getElementById('placeholder');
const fpsDisplay = document.getElementById('fpsDisplay');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const msgArea = document.getElementById('msgArea');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');

let poseLandmarker = null;
let stream = null;
let animId = null;
let lastTime = 0;
let fpsArr = [];

let isRecording = false;
let recordedFrames = [];
let recordStart = 0;
let timerInterval = null;
let takes = [];
let takeCount = 0;

let currentScore = 0;
let scoreMessage = "踊りを開始してください";

const recBtn = document.getElementById('recBtn');
const recBtnLabel = document.getElementById('recBtnLabel');
const recTimer = document.getElementById('recTimer');
const recCounter = document.getElementById('recCounter');
const takesList = document.getElementById('takesList');
const jsonPreview = document.getElementById('jsonPreview');

/* --- 3. 採点ロジック関数 --- */
function calculateAwaScore(lm) {
    let score = 0;
    let details = [];

    // 1. 手の高さチェック (MediaPipeのY軸は上が0)
    const handsUp = (lm[15].y < lm[11].y) && (lm[16].y < lm[12].y);
    if (handsUp) {
        score += 30;
    } else {
        details.push("手をもっと高く！");
    }

    // 2. 腰の低さ（膝の曲がり）
    const rKneeAngle = calcAngle(lm[23], lm[25], lm[27]);
    const lKneeAngle = calcAngle(lm[24], lm[26], lm[28]);
    if (rKneeAngle < 160 || lKneeAngle < 160) {
        score += 30;
    } else {
        details.push("腰を落として！");
    }

    // 3. ナンバ歩き判定 (Z値が小さいほどカメラに近い)
    const rightSideForward = (lm[15].z < lm[16].z) && (lm[27].z < lm[28].z);
    const leftSideForward = (lm[16].z < lm[15].z) && (lm[28].z < lm[27].z);
    
    if (rightSideForward || leftSideForward) {
        score += 40;
    } else {
        details.push("手足は同じ側を出して！");
    }

    scoreMessage = details.length === 0 ? "いい踊りです！" : details[0];
    return score;
}

function updateUIExtended(lm) {
    // 既存の角度/UI更新
    updateUI(lm); 

    // スコア計算と反映
    currentScore = calculateAwaScore(lm);
    const scoreValEl = document.getElementById('total-score-val');
    const scoreMsgEl = document.getElementById('score-message');
    if (scoreValEl) scoreValEl.textContent = currentScore;
    if (scoreMsgEl) {
        scoreMsgEl.textContent = scoreMessage;
        scoreMsgEl.className = 'message-area ' + (currentScore > 70 ? 'ok' : 'error');
    }
}

/* --- 4. カメラ・推論制御 --- */
function toggleRecord() {
  if (!isRecording) startRecord();
  else stopRecord();
}

function startRecord() {
  isRecording = true;
  recordedFrames = [];
  recordStart = performance.now();
  recBtn.classList.add('recording');
  recBtnLabel.textContent = '録画停止';
  recTimer.style.display = 'block';
  recCounter.style.display = 'block';
  timerInterval = setInterval(updateTimer, 100);
}

function updateTimer() {
  const elapsed = performance.now() - recordStart;
  const s = Math.floor(elapsed / 1000);
  const ms = Math.floor((elapsed % 1000) / 100);
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  recTimer.textContent = `${mm}:${ss}.${ms}`;
  recCounter.textContent = `${recordedFrames.length} フレーム録画済み`;
}

function stopRecord() {
  isRecording = false;
  clearInterval(timerInterval);
  recBtn.classList.remove('recording');
  recBtnLabel.textContent = '録画開始';

  if (recordedFrames.length === 0) return;

  takeCount++;
  const lastFrame = recordedFrames[recordedFrames.length - 1];
  const firstFrame = recordedFrames[0];
  const elapsed = (lastFrame.timestamp_ms - firstFrame.timestamp_ms);
  const duration = (elapsed / 1000).toFixed(1);
  const fps = Math.round(recordedFrames.length / (elapsed / 1000));

  const take = {
    id: takeCount,
    name: `テイク ${takeCount}`,
    recorded_at: new Date().toISOString(),
    duration_sec: parseFloat(duration),
    frame_count: recordedFrames.length,
    avg_fps: fps,
    landmark_names: LANDMARK_NAMES,
    frames: recordedFrames.map(f => ({
      timestamp_ms: f.timestamp_ms,
      landmarks: f.landmarks.map(l => ({
        x: parseFloat(l.x.toFixed(4)),
        y: parseFloat(l.y.toFixed(4)),
        z: parseFloat(l.z.toFixed(4)),
        visibility: parseFloat(l.visibility.toFixed(3))
      }))
    }))
  };
  takes.unshift(take);
  renderTakes();
}

function renderTakes() {
  if (takes.length === 0) {
    takesList.innerHTML = '<div class="empty-takes">録画データがありません<br>録画後ここに表示されます</div>';
    return;
  }
  takesList.innerHTML = takes.map((t, i) => `
    <div class="take-item">
      <div class="take-info">
        <div class="take-name">${t.name}</div>
        <div class="take-meta">${t.duration_sec}秒 / ${t.frame_count}fr / ${t.avg_fps}fps</div>
      </div>
      <div class="take-actions">
        <button class="take-btn" onclick="previewTake(${i})">確認</button>
        <button class="take-btn dl" onclick="downloadTake(${i})">保存</button>
        <button class="take-btn del" onclick="deleteTake(${i})">削除</button>
      </div>
    </div>
  `).join('');
}

window.previewTake = function(i) {
  const t = takes[i];
  const preview = {
    name: t.name,
    duration_sec: t.duration_sec,
    frame_count: t.frame_count,
    avg_fps: t.avg_fps,
    sample_frame_0: t.frames[0],
  };
  jsonPreview.style.display = 'block';
  jsonPreview.textContent = JSON.stringify(preview, null, 2);
};

window.downloadTake = function(i) {
  const t = takes[i];
  const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `awa-odori_take${t.id}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

window.deleteTake = function(i) {
  takes.splice(i, 1);
  jsonPreview.style.display = 'none';
  renderTakes();
};

function setStatus(state, text) {
  statusDot.className = 'status-dot' + (state === 'active' ? ' active' : '');
  statusText.textContent = text;
}

function setMsg(text, type = '') {
  msgArea.textContent = text;
  msgArea.className = 'message-area' + (type ? ' ' + type : '');
}

async function initModel() {
  setMsg('モデルを読み込み中...', '');
  msgArea.classList.add('loading-pulse');
  setStatus('', '読み込み中');

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  msgArea.classList.remove('loading-pulse');
  setMsg('モデル読み込み完了', 'ok');
  setStatus('', '準備完了');
}

async function startCamera() {
  startBtn.disabled = true;
  setMsg('カメラに接続中...', '');

  try {
    if (!poseLandmarker) await initModel();

    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' }
    });
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = r);
    video.play();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    placeholder.style.display = 'none';
    fpsDisplay.style.display = 'block';
    stopBtn.disabled = false;
    recBtn.disabled = false;
    setStatus('active', '検出中');
    setMsg('骨格を検出しています', 'ok');
    detectLoop();
  } catch (e) {
    startBtn.disabled = false;
    setMsg('エラー: ' + (e.name === 'NotAllowedError' ? 'カメラへのアクセスが拒否されました' : e.message), 'error');
    setStatus('', 'エラー');
  }
};

function stopCamera() {
  if (isRecording) stopRecord();
  if (animId) cancelAnimationFrame(animId);
  animId = null;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  if (poseLandmarker) { poseLandmarker.close(); poseLandmarker = null; }
  lastTime = 0;
  fpsArr = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  placeholder.style.display = 'flex';
  fpsDisplay.style.display = 'none';
  stopBtn.disabled = true;
  recBtn.disabled = true;
  startBtn.disabled = false;
  recTimer.style.display = 'none';
  recCounter.style.display = 'none';
  setStatus('', '停止');
  setMsg('', '');
  resetUI();
};

function detectLoop(now = 0) {
  animId = requestAnimationFrame(detectLoop);
  if (!poseLandmarker || video.readyState < 2) return;

  const result = poseLandmarker.detectForVideo(video, now);

  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-canvas.width, 0);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    if (document.getElementById('showSkeleton').checked) drawSkeleton(lm);
    if (document.getElementById('showPoints').checked) drawPoints(lm);
    if (document.getElementById('showAngles').checked) drawAngleLabels(lm);
    
    // スコア付きUI更新を呼び出す
    updateUIExtended(lm);

    if (isRecording) {
      recordedFrames.push({
        timestamp_ms: Math.round(now),
        landmarks: lm.map(l => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }))
      });
    }
  }

  const delta = now - lastTime;
  if (delta > 0) {
    fpsArr.push(1000 / delta);
    if (fpsArr.length > 20) fpsArr.shift();
    const fps = Math.round(fpsArr.reduce((a, b) => a + b) / fpsArr.length);
    fpsDisplay.textContent = fps + ' fps';
  }
  lastTime = now;
}

/* --- 5. 描画・補助関数 --- */
function lmToCanvas(l) {
  return [(1 - l.x) * canvas.width, l.y * canvas.height];
}

function drawSkeleton(lm) {
  ctx.strokeStyle = 'rgba(232,160,32,0.7)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const [a, b] of CONNECTIONS) {
    if (!lm[a] || !lm[b]) continue;
    if (lm[a].visibility < 0.4 || lm[b].visibility < 0.4) continue;
    const [x1,y1] = lmToCanvas(lm[a]);
    const [x2,y2] = lmToCanvas(lm[b]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

function drawPoints(lm) {
  for (const [i, l] of lm.entries()) {
    if (l.visibility < 0.4) continue;
    const [x, y] = lmToCanvas(l);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = l.visibility > 0.7 ? '#5dcaa5' : '#e8a020';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function calcAngle(a, b, c) {
  const ab = [a.x - b.x, a.y - b.y];
  const cb = [c.x - b.x, c.y - b.y];
  const dot = ab[0]*cb[0] + ab[1]*cb[1];
  const magAB = Math.sqrt(ab[0]**2 + ab[1]**2);
  const magCB = Math.sqrt(cb[0]**2 + cb[1]**2);
  if (magAB === 0 || magCB === 0) return 0;
  return Math.round(Math.acos(Math.min(1, Math.max(-1, dot / (magAB * magCB)))) * 180 / Math.PI);
}

function drawAngleLabels(lm) {
  const joints = [
    { idx: 13, a: 11, b: 13, c: 15, label: '右肘' },
    { idx: 14, a: 12, b: 14, c: 16, label: '左肘' },
    { idx: 25, a: 23, b: 25, c: 27, label: '右膝' },
    { idx: 26, a: 24, b: 26, c: 28, label: '左膝' },
  ];
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  for (const j of joints) {
    const lmJ = lm[j.idx];
    if (lmJ.visibility < 0.5) continue;
    const angle = calcAngle(lm[j.a], lm[j.b], lm[j.c]);
    const [x, y] = lmToCanvas(lmJ);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - 24, y - 22, 48, 18);
    ctx.fillStyle = '#e8a020';
    ctx.fillText(angle + '°', x, y - 8);
  }
}

function updateUI(lm) {
  const angles = {
    relbow: calcAngle(lm[11], lm[13], lm[15]),
    lelbow: calcAngle(lm[12], lm[14], lm[16]),
    rknee: calcAngle(lm[23], lm[25], lm[27]),
    lknee: calcAngle(lm[24], lm[26], lm[28]),
    rshoulder: calcAngle(lm[13], lm[11], lm[23]),
    lshoulder: calcAngle(lm[14], lm[12], lm[24]),
  };
  for (const [key, val] of Object.entries(angles)) {
    const el = document.getElementById('val-' + key);
    const bar = document.getElementById('bar-' + key);
    if (el) el.textContent = val + '°';
    if (bar) bar.style.width = Math.min(100, val / 1.8) + '%';
  }

  const kpMap = {
    nose: 0, leye: 2,
    rshoulder: 11, lshoulder: 12,
    relbow: 13, lelbow: 14,
    rwrist: 15, lwrist: 16,
    rknee: 25, lknee: 26,
    rankle: 27, lankle: 28,
  };
  for (const [key, idx] of Object.entries(kpMap)) {
    const el = document.getElementById('kp-' + key);
    const item = el?.closest('.kp-item');
    if (!el) continue;
    const v = lm[idx].visibility;
    el.textContent = (v * 100).toFixed(0) + '%';
    if (item) {
      item.className = 'kp-item' + (v > 0.7 ? ' detected' : v < 0.4 ? ' low' : '');
    }
  }
}

function resetUI() {
  document.querySelectorAll('.angle-val').forEach(e => e.textContent = '--°');
  document.querySelectorAll('.angle-bar').forEach(e => e.style.width = '0%');
  document.querySelectorAll('.kp-value').forEach(e => e.textContent = '--');
  document.querySelectorAll('.kp-item').forEach(e => e.className = 'kp-item');
  document.getElementById('total-score-val').textContent = '0';
  document.getElementById('score-message').textContent = '';
}

// イベントリスナーの設定
document.getElementById('startBtn').addEventListener('click', startCamera);
document.getElementById('stopBtn').addEventListener('click', stopCamera);
document.getElementById('recBtn').addEventListener('click', toggleRecord);

renderTakes();
