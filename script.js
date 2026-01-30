const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

let mediaRecorder;
let micStream;
let audioCtx;
let analyser;
let dataArray;
let animationId;
let timer;
let timeLeft = 10;

// ---------- Bird image ----------
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

// ---------- Waveform ----------
function drawWave() {
  analyser.getByteTimeDomainData(dataArray);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();

  const sliceWidth = canvas.width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const y = (dataArray[i] / 128) * canvas.height / 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += sliceWidth;
  }

  ctx.strokeStyle = "#60a5fa";
  ctx.stroke();

  animationId = requestAnimationFrame(drawWave);
}

// ---------- Stop recording ----------
async function stopRecording() {
  clearInterval(timer);
  stopBtn.disabled = true;

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }

  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
  }

  if (audioCtx) {
    await audioCtx.close();
  }

  cancelAnimationFrame(animationId);
}

// ---------- Record ----------
recordBtn.onclick = async () => {
  resultsEl.innerHTML = "";
  statusEl.textContent = "🎙️ Preparing microphone…";

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);

  audioCtx.createMediaStreamSource(micStream).connect(analyser);

  mediaRecorder = new MediaRecorder(micStream);
  const chunks = [];

  mediaRecorder.ondataavailable = e => chunks.push(e.data);

  mediaRecorder.onstop = async () => {
    statusEl.textContent = "🧠 Analyzing…";

    const blob = new Blob(chunks, { type: "audio/webm" });
    const fd = new FormData();
    fd.append("file", blob, "recording.webm");

    const res = await fetch(
      "https://bird-sound-backend.onrender.com/analyze",
      { method: "POST", body: fd }
    );
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
        </div>
      `;
    }

    statusEl.textContent = "✅ Analysis complete";
    recordBtn.disabled = false;
  };

  mediaRecorder.start();
  drawWave();

  recordBtn.disabled = true;
  stopBtn.disabled = false;

  timeLeft = 10;
  statusEl.textContent = `Recording… ${timeLeft}s`;

  timer = setInterval(() => {
    timeLeft--;
    statusEl.textContent = `Recording… ${timeLeft}s`;
    if (timeLeft <= 0) stopRecording();
  }, 1000);
};

// ---------- Stop button ----------
stopBtn.onclick = stopRecording;
