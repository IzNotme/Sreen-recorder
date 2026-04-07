/**
 * ScreenSnap - Modern Screen Recorder with System Audio
 * Uses MediaRecorder API + getDisplayMedia + Web Audio API
 * Supports: System Audio + Microphone + Screen Video
 */

class ScreenRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.stream = null;
    this.audioContext = null;
    this.startTime = null;
    this.isPaused = false;
    this.timerInterval = null;
    this.audioTracks = [];
    this.ffmpeg = null;
    
    this.initElements();
    this.bindEvents();
    this.loadSettings();
    this.initFFmpeg();
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
    this.systemAudioToggle = document.getElementById('systemAudioToggle');
    this.audioInfo = document.getElementById('audioInfo');
    
    // Preview
    this.previewVideo = document.getElementById('previewVideo');
    
    // Modals
    this.trimModal = document.getElementById('trimModal');
    this.processingModal = document.getElementById('processingModal');
    this.trimVideo = document.getElementById('trimVideo');
    this.trimStartSlider = document.getElementById('trimStart');
    this.trimEndSlider = document.getElementById('trimEnd');
    this.trimStartTime = document.getElementById('trimStartTime');
    this.trimEndTime = document.getElementById('trimEndTime');
  }

  async initFFmpeg() {
    try {
      const { FFmpeg, fetchFile } = FFmpeg;
      this.ffmpeg = new FFmpeg.FFmpeg();
      await this.ffmpeg.load();
      console.log('FFmpeg loaded successfully');
    } catch (error) {
      console.warn('FFmpeg failed to load:', error);
      this.ffmpeg = null;
    }
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
    
    // System audio toggle info
    this.systemAudioToggle.addEventListener('change', () => {
      this.audioInfo.classList.toggle('hidden', !this.systemAudioToggle.checked);
    });
    
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
      this.updateStatus('Starting recording...', 'ready');
      
      // Get screen stream
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          mediaSource: this.getScreenType(),
          displaySurface: 'monitor',
          logicalSurface: true,
          cursor: 'always'
        },
        audio: false // We'll handle audio separately
      });

      // Create audio context and destination
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioDestination = this.audioContext.createMediaStreamDestination();

      // Collect all audio tracks
      const audioTracks = [];

      // Get system audio (tab audio)
      if (this.systemAudioToggle.checked) {
        try {
          const systemAudioStream = await navigator.mediaDevices.getDisplayMedia({
            video: false,
            audio: {
              mandatory: {
                echoCancellation: false
              }
            }
          });
          
          if (systemAudioStream.getAudioTracks().length > 0) {
            const systemAudioTrack = systemAudioStream.getAudioTracks()[0];
            audioTracks.push(systemAudioTrack);
            
            // Add to audio context
            const systemAudioSource = this.audioContext.createMediaStreamSource(systemAudioStream);
            systemAudioSource.connect(audioDestination);
            console.log('System audio captured');
          }
        } catch (error) {
          console.warn('System audio not available:', error);
          this.showError('System audio not available on this browser/tab');
        }
      }

      // Get microphone
      if (this.micToggle.checked) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          
          const micTrack = micStream.getAudioTracks()[0];
          audioTracks.push(micTrack);
          
          // Add to audio context
          const micSource = this.audioContext.createMediaStreamSource(micStream);
          micSource.connect(audioDestination);
          console.log('Microphone captured');
        } catch (error) {
          console.warn('Microphone not available:', error);
          this.showError('Microphone access denied');
        }
      }

      // Combine streams
      const combinedStream = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ]);

      // Store audio tracks for cleanup
      this.audioTracks = audioTracks;

      // Create MediaRecorder
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: mimeType,
        audioBitsPerSecond: 128000,
        videoBitsPerSecond: 2500000
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.handleRecordingStop();
      };

      this.stream = combinedStream;

      // Start recording
      this.recordedChunks = [];
      this.mediaRecorder.start(100);
      this.startTime = Date.now();
      
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
      this.showError('Failed to start recording. Check permissions and try again.');
    }
  }

  getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return 'video/webm';
  }

  async handleRecordingStop() {
    // Stop all audio streams
    this.audioTracks.forEach(track => track.stop());
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }

    // Check if we need to process with FFmpeg
    const needsProcessing = this.systemAudioToggle.checked && this.ffmpeg && this.ffmpeg.isLoaded;
    
    if (needsProcessing) {
      this.processWithFFmpeg();
    } else {
      this.showPreview();
    }
  }

  async processWithFFmpeg() {
    try {
      this.processingModal.classList.remove('hidden');
      
      const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
      const buffer = await blob.arrayBuffer();
      
      // Write input file to FFmpeg filesystem
      this.ffmpeg.FS('writeFile', 'input.webm', new Uint8Array(buffer));
      
      // Run FFmpeg to ensure audio is properly encoded
      await this.ffmpeg.run(
        '-i', 'input.webm',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-y',
        'output.mp4'
      );
      
      // Read output file
      const data = this.ffmpeg.FS('readFile', 'output.mp4');
      const processedBlob = new Blob([data.buffer], { type: 'video/mp4' });
      
      // Clean up files
      this.ffmpeg.FS('unlink', 'input.webm');
      this.ffmpeg.FS('unlink', 'output.mp4');
      
      // Replace recorded chunks with processed video
      this.recordedChunks = [processedBlob];
      
      this.processingModal.classList.add('hidden');
      this.showPreview();
      
    } catch (error) {
      console.error('FFmpeg processing error:', error);
      this.processingModal.classList.add('hidden');
      // Fallback to original video
      this.showPreview();
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
      this.updateStatus('Processing...', 'processing');
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
    setTimeout(() => this.updateStatus('Ready to record', 'ready'), 4000);
  }

  // === DOWNLOAD ===
  downloadRecording() {
    const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Determine file extension based on content
    const extension = this.recordedChunks[0]?.type.includes('mp4') ? 'mp4' : 'webm';
    a.download = `recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${extension}`;
    
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  // === SETTINGS ===
  getScreenType() {
    const selected = document.querySelector('input[name="screenType"]:checked');
    const value = selected.value;
    
    if (value === 'tab') {
      return 'user-media';
    }
    return value;
  }

  updateScreenType() {
    // Visual feedback for selected screen type
  }

  saveSettings() {
    const settings = {
      mic: this.micToggle.checked,
      systemAudio: this.systemAudioToggle.checked,
      screenType: document.querySelector('input[name="screenType"]:checked').value,
      theme: document.documentElement.getAttribute('data-theme') || 'light'
    };
    localStorage.setItem('screensnap-settings', JSON.stringify(settings));
  }

  loadSettings() {
    const settings = JSON.parse(localStorage.getItem('screensnap-settings') || '{}');
    
    if (settings.mic !== undefined) this.micToggle.checked = settings.mic;
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
      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
      this.mediaRecorder = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.audioTracks.forEach(track => track.stop());
    this.audioTracks = [];
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
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

  // === TRIMMING ===
  showTrimModal() {
    this.trimModal.style.display = 'flex';
    this.trimVideo.src = this.previewVideo.src;
    this.trimVideo.currentTime = 0;
    
    this.trimVideo.onloadedmetadata = () => {
      this.trimStartSlider.max = this.trimVideo.duration;
      this.trimEndSlider.max = this.trimVideo.duration;
      this.trimEndSlider.value = this.trimVideo.duration;
      this.updateTrimPreview();
    };
  }

  hideTrimModal() {
    this.trimModal.style.display = 'none';
  }

  updateTrimPreview() {
    const start = parseFloat(this.trimStartSlider.value);
    const end = parseFloat(this.trimEndSlider.value);
    
    if (start >= end) {
      this.trimEndSlider.value = start + 0.1;
    }
    
    this.trimStartTime.textContent = this.formatTime(Math.floor(start));
    this.trimEndTime.textContent = this.formatTime(Math.floor(end));
    
    this.trimVideo.currentTime = start;
  }

  async applyTrim() {
    const start = parseFloat(this.trimStartSlider.value);
    const end = parseFloat(this.trimEndSlider.value);
    
    if (!this.ffmpeg || !this.ffmpeg.isLoaded) {
      this.showError('Trimming requires FFmpeg. Try downloading the original.');
      return;
    }
    
    try {
      this.processingModal.classList.remove('hidden');
      this.processingModal.querySelector('#processingText').textContent = 'Trimming video...';
      
      const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
      const buffer = await blob.arrayBuffer();
      
      this.ffmpeg.FS('writeFile', 'input.webm', new Uint8Array(buffer));
      
      await this.ffmpeg.run(
        '-i', 'input.webm',
        '-ss', String(start),
        '-to', String(end),
        '-c', 'copy',
        '-y',
        'output.webm'
      );
      
      const data = this.ffmpeg.FS('readFile', 'output.webm');
      const trimmedBlob = new Blob([data.buffer], { type: 'video/webm' });
      
      this.ffmpeg.FS('unlink', 'input.webm');
      this.ffmpeg.FS('unlink', 'output.webm');
      
      this.recordedChunks = [trimmedBlob];
      this.previewVideo.src = URL.createObjectURL(trimmedBlob);
      
      this.processingModal.classList.add('hidden');
      this.hideTrimModal();
      
    } catch (error) {
      console.error('Trim error:', error);
      this.processingModal.classList.add('hidden');
      this.showError('Trimming failed. Try downloading original.');
    }
  }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  new ScreenRecorder();
});

// Service Worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      console.log('Service Worker registration failed (expected for dev)');
    });
  });
}
