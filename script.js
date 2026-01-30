const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

const API_URL = "https://sa6h1n-bird-sound-monitor.hf.space/analyze";

let mediaRecorder;
let audioStream;
let audioCtx;
let analyser;
let dataArray;
let animationId;
let timer;
let timeLeft = 10;

/* ------------------ WAVEFORM ------------------ */
function drawWave() {
  if (!analyser) return;

  animationId = requestAnimationFrame(drawWave);
  analyser.getByteTimeDomainData(dataArray);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();

  const sliceWidth = canvas.width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;

    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += sliceWidth;
  }

  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ------------------ RECORD ------------------ */
recordBtn.onclick = async () => {
  resultsEl.innerHTML = "";
  statusEl.textContent = "🎙 Preparing microphone…";

  recordBtn.disabled = true;
  stopBtn.disabled = false;

  audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;

  const source = audioCtx.createMediaStreamSource(audioStream);
  source.connect(analyser);
  dataArray = new Uint8Array(analyser.fftSize);

  mediaRecorder = new MediaRecorder(audioStream);
  const chunks = [];

  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.start();

  timeLeft = 10;
  statusEl.textContent = `🎙 Recording… ${timeLeft}s`;
  drawWave();

  timer = setInterval(() => {
    timeLeft--;
    statusEl.textContent = `🎙 Recording… ${timeLeft}s`;
    if (timeLeft <= 0) stopRecording();
  }, 1000);

  stopBtn.onclick = stopRecording;

  async function stopRecording() {
    clearInterval(timer);
    cancelAnimationFrame(animationId);

    stopBtn.disabled = true;
    statusEl.textContent = "🤖 Analyzing with AI…";

    mediaRecorder.stop();
    audioStream.getTracks().forEach(t => t.stop());
    await audioCtx.close();

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/wav" });
      const formData = new FormData();
      formData.append("file", blob, "recording.wav");

      try {
        recordBtn.disabled = true;
        recordBtn.textContent = "Analyzing…";

        const res = await fetch(API_URL, {
          method: "POST",
          body: formData
        });

        if (!res.ok) throw new Error("Server error");

        const data = await res.json();
        showResults(data.predictions);
        statusEl.textContent = "Analysis complete";

      } catch (err) {
        console.error(err);
        statusEl.textContent = "Analysis failed. Please try again.";
      }

      recordBtn.disabled = false;
      recordBtn.textContent = "🎙 Record";
    };
  }
};

/* ------------------ RESULTS ------------------ */
function showResults(predictions) {
  resultsEl.innerHTML = "";

  predictions.forEach((p, i) => {
    const conf = Math.round(p.confidence * 100);

    resultsEl.innerHTML += `
      <div class="result-card">
        <div class="rank">#${i + 1}</div>
        <h3>${p.bird}</h3>
        <div class="confidence-bar">
          <div class="confidence-fill" style="width:${conf}%"></div>
        </div>
        <small>${conf}% confidence</small>
      </div>
    `;
  });
}
