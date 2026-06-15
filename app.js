import { createClient } from 'https://cdn.jsdelivr.net/npm/@nhost/nhost-js@4.7.1/+esm';

// App state
let nhost = null;
let currentConfig = {
  nhostSubdomain: '',
  nhostRegion: '',
  hasDeepgramKey: false,
  localDeepgramKey: ''
};

// UI Elements
const loadingScreen = document.getElementById('loading-screen');
const configScreen = document.getElementById('config-screen');
const authScreen = document.getElementById('auth-screen');
const dashboardScreen = document.getElementById('dashboard-screen');

const configForm = document.getElementById('config-form');
const cfgSubdomain = document.getElementById('cfg-subdomain');
const cfgRegion = document.getElementById('cfg-region');
const cfgDeepgram = document.getElementById('cfg-deepgram');

const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authError = document.getElementById('auth-error');
const authSuccess = document.getElementById('auth-success');
const btnShowConfig = document.getElementById('btn-show-config');

const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');

const userEmailDisplay = document.getElementById('user-email-display');
const btnSignout = document.getElementById('btn-signout');

// Controls & Status (Dashboard)
const btnMic = document.getElementById('btn-mic');
const micStatusText = document.getElementById('mic-status-text');
const iconMicOn = document.getElementById('icon-mic-on');
const iconMicOff = document.getElementById('icon-mic-off');
const statusAuth = document.getElementById('status-auth');
const statusWebsocket = document.getElementById('status-websocket');
const statusAudio = document.getElementById('status-audio');

// Transcript View
const transcriptFeed = document.getElementById('transcript-feed');
const transcriptEmpty = document.getElementById('transcript-empty');
const transcriptContainer = document.getElementById('transcript-container');
const transcriptFinal = document.getElementById('transcript-final');
const transcriptInterim = document.getElementById('transcript-interim');
const wordCountBadge = document.getElementById('word-count');
const btnCopy = document.getElementById('btn-copy');
const btnClear = document.getElementById('btn-clear');
const transcribeIndicator = document.getElementById('transcribe-indicator');

// Auth View Mode ('login' or 'signup')
let authMode = 'login';

// Streaming Variables
let isRecording = false;
let mediaStream = null;
let mediaRecorder = null;
let wsConn = null;
let finalTranscriptHistory = '';
let totalWords = 0;

// Audio Visualizer
let audioCtx = null;
let analyser = null;
let dataArray = null;
let visualizerSource = null;
let drawRequestFrame = null;

// Initialize app config
async function initApp() {
  try {
    // 1. Fetch server environment variables
    const res = await fetch('/api/config');
    const serverConfig = await res.json();
    
    currentConfig.nhostSubdomain = serverConfig.nhostSubdomain || localStorage.getItem('nhost_subdomain') || '';
    currentConfig.nhostRegion = serverConfig.nhostRegion || localStorage.getItem('nhost_region') || '';
    currentConfig.hasDeepgramKey = serverConfig.hasDeepgramKey || false;
    currentConfig.localDeepgramKey = localStorage.getItem('deepgram_api_key') || '';

    // 2. Determine if we have enough config to run Nhost
    if (currentConfig.nhostSubdomain && currentConfig.nhostRegion) {
      setupNhost();
    } else {
      // Show config panel
      showScreen(configScreen);
    }
  } catch (err) {
    console.error('Initialization failed:', err);
    // Standard local storage fallback
    currentConfig.nhostSubdomain = localStorage.getItem('nhost_subdomain') || '';
    currentConfig.nhostRegion = localStorage.getItem('nhost_region') || '';
    currentConfig.localDeepgramKey = localStorage.getItem('deepgram_api_key') || '';

    if (currentConfig.nhostSubdomain && currentConfig.nhostRegion) {
      setupNhost();
    } else {
      showScreen(configScreen);
    }
  }
}

