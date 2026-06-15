/**
 * EchoStream — Live Speech-to-Text Client
 *
 * Architecture:
 *   1. Fetch server config → decide if setup screen is needed
 *   2. Init Nhost client → auth state drives screen routing
 *   3. On mic click → getUserMedia → open WebSocket to /ws/transcribe
 *   4. Wait for backend "ready" (Deepgram connected) → start MediaRecorder
 *   5. Stream audio chunks → receive & render transcript JSON
 */

import { NhostClient } from 'https://esm.sh/@nhost/nhost-js@2.2.18';

// ─── App State ───────────────────────────────────────────────────────────────
let nhost = null;
let currentConfig = {
  nhostSubdomain: '',
  nhostRegion: '',
  hasDeepgramKey: false,
  localDeepgramKey: '',
};

let authMode = 'login'; // 'login' | 'signup'
let isRecording = false;
let mediaStream = null;
let mediaRecorder = null;
let wsConn = null;
let finalTranscriptHistory = '';
let totalWords = 0;

// Audio visualizer refs
let audioCtx = null;
let analyser = null;
let dataArray = null;
let visualizerSource = null;
let animFrameId = null;

// ─── DOM References ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const screens = {
  loading:   $('loading-screen'),
  config:    $('config-screen'),
  auth:      $('auth-screen'),
  dashboard: $('dashboard-screen'),
};

const dom = {
  // Config form
  configForm:   $('config-form'),
  cfgSubdomain: $('cfg-subdomain'),
  cfgRegion:    $('cfg-region'),
  cfgDeepgram:  $('cfg-deepgram'),

  // Auth
  authForm:      $('auth-form'),
  authEmail:     $('auth-email'),
  authPassword:  $('auth-password'),
  authSubmitBtn: $('auth-submit-btn'),
  authError:     $('auth-error'),
  authSuccess:   $('auth-success'),
  authTitle:     $('auth-title'),
  authSubtitle:  $('auth-subtitle'),
  tabLogin:      $('tab-login'),
  tabSignup:     $('tab-signup'),
  btnShowConfig: $('btn-show-config'),

  // Dashboard
  userEmail:       $('user-email-display'),
  btnSignout:      $('btn-signout'),
  btnMic:          $('btn-mic'),
  micStatusText:   $('mic-status-text'),
  iconMicOn:       $('icon-mic-on'),
  iconMicOff:      $('icon-mic-off'),
  statusAuth:      $('status-auth'),
  statusWebsocket: $('status-websocket'),
  statusAudio:     $('status-audio'),

  // Transcript
  transcriptFeed:      $('transcript-feed'),
  transcriptEmpty:     $('transcript-empty'),
  transcriptContainer: $('transcript-container'),
  transcriptFinal:     $('transcript-final'),
  transcriptInterim:   $('transcript-interim'),
  wordCount:           $('word-count'),
  btnCopy:             $('btn-copy'),
  btnClear:            $('btn-clear'),
  transcribeIndicator: $('transcribe-indicator'),

  // Canvas
  canvas: $('audio-visualizer'),
};

// ─── Screen Navigation ───────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove('active'));
  screens[name].classList.add('active');
}

// ─── App Bootstrap ───────────────────────────────────────────────────────────
async function initApp() {
  showScreen('loading');

  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`Config fetch failed (${res.status})`);
    const serverCfg = await res.json();

    currentConfig.nhostSubdomain =
      serverCfg.nhostSubdomain || localStorage.getItem('nhost_subdomain') || '';
    currentConfig.nhostRegion =
      serverCfg.nhostRegion || localStorage.getItem('nhost_region') || '';
    currentConfig.hasDeepgramKey = serverCfg.hasDeepgramKey;
    currentConfig.localDeepgramKey =
      localStorage.getItem('deepgram_api_key') || '';

    if (!currentConfig.nhostSubdomain || !currentConfig.nhostRegion) {
      showScreen('config');
      return;
    }

    initNhost();
    showScreen('auth');
  } catch (err) {
    console.error('initApp error:', err);
    showScreen('config');
  }
}

