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

import { PCMode }      from './pc-mode.js';
import { VRLobby }     from './vr-lobby.js';
import { VRViewer }    from './vr-viewer.js';
import { Panorama }    from './panorama.js';
import { ServerMode }  from './server-mode.js';
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
  HOME:        'HOME',
  PC_MODE:     'PC_MODE',
  VR_LOBBY:    'VR_LOBBY',
  VR_VIEWER:   'VR_VIEWER',
  SERVER_MODE: 'SERVER_MODE',
  DEV_MODE:    'DEV_MODE',
});

let _state = STATES.HOME;

// Controllers (lazy-init on first use)
let _pcMode     = null;
let _vrLobby    = null;
let _vrViewer   = null;
let _serverMode = null;
let _devPano    = null;
let _stopLobbyPoll = null;

// Screen elements
const screens = {
  home:   document.getElementById('screen-home'),
  pc:     document.getElementById('screen-pc'),
  vr:     document.getElementById('screen-vr'),
  server: document.getElementById('screen-server'),
  dev:    document.getElementById('screen-dev'),
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
  if (_pcMode)     { _pcMode.leave(); }
  if (_vrLobby)    { _vrLobby.destroy(); _vrLobby = null; }
  if (_vrViewer)   { _vrViewer.unload(); _vrViewer = null; }
  if (_serverMode) { _serverMode.leave(); }
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

function goServerMode() {
  _state = STATES.SERVER_MODE;
  showScreen('server');

  // Lazy-init — reuse instance across home↔server transitions
  if (!_serverMode) {
    _serverMode = new ServerMode({
      onBack: goHome,
      toast:  showToast,
    });
  }
  _serverMode.enter();
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
    el.textContent = 'Relay Offline';
    el.className   = 'relay-status relay-status--offline';
    return;
  }
  el.textContent = 'Checking relay…';
  el.className   = 'relay-status relay-status--checking';

  try {
    const cameras = await fetchCameras(RELAY_BASE);
    const anyLive = cameras.some(c => c.status === 'streaming');
    const anyWait = cameras.some(c => c.status === 'waiting');
    const allOff  = cameras.every(c => c.status === 'unreachable' || c.status === 'offline');

    if (allOff) {
      el.textContent = 'Relay Offline';
      el.className   = 'relay-status relay-status--offline';
    } else if (anyLive) {
      const liveCount = cameras.filter(c => c.status === 'streaming').length;
      el.textContent = `${liveCount} Camera${liveCount > 1 ? 's' : ''} Live`;
      el.className   = 'relay-status relay-status--live';
    } else if (anyWait) {
      el.textContent = 'Relay Online — Waiting for Camera';
      el.className   = 'relay-status relay-status--waiting';
    } else {
      el.textContent = 'Relay Online';
      el.className   = 'relay-status relay-status--online';
    }
  } catch {
    el.textContent = 'Relay Error';
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
//  MODAL SYSTEM
//  Usage: showModal({ icon, type, title, msg, actions })
//  type: 'success' | 'error' | 'warning' | 'info' | 'loading'
//  actions: [{ label, cls, onClick }]
// ─────────────────────────────────────────────────────────

const MODAL_ICONS = {
  success: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#00FF88"><polyline points="20 6 9 17 4 12"/></svg>',
  error:   '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#FF3344"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  warning: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#FFD000"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info:    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#00C6FF"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  loading: '<div class="spinner" style="width:22px;height:22px"></div>',
};

export function showModal({ type = 'info', title, msg, actions = [] }) {
  const backdrop = document.getElementById('modal-backdrop');
  const iconEl   = document.getElementById('modal-icon-el');
  const titleEl  = document.getElementById('modal-title-el');
  const msgEl    = document.getElementById('modal-msg-el');
  const actsEl   = document.getElementById('modal-actions-el');

  // Icon
  iconEl.className = `modal-icon modal-icon--${type}`;
  iconEl.innerHTML = MODAL_ICONS[type] ?? MODAL_ICONS.info;

  // Text
  titleEl.textContent = title ?? '';
  msgEl.textContent   = msg   ?? '';

  // Actions
  actsEl.innerHTML = '';
  if (actions.length === 0) {
    // Default dismiss
    const btn = document.createElement('button');
    btn.className   = 'modal-btn modal-btn--secondary';
    btn.textContent = 'Dismiss';
    btn.onclick     = hideModal;
    actsEl.appendChild(btn);
  } else {
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.className   = `modal-btn ${a.cls ?? 'modal-btn--secondary'}`;
      btn.textContent = a.label;
      btn.onclick     = () => { hideModal(); a.onClick?.(); };
      actsEl.appendChild(btn);
    });
  }

  backdrop.classList.add('open');
  backdrop.addEventListener('click', e => { if (e.target === backdrop) hideModal(); }, { once: true });
}

export function hideModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
}

// Expose globally for use from JS modules that don't import app.js
window._cn360ShowModal = showModal;
window._cn360HideModal = hideModal;

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
  document.getElementById('btn-server-mode').addEventListener('click', goServerMode);
  document.getElementById('btn-vr-mode').addEventListener('click', goVRLobby);
  document.getElementById('vr-home-btn').addEventListener('click', goHome);

  // Dev mode
  if (DEBUG_MODE) {
    const debugLink = document.getElementById('home-debug-link');
    debugLink.classList.remove('hidden');
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
