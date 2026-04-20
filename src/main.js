import { HandLandmarker, FilesetResolver } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

// DOM
const video      = document.getElementById('video');
const canvas     = document.getElementById('canvas');
const ctx        = canvas.getContext('2d');
const statusDot  = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const answerCard = document.getElementById('answer-card');
const answerText = document.getElementById('answer-text');
const speakBtn   = document.getElementById('speak-btn');
const countdownEl= document.getElementById('countdown');

// Config
const WASM_URL   = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PINCH_CLOSE     = 0.07;  // normalized dist — fingers together
const PINCH_OPEN      = 0.12;  // normalized dist — fingers clearly apart (hysteresis)
const COUNTDOWN_SECS  = 2;
const REARM_DELAY_MS  = 4000;  // min gap between triggers
const CAPTURE_W       = 768;
const DETECT_INTERVAL = 100;   // ms between hand detection frames (~10fps)

// State
let handLandmarker  = null;
let pinchState      = 'open'; // 'open' | 'pinched'
let countdownTimer  = null;
let lastTriggerAt   = 0;
let analyzing       = false;
let currentAnswer   = '';
let lastDetectTime  = 0;

// ── UI ───────────────────────────────────────────────────────────────────
function setStatus(state, text) {
  statusDot.className = state;
  statusText.textContent = text;
}

function showCountdown(n) {
  if (n <= 0) {
    countdownEl.classList.add('hidden');
  } else {
    countdownEl.textContent = n;
    countdownEl.classList.remove('hidden');
  }
}

function showAnswer(text) {
  currentAnswer = text;
  answerText.textContent = text;
  answerCard.classList.remove('hidden');
}

function hideAnswer() {
  answerCard.classList.add('hidden');
}

// ── TTS ──────────────────────────────────────────────────────────────────
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.88;
  utt.pitch = 1.0;
  utt.volume = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => /Samantha|Karen|Moira|Victoria/i.test(v.name))
    || voices.find(v => v.lang.startsWith('en') && v.localService);
  if (preferred) utt.voice = preferred;
  window.speechSynthesis.speak(utt);
}

speakBtn.addEventListener('click', () => { if (currentAnswer) speak(currentAnswer); });

// ── Capture + Analyze ────────────────────────────────────────────────────
function captureDataURL() {
  const aspect = video.videoHeight / video.videoWidth;
  canvas.width = CAPTURE_W;
  canvas.height = Math.round(CAPTURE_W * aspect);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function analyzeFrame() {
  analyzing = true;
  setStatus('thinking', 'Looking…');

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: captureDataURL() }),
    });
    const data = await res.json();
    if (data.nothing) {
      hideAnswer();
      setStatus('ready', 'Pinch to take a photo');
    } else if (data.answer) {
      showAnswer(data.answer);
      speak(data.answer);
      setStatus('ready', 'Pinch again for another');
    } else {
      setStatus('', 'Pinch to take a photo');
    }
  } catch {
    setStatus('error', 'Connection problem — try again');
  }

  lastTriggerAt = Date.now();
  analyzing = false;
}

// ── Countdown ────────────────────────────────────────────────────────────
function startCountdown() {
  let remaining = COUNTDOWN_SECS;
  setStatus('thinking', 'Hold still…');
  showCountdown(remaining);

  countdownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      showCountdown(0);
      analyzeFrame();
    } else {
      showCountdown(remaining);
    }
  }, 1000);
}

// ── Pinch Detection ───────────────────────────────────────────────────────
function pinchDistance(landmarks) {
  const thumb = landmarks[4]; // thumb tip
  const index = landmarks[8]; // index finger tip
  return Math.hypot(thumb.x - index.x, thumb.y - index.y);
}

function detectLoop() {
  requestAnimationFrame(detectLoop);

  if (!handLandmarker || video.readyState < 2) return;
  if (analyzing || countdownTimer) return;

  const now = performance.now();
  if (now - lastDetectTime < DETECT_INTERVAL) return;
  lastDetectTime = now;

  const results = handLandmarker.detectForVideo(video, now);

  if (!results.landmarks.length) {
    pinchState = 'open';
    return;
  }

  const dist = pinchDistance(results.landmarks[0]);

  if (pinchState === 'open' && dist < PINCH_CLOSE) {
    if (Date.now() - lastTriggerAt > REARM_DELAY_MS) {
      pinchState = 'pinched';
      startCountdown();
    }
  } else if (pinchState === 'pinched' && dist > PINCH_OPEN) {
    pinchState = 'open';
  }
}

// ── Camera ────────────────────────────────────────────────────────────────
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch {
    setStatus('error', 'Camera not available');
    throw new Error('camera');
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────
window.speechSynthesis.getVoices();
window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices());

async function boot() {
  setStatus('', 'Loading…');
  try {
    await startCamera();
    const resolver = await FilesetResolver.forVisionTasks(WASM_URL);
    handLandmarker = await HandLandmarker.createFromOptions(resolver, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    setStatus('ready', 'Pinch to take a photo');
    requestAnimationFrame(detectLoop);
  } catch (err) {
    if (err.message !== 'camera') {
      setStatus('error', 'Could not load gesture detection');
    }
  }
}

boot();