// ─── Nhost Client ────────────────────────────────────────────────────────────
function initNhost() {
  try {
    nhost = new NhostClient({
      subdomain: currentConfig.nhostSubdomain,
      region: currentConfig.nhostRegion,
    });

    nhost.auth.onAuthStateChanged((event, session) => {
      console.log('[auth]', event);

      if (event === 'SIGNED_IN' && session) {
        dom.userEmail.textContent = session.user.email;
        setStatus('statusAuth', 'Active', 'success');
        showScreen('dashboard');
      } else if (event === 'SIGNED_OUT') {
        setStatus('statusAuth', 'Inactive', 'muted');
        showScreen('auth');
      }
    });
  } catch (err) {
    console.error('Nhost init error:', err);
    showScreen('config');
  }
}

// ─── Auth Helpers ────────────────────────────────────────────────────────────
function setAuthMode(mode) {
  authMode = mode;
  hideAlerts();

  const isLogin = mode === 'login';
  dom.tabLogin.classList.toggle('active', isLogin);
  dom.tabSignup.classList.toggle('active', !isLogin);
  dom.authTitle.textContent = isLogin ? 'Welcome Back' : 'Create Account';
  dom.authSubtitle.textContent = isLogin
    ? 'Sign in to access your speech-to-text dashboard.'
    : 'Register a new account using your email.';
  dom.authSubmitBtn.querySelector('.btn-text').textContent = isLogin
    ? 'Sign In'
    : 'Sign Up';
}

function setAuthLoading(loading) {
  dom.authSubmitBtn.toggleAttribute('disabled', loading);
  dom.authSubmitBtn.querySelector('.btn-text').classList.toggle('hidden', loading);
  dom.authSubmitBtn.querySelector('.btn-loader').classList.toggle('hidden', !loading);
}

function showAlert(type, msg) {
  const el = type === 'error' ? dom.authError : dom.authSuccess;
  el.querySelector('.alert-message').textContent = msg;
  el.classList.remove('hidden');
}

function hideAlerts() {
  dom.authError.classList.add('hidden');
  dom.authSuccess.classList.add('hidden');
}

// ─── Status Badge Helper ─────────────────────────────────────────────────────
function setStatus(key, label, variant) {
  const el = dom[key];
  el.textContent = label;
  el.className = `status-indicator indicator-${variant}`;
}

// ─── Streaming Logic ─────────────────────────────────────────────────────────
async function startStreaming() {
  try {
    // 1. Acquire microphone
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        sampleRate: 16000,
      },
    });
    setStatus('statusAudio', 'Active', 'success');

    // 2. Open WebSocket to backend proxy
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${proto}//${location.host}/ws/transcribe`;
    if (!currentConfig.hasDeepgramKey && currentConfig.localDeepgramKey) {
      wsUrl += `?apiKey=${encodeURIComponent(currentConfig.localDeepgramKey)}`;
    }

    wsConn = new WebSocket(wsUrl);
    setStatus('statusWebsocket', 'Connecting…', 'warning');

    wsConn.onopen = () => {
      console.log('[ws] Connected to backend — waiting for Deepgram handshake…');
    };

    wsConn.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Backend signals Deepgram is ready — safe to stream now
        if (data.status === 'ready') {
          console.log('[ws] Deepgram ready. Starting audio capture.');
          setStatus('statusWebsocket', 'Connected', 'success');
          dom.transcribeIndicator.classList.remove('hidden');
          setMicUI(true);
          beginRecording();
          startVisualizer(mediaStream);
          return;
        }

        // Error from backend
        if (data.error) {
          showAlert('error', data.error);
          stopStreaming();
          return;
        }

        // Deepgram transcript payload
        handleTranscript(data);
      } catch (err) {
        console.error('[ws] Parse error:', err);
      }
    };

    wsConn.onerror = () => {
      setStatus('statusWebsocket', 'Error', 'danger');
    };

    wsConn.onclose = () => {
      console.log('[ws] Closed.');
      setStatus('statusWebsocket', 'Disconnected', 'muted');
      stopStreaming();
    };
  } catch (err) {
    console.error('startStreaming error:', err);
    showAlert('error', 'Microphone access denied or unavailable.');
    stopStreaming();
  }
}

