const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");
const timerEl = document.getElementById("timer");
const NON_BIRD_LABELS = [
  "human",
  "whistle",
  "speech",
  "noise",
  "silence",
  "insect",
  "wind",
  "rain",
  "engine"
];

const API = "https://sa6h1n-bird-sound-monitor.hf.space/analyze";

/* ------------------ Recording + Waveform ------------------ */
let recorder, stream, audioCtx, analyser, dataArray;
let countdownInterval;
let timeLeft = 10;

let currentHistoryRange = "week"; // default

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
let malayalam = "";

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
      malayalam = entity?.labels?.ml?.value || "";
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
  distribution,
  malayalam
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
  if (timeLeft <= 0) return;

  timeLeft--;
  timerEl.textContent = `${timeLeft}s`;

  if (timeLeft === 0) {
    stopRecording();
  }
}, 1000);

  stopBtn.onclick = stopRecording;

recorder.onstop = async () => {
  statusEl.textContent = "Analyzing…";

  try {
    const blob = new Blob(chunks, { type: "audio/wav" });
    const fd = new FormData();
    fd.append("file", blob, "recording.wav");

    const res = await fetch(API, { method: "POST", body: fd });
    const data = await res.json();

    // Show predictions
    await renderResults(data.predictions);

    // Store ONLY real birds
    const topPrediction = getTopPrediction(data.predictions);
    if (
      topPrediction &&
      topPrediction.confidence >= 0.3 &&
      !NON_BIRD_LABELS.some(label =>
        topPrediction.bird.toLowerCase().includes(label)
      )
    ) {
      saveDetections([topPrediction]);
    }

    // Refresh history & analytics
    showHistory(currentHistoryRange);

    // ✅ THIS WAS MISSING
    resetControls();

  } catch (err) {
    console.error(err);
    statusEl.textContent = "Analysis failed";
    resetControls();
  }
}
};
function stopRecording() {
  clearInterval(countdownInterval);
  countdownInterval = null;

  stopBtn.disabled = true;

  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }

  if (audioCtx) {
    audioCtx.close();
  }
}
function resetControls() {
  recordBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = "Ready";
  timerEl.textContent = "10 s";
}
/* ================== HELPERS ================== */

function getTopPrediction(predictions) {
  if (!predictions || predictions.length === 0) return null;

  return predictions.reduce((top, current) => {
    return current.confidence > top.confidence ? current : top;
  });
}
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
${wiki.malayalam ? `<div class="mal-name">${wiki.malayalam}</div>` : ""}
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
const missingBirds = checkSpeciesDisappearance();

if (missingBirds.length > 0) {
  alert(
    `⚠️ Species absence detected:\n${missingBirds.join(", ")}\n\nThis may indicate habitat disturbance or seasonal change.`
  );
}

/* ================== HISTORY STORAGE ================== */

function saveDetections(predictions) {
  if (!predictions || predictions.length === 0) return;

  const history =
    JSON.parse(localStorage.getItem("birdDetectionHistory")) || [];

  const now = Date.now();

  predictions.forEach(p => {
    history.push({
      bird: p.bird,
      confidence: p.confidence,
      timestamp: now
    });
  });

  localStorage.setItem("birdDetectionHistory", JSON.stringify(history));

  // ✅ IMMEDIATELY UPDATE UI
 showHistory(currentHistoryRange);
  renderCharts();
  renderBiodiversityTrend();
  updateBiodiversityScore();
}

/* ================== SHOW HISTORY ================== */

