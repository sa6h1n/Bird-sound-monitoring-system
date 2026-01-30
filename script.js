const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

let mediaRecorder;
let audioChunks = [];

const API_URL = "https://sa6h1n-bird-sound-monitor.hf.space/analyze";

/* ---------- Browser detection ---------- */
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/* ---------- RECORD ---------- */
recordBtn.onclick = async () => {
  resultsEl.innerHTML = "";
  audioChunks = [];
  statusEl.textContent = "🎙️ Recording...";

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const options = isSafari
    ? { mimeType: "audio/mp4" }
    : { mimeType: "audio/webm" };

  mediaRecorder = new MediaRecorder(stream, options);

  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.start();
  recordBtn.disabled = true;
  stopBtn.disabled = false;

  setTimeout(() => stopRecording(stream), 10000);
  stopBtn.onclick = () => stopRecording(stream);
};

function stopRecording(stream) {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;

  mediaRecorder.stop();
  stream.getTracks().forEach(t => t.stop());
  recordBtn.disabled = false;
  stopBtn.disabled = true;

  mediaRecorder.onstop = async () => {
    try {
      statusEl.textContent = "⏳ Processing audio...";
      const blob = new Blob(audioChunks);
      if (blob.size < 5000) throw new Error("Audio too small");

      const wavBlob = await convertToWav(blob);
      await sendToBackend(wavBlob);
    } catch (e) {
      console.error(e);
      statusEl.textContent = "Recording failed. Try again.";
    }
  };
}

/* ---------- BACKEND ---------- */
async function sendToBackend(wavBlob) {
  try {
    statusEl.textContent = "Analyzing (may take ~30 seconds)...";

    const fd = new FormData();
    fd.append("file", wavBlob, "recording.wav");

    const res = await fetch(API_URL, {
      method: "POST",
      body: fd
    });

    if (!res.ok) throw new Error("Backend error");

    const data = await res.json();
    renderResults(data.predictions);
    statusEl.textContent = "Analysis complete";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Analysis failed. Please try again.";
  }
}

/* ---------- AUDIO CONVERSION ---------- */
async function convertToWav(blob) {
  const audioCtx = new AudioContext();
  const buffer = await audioCtx.decodeAudioData(await blob.arrayBuffer());
  return new Blob([audioBufferToWav(buffer)], { type: "audio/wav" });
}

function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length * numCh * 2 + 44;
  const ab = new ArrayBuffer(len);
  const view = new DataView(ab);
  let offset = 0;

  const write = s => { for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i)); };

  write("RIFF");
  view.setUint32(offset, len - 8, true); offset += 4;
  write("WAVEfmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numCh, true); offset += 2;
  view.setUint32(offset, buffer.sampleRate, true); offset += 4;
  view.setUint32(offset, buffer.sampleRate * numCh * 2, true); offset += 4;
  view.setUint16(offset, numCh * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  write("data");
  view.setUint32(offset, buffer.length * numCh * 2, true); offset += 4;

  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      view.setInt16(offset, buffer.getChannelData(ch)[i] * 0x7fff, true);
      offset += 2;
    }
  }
  return ab;
}

/* ---------- UI ---------- */
function renderResults(preds) {
  resultsEl.innerHTML = "";
  preds.forEach((p, i) => {
    resultsEl.innerHTML += `
      <div class="result-card">
        <strong>#${i + 1} ${p.bird}</strong>
        <div class="bar">
          <div class="fill" style="width:${p.confidence * 100}%"></div>
        </div>
        <small>${Math.round(p.confidence * 100)}%</small>
      </div>`;
  });
}
