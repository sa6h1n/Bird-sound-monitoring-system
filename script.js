const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const canvas = document.getElementById("waveform");
const ctx = canvas.getContext("2d");

let mediaRecorder, micStream, audioCtx, analyser, dataArray;
let timeLeft = 10, timer;

async function getBirdImage(name) {
  if (!name) return "https://upload.wikimedia.org/wikipedia/commons/6/65/No-Image-Placeholder.svg";
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
    const data = await res.json();
    return data.thumbnail?.source || "https://upload.wikimedia.org/wikipedia/commons/6/65/No-Image-Placeholder.svg";
  } catch {
    return "https://upload.wikimedia.org/wikipedia/commons/6/65/No-Image-Placeholder.svg";
  }
}

function drawWave() {
  if (!analyser) return;
  requestAnimationFrame(drawWave);
  analyser.getByteTimeDomainData(dataArray);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.beginPath();
  let slice = canvas.width / dataArray.length;
  let x = 0;
  for (let i=0;i<dataArray.length;i++){
    let y = (dataArray[i]/128)*canvas.height/2;
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    x+=slice;
  }
  ctx.strokeStyle="#60a5fa"; ctx.stroke();
}

recordBtn.onclick = async () => {
  micStream = await navigator.mediaDevices.getUserMedia({audio:true});
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  audioCtx.createMediaStreamSource(micStream).connect(analyser);
  analyser.fftSize = 2048;
  dataArray = new Uint8Array(analyser.fftSize);

  mediaRecorder = new MediaRecorder(micStream);
  let chunks=[];
  mediaRecorder.ondataavailable=e=>chunks.push(e.data);
  mediaRecorder.start();

  recordBtn.disabled=true; stopBtn.disabled=false;
  timeLeft=10;
  statusEl.textContent=`Recording… ${timeLeft}s`;
  drawWave();

  timer=setInterval(()=>{
    timeLeft--;
    statusEl.textContent=`Recording… ${timeLeft}s`;
    if(timeLeft<=0) stop();
  },1000);

  stopBtn.onclick=stop;

  async function stop(){
    clearInterval(timer);
    mediaRecorder.stop();
    stopBtn.disabled=true;
    micStream.getTracks().forEach(t=>t.stop());
    audioCtx.close();

    mediaRecorder.onstop=async()=>{
      statusEl.textContent="Analyzing…";
      const blob=new Blob(chunks,{type:"audio/webm"});
      const fd=new FormData();
      fd.append("file",blob,"recording.webm");

      const res=await fetch("http://127.0.0.1:8000/analyze",{method:"POST",body:fd});
      const data=await res.json();

      resultsEl.innerHTML="";
      for(let i=0;i<data.predictions.length;i++){
        const p=data.predictions[i];
        const img=await getBirdImage(p.bird);
        const conf=Math.round(p.confidence*100);
        resultsEl.innerHTML+=`
          <div class="result-card">
            <div class="rank">#${i+1}</div>
            <img src="${img}">
            <h3>${p.bird}</h3>
            <div class="confidence-bar">
              <div class="confidence-fill" style="width:${conf}%"></div>
            </div>
            <small>${conf}% confidence</small>
          </div>`;
      }
      statusEl.textContent="✅ Analysis complete";
      recordBtn.disabled=false;
    };
  }
};