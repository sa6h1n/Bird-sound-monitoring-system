const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

let mediaRecorder;
let stream;
let analyser;
let audioCtx;
let dataArray;
let timer;
let timeLeft = 10;
let isRecording = false;
let isAnalyzing = false;

/* ================= IMAGE FETCH ================= */
async function getBirdImage(name) {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        name
      )}`
    );
    const data = await res.json();
    return data.thumbnail?.source || null;
  } catch {
    return null;
  }
}

/* ================= WAVEFORM ================= */
function drawWave() {
  if (!analyser || !isRecording) return;

  requestAnimationFrame(drawWave);
  analyser.getByteTimeDomainData(dataArray);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();

  const slice = canvas.width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const y = (dataArray[i] / 128) * (canvas.height / 2);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += slice;
  }

  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ================= RECORD ================= */
recordBtn.onclick = async () => {
  if (isAnalyzing) return;

  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  audioCtx.createMediaStreamSource(stream).connect(analyser);

  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);

  mediaRecorder = new MediaRecorder(stream);
  const chunks = [];

  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.start();

  isRecording = true;
  timeLeft = 10;

  recordBtn.disabled = true;
  stopBtn.disabled = false;
  resultsEl.innerHTML = "";
  statusEl.innerHTML = `🎙 Recording… ${timeLeft}s`;

  drawWave();

  timer = setInterval(() => {
    timeLeft--;
    statusEl.innerHTML = `🎙 Recording… ${timeLeft}s`;
    if (timeLeft <= 0) stopRecording();
  }, 1000);

  stopBtn.onclick = stopRecording;

  async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    clearInterval(timer);
    mediaRecorder.stop();
    stream.getTracks().forEach(t => t.stop());
    await audioCtx.close();

    stopBtn.disabled = true;
    statusEl.innerHTML = `<span class="ai-loading">🤖 Analyzing with AI…</span>`;
    isAnalyzing = true;

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/wav" });
      const fd = new FormData();
      fd.append("file", blob, "recording.wav");

      try {
        const res = await fetch(
          "https://sa6h1n-bird-sound-monitor.hf.space/analyze",
          { method: "POST", body: fd }
        );

        const data = await res.json();
        await renderResults(data.predictions);
        statusEl.innerHTML = "✅ Analysis complete";
      } catch (err) {
        statusEl.innerHTML = "❌ Analysis failed. Try again.";
      }

      recordBtn.disabled = false;
      isAnalyzing = false;
    };
  }
};

/* ================= RESULTS ================= */
async function renderResults(predictions) {
  resultsEl.innerHTML = "";

  for (let i = 0; i < predictions.length; i++) {
    const p = predictions[i];
    const conf = Math.round(p.confidence * 100);
    const img = await getBirdImage(p.bird);

    resultsEl.innerHTML += `
      <div class="result-card">
        <div class="rank">#${i + 1}</div>

        ${
          img
            ? `<img src="${img}" class="bird-img">`
            : `<div class="no-img">No Image</div>`
        }

        <strong>${p.bird}</strong>

        <div class="confidence-bar">
          <div class="confidence-fill" style="width:${conf}%"></div>
        </div>

        <small>${conf}% confidence</small>
      </div>
    `;
  }
}
