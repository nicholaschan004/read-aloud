// DOM
const video       = document.getElementById('video');
const canvas      = document.getElementById('canvas');
const ctx         = canvas.getContext('2d');
const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');
const answerCard  = document.getElementById('answer-card');
const answerText  = document.getElementById('answer-text');
const speakBtn    = document.getElementById('speak-btn');
const countdownEl = document.getElementById('countdown');
const startScreen = document.getElementById('start-screen');
const flashEl     = document.getElementById('flash');

// ── Gesture config ────────────────────────────────────────────────────────
const GESTURES = [
  { id: 'wave',  icon: '🤚', label: 'Wave',  hint: 'Wave hand to capture' },
  { id: 'pinch', icon: '🤌', label: 'Pinch', hint: 'Pinch to capture'     },
];
let gestureModeIdx = parseInt(localStorage.getItem('gestureModeIdx') || '0');
const gesture = () => GESTURES[gestureModeIdx];

// ── Constants ─────────────────────────────────────────────────────────────
const COUNTDOWN_SECS  = 2;
const REARM_DELAY_MS  = 4000;
const CAPTURE_W       = 768;
const COUNT_WORDS     = ['', 'one', 'two', 'three'];

// MediaPipe (lazy-loaded only when Pinch mode is active)
const WASM_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PINCH_CLOSE     = 0.07;
const PINCH_OPEN      = 0.12;
const DETECT_INTERVAL = 100;

// Wave detection
const WAVE_SPIKE  = 14;  // avg pixel diff = deliberate hand motion
const WAVE_SETTLE = 4;   // diff falls back = hand is gone, take photo

// Shake detection
const SHAKE_THRESHOLD = 22; // m/s² magnitude for a deliberate shake

// ── State ─────────────────────────────────────────────────────────────────
let audioCtx       = null;
let _utt           = null;
let _speechSource  = null;
let countdownTimer = null;
let lastTriggerAt  = 0;
let analyzing      = false;
let currentAnswer  = '';

// Pinch state
let handLandmarker = null;
let pinchState     = 'open';
let lastDetectTime = 0;

// Wave state
let lastWaveFrame  = null;
let waveTriggered  = false;
let waveLoopId     = null;

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
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
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
async function speak(text) {
  try { _speechSource?.stop(); } catch {}
  _speechSource = null;
  window.speechSynthesis.cancel();

  try {
    if (!audioCtx) throw new Error('no ctx');
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('tts failed');
    const audioBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
    _speechSource = audioCtx.createBufferSource();
    _speechSource.buffer = audioBuffer;
    _speechSource.connect(audioCtx.destination);
    _speechSource.start();
    _speechSource.onended = () => { _speechSource = null; };
  } catch {
    _utt = new SpeechSynthesisUtterance(text);
    _utt.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(v => /Samantha|Nicky|Karen|Moira/i.test(v.name) && v.localService)
      || voices.find(v => v.lang === 'en-US' && v.localService)
      || voices.find(v => v.lang.startsWith('en'));
    if (v) _utt.voice = v;
    setTimeout(() => window.speechSynthesis.speak(_utt), 120);
  }
}

setInterval(() => { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); }, 5000);
window.speechSynthesis.getVoices();
window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices());
speakBtn.addEventListener('click', () => { if (currentAnswer) speak(currentAnswer); });

// ── UI ────────────────────────────────────────────────────────────────────
function setStatus(state, text) {
  statusDot.className = state;
  statusText.textContent = text;
}

