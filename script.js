const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");
const timerEl = document.getElementById("timer");

const API = "https://sa6h1n-bird-sound-monitor.hf.space/analyze";

/* ------------------ Recording + Waveform ------------------ */
let recorder, stream, audioCtx, analyser, dataArray;
let countdownInterval;
let timeLeft = 10;

function resizeCanvas() {
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}

function drawWave() {
  if (!analyser) return;
  requestAnimationFrame(drawWave);

  analyser.getByteTimeDomainData(dataArray);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();

  const slice = canvas.width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const y = (dataArray[i] / 128) * canvas.height / 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += slice;
  }

  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ------------------ Wikipedia + Wikidata ------------------ */
async function fetchWikiData(bird) {
  try {
    // Wikipedia summary
    const wikiRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bird)}`
    );
    const wiki = await wikiRes.json();

    let scientific = "Not available";
    let iucn = "Not evaluated";
    let distribution = "Distribution information not available.";

    // Wikidata lookup
    if (wiki.wikibase_item) {
      const wdRes = await fetch(
        `https://www.wikidata.org/wiki/Special:EntityData/${wiki.wikibase_item}.json`
      );
      const wd = await wdRes.json();
      const entity = wd.entities[wiki.wikibase_item];

      // Scientific name (P225)
      scientific =
        entity?.claims?.P225?.[0]?.mainsnak?.datavalue?.value ||
        scientific;

      // IUCN status (P141)
      const iucnMap = {
        Q211005: "Least Concern",
        Q211006: "Near Threatened",
        Q211007: "Vulnerable",
        Q211008: "Endangered",
        Q211009: "Critically Endangered",
        Q11394: "Extinct"
      };

      const iucnId =
        entity?.claims?.P141?.[0]?.mainsnak?.datavalue?.value?.id;

      if (iucnId && iucnMap[iucnId]) {
        iucn = iucnMap[iucnId];
      }
    }

    // Simple distribution extraction
    if (wiki.extract) {
      distribution = wiki.extract.split(".")[0] + ".";
    }

    return {
      image: wiki.thumbnail?.source || "",
      description: wiki.extract || "No description available.",
      scientific,
      iucn,
      distribution
    };
  } catch (err) {
    return {
      image: "",
      description: "No description available.",
      scientific: "Not available",
      iucn: "Not evaluated",
      distribution: "Distribution information not available."
    };
  }
}

/* ------------------ Record Button ------------------ */
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

  timeLeft = 10;
  timerEl.textContent = `${timeLeft}s`;

  countdownInterval = setInterval(() => {
    timeLeft--;
    timerEl.textContent = `${timeLeft}s`;
    if (timeLeft <= 0) stopRecording();
  }, 1000);

  stopBtn.onclick = stopRecording;

  function stopRecording() {
    clearInterval(countdownInterval);
    timerEl.textContent = "0s";

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

      statusEl.textContent = "Analysis complete";
      recordBtn.disabled = false;
    };
  }
};

/* ------------------ Render Results ------------------ */
async function renderResults(predictions) {
  resultsEl.innerHTML = "";

  if (!predictions || predictions.length === 0) {
    resultsEl.innerHTML = `
      <div class="result">
        <strong>No bird sounds detected</strong><br>
        പക്ഷി ശബ്ദങ്ങൾ കണ്ടെത്താനായില്ല
      </div>`;
    return;
  }

  for (const p of predictions) {
    const wiki = await fetchWikiData(p.bird);
    const confidencePercent = Math.round(p.confidence * 100);

    const card = document.createElement("div");
    card.className = "result";
    card.innerHTML = `
      ${wiki.image ? `<img src="${wiki.image}" />` : ""}

      <div class="info">
        <h3>${p.bird}</h3>
        <em>${wiki.scientific}</em>

        <div class="confidence">
          <span>${confidencePercent}% confidence</span>
          <div class="confidence-bar">
            <div class="confidence-fill" style="width:${confidencePercent}%"></div>
          </div>
        </div>

        <p>${wiki.description}</p>

        <div class="env-note">
          <h4>IUCN Conservation Status</h4>
          <p>${wiki.iucn}</p>

          <h4>Distribution</h4>
          <p>${wiki.distribution}</p>
        </div>
      </div>
    `;

    resultsEl.appendChild(card);
  }
}
