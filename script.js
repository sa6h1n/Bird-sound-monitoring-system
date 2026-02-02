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

const SUPABASE_URL = "https://gmxjrqewownmvkxkhuuw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdteGpycWV3b3dubXZreGtodXV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjg3MTksImV4cCI6MjA4NTUwNDcxOX0.LQtcG8aNkyXbsODAjkFP6RqTUPxdNgTpmj9toDwAL-0";

const { createClient } = supabase;
const supabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
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
  Q11394:  "Extinct",
  Q237350: "Extinct in the Wild",
  Q219127: "Data Deficient"
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
      await saveDetections([topPrediction]);
    }

    // Refresh history & analytics
  updateBiodiversityScore([]);
// 🔁 Auto-switch to Today after a new recording
currentHistoryRange = "day";

const todayBtn = document.querySelector(
  '.history-controls button[data-range="day"]'
);

await showHistory("day", todayBtn);

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
function updateChartRangeLabel(range) {
  const el = document.getElementById("chartRangeLabel");
  if (!el) return;

  const map = {
    day: "Today",
    week: "Last 7 Days",
    month: "Last 30 Days"
  };

  el.textContent = `Showing: ${map[range] || "Last 7 Days"}`;
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

/* ================== HISTORY STORAGE ================== */

async function saveDetections(predictions) {
  if (!predictions.length) return;

  const rows = predictions.map(p => ({
    bird: p.bird,
    confidence: p.confidence
  }));

  const { data, error } = await supabaseClient
    .from("detections")
    .insert(rows)
    .select();

  if (error) {
    console.error("INSERT FAILED:", error);
  } else {
    console.log("INSERT OK:", data);
  }
}

async function fetchDetections(range = "day") {
  let fromDate = new Date();

  if (range === "day") {
    fromDate.setHours(0, 0, 0, 0); // TODAY only
  }

  if (range === "week") {
    fromDate.setDate(fromDate.getDate() - 7);
  }

  if (range === "month") {
    fromDate.setDate(fromDate.getDate() - 30);
  }

  const { data, error } = await supabaseClient
    .from("detections")
    .select("*")
    .gte("created_at", fromDate.toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    console.error("FETCH FAILED:", error);
    return [];
  }

  return data;
}

async function showHistory(range = "week", btn = null) {
  currentHistoryRange = range;
  updateChartRangeLabel(range);

  // ✅ Update active button
  document
    .querySelectorAll(".history-controls button")
    .forEach(b => b.classList.remove("active"));

  if (btn) btn.classList.add("active");

  const historyResults = document.getElementById("historyResults");
  historyResults.innerHTML = "<p>Loading...</p>";

  const history = await fetchDetections(range);

  if (!history.length) {
    historyResults.innerHTML = "<p>No history available.</p>";
    updateBiodiversityScore([]);
    if (speciesChart) speciesChart.destroy();
    if (biodiversityChart) biodiversityChart.destroy();
    return;
  }

  historyResults.innerHTML = "";

  const birdMap = {};
  history.forEach(item => {
    if (!birdMap[item.bird]) {
      birdMap[item.bird] = { count: 0, lastSeen: item.created_at };
    }
    birdMap[item.bird].count++;
    if (new Date(item.created_at) > new Date(birdMap[item.bird].lastSeen)) {
      birdMap[item.bird].lastSeen = item.created_at;
    }
  });

  Object.entries(birdMap).forEach(([bird, data]) => {
    const utcDate = new Date(data.lastSeen + "Z");
    const formatted = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata"
    }).format(utcDate);

    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <strong>${bird}</strong>
      <span>Detected ${data.count} ${data.count === 1 ? "time" : "times"}</span>
      <div class="history-time">Last detected: ${formatted} (IST)</div>
    `;
    historyResults.appendChild(div);
  });

  renderCharts(history);
  renderBiodiversityTrend(history);
  updateBiodiversityScore(history);
}

/* ================== CLEAR HISTORY ================== */

async function clearHistory() {
  if (!confirm("Clear all bird detection history?")) return;

  const { error } = await supabaseClient
    .from("detections")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) {
    console.error(error);
    alert("Failed to clear history");
    return;
  }

  document.getElementById("historyResults").innerHTML =
    "<p>History cleared.</p>";

  if (speciesChart) speciesChart.destroy();
  if (biodiversityChart) biodiversityChart.destroy();

  updateBiodiversityScore([]);
}

/* ================== BIODIVERSITY SCORE ================== */


function updateBiodiversityScore(filteredHistory = []) {
  const el = document.getElementById("biodiversityScore");
  if (!el) return;

  const speciesSet = new Set(filteredHistory.map(h => h.bird));
  const speciesCount = speciesSet.size;

  const score = Math.min(100, Math.round((speciesCount / 20) * 100));

  el.innerHTML = `
    <h3>Biodiversity Score</h3>
    <strong>${score} / 100</strong>
    <p>
      ${
        score > 70
          ? "High biodiversity"
          : score > 40
          ? "Moderate biodiversity"
          : "Low biodiversity – potential ecological stress"
      }
    </p>

    <div class="bio-meta">
      <span>${speciesCount} unique species detected</span><br>
      <span>Last 7 days</span>
    </div>
  `;
}

/* ================== CHARTS ================== */

let speciesChart;
let biodiversityChart;

function renderCharts(filteredHistory = []) {
  if (!filteredHistory.length) return;

  const canvas = document.getElementById("speciesChart");
  if (!canvas) return;

  const counts = {};
  filteredHistory.forEach(h => {
    counts[h.bird] = (counts[h.bird] || 0) + 1;
  });

  if (speciesChart) speciesChart.destroy();

  speciesChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: Object.keys(counts),
      datasets: [{
        label: "Detections",
        data: Object.values(counts),
        backgroundColor: "#60a5fa",
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 45,
            autoSkip: false,          // 🔑 show ALL names
            font: { size: 8 },
            callback: function(value) {
               return this.getLabelForValue(value).replace(/\s+/g, " ");
            }
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0,
            font: { size: 11 }
          }
        }
      }
    }
  });
}

function renderBiodiversityTrend(filteredHistory = []) {
  if (!filteredHistory || filteredHistory.length === 0) return;

  const canvas = document.getElementById("biodiversityTrendChart");
  if (!canvas) return;

  const days = {};

  filteredHistory.forEach(h => {
    const date = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(new Date(h.created_at));

    if (!days[date]) days[date] = new Set();
    days[date].add(h.bird);
  });

  const labels = Object.keys(days);
  const values = Object.values(days).map(s => s.size);

  if (biodiversityChart) biodiversityChart.destroy();

  biodiversityChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Unique Species",
        data: values,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,0.15)",
        fill: true,
        tension: 0.35,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: {
            autoSkip: true,
            maxTicksLimit: 5,
            font: { size: 10 }
          }
        },
  y: {
  beginAtZero: true,
  suggestedMax: 20,
  title: {
    display: true,
    text: "Unique bird species detected",
    color: "#cbd5e1",
    font: {
      size: 12,
      weight: "600"
    }
  },
  ticks: {
    stepSize: 2,
    precision: 0,
    font: { size: 10 }
  }
}
      }
    }
  });
}
window.addEventListener("DOMContentLoaded", () => {
  const weekBtn = document.querySelector(
    ".history-controls button:nth-child(2)"
  );
  showHistory("week", weekBtn);
});
async function downloadCSV() {
  const range = currentHistoryRange || "week";
  const data = await fetchDetections(range);

  if (!data.length) {
    alert("No data available to export.");
    return;
  }

  // Convert to CSV
  const headers = ["bird", "confidence", "detected_at", "range"];
  const rows = data.map(d => [
    `"${d.bird}"`,
    d.confidence,
    `"${new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata"
    }).format(new Date(d.created_at))}"`,
    range
  ]);

  let csv = headers.join(",") + "\n";
  rows.forEach(r => (csv += r.join(",") + "\n"));

  // Trigger download
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `bird_detections_${range}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
