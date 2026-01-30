const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

let mediaRecorder, audioCtx, analyser, dataArray, micStream;
let timer, timeLeft = 10;

canvas.width = canvas.offsetWidth;
canvas.height = canvas.offsetHeight;

function drawWave() {
  if (!analyser) return;
  requestAnimationFrame(drawWave);
  analyser.getByteTimeDomainData(dataArray);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  let slice = canvas.width / dataArray.length;
  let x = 0;
  for (let i = 0; i < dataArray.length; i++) {
    let y = (dataArray[i] / 128.0) * canvas.height / 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += slice;
  }
  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 2;
  ctx.stroke();
}

recordBtn.onclick = async () => {
  resultsEl.innerHTML = "";
  statusEl.textContent = "Recording… 10s";
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
  mediaRecorder.start();
  drawWave();

  timeLeft = 10;
  timer = setInterval(() => {
    timeLeft--;
    statusEl.textContent = `Recording… ${timeLeft}s`;
    if (timeLeft <= 0) stop();
  }, 1000);

  stopBtn.onclick = stop;

  async function stop() {
    clearInterval(timer);
    stopBtn.disabled = true;
    micStream.getTracks().forEach(t => t.stop());
    audioCtx.close();
    mediaRecorder.stop();

    mediaRecorder.onstop = async () => {
      statusEl.textContent = "Analyzing";
      statusEl.classList.add("thinking");

      const blob = new Blob(chunks, { type: "audio/wav" });
      const fd = new FormData();
      fd.append("file", blob, "recording.wav");

      try {
        const res = await fetch(
          "https://sa6h1n-bird-sound-monitor.hf.space/analyze",
          { method: "POST", body: fd }
        );
        const data = await res.json();

        statusEl.classList.remove("thinking");
        resultsEl.innerHTML = "";

        if (!data.predictions || data.predictions.length === 0) {
          statusEl.textContent = "⚠️ No bird sounds detected";
          resultsEl.innerHTML = `
            <div class="no-result">
              🐦 No bird sounds detected.<br>
              <small>Try recording closer or reduce noise</small>
            </div>`;
        } else {
          statusEl.textContent = "Analysis complete";
          for (const p of data.predictions) {
            const img = await fetchBirdImage(p.bird);
            const percent = Math.round(p.confidence * 100);
            const card = document.createElement("div");
            card.className = "result";
            card.innerHTML = `
              ${img ? `<img src="${img}">` : ""}
              <div class="info">
                <strong>${p.bird}</strong>
                <div class="bar">
                  <div class="bar-fill" style="width:${percent}%"></div>
                </div>
                <small>${percent}% confidence</small>
              </div>`;
            resultsEl.appendChild(card);
          }
        }
      } catch {
        statusEl.textContent = "Analysis failed";
      }

      recordBtn.disabled = false;
    };
  }
};

async function fetchBirdImage(name) {
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`
    );
    const d = await r.json();
    return d.thumbnail?.source || "";
  } catch {
    return "";
  }
}