// Setup Nhost Client
function setupNhost() {
  try {
    nhost = createClient({
      subdomain: currentConfig.nhostSubdomain,
      region: currentConfig.nhostRegion
    });

    // Monitor Auth State
    nhost.auth.onAuthStateChange((event, session) => {
      console.log('Nhost Auth Event:', event);
      if (nhost.auth.isAuthenticated()) {
        const user = nhost.auth.getUser();
        userEmailDisplay.textContent = user.email;
        statusAuth.textContent = 'Active';
        statusAuth.className = 'status-indicator indicator-success';
        showScreen(dashboardScreen);
      } else {
        statusAuth.textContent = 'Inactive';
        statusAuth.className = 'status-indicator indicator-muted';
        showScreen(authScreen);
      }
    });
  } catch (err) {
    console.error('Failed to initialize Nhost Client:', err);
    alert('Nhost Client initialization failed. Check your Subdomain and Region settings.');
    showScreen(configScreen);
  }
}

// Switch Screens
function showScreen(screenEl) {
  [loadingScreen, configScreen, authScreen, dashboardScreen].forEach(s => {
    s.classList.remove('active');
  });
  screenEl.classList.add('active');
}

// Set up UI event listeners
document.addEventListener('DOMContentLoaded', () => {
  initApp();

  // Tab switcher
  tabLogin.addEventListener('click', () => setAuthMode('login'));
  tabSignup.addEventListener('click', () => setAuthMode('signup'));

  // Show config manually from auth page
  btnShowConfig.addEventListener('click', () => {
    cfgSubdomain.value = currentConfig.nhostSubdomain;
    cfgRegion.value = currentConfig.nhostRegion;
    cfgDeepgram.value = currentConfig.localDeepgramKey;
    showScreen(configScreen);
  });

  // Config Submit
  configForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const sub = cfgSubdomain.value.trim();
    const reg = cfgRegion.value.trim();
    const dgKey = cfgDeepgram.value.trim();

    localStorage.setItem('nhost_subdomain', sub);
    localStorage.setItem('nhost_region', reg);
    if (dgKey) {
      localStorage.setItem('deepgram_api_key', dgKey);
    }

    currentConfig.nhostSubdomain = sub;
    currentConfig.nhostRegion = reg;
    currentConfig.localDeepgramKey = dgKey;

    showScreen(loadingScreen);
    setupNhost();
  });

  // Auth Form Submit
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authEmail.value.trim();
    const password = authPassword.value;

    setAuthLoading(true);
    hideAlerts();

    try {
      if (authMode === 'login') {
        const { session, error } = await nhost.auth.signInEmailPassword({ email, password });
        if (error) throw error;
        showSuccess('Logged in successfully!');
      } else {
        const { session, error } = await nhost.auth.signUpEmailPassword({ email, password });
        if (error) throw error;
        
        // Some Nhost instances verify email, check if user session returned immediately
        if (session) {
          showSuccess('Account created and logged in!');
        } else {
          showSuccess('Account created! Please check your email to verify or sign in.');
          setAuthMode('login');
        }
      }
    } catch (err) {
      console.error(err);
      showError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setAuthLoading(false);
    }
  });

  // Sign out Button
  btnSignout.addEventListener('click', async () => {
    if (isRecording) {
      stopStreaming();
    }
    await nhost.auth.signOut();
  });

  // Microphone toggle button
  btnMic.addEventListener('click', () => {
    if (isRecording) {
      stopStreaming();
    } else {
      startStreaming();
    }
  });

  // Copy Transcript
  btnCopy.addEventListener('click', () => {
    const fullText = (finalTranscriptHistory + ' ' + transcriptInterim.textContent).trim();
    if (fullText) {
      navigator.clipboard.writeText(fullText)
        .then(() => {
          const originalText = btnCopy.textContent;
          btnCopy.textContent = 'Copied!';
          setTimeout(() => btnCopy.textContent = originalText, 2000);
        })
        .catch(err => console.error('Copy failed:', err));
    }
  });

  // Clear Transcript
  btnClear.addEventListener('click', () => {
    finalTranscriptHistory = '';
    transcriptFinal.textContent = '';
    transcriptInterim.textContent = '';
    totalWords = 0;
    wordCountBadge.textContent = '0 words';
    transcriptEmpty.classList.remove('hidden');
    transcriptContainer.classList.add('hidden');
  });

  // Keep Canvas visualizer responsive
  const canvas = document.getElementById('audio-visualizer');
  const resizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.parentElement.clientWidth * dpr;
    canvas.height = canvas.parentElement.clientHeight * dpr;
  };
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
});

