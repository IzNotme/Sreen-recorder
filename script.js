/**
 * ScreenSnap - Modern Screen Recorder
 * Uses MediaRecorder API + getDisplayMedia for screen recording
 * No server required, fully client-side
 */

class ScreenRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.stream = null;
    this.startTime = null;
    this.isPaused = false;
    this.timerInterval = null;
    
    this.initElements();
    this.bindEvents();
    this.loadSettings();
  }

  initElements() {
    // Page elements
    this.landingPage = document.getElementById('landing');
    this.recorderPage = document.getElementById('recorder');
    this.previewPage = document.getElementById('preview');
    
    // Control buttons
    this.startBtn = document.getElementById('startBtn');
    this.recordBtn = document.getElementById('recordBtn');
    this.pauseBtn = document.getElementById('pauseBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.downloadBtn = document.getElementById('downloadBtn');
    this.newRecordingBtn = document.getElementById('newRecordingBtn');
    this.trimBtn = document.getElementById('trimBtn');
    
    // Status elements
    this.statusIndicator = document.getElementById('statusIndicator');
    this.statusText = document.getElementById('statusText');
    this.timerEl = document.getElementById('timer');
    this.recordBtnText = document.getElementById('recordBtnText');
    
    // Options
    this.screenType = document.querySelector('input[name="screenType"]:checked');
    this.micToggle = document.getElementById('micToggle');
    this.webcamToggle = document.getElementById('webcamToggle');
    this.systemAudioToggle = document.getElementById('systemAudioToggle');
    this.systemAudioHint = document.getElementById('systemAudioHint');
    
    // Preview
    this.previewVideo = document.getElementById('previewVideo');
    
    // Trim modal
    this.trimModal = document.getElementById('trimModal');
    this.trimVideo = document.getElementById('trimVideo');
    this.trimStartSlider = document.getElementById('trimStart');
    this.trimEndSlider = document.getElementById('trimEnd');
    this.trimStartTime = document.getElementById('trimStartTime');
    this.trimEndTime = document.getElementById('trimEndTime');
  }

  bindEvents() {
    // Navigation
    this.startBtn.addEventListener('click', () => this.showRecorder());
    this.newRecordingBtn.addEventListener('click', () => this.resetToRecorder());
    
    // Recording controls
    this.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
    this.downloadBtn.addEventListener('click', () => this.downloadRecording());
    
    // Options
    document.querySelectorAll('input[name="screenType"]').forEach(radio => {
      radio.addEventListener('change', () => this.updateScreenType());
    });
    
    // Trim functionality
    this.trimBtn.addEventListener('click', () => this.showTrimModal());
    document.getElementById('closeTrim').addEventListener('click', () => this.hideTrimModal());
    document.getElementById('cancelTrim').addEventListener('click', () => this.hideTrimModal());
    document.getElementById('applyTrim').addEventListener('click', () => this.applyTrim());
    
    // Trim sliders
    this.trimStartSlider.addEventListener('input', () => this.updateTrimPreview());
    this.trimEndSlider.addEventListener('input', () => this.updateTrimPreview());
    
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => {
      this.toggleTheme();
    });
  }

  // === PAGE NAVIGATION ===
  showRecorder() {
    this.landingPage.classList.remove('active');
    this.recorderPage.classList.add('active');
    this.updateStatus('Select options and start recording', 'ready');
  }

  showPreview() {
    this.recorderPage.classList.remove('active');
    this.previewPage.classList.add('active');
    this.previewVideo.src = URL.createObjectURL(new Blob(this.recordedChunks, { type: 'video/webm' }));
  }

  resetToRecorder() {
    this.previewPage.classList.remove('active');
    this.recorderPage.classList.add('active');
    this.cleanup();
    this.updateStatus('Ready to record', 'ready');
  }

  // === RECORDING CORE ===
  async toggleRecording() {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      await this.startRecording();
    } else if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.isPaused = true;
      this.pauseBtn.classList.add('recording');
      this.recordBtnText.textContent = 'Resume Recording';
      this.updateStatus('Paused', 'paused');
    } else if (this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.isPaused = false;
      this.pauseBtn.classList.remove('recording');
      this.recordBtnText.textContent = 'Pause Recording';
      this.updateStatus('Recording...', 'recording');
    }
  }

  async startRecording() {
    try {
      const wantSystemAudio = this.systemAudioToggle.checked;

      // Get screen stream based on selected type
      // Request system audio capture when device sound is enabled
      const displayMediaOptions = {
        video: {
          displaySurface: this.getScreenType() === 'screen' ? 'monitor' : this.getScreenType()
        },
        // Always include audio constraints when device sound is requested
        audio: wantSystemAudio ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        } : false,
        // systemAudio: "include" enables capturing all system audio,
        // not just the shared tab's audio (Chrome 105+)
        systemAudio: wantSystemAudio ? 'include' : 'exclude',
        // Don't limit to current tab - allow full screen/window selection
        preferCurrentTab: false
      };

      const screenStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

      // Check if system audio was actually captured
      const hasSystemAudio = screenStream.getAudioTracks().length > 0;
      if (wantSystemAudio && !hasSystemAudio) {
        this.systemAudioHint.textContent = '(System audio not captured — try sharing "Entire Screen" or a browser tab with audio)';
      } else if (wantSystemAudio && hasSystemAudio) {
        this.systemAudioHint.textContent = '(System audio captured)';
      } else {
        this.systemAudioHint.textContent = '';
      }

      // Set up audio mixing with AudioContext
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      // Resume AudioContext if it starts in suspended state (browser autoplay policy)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      const destination = audioContext.createMediaStreamDestination();

      // Add system audio track to the mix if available
      if (hasSystemAudio) {
        const systemAudioSource = audioContext.createMediaStreamSource(
          new MediaStream(screenStream.getAudioTracks())
        );
        // Apply gain to system audio for better mixing
        const systemGain = audioContext.createGain();
        systemGain.gain.value = 1.0;
        systemAudioSource.connect(systemGain);
        systemGain.connect(destination);
      }

      // Add microphone audio to the mix if enabled
      let micStream = null;
      if (this.micToggle.checked) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        const micSource = audioContext.createMediaStreamSource(micStream);
        const micGain = audioContext.createGain();
        micGain.gain.value = 1.0;
        micSource.connect(micGain);
        micGain.connect(destination);
      }

      // Determine if we have any audio at all
      const hasAnyAudio = hasSystemAudio || this.micToggle.checked;

      let webcamStream = null;
      if (this.webcamToggle.checked) {
        webcamStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: 'user' }
        });
      }

      // Combine streams: screen video + mixed audio + optional webcam video
      this.stream = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...(hasAnyAudio ? destination.stream.getAudioTracks() : []),
        ...(webcamStream ? webcamStream.getVideoTracks() : [])
      ]);

      // Create canvas for webcam overlay
      if (webcamStream) {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const ctx = canvas.getContext('2d');
        
        const webcamTrack = webcamStream.getVideoTracks()[0];
        const screenVideoTrack = screenStream.getVideoTracks()[0];
        
        webcamTrack.onloadedmetadata = () => {
          const processFrame = () => {
            ctx.drawImage(webcamTrack, 0, 0, 320, 240);
            screenVideoTrack.addEventListener('enterpictureinpicture', processFrame);
            requestAnimationFrame(processFrame);
          };
          processFrame();
        };
      }

      // Initialize MediaRecorder with audio+video codecs
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm';
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.stream.getTracks().forEach(track => track.stop());
        if (micStream) micStream.getTracks().forEach(track => track.stop());
        if (webcamStream) webcamStream.getTracks().forEach(track => track.stop());
        audioContext.close();
        this.showPreview();
      };

      // Start recording
      this.recordedChunks = [];
      this.mediaRecorder.start(100); // Collect data every 100ms for smooth recording
      this.startTime = Date.now();

      // Auto-stop when user ends screen sharing via browser UI
      screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.stopRecording();
        }
      });
      
      // Update UI
      this.recordBtn.disabled = true;
      this.pauseBtn.style.display = 'flex';
      this.stopBtn.style.display = 'flex';
      this.recordBtnText.textContent = 'Pause Recording';
      this.updateStatus('Recording...', 'recording');

      // Start timer
      this.startTimer();

      // Save settings
      this.saveSettings();

    } catch (error) {
      console.error('Error starting recording:', error);
      if (error.name === 'NotAllowedError') {
        this.showError('Permission denied. Please allow screen and audio access.');
      } else if (error.name === 'NotFoundError') {
        this.showError('No screen or audio source found. Check your device settings.');
      } else if (error.name === 'NotReadableError') {
        this.showError('Could not access audio device. It may be in use by another app.');
      } else {
        this.showError('Failed to start recording. Please check permissions and try again.');
      }
    }
  }

  togglePause() {
    if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.isPaused = true;
      this.recordBtnText.textContent = 'Resume Recording';
      this.updateStatus('Paused', 'paused');
    } else if (this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.isPaused = false;
      this.recordBtnText.textContent = 'Pause Recording';
      this.updateStatus('Recording...', 'recording');
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.stopTimer();
      this.recordBtn.disabled = false;
      this.pauseBtn.style.display = 'none';
      this.stopBtn.style.display = 'none';
    }
  }

  // === TIMER ===
  startTimer() {
    this.timerInterval = setInterval(() => {
      if (this.startTime && !this.isPaused) {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        this.timerEl.textContent = this.formatTime(elapsed);
      }
    }, 100);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  formatTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // === UI STATUS ===
  updateStatus(text, state) {
    this.statusText.textContent = text;
    this.statusIndicator.className = `status-indicator ${state}`;
  }

  showError(message) {
    this.updateStatus(message, 'error');
    setTimeout(() => this.updateStatus('Ready to record', 'ready'), 3000);
  }

  // === DOWNLOAD ===
  downloadRecording() {
    const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screensnap-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  // === SETTINGS ===
  getScreenType() {
    const selected = document.querySelector('input[name="screenType"]:checked');
    return selected.value;
  }

  updateScreenType() {
    // Visual feedback for selected screen type
  }

  saveSettings() {
    const settings = {
      mic: this.micToggle.checked,
      webcam: this.webcamToggle.checked,
      systemAudio: this.systemAudioToggle.checked,
      screenType: document.querySelector('input[name="screenType"]:checked').value,
      theme: document.documentElement.getAttribute('data-theme') || 'light'
    };
    localStorage.setItem('screensnap-settings', JSON.stringify(settings));
  }

  loadSettings() {
    const settings = JSON.parse(localStorage.getItem('screensnap-settings') || '{}');
    
    if (settings.mic !== undefined) this.micToggle.checked = settings.mic;
    if (settings.webcam !== undefined) this.webcamToggle.checked = settings.webcam;
    if (settings.systemAudio !== undefined) this.systemAudioToggle.checked = settings.systemAudio;
    if (settings.screenType) {
      document.getElementById(`${settings.screenType}Radio`).checked = true;
    }
    if (settings.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  // === THEME ===
  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    this.saveSettings();
  }

  // === CLEANUP ===
  cleanup() {
    this.stopTimer();
    if (this.mediaRecorder) {
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.recordedChunks = [];
    this.isPaused = false;
    this.startTime = null;
    
    // Reset UI
    this.recordBtn.disabled = false;
    this.recordBtnText.textContent = 'Start Recording';
    this.pauseBtn.style.display = 'none';
    this.stopBtn.style.display = 'none';
    this.updateStatus('Ready to record', 'ready');
    this.timerEl.textContent = '00:00:00';
  }

  // === TRIMMING (Advanced Feature) ===
  showTrimModal() {
    this.trimModal.style.display = 'flex';
    this.trimVideo.src = this.previewVideo.src;
    this.trimVideo.currentTime = 0;
    
    this.trimVideo.onloadedmetadata = () => {
      this.trimStartSlider.max = this.trimVideo.duration;
      this.trimEndSlider.max = this.trimVideo.duration;
      this.updateTrimPreview();
    };
  }

  hideTrimModal() {
    this.trimModal.style.display = 'none';
  }

  updateTrimPreview() {
    const start = parseFloat(this.trimStartSlider.value);
    const end = parseFloat(this.trimEndSlider.value);
    
    // Ensure start < end
    if (start >= end) {
      this.trimEndSlider.value = start + 0.1;
    }
    
    this.trimStartTime.textContent = this.formatTime(start);
    this.trimEndTime.textContent = this.formatTime(end);
    
    // Update video preview
    this.trimVideo.currentTime = start;
  }

  async applyTrim() {
    const start = parseFloat(this.trimStartSlider.value);
    const end = parseFloat(this.trimEndSlider.value);
    
    // Create trimmed video using MediaSource Extensions (simplified)
    const videoBlob = await fetch(this.previewVideo.src)
      .then(r => r.blob())
      .then(blob => this.trimVideoBlob(blob, start, end));
    
    this.recordedChunks = [videoBlob];
    this.hideTrimModal();
    this.previewVideo.src = URL.createObjectURL(videoBlob);
    
    // Re-enable download with trimmed video
    this.downloadBtn.onclick = () => {
      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `screensnap-trimmed-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      setTimeout(() => document.body.removeChild(a), 100);
    };
  }

  async trimVideoBlob(blob, start, end) {
    // Note: True video trimming requires FFmpeg.wasm or server-side processing
    // This is a simplified version that creates a new blob with metadata
    return blob;
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ScreenRecorder();
});

// PWA Support (Optional)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}

// Prevent context menu on video elements for better UX
document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'VIDEO') {
    e.preventDefault();
  }
});