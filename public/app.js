/**
 * CN360Live — app.js
 *
 * SPA entry point & state machine.
 *
 * States:
 *   HOME → PC_MODE → PC_VIEWER → (PC_MODE)
 *   HOME → VR_LOBBY → VR_VIEWER → VR_LOBBY → HOME
 *
 * URL params:
 *   ?relay=URL    MediaMTX HLS tunnel URL
 *   ?debug=1      Enable developer mode
 */

import { PCMode }    from './pc-mode.js';
import { VRLobby }   from './vr-lobby.js';
import { VRViewer }  from './vr-viewer.js';
import { Panorama }  from './panorama.js';
import {
  RELAY_BASE,
  DEBUG_MODE,
  POLL_INTERVAL_MS,
} from './config.js';
import { fetchCameras, startPolling } from './cameras-api.js';

// ─────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────

const STATES = Object.freeze({
  HOME:       'HOME',
  PC_MODE:    'PC_MODE',
  VR_LOBBY:   'VR_LOBBY',
  VR_VIEWER:  'VR_VIEWER',
  DEV_MODE:   'DEV_MODE',
});

let _state = STATES.HOME;

// Controllers (lazy-init on first use)
let _pcMode   = null;
let _vrLobby  = null;
let _vrViewer = null;
let _devPano  = null;
let _stopLobbyPoll = null;

// Screen elements
const screens = {
  home: document.getElementById('screen-home'),
  pc:   document.getElementById('screen-pc'),
  vr:   document.getElementById('screen-vr'),
  dev:  document.getElementById('screen-dev'),
};

// ─────────────────────────────────────────────────────────
//  SCREEN SWITCHING
// ─────────────────────────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

// ─────────────────────────────────────────────────────────
//  TRANSITIONS
// ─────────────────────────────────────────────────────────

function goHome() {
  // Tear down any active mode
  if (_pcMode)   { _pcMode.leave(); }
  if (_vrLobby)  { _vrLobby.destroy(); _vrLobby = null; }
  if (_vrViewer) { _vrViewer.unload(); _vrViewer = null; }
  if (_stopLobbyPoll) { _stopLobbyPoll(); _stopLobbyPoll = null; }

  _state = STATES.HOME;
  showScreen('home');
  updateHomeRelayStatus();
}

function goPCMode() {
  _state = STATES.PC_MODE;
  showScreen('pc');

  if (!_pcMode) {
    _pcMode = new PCMode({
      relay:  RELAY_BASE,
      onBack: goHome,
      toast:  showToast,
    });
  }
  _pcMode.enter();
}

function goVRLobby() {
  _state = STATES.VR_LOBBY;
  showScreen('vr');

  // Tear down viewer if coming back from it
  if (_vrViewer) { _vrViewer.unload(); _vrViewer = null; }

  document.getElementById('vr-lobby-hud').classList.remove('hidden');
  document.getElementById('vr-viewer-hud').classList.add('hidden');

  const canvas = document.getElementById('vr-canvas');

  // Always recreate lobby with fresh renderer
  if (_vrLobby) { _vrLobby.destroy(); _vrLobby = null; }

  _vrLobby = new VRLobby(canvas, {
    onSelectCamera: camera => goVRViewer(camera),
    onToast: showToast,
  });

  // Load cameras and start polling
  document.getElementById('vr-lobby-loading').classList.remove('hidden');
  fetchCameras(RELAY_BASE).then(cameras => {
    // Guard: lobby may have been destroyed already if user navigated away
    if (_state !== STATES.VR_LOBBY || !_vrLobby) return;
    document.getElementById('vr-lobby-loading').classList.add('hidden');
    _vrLobby.updateCameras(cameras);
    document.getElementById('vr-lobby-hint').textContent =
      cameras.length ? 'Click a camera panel to connect' : 'No cameras found';
  });

  _stopLobbyPoll = startPolling(cameras => {
    if (_state === STATES.VR_LOBBY && _vrLobby) {
      _vrLobby.updateCameras(cameras);
    }
  }, POLL_INTERVAL_MS, RELAY_BASE);
}

async function goVRViewer(camera) {
  if (!_vrLobby) return;   // lobby must exist to navigate forward

  _state = STATES.VR_VIEWER;

  // Stop polling while in viewer
  _stopLobbyPoll?.();
  _stopLobbyPoll = null;

  // Destroy lobby — releases the WebGL context on vr-canvas
  _vrLobby.destroy();
  _vrLobby = null;

  document.getElementById('vr-lobby-hud').classList.add('hidden');

  // Give the browser one frame to release the old GL context
  await new Promise(r => requestAnimationFrame(r));

  const canvas = document.getElementById('vr-canvas');
  _vrViewer = new VRViewer(canvas, {
    relay:  RELAY_BASE,
    onBack: goVRLobby,
    toast:  showToast,
  });

  await _vrViewer.loadCamera(camera);
}