// Configure Auth Forms UI
function setAuthMode(mode) {
  authMode = mode;
  hideAlerts();
  if (mode === 'login') {
    tabLogin.classList.add('active');
    tabSignup.classList.remove('active');
    authTitle.textContent = 'Welcome Back';
    authSubtitle.textContent = 'Sign in to access your speech-to-text dashboard.';
    authSubmitBtn.querySelector('.btn-text').textContent = 'Sign In';
  } else {
    tabLogin.classList.remove('active');
    tabSignup.classList.add('active');
    authTitle.textContent = 'Create Account';
    authSubtitle.textContent = 'Register a new account using your email.';
    authSubmitBtn.querySelector('.btn-text').textContent = 'Sign Up';
  }
}

function setAuthLoading(isLoading) {
  if (isLoading) {
    authSubmitBtn.setAttribute('disabled', 'true');
    authSubmitBtn.querySelector('.btn-text').classList.add('hidden');
    authSubmitBtn.querySelector('.btn-loader').classList.remove('hidden');
  } else {
    authSubmitBtn.removeAttribute('disabled');
    authSubmitBtn.querySelector('.btn-text').classList.remove('hidden');
    authSubmitBtn.querySelector('.btn-loader').classList.add('hidden');
  }
}

function showError(msg) {
  authError.querySelector('.alert-message').textContent = msg;
  authError.classList.remove('hidden');
}

function showSuccess(msg) {
  authSuccess.querySelector('.alert-message').textContent = msg;
  authSuccess.classList.remove('hidden');
}

function hideAlerts() {
  authError.classList.add('hidden');
  authSuccess.classList.add('hidden');
}

// ----------------- STREAMING & SPEECH-TO-TEXT LOGIC -----------------

async function startStreaming() {
  try {
    // 1. Check microphone permissions and obtain stream
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    statusAudio.textContent = 'Active';
    statusAudio.className = 'status-indicator indicator-success';

    // 2. Establish connection to local Python proxy WS endpoint
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    let wsUrl = `${protocol}//${host}/ws/transcribe`;

    // Retrieve Deepgram API key (server env or fallback UI config)
    const keyQuery = currentConfig.hasDeepgramKey ? '' : `?apiKey=${encodeURIComponent(currentConfig.localDeepgramKey)}`;
    wsUrl += keyQuery;

    wsConn = new WebSocket(wsUrl);
    statusWebsocket.textContent = 'Connecting...';
    statusWebsocket.className = 'status-indicator indicator-warning';

    wsConn.onopen = () => {
      console.log('WebSocket connection to Python backend opened.');
      statusWebsocket.textContent = 'Connected';
      statusWebsocket.className = 'status-indicator indicator-success';
      transcribeIndicator.classList.remove('hidden');

      // Update UI button state
      btnMic.classList.add('recording');
      iconMicOff.classList.remove('active');
      iconMicOn.classList.add('active');
      micStatusText.textContent = 'Streaming Audio';
      micStatusText.classList.add('recording');

      // Start Recording Chunks
      startRecording();
      // Start Drawing Audio Wave
      startVisualizer(mediaStream);
    };

    wsConn.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle server-side errors
        if (data.error) {
          alert(`Proxy Error: ${data.error}`);
          stopStreaming();
          return;
        }

        // Process Deepgram structure
        if (data.channel && data.channel.alternatives) {
          const alt = data.channel.alternatives[0];
          const transcriptText = alt.transcript;
          
          if (transcriptText) {
            transcriptEmpty.classList.add('hidden');
            transcriptContainer.classList.remove('hidden');

            if (data.is_final) {
              // Append to final text history
              finalTranscriptHistory += ' ' + transcriptText;
              transcriptFinal.textContent = finalTranscriptHistory.trim() + ' ';
              transcriptInterim.textContent = '';
            } else {
              // Show interim active text in real-time
              transcriptInterim.textContent = transcriptText;
            }

            // Word counter helper
            updateWordCount();
            // Scroll down
            transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
          }
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    wsConn.onerror = (err) => {
      console.error('WebSocket Error:', err);
      statusWebsocket.textContent = 'Error';
      statusWebsocket.className = 'status-indicator indicator-danger';
    };

    wsConn.onclose = () => {
      console.log('WebSocket closed.');
      statusWebsocket.textContent = 'Disconnected';
      statusWebsocket.className = 'status-indicator indicator-muted';
      stopStreaming();
    };

  } catch (err) {
    console.error('Error starting live transcription:', err);
    alert('Microphone access is required or WebSocket connection failed.');
    stopStreaming();
  }
}

function startRecording() {
  isRecording = true;
  // Initialize MediaRecorder (webm/opus is default on modern browsers and accepted by Deepgram)
  mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0 && wsConn && wsConn.readyState === WebSocket.OPEN) {
      wsConn.send(e.data);
    }
  };

  // Start sending audio chunks every 100ms
  mediaRecorder.start(100);
}

