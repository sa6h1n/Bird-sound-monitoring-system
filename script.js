const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

let mediaRecorder, audioCtx, analyser, dataArray;
let chunks = [];
let timer, timeLeft = 10;

// 🔹 Convert WebM → WAV (browser-side)
async function webmToWav(webmBlob) {
  const arrayBuffer = await webmBlob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const wavBuffer = audioBufferToWav(audioBuffer);
  return new Blob([wavBuffer], { type: "audio/wav" });
}

function audioBufferToWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  let offset = 0;

  function writeString(str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset++, str.charCodeAt(i));
    }
  }

  writeString("RIFF");
  view.setUint32(offset, length - 8, true); offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numOfChan, true); offset += 2;
  view.setUint32(offset, buffer.sampleRate, true); offset += 4;
  view.setUint32(offset, buffer.sampleRate * 2 * numOfChan, true); offset += 4;
  view.setUint16(offset, numOfChan * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString("data");
  view.setUint32(offset, length - offset - 4, true); offset += 4;

  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      let sample = buffer.getChannelData(ch)[i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return bufferArray;
}

// 🔹 Waveform
function drawWave() {
  requestAnimationFrame(drawWave);
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

// 🎙️ Record
recordBtn.onclick = async () => {
  chunks = [];
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  audioCtx.createMediaStreamSource(stream).connect(analyser);
  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.start();

  drawWave();
  recordBtn.disabled = true;
  stopBtn.disabled = false;

  timeLeft = 10;
  statusEl.textContent = `Recording… ${timeLeft}s`;
  timer = setInterval(() => {
    timeLeft--;
    statusEl.textContent = `Recording… ${timeLeft}s`;
    if (timeLeft <= 0) stopBtn.click();
  }, 1000);

  stopBtn.onclick = async () => {
    clearInterval(timer);
    mediaRecorder.stop();
    stream.getTracks().forEach(t => t.stop());
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    statusEl.textContent = "Analyzing…";

    mediaRecorder.onstop = async () => {
      try {
        const webmBlob = new Blob(chunks, { type: "audio/webm" });
        const wavBlob = await webmToWav(webmBlob);

        const fd = new FormData();
        fd.append("file", wavBlob, "recording.wav");

        const res = await fetch(
          "https://sa6h1n-bird-sound-monitor.hf.space/analyze",
          { method: "POST", body: fd }
        );

        if (!res.ok) throw new Error("Backend error");

        const data = await res.json();
        resultsEl.innerHTML = JSON.stringify(data, null, 2);
        statusEl.textContent = "Analysis complete";
      } catch (err) {
        statusEl.textContent = "Analysis failed. Please try again.";
        console.error(err);
      }
    };
  };
};
