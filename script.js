const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

let mediaRecorder, micStream;
let audioCtx, analyser, dataArray;
let timer, timeLeft = 10;
let analyzingInterval;
let animationFrame;

// ------------------ WAVEFORM ------------------
function drawWave() {
  if (!analyser) return;
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

  animationFrame = requestAnimationFrame(drawWave);
}

// ------------------ ANALYZING ANIMATION ------------------
function startAnalyzingAnimation() {
  let dots = 0;
  analyzingInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    statusEl.textContent = "Analyzing" + ".".repeat(dots);
  }, 400);
}

function stopAnalyzingAnimation() {
  clearInterval(analyzingInterval);
}

// ------------------ RECORD ------------------
recordBtn.onclick = async () => {
  resultsEl.innerHTML = "";
  statusEl.textContent = "Preparing mic…";

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  audioCtx.createMediaStreamSource(micStream).connect(analyser);

  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);

  mediaRecorder = new MediaRecorder(micStream);
  const chunks = [];

  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.start();

  recordBtn.disabled = true;
  stopBtn.disabled = false;

  timeLeft = 10;
  statusEl.textContent = `Recording… ${timeLeft}s`;
  drawWave();

  timer = setInterval(() => {
    timeLeft--;
    statusEl.textContent = `Recording… ${timeLeft}s`;
    if (timeLeft <= 0) stopRecording();
  }, 1000);

  stopBtn.onclick = stopRecording;

  async function stopRecording() {
    clearInterval(timer);
    cancelAnimationFrame(animationFrame);

    stopBtn.disabled = true;
    micStream.getTracks().forEach(t => t.stop());
    mediaRecorder.stop();
    await audioCtx.close();

    mediaRecorder.onstop = async () => {
      // UI update BEFORE fetch
      statusEl.textContent = "Analyzing";
      startAnalyzingAnimation();

      const blob = new Blob(chunks, { type: "audio/webm" });
      const fd = new FormData();
      fd.append("file", blob, "recording.webm");

      try {
        // let UI paint
        await new Promise(r => setTimeout(r, 100));

        const res = await fetch(
          "https://sa6h1n-bird-sound-monitor.hf.space/analyze",
          { method: "POST", body: fd }
        );

        if (!res.ok) throw new Error("API error");

        const data = await res.json();

        stopAnalyzingAnimation();
        statusEl.textContent = "✅ Analysis complete";

        resultsEl.innerHTML = "";
        data.predictions.forEach((p, i) => {
          const conf = Math.round(p.confidence * 100);
          resultsEl.innerHTML += `
            <div class="result-card">
              <div class="rank">#${i + 1}</div>
              <h3>${p.bird}</h3>
              <div class="confidence-bar">
                <div class="confidence-fill" style="width:${conf}%"></div>
              </div>
              <small>${conf}% confidence</small>
            </div>`;
        });

      } catch (err) {
        stopAnalyzingAnimation();
        statusEl.textContent = "❌ Analysis failed. Please try again.";
      }

      recordBtn.disabled = false;
    };
  }
};
