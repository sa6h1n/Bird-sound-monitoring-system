const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

const BACKEND_URL = "https://bird-sound-backend.onrender.com/analyze";

let mediaRecorder = null;
let micStream = null;
let audioCtx = null;
let analyser = null;
let dataArray = null;
let animationId = null;
let timer = null;
let timeLeft = 10;
let chunks = [];

/* ================= IMAGE FETCH ================= */
async function getBirdImage(name) {
  if (!name) return "https://upload.wikimedia.org/wikipedia/commons/6/65/No-Image-Placeholder.svg";
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`
    );
    const data = await res.json();
    return data.thumbnail?.source ||
      "https://upload.wikimedia.org/wikipedia/commons/6/65/No-Image-Placeholder.svg";
  } catch {
    return "https://upload.wikimedia.org/wikipedia/commons/6/65/No-Image-Placeholder.svg";
  }
}

/* ================= WAVEFORM ================= */
function drawWave() {
  if (!analyser) return;

  animationId = requestAnimationFrame(drawWave);
  analyser.getByteTimeDomainData(dataArray);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();

  const sliceWidth = canvas.width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const y = (dataArray[i] / 128.0) * canvas.height / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }

  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ================= CLEANUP ================= */
function cleanup() {
  if (timer) clearInterval(timer);
  if (animationId) cancelAnimationFrame(animationId);

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }

  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }

  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }

  analyser = null;
  dataArray = null;

  recordBtn.disabled = false;
  stopBtn.disabled = true;
}

/* ================= RECORD ================= */
recordBtn.onclick = async () => {
  resultsEl.innerHTML = "";
  statusEl.textContent = "🎤 Preparing microphone…";

  chunks = [];
  timeLeft = 10;

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(micStream);
    source.connect(analyser);

    analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.fftSize);

    mediaRecorder = new MediaRecorder(micStream, { mimeType: "audio/webm" });

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.start();

    recordBtn.disabled = true;
    stopBtn.disabled = false;

    drawWave();

    statusEl.textContent = `🔴 Recording… ${timeLeft}s`;

    timer = setInterval(() => {
      timeLeft--;
      statusEl.textContent = `🔴 Recording… ${timeLeft}s`;
      if (timeLeft <= 0) stopRecording();
    }, 1000);

  } catch (err) {
    statusEl.textContent = "❌ Microphone access denied";
    cleanup();
  }
};

/* ================= STOP ================= */
stopBtn.onclick = stopRecording;

function stopRecording() {
  if (!mediaRecorder) return;

  cleanup();
  statusEl.textContent = "🧠 Analyzing (server waking up)…";

  mediaRecorder.onstop = async () => {
    try {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const formData = new FormData();
      formData.append("file", blob, "recording.webm");

      const res = await fetch(BACKEND_URL, {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      renderResults(data);

    } catch (err) {
      statusEl.textContent = "❌ Analysis failed";
      recordBtn.disabled = false;
    }
  };
}

/* ================= RESULTS ================= */
async function renderResults(data) {
  resultsEl.innerHTML = "";

  if (!data.predictions || data.predictions.length === 0) {
    statusEl.textContent = "❌ No bird detected";
    recordBtn.disabled = false;
    return;
  }

  for (let i = 0; i < data.predictions.length; i++) {
    const p = data.predictions[i];
    const img = await getBirdImage(p.bird);
    const conf = Math.round(p.confidence * 100);

    resultsEl.innerHTML += `
      <div class="result-card">
        <div class="rank">#${i + 1}</div>
        <img src="${img}" alt="${p.bird}">
        <h3>${p.bird}</h3>
        <div class="confidence-bar">
          <div class="confidence-fill" style="width:${conf}%"></div>
        </div>
        <small>${conf}% confidence</small>
      </div>
    `;
  }

  statusEl.textContent = "✅ Analysis complete";
  recordBtn.disabled = false;
}
