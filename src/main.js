const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const answerCard = document.getElementById('answer-card');
const answerText = document.getElementById('answer-text');
const speakBtn = document.getElementById('speak-btn');

const CAPTURE_W = 768;
const STABILITY_THRESHOLD = 4.5;
const STABILITY_FRAMES = 10;
const CHANGE_THRESHOLD = 8;
const SAMPLE_INTERVAL = 100;
const MIN_REANALYZE_MS = 6000;

let lastFrameData = null;
let lastAnalyzedData = null;
let steadyCount = 0;
let analyzing = false;
let lastAnalyzedAt = 0;
let currentAnswer = '';

function setStatus(state, text) {
  statusDot.className = state;
  statusText.textContent = text;
}

function showAnswer(text) {
  currentAnswer = text;
  answerText.textContent = text;
  answerCard.classList.remove('hidden');
}

function hideAnswer() {
  answerCard.classList.add('hidden');
}

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

function captureFrame() {
  const aspect = video.videoHeight / video.videoWidth;
  canvas.width = CAPTURE_W;
  canvas.height = Math.round(CAPTURE_W * aspect);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function avgDiff(a, b) {
  const len = Math.min(a.data.length, b.data.length);
  let total = 0;
  for (let i = 0; i < len; i += 64) total += Math.abs(a.data[i] - b.data[i]);
  return total / (len / 64);
}

async function analyzeFrame() {
  analyzing = true;
  setStatus('thinking', 'Looking…');
  const dataURL = canvas.toDataURL('image/jpeg', 0.82);
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataURL }),
    });
    const data = await res.json();
    if (data.nothing) {
      hideAnswer();
      setStatus('ready', 'Point at a question');
    } else if (data.answer) {
      showAnswer(data.answer);
      speak(data.answer);
      setStatus('ready', 'Move closer to see more');
    } else {
      setStatus('', 'Point at a question');
    }
  } catch {
    setStatus('error', 'Connection problem — try again');
  }
  lastAnalyzedAt = Date.now();
  analyzing = false;
}

function tick() {
  if (!video.readyState || video.readyState < 2) return;
  const frame = captureFrame();

  if (!lastFrameData) { lastFrameData = frame; return; }

  const motionDiff = avgDiff(frame, lastFrameData);
  lastFrameData = frame;

  steadyCount = motionDiff < STABILITY_THRESHOLD ? steadyCount + 1 : 0;

  const cooldownOk = Date.now() - lastAnalyzedAt > MIN_REANALYZE_MS;

  if (steadyCount >= STABILITY_FRAMES && !analyzing && cooldownOk) {
    const sceneChanged = !lastAnalyzedData || avgDiff(frame, lastAnalyzedData) > CHANGE_THRESHOLD;
    if (sceneChanged) {
      lastAnalyzedData = frame;
      steadyCount = 0;
      analyzeFrame();
    }
  }

  if (steadyCount < STABILITY_FRAMES && !analyzing && answerCard.classList.contains('hidden')) {
    setStatus('', motionDiff > 20 ? 'Hold still…' : 'Point at a question');
  }
}

async function startCamera() {
  setStatus('', 'Starting camera…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    setStatus('ready', 'Point at a question');
    setInterval(tick, SAMPLE_INTERVAL);
  } catch {
    setStatus('error', 'Camera not available');
  }
}

window.speechSynthesis.getVoices();
window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices());

startCamera();
