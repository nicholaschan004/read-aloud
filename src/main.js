import { HandLandmarker, FilesetResolver } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

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

// Config
const WASM_URL        = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL       = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PINCH_CLOSE     = 0.07;
const PINCH_OPEN      = 0.12;
const COUNTDOWN_SECS  = 2;
const REARM_DELAY_MS  = 4000;
const CAPTURE_W       = 768;
const DETECT_INTERVAL = 100;
const COUNT_WORDS     = ['', 'one', 'two', 'three'];

// State
let handLandmarker = null;
let pinchState     = 'open';
let countdownTimer = null;
let lastTriggerAt  = 0;
let analyzing      = false;
let currentAnswer  = '';
let lastDetectTime = 0;
let audioCtx       = null;
let _utt           = null; // module-level ref prevents iOS GC of utterance

// ── Audio (Web Audio ticks) ───────────────────────────────────────────────
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
  const src    = audioCtx.createBufferSource();
  src.buffer   = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type  = 'bandpass';
  filter.frequency.value = 1400;
  filter.Q.value = 1.2;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.7;
  src.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
  src.start();
}

// ── TTS ───────────────────────────────────────────────────────────────────
function getVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find(v => /Samantha|Karen|Moira|Victoria/i.test(v.name))
    || voices.find(v => v.lang.startsWith('en') && v.localService)
    || null;
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  // Keeping _utt at module scope prevents iOS garbage-collecting it mid-speech.
  _utt = new SpeechSynthesisUtterance(text);
  _utt.rate   = 0.88;
  _utt.pitch  = 1.0;
  _utt.volume = 1.0;
  const v = getVoice();
  if (v) _utt.voice = v;
  // Small delay: iOS needs cancel() to fully clear before the next speak().
  setTimeout(() => window.speechSynthesis.speak(_utt), 120);
}

// iOS sometimes silently pauses synthesis mid-sentence — keep it alive.
setInterval(() => {
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();
}, 4000);

window.speechSynthesis.getVoices();
window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices());

speakBtn.addEventListener('click', () => { if (currentAnswer) speak(currentAnswer); });

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
  canvas.width  = CAPTURE_W;
  canvas.height = Math.round(CAPTURE_W * aspect);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function analyzeFrame() {
  analyzing = true;
  setStatus('thinking', 'Looking…');
  speak('Just a moment.');

  try {
    const res  = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: captureDataURL() }),
    });
    const data = await res.json();

    if (data.nothing) {
      hideAnswer();
      setStatus('ready', 'Pinch to take a photo');
      speak("I don't see a question. Try pointing the camera at a form or screen.");
    } else if (data.answer) {
      showAnswer(data.answer);
      speak(data.answer);
      setStatus('ready', 'Pinch again for another');
    } else {
      setStatus('', 'Pinch to take a photo');
      speak('Ready. Pinch to take a photo.');
    }
  } catch {
    setStatus('error', 'Connection problem');
    speak('Having trouble connecting. Please try again.');
  }

  lastTriggerAt = Date.now();
  analyzing = false;
}

// ── Countdown ─────────────────────────────────────────────────────────────
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
  const t = landmarks[4];
  const i = landmarks[8];
  return Math.hypot(t.x - i.x, t.y - i.y);
}

function detectLoop() {
  requestAnimationFrame(detectLoop);
  if (!handLandmarker || video.readyState < 2) return;
  if (analyzing || countdownTimer) return;

  const now = performance.now();
  if (now - lastDetectTime < DETECT_INTERVAL) return;
  lastDetectTime = now;

  const results = handLandmarker.detectForVideo(video, now);
  if (!results.landmarks.length) { pinchState = 'open'; return; }

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
    startScreen.querySelector('p').textContent = 'Tap anywhere to start';
  } catch (err) {
    if (err.message !== 'camera') {
      setStatus('error', 'Could not load gesture detection');
    }
  }
}

// The start-screen tap is the guaranteed user gesture iOS requires for audio.
// We init AudioContext and fire a real (inaudible) utterance here so that
// all future speak() calls work — iOS won't allow audio from async code
// unless speech has been triggered at least once inside a touch handler.
startScreen.addEventListener('click', () => {
  initAudio();

  // Speak a real (silent) word now; iOS unlocks the synthesis engine.
  // On completion, speak the welcome prompt.
  _utt = new SpeechSynthesisUtterance('a');
  _utt.volume = 0;
  _utt.rate   = 10;
  _utt.onend  = () => speak('Ready. Pinch your fingers to take a photo.');
  window.speechSynthesis.speak(_utt);

  startScreen.classList.add('hidden');
  setStatus('ready', 'Pinch to take a photo');
  requestAnimationFrame(detectLoop);
}, { once: true });

boot();
