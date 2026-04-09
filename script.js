let audioContext;
let tracks = [];
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];
let micStream;
let liveAnalyser;
let liveAnimationId;
let sourceNodes = [];

// DOM Elements
const tracksContainer = document.getElementById('tracks-container');
const trackTemplate = document.getElementById('track-template');
const exportBtn = document.getElementById('export-mixdown-btn');
const exportStatus = document.getElementById('export-status');
const errorBanner = document.getElementById('error-banner');
const countdownBox = document.getElementById('countdown-box');
const exportFilenameInput = document.getElementById('export-filename');

function showError(msg) {
    errorBanner.style.display = 'block';
    errorBanner.textContent = msg;
    setTimeout(() => { errorBanner.style.display = 'none'; }, 8000);
}

// Track Class to hold state and elements
class Track {
    constructor() {
        this.id = Date.now().toString() + Math.random().toString(36).substring(2);
        this.audioBuffer = null;
        this.hasAudio = false;
        
        // Clone template
        const clone = trackTemplate.content.cloneNode(true);
        this.element = clone.querySelector('.track');
        
        // Element bindings
        this.monitorToggle = this.element.querySelector('.monitor-toggle');
        this.exportToggle = this.element.querySelector('.export-toggle');
        this.recordBtn = this.element.querySelector('.record-btn');
        this.addTrackBtn = this.element.querySelector('.add-track-btn');
        this.deleteTrackBtn = this.element.querySelector('.delete-track-btn');
        this.canvas = this.element.querySelector('.waveform');
        this.canvasCtx = this.canvas.getContext('2d');
        
        // Event Listeners
        this.recordBtn.addEventListener('click', () => this.handleRecordClick());
        this.addTrackBtn.addEventListener('click', () => addTrackElement(this.element));
        this.deleteTrackBtn.addEventListener('click', () => this.deleteTrack());
        this.exportToggle.addEventListener('change', checkExportButton);
    }
    
    deleteTrack() {
        this.element.remove();
        tracks = tracks.filter(t => t !== this);
        // If they delete all tracks, create a fresh empty one
        if (tracks.length === 0) {
            addTrackElement();
        }
        checkExportButton();
    }
    
    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.drawBlank();
    }

    drawBlank() {
        if (this.hasAudio) return;
        this.canvasCtx.fillStyle = '#1a1d24'; // bg-panel
        this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(0, this.canvas.height / 2);
        this.canvasCtx.lineTo(this.canvas.width, this.canvas.height / 2);
        this.canvasCtx.strokeStyle = '#334155'; // border
        this.canvasCtx.lineWidth = 2;
        this.canvasCtx.stroke();
    }

    handleRecordClick() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (this.hasAudio) {
            // Act as a play/stop button for this specific track if it already has audio
            if (this.recordBtn.classList.contains('playing')) {
                stopPlayback();
                this.recordBtn.classList.remove('playing');
            } else {
                playSingleTrack(this);
                this.recordBtn.classList.add('playing');
            }
            return;
        }

        if (isRecording) {
            stopRecording(this);
        } else {
            startRecording(this);
        }
    }

    drawStaticWaveform() {
        if (!this.audioBuffer) return;
        
        const rawData = this.audioBuffer.getChannelData(0); // We'll just draw channel 0
        const step = Math.ceil(rawData.length / this.canvas.width);
        const amp = this.canvas.height / 2;
        
        this.canvasCtx.fillStyle = '#1a1d24';
        this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(0, amp);
        
        // Draw standard min/max waveform
        this.canvasCtx.strokeStyle = '#10b981'; // waveform-col
        this.canvasCtx.lineWidth = 1;
        
        for (let i = 0; i < this.canvas.width; i++) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const datum = rawData[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            this.canvasCtx.lineTo(i, (1 + min) * amp);
            this.canvasCtx.lineTo(i, (1 + max) * amp);
        }
        this.canvasCtx.stroke();
    }
}