function goDevMode() {
  _state = STATES.DEV_MODE;
  showScreen('dev');

  const canvas = document.getElementById('dev-canvas');
  if (!_devPano) {
    _devPano = new Panorama(canvas, {
      onStatus: (text) => {
        document.getElementById('dev-status').textContent = 'Status: ' + text;
      },
      onToast: showToast,
    });
    _devPano.useDefaultTexture();
  }
}

// ─────────────────────────────────────────────────────────
//  HOME RELAY STATUS
// ─────────────────────────────────────────────────────────

async function updateHomeRelayStatus() {
  const el = document.getElementById('home-relay-status');
  if (!RELAY_BASE) {
    el.textContent  = '● RELAY OFFLINE';
    el.className    = 'relay-status relay-status--offline';
    return;
  }
  el.textContent = '● CHECKING RELAY…';
  el.className   = 'relay-status relay-status--checking';

  try {
    const cameras = await fetchCameras(RELAY_BASE);
    const anyLive = cameras.some(c => c.status === 'streaming');
    const anyWait = cameras.some(c => c.status === 'waiting');
    const allOff  = cameras.every(c => c.status === 'unreachable' || c.status === 'offline');

    if (allOff) {
      el.textContent = '● RELAY OFFLINE';
      el.className   = 'relay-status relay-status--offline';
    } else if (anyLive) {
      el.textContent = `● ${cameras.filter(c=>c.status==='streaming').length} CAMERA LIVE`;
      el.className   = 'relay-status relay-status--live';
    } else if (anyWait) {
      el.textContent = '● RELAY ONLINE — WAITING FOR CAMERA';
      el.className   = 'relay-status relay-status--waiting';
    } else {
      el.textContent = '● RELAY ONLINE';
      el.className   = 'relay-status relay-status--online';
    }
  } catch {
    el.textContent = '● RELAY ERROR';
    el.className   = 'relay-status relay-status--offline';
  }
}

// ─────────────────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────────────────

let _toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─────────────────────────────────────────────────────────
//  HOME — WebXR badge
// ─────────────────────────────────────────────────────────

async function checkXRBadge() {
  const badge = document.getElementById('vr-badge');
  if (!badge) return;
  if (!navigator.xr) {
    badge.textContent = 'No XR';
    badge.style.opacity = '0.4';
    return;
  }
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-vr');
    badge.textContent = ok ? 'WebXR ✓' : 'WebXR';
    badge.style.color = ok ? '#00FF88' : '#FFD000';
    badge.style.borderColor = ok ? 'rgba(0,255,136,0.4)' : 'rgba(255,208,0,0.3)';
    if (ok) document.getElementById('btn-vr-mode').classList.add('mode-card--xr-ready');
  } catch {
    badge.textContent = 'WebXR';
  }
}

// ─────────────────────────────────────────────────────────
//  DEV MODE — wire up controls
// ─────────────────────────────────────────────────────────

function initDevMode() {
  document.getElementById('dev-back-btn').addEventListener('click', () => {
    if (_devPano) { _devPano.destroy(); _devPano = null; }
    goHome();
  });

  document.getElementById('dev-default-btn').addEventListener('click', () => {
    _devPano?.useDefaultTexture();
    document.getElementById('dev-status').textContent = 'Status: default panorama';
  });

  document.getElementById('dev-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file || !_devPano) return;
    const url = URL.createObjectURL(file);
    _devPano.setImageTexture(url);
    e.target.value = '';
  });

  document.getElementById('dev-connect-btn').addEventListener('click', () => {
    const url = document.getElementById('dev-stream-url').value.trim();
    if (!url) { showToast('Enter a stream URL'); return; }
    _devPano?.setLiveStream(url);
  });

  document.getElementById('dev-set-relay-btn').addEventListener('click', () => {
    const url = document.getElementById('dev-relay-url').value.trim();
    if (!url) { showToast('Enter a relay URL'); return; }
    // Redirect with ?relay= param so config.js picks it up
    const next = new URL(window.location.href);
    next.searchParams.set('relay', url);
    next.searchParams.set('debug', '1');
    window.location.href = next.toString();
  });
}

// ─────────────────────────────────────────────────────────
//  MAIN INIT
// ─────────────────────────────────────────────────────────

function init() {
  // Wire home buttons
  document.getElementById('btn-pc-mode').addEventListener('click', goPCMode);
  document.getElementById('btn-vr-mode').addEventListener('click', goVRLobby);
  document.getElementById('vr-home-btn').addEventListener('click', goHome);

  // Dev mode
  if (DEBUG_MODE) {
    document.getElementById('home-debug-link').style.display = 'block';
    document.getElementById('btn-debug-mode').addEventListener('click', goDevMode);
  }
  initDevMode();

  // Initial screen
  showScreen('home');
  updateHomeRelayStatus();
  checkXRBadge();

  console.log('[CN360] App ready. Relay:', RELAY_BASE || '(none — mock mode)', '| Debug:', DEBUG_MODE);
}

init();
