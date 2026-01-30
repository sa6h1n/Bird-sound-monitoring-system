const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

const API_URL = "https://sa6h1n-bird-sound-monitor.hf.space/analyze";

let mediaRecorder;
let audioChunks = [];
let audioCtx, analyser, dataArray;
let timerInterval;
let timeLeft = 10;

/* ---------- Waveform ---------- */
function drawWave() {
  if (!analyser) return;
  requestAnimationFrame(drawWave);

  analyser.getByteTimeDomainData(dataArray);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.beginPath();
  ctx.strokeStyle = "#60a5fa";
  let slice = canvas.width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    let y = (dataArray[i] / 128.0) * canvas.height / 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += slice;
  }
  ctx.stroke();
}

/* ---------- RECORD ---------- */
recordBtn.onclick = async () => {
  resultsEl.innerHTML = "";
  audioChunks = [];
  timeLeft = 10;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Audio context for waveform
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);
  audioCtx.createMediaStreamSource(stream).connect(analyser);
  drawWave();

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
  mediaRecorder.start();

  recordBtn.disabled = true;
  stopBtn.disabled = false;

  statusEl.textContent = `🎙️ Recording… ${timeLeft}s`;

  timerInterval = setInterval(() => {
    timeLeft--;
    statusEl.textContent = `🎙️ Recording… ${timeLeft}s`;
    if (timeLeft <= 0) stopRecording(stream);
  }, 1000);

  stopBtn.onclick = () => stopRecording(stream);
};

/* ---------- STOP ---------- */
function stopRecording(stream) {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;

  clearInterval(timerInterval);
  mediaRecorder.stop();
  stream.getTracks().forEach(t => t.stop());
  audioCtx.close();

  recordBtn.disabled = false;
  stopBtn.disabled = true;

  mediaRecorder.onstop = async () => {
    try {
      statusEl.textContent = "⏳ Converting audio…";

      const blob = new Blob(audioChunks, { type: "audio/webm" });
      if (blob.size < 5000) throw new Error("Audio too short");

      const wavBlob = await convertToWav(blob);
      await sendToBackend(wavBlob);
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Analysis failed. Please try again.";
    }
  };
}

/* ---------- WAV CONVERSION ---------- */
async function convertToWav(blob) {
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  return new Blob([audioBufferToWav(buffer)], { type: "audio/wav" });
}

function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const length = buffer.length * numCh * 2 + 44;
  const ab = new ArrayBuffer(length);
  const view = new DataView(ab);
  let offset = 0;

  const write = s => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };

  write("RIFF");
  view.setUint32(offset, length - 8, true); offset += 4;
  write("WAVEfmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numCh, true); offset += 2;
  view.setUint32(offset, buffer.sampleRate, true); offset += 4;
  view.setUint32(offset, buffer.sampleRate * numCh * 2, true); offset += 4;
  view.setUint16(offset, numCh * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  write("data");
  view.setUint32(offset, buffer.length * numCh * 2, true); offset += 4;

  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      view.setInt16(offset, buffer.getChannelData(ch)[i] * 0x7fff, true);
      offset += 2;
    }
  }
  return ab;
}

/* ---------- BACKEND ---------- */
async function sendToBackend(wavBlob) {
  statusEl.textContent = "Analyzing (can take ~30s)…";

  const fd = new FormData();
  fd.append("file", wavBlob, "recording.wav");

  const res = await fetch(API_URL, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Backend error");

  const data = await res.json();
  renderResults(data.predictions);
  statusEl.textContent = "Analysis complete";
}

/* ---------- RESULTS ---------- */
function renderResults(preds) {
  resultsEl.innerHTML = "";
  preds.forEach((p, i) => {
    resultsEl.innerHTML += `
      <div class="result-card">
        <strong>#${i + 1} ${p.bird}</strong>
        <div class="confidence-bar">
          <div class="confidence-fill" style="width:${p.confidence * 100}%"></div>
        </div>
        <small>${Math.round(p.confidence * 100)}%</small>
      </div>`;
  });
}