// Global functions
function addTrackElement(afterElement = null) {
    const track = new Track();
    if (afterElement) {
        afterElement.after(track.element);
        const index = tracks.findIndex(t => t.element === afterElement);
        tracks.splice(index + 1, 0, track);
    } else {
        tracksContainer.appendChild(track.element);
        tracks.push(track);
    }
    
    // Resize after it is in the DOM so ClientRect is valid
    track.resizeCanvas();
    window.addEventListener('resize', () => track.resizeCanvas());
    
    checkExportButton();
}

async function startRecording(track) {
    try {
        // Ensure mic is active before countdown
        if (!micStream || micStream.getAudioTracks().every(t => t.readyState === 'ended')) {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        
        let count = 4;
        countdownBox.style.display = 'block';
        countdownBox.textContent = count;
        playClick(440);
        
        const cInterval = setInterval(() => {
            count--;
            if (count > 0) {
                countdownBox.textContent = count;
                playClick(440);
            } else {
                clearInterval(cInterval);
                countdownBox.style.display = 'none';
                playClick(880); // higher beep for start
                startActualRecording(track);
            }
        }, 1000);
        
    } catch (err) {
        console.error("Error accessing microphone:", err);
        showError("Microphone Error: " + err.message + ". Please allow microphone access or ensure you're on a secure context (localhost/HTTPS).");
    }
}

function playClick(frequency) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const env = audioContext.createGain();
    osc.connect(env);
    env.connect(audioContext.destination);
    
    osc.frequency.value = frequency;
    osc.type = 'triangle';
    
    const now = audioContext.currentTime;
    osc.start(now);
    env.gain.setValueAtTime(1, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.stop(now + 0.1);
}

function startActualRecording(track) {
    isRecording = true;
    recordedChunks = [];
    track.recordBtn.classList.add('recording');
    
    // Setup MediaRecorder
    mediaRecorder = new MediaRecorder(micStream);
    mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };
    
    mediaRecorder.onstop = async () => processRecording(track);

    // Setup live visualization
    const source = audioContext.createMediaStreamSource(micStream);
    liveAnalyser = audioContext.createAnalyser();
    liveAnalyser.fftSize = 1024;
    source.connect(liveAnalyser);
    
    // Start playing monitored tracks
    playMonitoredTracks();
    
    // Start recording
    mediaRecorder.start();
    drawLiveWaveform(track);
}

function stopRecording(track) {
    isRecording = false;
    track.recordBtn.classList.remove('recording');
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }
    // Keeps micStream alive so secondary tracks don't error out with a blank device
    cancelAnimationFrame(liveAnimationId);
    stopPlayback(); // Stop any monitored tracks playing
}

async function processRecording(track) {
    const blob = new Blob(recordedChunks, { type: 'audio/webm;codecs=opus' });
    // Chrome creates webm, Safari might do mp4/aac. Let's just decode it:
    const arrayBuffer = await blob.arrayBuffer();
    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        track.audioBuffer = audioBuffer;
        track.hasAudio = true;
        track.recordBtn.classList.add('has-audio');
        track.recordBtn.title = "Play/Stop Track";
        track.drawStaticWaveform();
        checkExportButton();
    } catch (err) {
        console.error("Failed to decode audio", err);
    }
}

function drawLiveWaveform(track) {
    if (!isRecording) return;
    
    const bufferLength = liveAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    liveAnalyser.getByteTimeDomainData(dataArray);
    
    track.canvasCtx.fillStyle = '#1a1d24';
    track.canvasCtx.fillRect(0, 0, track.canvas.width, track.canvas.height);
    
    track.canvasCtx.lineWidth = 2;
    track.canvasCtx.strokeStyle = '#ef4444'; // record-red
    track.canvasCtx.beginPath();
    
    const sliceWidth = track.canvas.width * 1.0 / bufferLength;
    let x = 0;
    
    for(let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * track.canvas.height / 2;
        if(i === 0) {
            track.canvasCtx.moveTo(x, y);
        } else {
            track.canvasCtx.lineTo(x, y);
        }
        x += sliceWidth;
    }
    track.canvasCtx.stroke();
    
    liveAnimationId = requestAnimationFrame(() => drawLiveWaveform(track));
}