function stopStreaming() {
  isRecording = false;

  // Stop MediaRecorder
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;

  // Stop tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }
  mediaStream = null;
  statusAudio.textContent = 'Inactive';
  statusAudio.className = 'status-indicator indicator-muted';

  // Close WebSocket
  if (wsConn) {
    if (wsConn.readyState === WebSocket.OPEN) {
      wsConn.close();
    }
  }
  wsConn = null;

  // Reset UI classes
  btnMic.classList.remove('recording');
  iconMicOn.classList.remove('active');
  iconMicOff.classList.add('active');
  micStatusText.textContent = 'Microphone Idle';
  micStatusText.classList.remove('recording');
  transcribeIndicator.classList.add('hidden');

  // Stop Wave
  stopVisualizer();
}

function updateWordCount() {
  const fullText = (finalTranscriptHistory + ' ' + transcriptInterim.textContent).trim();
  if (!fullText) {
    totalWords = 0;
  } else {
    totalWords = fullText.split(/\s+/).filter(Boolean).length;
  }
  wordCountBadge.textContent = `${totalWords} word${totalWords === 1 ? '' : 's'}`;
}

// ----------------- CANVAS VISUALIZER LOOP -----------------

function startVisualizer(stream) {
  const canvas = document.getElementById('audio-visualizer');
  const canvasCtx = canvas.getContext('2d');
  
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  // Resumes audio context if suspended by browser security
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128; // lower sizes for wider bar styling
  const bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);
  
  visualizerSource = audioCtx.createMediaStreamSource(stream);
  visualizerSource.connect(analyser);
  
  function draw() {
    drawRequestFrame = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    
    // Clear canvas
    canvasCtx.fillStyle = 'rgba(10, 14, 25, 0.4)';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    
    const barWidth = (canvas.width / bufferLength) * 1.5;
    let barHeight;
    let x = 0;
    
    // Draw frequency spectrum
    for (let i = 0; i < bufferLength; i++) {
      barHeight = (dataArray[i] / 255) * canvas.height * 0.9;
      
      // Calculate cool cybernetic color gradient
      const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, 0);
      gradient.addColorStop(0, 'rgba(0, 242, 254, 0.15)');
      gradient.addColorStop(0.5, 'rgba(0, 242, 254, 0.65)');
      gradient.addColorStop(1, 'rgba(108, 38, 255, 0.85)');
      
      canvasCtx.fillStyle = gradient;
      
      // Double side bars from center height
      const yOffset = (canvas.height - barHeight) / 2;
      canvasCtx.fillRect(x, yOffset, barWidth - 3, barHeight);
      
      x += barWidth;
    }
  }
  
  draw();
}

function stopVisualizer() {
  if (drawRequestFrame) {
    cancelAnimationFrame(drawRequestFrame);
    drawRequestFrame = null;
  }
  if (visualizerSource) {
    visualizerSource.disconnect();
    visualizerSource = null;
  }
  
  // Clear visualizer to silent state
  const canvas = document.getElementById('audio-visualizer');
  const canvasCtx = canvas.getContext('2d');
  canvasCtx.fillStyle = '#0a0e19';
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
}
