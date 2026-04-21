// DOM
const video       = document.getElementById('video');
const canvas      = document.getElementById('canvas');
const ctx         = canvas.getContext('2d');
const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');
const answerCard  = document.getElementById('answer-card');
const answerText  = document.getElementById('answer-text');
const countdownEl = document.getElementById('countdown');
const startScreen = document.getElementById('start-screen');
const flashEl     = document.getElementById('flash');

// ── Constants ─────────────────────────────────────────────────────────────
const WASM_URL        = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL       = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PINCH_CLOSE     = 0.07;
const PINCH_OPEN      = 0.12;
const DETECT_INTERVAL = 100;
const COUNTDOWN_SECS  = 2;
const REARM_DELAY_MS  = 4000;
const CAPTURE_W       = 768;
const COUNT_WORDS     = ['', 'one', 'two', 'three'];

// ── State ─────────────────────────────────────────────────────────────────
let audioCtx       = null;
let _utt           = null;
let countdownTimer = null;
let lastTriggerAt  = 0;
let analyzing      = false;
let currentAnswer  = '';
let handLandmarker = null;
let pinchState     = 'open';
let lastDetectTime = 0;

// ── Audio ─────────────────────────────────────────────────────────────────
function initAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTick() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const rate = audioCtx.sampleRate;
  const len  = Math.floor(rate * 0.04);
  const buf  = audioCtx.createBuffer(1, len, rate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 12);
  const src = audioCtx.createBufferSource(); src.buffer = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass'; filter.frequency.value = 1400; filter.Q.value = 1.2;
  const gain = audioCtx.createGain(); gain.gain.value = 0.7;
  src.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
  src.start();
}

function playShutter() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const rate = audioCtx.sampleRate, now = audioCtx.currentTime;
  [0, 0.055].forEach((offset, i) => {
    const len  = Math.floor(rate * (i === 0 ? 0.025 : 0.018));
    const buf  = audioCtx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let j = 0; j < len; j++) data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, 7);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const gain = audioCtx.createGain(); gain.gain.value = i === 0 ? 0.9 : 0.5;
    src.connect(gain); gain.connect(audioCtx.destination); src.start(now + offset);
  });
}

function triggerFlash() {
  flashEl.classList.remove('active');
  void flashEl.offsetWidth;
  flashEl.classList.add('active');
}

// ── TTS ───────────────────────────────────────────────────────────────────
function speak(text) {
  window.speechSynthesis.cancel();
  _utt = new SpeechSynthesisUtterance(text);
  _utt.rate = 0.85;
  const voices = window.speechSynthesis.getVoices();
  const v = voices.find(v => /Moira/i.test(v.name) && v.localService)
    || voices.find(v => /Samantha|Nicky|Karen/i.test(v.name) && v.localService)
    || voices.find(v => v.lang === 'en-US' && v.localService)
    || voices.find(v => v.lang.startsWith('en'));
  if (v) _utt.voice = v;
  setTimeout(() => window.speechSynthesis.speak(_utt), 120);
}

setInterval(() => { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); }, 5000);
window.speechSynthesis.getVoices();
window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices());

// ── UI ────────────────────────────────────────────────────────────────────
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
    playTick();
    speak(COUNT_WORDS[n] || String(n));
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

// ── Capture + Analyze ─────────────────────────────────────────────────────
function captureDataURL() {
  const aspect = video.videoHeight / video.videoWidth;
  canvas.width = CAPTURE_W;
  canvas.height = Math.round(CAPTURE_W * aspect);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function analyzeFrame() {
  analyzing = true;
  triggerFlash();
  playShutter();
  setStatus('thinking', 'Looking…');
  speak('Just a moment.');
  try {
    const res  = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: captureDataURL() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    if (data.nothing) {
      hideAnswer();
      setStatus('ready', 'Pinch to capture');
      speak("I don't see a question. Try pointing the camera at a form or screen.");
    } else if (data.answer) {
      showAnswer(data.answer);
      speak(data.answer);
      setStatus('ready', 'Pinch again for another');
    } else {
      setStatus('ready', 'Pinch to capture');
    }
  } catch (err) {
    console.error('Analysis failed:', err.message);
    setStatus('error', err.message || 'Connection problem');
    speak('Something went wrong. Please try again.');
  }
  lastTriggerAt = Date.now();
  analyzing = false;
}

// ── Countdown ─────────────────────────────────────────────────────────────
function startCountdown() {
  if (analyzing || countdownTimer || Date.now() - lastTriggerAt < REARM_DELAY_MS) return;
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

// ── Pinch Detection (MediaPipe) ───────────────────────────────────────────
function pinchLoop() {
  requestAnimationFrame(pinchLoop);
  if (!handLandmarker || video.readyState < 2 || analyzing || countdownTimer) return;
  const now = performance.now();
  if (now - lastDetectTime < DETECT_INTERVAL) return;
  lastDetectTime = now;
  const results = handLandmarker.detectForVideo(video, now);
  if (!results.landmarks.length) { pinchState = 'open'; return; }
  const t = results.landmarks[0][4];
  const i = results.landmarks[0][8];
  const dist = Math.hypot(t.x - i.x, t.y - i.y);
  if (pinchState === 'open' && dist < PINCH_CLOSE) {
    pinchState = 'pinched';
    startCountdown();
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
async function boot() {
  setStatus('', 'Loading…');
  try { await startCamera(); } catch {}
  startScreen.querySelector('p').textContent = 'Tap anywhere to start';
}

startScreen.addEventListener('click', async () => {
  initAudio();
  speak('Ready. Pinch your fingers to take a photo.');

  startScreen.classList.add('hidden');
  setStatus('', 'Loading pinch detection…');

  try {
    const { HandLandmarker, FilesetResolver } = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
    );
    const resolver = await FilesetResolver.forVisionTasks(WASM_URL);
    handLandmarker = await HandLandmarker.createFromOptions(resolver, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    setStatus('ready', 'Pinch to capture');
    requestAnimationFrame(pinchLoop);
  } catch {
    setStatus('error', 'Pinch detection unavailable');
  }
}, { once: true });

boot();