function beginRecording() {
  isRecording = true;
  mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0 && wsConn?.readyState === WebSocket.OPEN) {
      wsConn.send(e.data);
    }
  };

  mediaRecorder.start(100); // chunk every 100ms
}

function stopStreaming() {
  isRecording = false;

  if (mediaRecorder?.state !== 'inactive') {
    try { mediaRecorder?.stop(); } catch { /* already stopped */ }
  }
  mediaRecorder = null;

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
  }
  mediaStream = null;
  setStatus('statusAudio', 'Inactive', 'muted');

  if (wsConn?.readyState === WebSocket.OPEN) {
    wsConn.close();
  }
  wsConn = null;

  setMicUI(false);
  dom.transcribeIndicator.classList.add('hidden');
  stopVisualizer();
}

// ─── Mic UI Toggle ───────────────────────────────────────────────────────────
function setMicUI(active) {
  dom.btnMic.classList.toggle('recording', active);
  dom.iconMicOn.classList.toggle('active', active);
  dom.iconMicOff.classList.toggle('active', !active);
  dom.micStatusText.textContent = active ? 'Streaming Audio' : 'Microphone Idle';
  dom.micStatusText.classList.toggle('recording', active);
}

// ─── Transcript Rendering ────────────────────────────────────────────────────
function handleTranscript(data) {
  const alt = data?.channel?.alternatives?.[0];
  if (!alt?.transcript) return;

  dom.transcriptEmpty.classList.add('hidden');
  dom.transcriptContainer.classList.remove('hidden');

  if (data.is_final) {
    finalTranscriptHistory += ' ' + alt.transcript;
    dom.transcriptFinal.textContent = finalTranscriptHistory.trim() + ' ';
    dom.transcriptInterim.textContent = '';
  } else {
    dom.transcriptInterim.textContent = alt.transcript;
  }

  updateWordCount();
  dom.transcriptFeed.scrollTop = dom.transcriptFeed.scrollHeight;
}

function updateWordCount() {
  const text = (finalTranscriptHistory + ' ' + dom.transcriptInterim.textContent).trim();
  totalWords = text ? text.split(/\s+/).filter(Boolean).length : 0;
  dom.wordCount.textContent = `${totalWords} word${totalWords === 1 ? '' : 's'}`;
}

function clearTranscript() {
  finalTranscriptHistory = '';
  dom.transcriptFinal.textContent = '';
  dom.transcriptInterim.textContent = '';
  totalWords = 0;
  dom.wordCount.textContent = '0 words';
  dom.transcriptEmpty.classList.remove('hidden');
  dom.transcriptContainer.classList.add('hidden');
}

// ─── Audio Visualizer ────────────────────────────────────────────────────────
function startVisualizer(stream) {
  const ctx = dom.canvas.getContext('2d');

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  const bufLen = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufLen);

  visualizerSource = audioCtx.createMediaStreamSource(stream);
  visualizerSource.connect(analyser);

  const draw = () => {
    animFrameId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    ctx.fillStyle = 'rgba(10, 14, 25, 0.4)';
    ctx.fillRect(0, 0, dom.canvas.width, dom.canvas.height);

    const barW = (dom.canvas.width / bufLen) * 1.5;
    let x = 0;

    for (let i = 0; i < bufLen; i++) {
      const barH = (dataArray[i] / 255) * dom.canvas.height * 0.9;
      const grad = ctx.createLinearGradient(0, dom.canvas.height, 0, 0);
      grad.addColorStop(0, 'rgba(0, 242, 254, 0.15)');
      grad.addColorStop(0.5, 'rgba(0, 242, 254, 0.65)');
      grad.addColorStop(1, 'rgba(108, 38, 255, 0.85)');
      ctx.fillStyle = grad;

      const yOff = (dom.canvas.height - barH) / 2;
      ctx.fillRect(x, yOff, barW - 3, barH);
      x += barW;
    }
  };
  draw();
}