function playMonitoredTracks() {
    sourceNodes = [];
    tracks.forEach(t => {
        if (t.hasAudio && t.monitorToggle.checked && t.audioBuffer) {
            const source = audioContext.createBufferSource();
            source.buffer = t.audioBuffer;
            source.connect(audioContext.destination);
            source.start();
            sourceNodes.push(source);
        }
    });
}

function playSingleTrack(track) {
    if (!track.audioBuffer) return;
    const source = audioContext.createBufferSource();
    source.buffer = track.audioBuffer;
    source.connect(audioContext.destination);
    
    source.onended = () => {
        track.recordBtn.classList.remove('playing');
    };
    
    source.start();
    sourceNodes.push(source);
}

function stopPlayback() {
    sourceNodes.forEach(source => {
        try { source.stop(); } catch (e) {}
    });
    sourceNodes = [];
}

function checkExportButton() {
    const hasExportable = tracks.some(t => t.hasAudio && t.exportToggle.checked);
    exportBtn.disabled = !hasExportable;
}

// MP3 Export Logic
exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    exportStatus.textContent = "Mixing down...";
    
    try {
        const exportTracks = tracks.filter(t => t.hasAudio && t.exportToggle.checked);
        if (exportTracks.length === 0) return;
        
        // Find longest duration
        const maxDuration = Math.max(...exportTracks.map(t => t.audioBuffer.duration));
        const sampleRate = exportTracks[0].audioBuffer.sampleRate;
        
        // Mixdown to one buffer
        const offlineCtx = new OfflineAudioContext(2, sampleRate * maxDuration, sampleRate);
        
        exportTracks.forEach(t => {
            const source = offlineCtx.createBufferSource();
            source.buffer = t.audioBuffer;
            source.connect(offlineCtx.destination);
            source.start();
        });
        
        const mixedBuffer = await offlineCtx.startRendering();
        
        const baseName = exportFilenameInput.value.trim() || 'mixdown';
        const trackIndices = exportTracks.map(t => tracks.indexOf(t) + 1).join('_');
        const filename = `${baseName}_${trackIndices}.mp3`;
        
        exportStatus.textContent = "Encoding to MP3...";
        
        // Encode to MP3 using lamejs
        setTimeout(() => encodeToMP3(mixedBuffer, filename), 100);
        
    } catch (e) {
        console.error(e);
        exportStatus.textContent = "Error during export.";
        exportBtn.disabled = false;
    }
});

function encodeToMP3(audioBuffer, filename) {
    try {
        const channels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128); // 128kbps
        const mp3Data = [];
        
        // Get interleaved/separated channels and convert float32 to int16
        const leftData = audioBuffer.getChannelData(0);
        const rightData = channels > 1 ? audioBuffer.getChannelData(1) : leftData;
        
        const leftInt = new Int16Array(leftData.length);
        const rightInt = new Int16Array(rightData.length);
        
        // Scale Float32 to Int16
        for(let i=0; i<leftData.length; i++) {
            leftInt[i] = Math.max(-1, Math.min(1, leftData[i])) * 32767;
            rightInt[i] = Math.max(-1, Math.min(1, rightData[i])) * 32767;
        }

        const sampleBlockSize = 1152; // Needs to be multiple of 576
        
        for (let i = 0; i < leftData.length; i += sampleBlockSize) {
            const leftChunk = leftInt.subarray(i, i + sampleBlockSize);
            const rightChunk = rightInt.subarray(i, i + sampleBlockSize);
            
            const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
            if (mp3buf.length > 0) {
                mp3Data.push(mp3buf);
            }
        }
        
        const mp3buf = mp3encoder.flush();
        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }
        
        const blob = new Blob(mp3Data, {type: 'audio/mp3'});
        const url = URL.createObjectURL(blob);
        
        // Try automatic download
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        
        // Setup manual fallback link
        exportStatus.innerHTML = `<span style="color:var(--waveform-col)">Export Complete!</span> If the download didn't start automatically, <a href="${url}" download="${filename}" style="color:var(--accent); text-decoration:underline;">Click Here to Download MP3</a>`;
        
    } catch (e) {
        console.error(e);
        exportStatus.textContent = "Error encoding MP3.";
    } finally {
        checkExportButton();
    }
}

// Initialization
addTrackElement(); // Add first track initially
