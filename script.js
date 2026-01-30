const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

const API_URL = "https://sa6h1n-bird-sound-monitor.hf.space/analyze";

let mediaRecorder;
let micStream;
let audioCtx;
let analyser;
let dataArray;
let animationId;
let timer;
let timeLeft = 10;

function resetUI() {
  cancelAnimationFrame(animationId);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  recordBtn.disabled = false;
  stopBtn.disabled = true;
}

function drawWave() {
  animationId = requestAnimationFrame(drawWave);
  analyser.getByteTimeDomainData(dataArray);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  let slice = canvas.width / dataArray.length;
  let x = 0;
  for (let i = 0; i < dataArray.length; i++) {
    let y = (dataArray[i] / 128) * canvas.height / 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += slice;
  }
  ctx.strokeStyle = "#60a5fa";
  ctx.stroke();
}

async function getBirdImage(name) {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`
    );
    const data = await res.json();
    return (
      data.thumbnail?.source ||
      "https://upload.wikimedia.org/wikipedia/commons/6/65/No-Image-Placeholder.svg"
    );
  } catch {
    return "https://upload.wikimedia.org/wikipedia/commons/6/65/No-Image-Placeholder.svg";
  }
}

recordBtn.onclick = async () => {
  resultsEl.innerHTML = "";
  recordBtn.disabled = true;
  stopBtn.disabled = false;

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  audioCtx.createMediaStreamSource(micStream).connect(analyser);
  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);

  mediaRecorder = new MediaRecorder(micStream);
  let chunks = [];

  mediaRecorder.ondataavailable = e => chunks.push(e.data);

  mediaRecorder.onstop = async () => {
    try {
      statusEl.textContent = "Analyzing birds (first run may take ~30s)…";

      const blob = new Blob(chunks, { type: "audio/webm" });
      const fd = new FormData();
      fd.append("file", blob, "recording.webm");

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 120000); // 2 min timeout

      const res = await fetch(API_URL, {
        method: "POST",
        body: fd,
        signal: controller.signal
      });

      if (!res.ok) throw new Error("Server error");

      const data = await res.json();
      resultsEl.innerHTML = "";

      for (let i = 0; i < data.predictions.length; i++) {
        const p = data.predictions[i];
        const img = await getBirdImage(p.bird);
        const conf = Math.round(p.confidence * 100);

        resultsEl.innerHTML += `
          <div class="result-card">
            <div class="rank">#${i + 1}</div>
            <img src="${img}">
            <h3>${p.bird}</h3>
            <div class="confidence-bar">
              <div class="confidence-fill" style="width:${conf}%"></div>
            </div>
            <small>${conf}% confidence</small>
          </div>`;
      }

      statusEl.textContent = "Analysis complete";
    } catch (err) {
      statusEl.textContent = "Analysis failed. Please try again.";
    } finally {
      resetUI();
    }
  };

  mediaRecorder.start();
  drawWave();

  timeLeft = 10;
  statusEl.textContent = `🎙 Recording… ${timeLeft}s`;

  timer = setInterval(() => {
    timeLeft--;
    statusEl.textContent = `🎙 Recording… ${timeLeft}s`;
    if (timeLeft <= 0) stopRecording();
  }, 1000);
};

stopBtn.onclick = stopRecording;

function stopRecording() {
  clearInterval(timer);
  stopBtn.disabled = true;

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }

  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
  }

  if (audioCtx) {
    audioCtx.close();
  }
}
