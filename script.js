const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const envAlert = document.getElementById("envAlert");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");
const timerEl = document.getElementById("timer");

const API = "https://sa6h1n-bird-sound-monitor.hf.space/analyze";

/* -------- Bird metadata (English + Malayalam + meaning) -------- */
const birdInfo = {
  "Hooded Crow": {
    ml: "കരിവാലൻ കാക്ക",
    meaning:
      "Crows are highly adaptable birds. Their presence usually indicates a habitable environment, often near human settlements.",
    meaning_ml:
      "കാക്കകൾ അത്യന്തം അനുയോജ്യമായ പക്ഷികളാണ്. ഇവയുടെ സാന്നിധ്യം മനുഷ്യവാസമുള്ള പ്രദേശങ്ങളിലും പരിസ്ഥിതി ഇപ്പോഴും ഉപയോഗയോഗ്യമാണെന്ന് സൂചിപ്പിക്കുന്നു."
  },
  "Carrion Crow": {
    ml: "കരിങ്കാക്ക",
    meaning:
      "Carrion crows act as scavengers and help clean the environment. Their presence suggests ecological balance.",
    meaning_ml:
      "കരിങ്കാക്കകൾ പരിസ്ഥിതിയിലെ മാലിന്യങ്ങൾ നീക്കം ചെയ്യുന്നതിൽ സഹായിക്കുന്നു. ഇവയുടെ സാന്നിധ്യം പരിസ്ഥിതി തുലനം സൂചിപ്പിക്കുന്നു."
  }
};

/* -------- Wikipedia fetch -------- */
async function fetchWiki(bird) {
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bird)}`
    );
    const d = await r.json();
    return {
      image: d.thumbnail?.source || "",
      text: d.extract || "No description available."
    };
  } catch {
    return { image: "", text: "No description available." };
  }
}

/* -------- Recording & Waveform -------- */
let recorder, stream, audioCtx, analyser, dataArray;
let countdownInterval;
let timeLeft = 10;

/* Fix canvas resolution */
function resizeCanvas() {
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}

function drawWave() {
  requestAnimationFrame(drawWave);
  if (!analyser) return;

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
  ctx.lineWidth = 2;
  ctx.stroke();
}
/* -------- Record button -------- */
recordBtn.onclick = async () => {
  resultsEl.innerHTML = "";
  resizeCanvas();

  statusEl.textContent = "Recording…";
  recordBtn.disabled = true;
  stopBtn.disabled = false;

  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  audioCtx.createMediaStreamSource(stream).connect(analyser);
  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);

  recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.start();

  drawWave();

  /* -------- Timer start -------- */
  timeLeft = 10;
  timerEl.textContent = `${timeLeft} s`;

  countdownInterval = setInterval(() => {
    timeLeft--;
    timerEl.textContent = `${timeLeft} s`;

    if (timeLeft <= 0) {
      stopRecording();
    }
  }, 1000);

  stopBtn.onclick = stopRecording;

  function stopRecording() {
    clearInterval(countdownInterval);
    timerEl.textContent = "0 s";

    recorder.stop();
    stream.getTracks().forEach(t => t.stop());
    audioCtx.close();
    stopBtn.disabled = true;

    recorder.onstop = async () => {
      statusEl.textContent = "Analyzing…";

      const blob = new Blob(chunks, { type: "audio/wav" });
      const fd = new FormData();
      fd.append("file", blob, "recording.wav");

      const res = await fetch(API, { method: "POST", body: fd });
      const data = await res.json();

      renderResults(data.predictions);
      updateEnvironmentAlert(data.predictions);

      statusEl.textContent = "Analysis complete";
      recordBtn.disabled = false;
    };
  }
};

/* -------- Render results -------- */
async function renderResults(predictions) {
  resultsEl.innerHTML = "";

  if (!predictions || predictions.length === 0) {
    resultsEl.innerHTML = `
      <div class="result">
        <div class="info">
          <strong>No bird sounds detected</strong><br>
          പക്ഷി ശബ്ദങ്ങൾ കണ്ടെത്താനായില്ല
        </div>
      </div>`;
    return;
  }

  for (const p of predictions) {
    const wiki = await fetchWiki(p.bird);
    const meta = birdInfo[p.bird] || {};

    const card = document.createElement("div");
    card.className = "result";
    card.innerHTML = `
      ${wiki.image ? `<img src="${wiki.image}">` : ""}
      <div class="info">
        <strong>${p.bird}</strong><br>
        <em>${meta.ml || ""}</em>
        <p>${wiki.text}</p>
<div class="env-note">
  <strong>Environmental Insight:</strong>
  <br>
  ${meta.meaning || ""}
  <br><br>
  <strong>പരിസ്ഥിതി സൂചന:</strong>
  <br>
  ${meta.meaning_ml || ""}
</div>
    `;
    resultsEl.appendChild(card);
  }
}

function updateEnvironmentAlert(predictions) {
  if (!predictions || predictions.length === 0) {
    envAlert.className = "env-alert critical";
    envAlert.innerHTML =
      "Possible environmental disturbance detected<br>പരിസ്ഥിതി സമ്മർദ്ദം ഉണ്ടായേക്കാം";
  } else if (predictions.length === 1) {
    envAlert.className = "env-alert warning";
    envAlert.innerHTML =
      "Low bird diversity observed<br>പക്ഷി വൈവിധ്യം കുറവാണ്";
  } else {
    envAlert.className = "env-alert normal";
    envAlert.innerHTML =
      "Environment appears stable<br>പരിസ്ഥിതി സ്ഥിരമാണെന്ന് സൂചിപ്പിക്കുന്നു";
  }
}