function setReady() {
  setStatus('ready', gesture().hint);
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
      setReady();
      speak("I don't see a question. Try pointing the camera at a form or screen.");
    } else if (data.answer) {
      showAnswer(data.answer);
      speak(data.answer);
      setReady();
    } else {
      setReady();
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
function canTrigger() {
  return !analyzing && !countdownTimer && Date.now() - lastTriggerAt > REARM_DELAY_MS;
}

function startCountdown() {
  if (!canTrigger()) return;
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

// ── Gesture: Tap ──────────────────────────────────────────────────────────
document.getElementById('overlay').addEventListener('touchstart', (e) => {
  if (gesture().id !== 'tap') return;
  if (e.target.closest('#answer-card, #gesture-btn, #speak-btn')) return;
  startCountdown();
}, { passive: true });

// ── Gesture: Wave ─────────────────────────────────────────────────────────
function avgDiff(a, b) {
  const len = Math.min(a.data.length, b.data.length);
  let total = 0;
  for (let i = 0; i < len; i += 16) total += Math.abs(a.data[i] - b.data[i]);
  return total / (len / 16);
}

function waveLoop() {
  waveLoopId = setTimeout(waveLoop, 100);
  if (gesture().id !== 'wave') return;
  if (video.readyState < 2) return;

  canvas.width = 160; canvas.height = 90;
  ctx.drawImage(video, 0, 0, 160, 90);
  const frame = ctx.getImageData(0, 0, 160, 90);

  if (lastWaveFrame) {
    const diff = avgDiff(frame, lastWaveFrame);
    if (!waveTriggered && diff > WAVE_SPIKE) {
      waveTriggered = true;
    } else if (waveTriggered && diff < WAVE_SETTLE) {
      waveTriggered = false;
      startCountdown();
    }
  }
  lastWaveFrame = frame;
}

// ── Gesture: Pinch (MediaPipe, lazy-loaded) ───────────────────────────────
async function loadPinch() {
  if (handLandmarker) { startPinchLoop(); return; }
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
    startPinchLoop();
  } catch {
    setStatus('error', 'Pinch detection unavailable');
  }
}

function startPinchLoop() {
  setReady();
  requestAnimationFrame(pinchLoop);
}

function pinchLoop() {
  if (gesture().id !== 'pinch') return; // stop if mode changed
  requestAnimationFrame(pinchLoop);
  if (!handLandmarker || video.readyState < 2 || analyzing || countdownTimer) return;

  const now = performance.now();
  if (now - lastDetectTime < DETECT_INTERVAL) return;
  lastDetectTime = now;

  const results = handLandmarker.detectForVideo(video, now);
  if (!results.landmarks.length) { pinchState = 'open'; return; }

  const t = results.landmarks[0][4];
  const idx = results.landmarks[0][8];
  const dist = Math.hypot(t.x - idx.x, t.y - idx.y);

  if (pinchState === 'open' && dist < PINCH_CLOSE) {
    pinchState = 'pinched';
    startCountdown();
  } else if (pinchState === 'pinched' && dist > PINCH_OPEN) {
    pinchState = 'open';
  }
}

// ── Gesture: Shake (always-on backup) ────────────────────────────────────
function setupShake() {
  let lastShakeAt = 0;
  window.addEventListener('devicemotion', (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const mag = Math.sqrt((a.x||0)**2 + (a.y||0)**2 + (a.z||0)**2);
    const now = Date.now();
    if (mag > SHAKE_THRESHOLD && now - lastShakeAt > 1500) {
      lastShakeAt = now;
      startCountdown();
    }
  });
}

async function initShake() {
  if (typeof DeviceMotionEvent?.requestPermission === 'function') {
    try {
      const perm = await DeviceMotionEvent.requestPermission();
      if (perm === 'granted') setupShake();
    } catch {}
  } else {
    setupShake();
  }
}

// ── Gesture mode switching ────────────────────────────────────────────────
function applyGestureMode() {
  // Update bar button states
  document.querySelectorAll('.gesture-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === gesture().id);
  });

  // Stop wave loop
  if (waveLoopId) { clearTimeout(waveLoopId); waveLoopId = null; }
  waveTriggered = false;
  lastWaveFrame = null;

  if (gesture().id === 'wave') {
    setReady();
    waveLoop();
  } else if (gesture().id === 'pinch') {
    loadPinch();
  }
}

function buildGestureBar() {
  const bar = document.getElementById('gesture-bar');
  GESTURES.forEach((g, i) => {
    const btn = document.createElement('button');
    btn.className = 'gesture-opt' + (i === gestureModeIdx ? ' active' : '');
    btn.dataset.id = g.id;
    btn.textContent = `${g.icon} ${g.label}`;
    btn.addEventListener('click', () => {
      if (gesture().id === g.id) return;
      gestureModeIdx = i;
      localStorage.setItem('gestureModeIdx', i);
      applyGestureMode();
    });
    bar.appendChild(btn);
  });
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
  try {
    await startCamera();
  } catch {}
  startScreen.querySelector('p').textContent = 'Tap anywhere to start';
}

startScreen.addEventListener('click', () => {
  initAudio();
  initShake();

  // Unlock iOS speech synthesis with a silent utterance inside this gesture
  _utt = new SpeechSynthesisUtterance('a');
  _utt.volume = 0; _utt.rate = 10;
  _utt.onend = () => speak(`Ready. ${gesture().hint}.`);
  window.speechSynthesis.speak(_utt);

  startScreen.classList.add('hidden');
  buildGestureBar();
  applyGestureMode();
}, { once: true });

boot();