function stopVisualizer() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (visualizerSource) {
    visualizerSource.disconnect();
    visualizerSource = null;
  }
  const ctx = dom.canvas.getContext('2d');
  ctx.fillStyle = '#0a0e19';
  ctx.fillRect(0, 0, dom.canvas.width, dom.canvas.height);
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  dom.canvas.width = dom.canvas.parentElement.clientWidth * dpr;
  dom.canvas.height = dom.canvas.parentElement.clientHeight * dpr;
}

// ─── Event Wiring ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initApp();

  // Auth tabs
  dom.tabLogin.addEventListener('click', () => setAuthMode('login'));
  dom.tabSignup.addEventListener('click', () => setAuthMode('signup'));

  // Manual config
  dom.btnShowConfig.addEventListener('click', () => {
    dom.cfgSubdomain.value = currentConfig.nhostSubdomain;
    dom.cfgRegion.value = currentConfig.nhostRegion;
    dom.cfgDeepgram.value = currentConfig.localDeepgramKey;
    showScreen('config');
  });

  // Config form
  dom.configForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const sub = dom.cfgSubdomain.value.trim();
    const reg = dom.cfgRegion.value.trim();
    const dgKey = dom.cfgDeepgram.value.trim();

    localStorage.setItem('nhost_subdomain', sub);
    localStorage.setItem('nhost_region', reg);
    if (dgKey) localStorage.setItem('deepgram_api_key', dgKey);

    Object.assign(currentConfig, {
      nhostSubdomain: sub,
      nhostRegion: reg,
      localDeepgramKey: dgKey,
    });

    initNhost();
    showScreen('auth');
  });

  // Auth form
  dom.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = dom.authEmail.value.trim();
    const password = dom.authPassword.value;

    if (!email || !password) return;

    setAuthLoading(true);
    hideAlerts();

    try {
      if (authMode === 'login') {
        const { session, error } = await nhost.auth.signIn({ email, password });
        if (error) throw error;
        if (session) {
          dom.userEmail.textContent = session.user.email;
          showScreen('dashboard');
        }
      } else {
        const { session, error } = await nhost.auth.signUp({ email, password });
        if (error) throw error;
        if (session) {
          dom.userEmail.textContent = session.user.email;
          showScreen('dashboard');
        } else {
          showAlert('success', 'Account created! Check your email to verify, then sign in.');
          setAuthMode('login');
        }
      }
    } catch (err) {
      console.error('[auth] Error:', err);
      showAlert('error', err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setAuthLoading(false);
    }
  });

  // Sign out
  dom.btnSignout.addEventListener('click', async () => {
    if (isRecording) stopStreaming();
    await nhost.auth.signOut();
  });

  // Mic toggle
  dom.btnMic.addEventListener('click', () => {
    isRecording ? stopStreaming() : startStreaming();
  });

  // Copy transcript
  dom.btnCopy.addEventListener('click', async () => {
    const text = (finalTranscriptHistory + ' ' + dom.transcriptInterim.textContent).trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const orig = dom.btnCopy.textContent;
      dom.btnCopy.textContent = 'Copied!';
      setTimeout(() => (dom.btnCopy.textContent = orig), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  });

  // Clear transcript
  dom.btnClear.addEventListener('click', clearTranscript);

  // Canvas resize
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
});