function showHistory(range = currentHistoryRange) {
  currentHistoryRange = range;

  const historyResults = document.getElementById("historyResults");
  if (!historyResults) return;

  historyResults.innerHTML = "";

  const history =
    JSON.parse(localStorage.getItem("birdDetectionHistory")) || [];

  if (history.length === 0) {
    historyResults.innerHTML = "<p>No history available.</p>";
    renderCharts([]);
    renderBiodiversityTrend([]);
    updateBiodiversityScore([]);
    return;
  }

  const now = Date.now();
  let rangeMs = 7 * 24 * 60 * 60 * 1000; // default week

  if (range === "day") rangeMs = 24 * 60 * 60 * 1000;
  if (range === "month") rangeMs = 30 * 24 * 60 * 60 * 1000;

  const filtered = history.filter(
    item => now - item.timestamp <= rangeMs
  );

  if (filtered.length === 0) {
    historyResults.innerHTML = "<p>No detections in this period.</p>";
    renderCharts([]);
    renderBiodiversityTrend([]);
    updateBiodiversityScore([]);
    return;
  }

  // Group by bird
  const birdMap = {};
  filtered.forEach(item => {
    birdMap[item.bird] = (birdMap[item.bird] || 0) + 1;
  });

  Object.entries(birdMap).forEach(([bird, count]) => {
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <strong>${bird}</strong>
      <span>Detected ${count} times</span>
    `;
    historyResults.appendChild(div);
  });

  // 🔑 ONE place to update everything
  renderCharts(filtered);
  renderBiodiversityTrend(filtered);
  updateBiodiversityScore(filtered);
}

/* ================== CLEAR HISTORY ================== */

function clearHistory() {
  if (!confirm("Clear all bird detection history?")) return;

  localStorage.removeItem("birdDetectionHistory");

  const historyResults = document.getElementById("historyResults");
  if (historyResults) {
    historyResults.innerHTML = "<p>History cleared.</p>";
  }

  updateBiodiversityScore();

  if (speciesChart) speciesChart.destroy();
  if (biodiversityChart) biodiversityChart.destroy();
}

/* ================== SPECIES DISAPPEARANCE ================== */

function checkSpeciesDisappearance() {
  const history =
    JSON.parse(localStorage.getItem("birdDetectionHistory")) || [];

  if (history.length === 0) return [];

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const recentWindow = 2 * DAY;
  const pastWindow = 7 * DAY;

  const birdsPast = new Set();
  const birdsRecent = new Set();

  history.forEach(item => {
    if (now - item.timestamp <= pastWindow) birdsPast.add(item.bird);
    if (now - item.timestamp <= recentWindow) birdsRecent.add(item.bird);
  });

  return [...birdsPast].filter(b => !birdsRecent.has(b));
}

/* ================== BIODIVERSITY SCORE ================== */

function calculateBiodiversityScore() {
  const history =
    JSON.parse(localStorage.getItem("birdDetectionHistory")) || [];

  if (history.length === 0) return 0;

  const now = Date.now();
  const WEEK = 7 * 24 * 60 * 60 * 1000;

  const species = new Set(
    history
      .filter(item => now - item.timestamp <= WEEK)
      .map(item => item.bird)
  );

  const Smax = 20; // baseline
  return Math.min(100, Math.round((species.size / Smax) * 100));
}

function updateBiodiversityScore(filteredHistory = []) {
  const el = document.getElementById("biodiversityScore");
  if (!el) return;

  const species = new Set(filteredHistory.map(h => h.bird));
  const score = Math.min(100, Math.round((species.size / 20) * 100));

  el.innerHTML = `
    <h3>Biodiversity Score</h3>
    <strong>${score}/100</strong>
    <p>
      ${
        score > 70
          ? "High biodiversity – healthy ecosystem"
          : score > 40
          ? "Moderate biodiversity"
          : "Low biodiversity – potential ecological stress"
      }
    </p>
    <small>
      Based on unique bird species detected in the selected time period.
    </small>
  `;
}

/* ================== CHARTS ================== */

let speciesChart;
let biodiversityChart;

function renderCharts(filteredHistory = []) {
  if (!filteredHistory.length) return;

  const counts = {};
  filteredHistory.forEach(h => {
    counts[h.bird] = (counts[h.bird] || 0) + 1;
  });

  const labels = Object.keys(counts);
  const values = Object.values(counts);

  const canvas = document.getElementById("speciesChart");
  if (!canvas) return;

  if (speciesChart) speciesChart.destroy();

  speciesChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Detections",
        data: values,
        backgroundColor: "#60a5fa"
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}

function renderBiodiversityTrend(filteredHistory = []) {
  if (!filteredHistory.length) return;

  const days = {};
  filteredHistory.forEach(h => {
    const d = new Date(h.timestamp).toDateString();
    if (!days[d]) days[d] = new Set();
    days[d].add(h.bird);
  });

  const labels = Object.keys(days);
  const values = labels.map(d => days[d].size);

  const canvas = document.getElementById("biodiversityTrendChart");
  if (!canvas) return;

  if (biodiversityChart) biodiversityChart.destroy();

  biodiversityChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Unique Species",
        data: values,
        borderColor: "#22c55e",
        tension: 0.3
      }]
    }
  });
}
window.addEventListener("DOMContentLoaded", () => {
  showHistory("week"); // default view on refresh
});
