/**
 * CN360 · VR 360° Viewer — viewer.js
 *
 * Features:
 *   • Three.js equirectangular sphere (inside-out)
 *   • WebXR immersive-vr with head tracking
 *   • Mouse / touch drag (non-VR)
 *   • Scroll / pinch to zoom FOV
 *   • Upload 360° image from local file
 *   • Live camera stream via VideoTexture (HLS/WebRTC URL)
 *
 * Phase 2 hook:
 *   Call  setLiveStream(url)  to swap to a live VideoTexture.
 *   Call  setImageTexture(url) to load a static equirect.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────
//  RENDERER
// ─────────────────────────────────────────────────────────

const canvas = document.getElementById('c');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping     = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// ─────────────────────────────────────────────────────────
//  SCENE
// ─────────────────────────────────────────────────────────

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 1000);
camera.position.set(0, 0, 0.001);   // tiny offset prevents clipping at exact 0
scene.add(camera);

// Inside-out sphere — viewer at center
const geo = new THREE.SphereGeometry(50, 128, 64);
geo.scale(-1, 1, 1);   // flip normals inward

const mat = new THREE.MeshBasicMaterial({
  side: THREE.FrontSide,
  depthWrite: false,
  color: 0xffffff,
});

const sphere = new THREE.Mesh(geo, mat);
scene.add(sphere);

// ─────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────

const state = {
  yaw:   0,
  pitch: 0,
  fov:   90,
  isVR:  false,
  source: 'default',
  _video: null,
  _stream: null,
  _hls: null,
};

// ─────────────────────────────────────────────────────────
//  RESIZE
// ─────────────────────────────────────────────────────────

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov    = state.fov;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ─────────────────────────────────────────────────────────
//  CAMERA ROTATION (non-VR)
// ─────────────────────────────────────────────────────────

function applyRotation() {
  if (renderer.xr.isPresenting) return;
  camera.quaternion.setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(state.pitch),
      THREE.MathUtils.degToRad(-state.yaw),
      0,
      'YXZ'
    )
  );
  camera.fov = state.fov;
  camera.updateProjectionMatrix();
}

// ─────────────────────────────────────────────────────────
//  DRAG INTERACTION
// ─────────────────────────────────────────────────────────

const drag = { active: false, x: 0, y: 0 };

function getXY(e) {
  return e.touches
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
    : { x: e.clientX,            y: e.clientY };
}

canvas.addEventListener('mousedown',  e => { if (!state.isVR) { drag.active = true;  const p = getXY(e); drag.x = p.x; drag.y = p.y; } });
canvas.addEventListener('touchstart', e => { if (!state.isVR) { drag.active = true;  const p = getXY(e); drag.x = p.x; drag.y = p.y; } }, { passive: true });

window.addEventListener('mousemove', e => {
  if (!drag.active || state.isVR) return;
  const p = getXY(e);
  state.yaw   -= (p.x - drag.x) * 0.22;
  state.pitch += (p.y - drag.y) * 0.16;
  state.pitch  = Math.max(-88, Math.min(88, state.pitch));
  drag.x = p.x; drag.y = p.y;
  applyRotation();
});

window.addEventListener('touchmove', e => {
  if (!drag.active || state.isVR) return;
  const p = getXY(e);
  state.yaw   -= (p.x - drag.x) * 0.22;
  state.pitch += (p.y - drag.y) * 0.16;
  state.pitch  = Math.max(-88, Math.min(88, state.pitch));
  drag.x = p.x; drag.y = p.y;
  applyRotation();
}, { passive: true });

window.addEventListener('mouseup',  () => { drag.active = false; });
window.addEventListener('touchend', () => { drag.active = false; });

// Scroll to zoom
canvas.addEventListener('wheel', e => {
  if (state.isVR) return;
  e.preventDefault();
  state.fov = Math.max(30, Math.min(120, state.fov + e.deltaY * 0.04));
  applyRotation();
}, { passive: false });

// ─────────────────────────────────────────────────────────
//  TEXTURE HELPERS
// ─────────────────────────────────────────────────────────

let activeDeviceId = null;

function disposeCurrentTexture() {
  if (mat.map) {
    mat.map.dispose();
    mat.map = null;
  }
  if (state._hls) {
    state._hls.destroy();
    state._hls = null;
  }
  // Stop any playing video / stream tracks
  if (state._video) {
    state._video.pause();
    state._video.srcObject = null;
    state._video.src = '';
    state._video = null;
  }
  if (state._stream) {
    state._stream.getTracks().forEach(t => t.stop());
    state._stream = null;
  }
  activeDeviceId = null;
  document.getElementById('live-btn').classList.remove('active');
}

/** Load a static equirectangular image URL → sphere texture */
export function setImageTexture(url) {
  disposeCurrentTexture();
  const loader = new THREE.TextureLoader();
  loader.load(
    url,
    tex => {
      tex.colorSpace      = THREE.SRGBColorSpace;
      tex.minFilter       = THREE.LinearMipmapLinearFilter;
      tex.magFilter       = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy      = renderer.capabilities.getMaxAnisotropy();
      mat.map = tex;
      mat.needsUpdate = true;
      state.source = 'upload';
      setStatus('360', 'ready');
      toast('Image loaded');
    },
    undefined,
    err => {
      console.error('[CN360] Image load failed', err);
      toast('Failed to load image');
      useDefaultTexture();
    }
  );
}

/** Load a live video stream URL → VideoTexture */
export function setLiveStream(url) {
  disposeCurrentTexture();
  setStatus('CONNECTING…', 'waiting');

  const video = document.createElement('video');
  video.crossOrigin  = 'anonymous';
  video.loop         = true;
  video.muted        = true;
  video.playsInline  = true;
  video.autoplay     = true;
  state._video = video;

  const isM3u8 = /\.m3u8($|\?)/i.test(url);
  const hasNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';

  const onReady = () => {
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter  = THREE.LinearFilter;
    tex.magFilter  = THREE.LinearFilter;
    mat.map = tex;
    mat.needsUpdate = true;
    video.play().catch(() => {});
    state.source = 'live';
    setStatus('LIVE', 'live');
    toast('Live stream connected');
    document.getElementById('live-btn').classList.add('active');
  };

  const onFail = () => {
    toast('Stream connection failed');
    setStatus('360', 'ready');
    document.getElementById('live-btn').classList.remove('active');
    useDefaultTexture();
  };

  // Most browsers (Chrome/Edge/Pico) don't support HLS natively — use hls.js.
  // Safari does support it natively, so prefer that path when available.
  if (isM3u8 && !hasNativeHls && window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ enableWorker: true });
    state._hls = hls;
    hls.on(window.Hls.Events.MANIFEST_PARSED, onReady);
    hls.on(window.Hls.Events.ERROR, (_evt, data) => {
      if (data.fatal) onFail();
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  } else {
    video.src = url;
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onFail);
  }
}

/** Procedural fallback equirectangular panorama */
function useDefaultTexture() {
  const W = 4096, H = 2048;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // Sky gradient
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0,    '#04060D');
  sky.addColorStop(0.42, '#080E1C');
  sky.addColorStop(0.5,  '#0C1018');
  sky.addColorStop(0.58, '#0E1208');
  sky.addColorStop(1,    '#06090A');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // Grid
  g.strokeStyle = 'rgba(0,198,255,0.07)';
  g.lineWidth   = 1;
  for (let i = 0; i <= 24; i++) {
    const x = (i / 24) * W;
    g.beginPath(); g.moveTo(x,0); g.lineTo(x,H); g.stroke();
  }
  for (let i = 0; i <= 12; i++) {
    const y = (i / 12) * H;
    g.beginPath(); g.moveTo(0,y); g.lineTo(W,y); g.stroke();
  }

  // Horizon
  const hY = H / 2;
  g.strokeStyle = 'rgba(0,198,255,0.3)';
  g.lineWidth   = 1.5;
  g.beginPath(); g.moveTo(0,hY); g.lineTo(W,hY); g.stroke();

  // Cardinal directions
  const cards = [
    {l:'N', d:0,   c:'#00C6FF', s:36},
    {l:'E', d:90,  c:'rgba(255,255,255,0.7)', s:28},
    {l:'S', d:180, c:'rgba(255,255,255,0.7)', s:28},
    {l:'W', d:270, c:'rgba(255,255,255,0.7)', s:28},
  ];
  cards.forEach(({l,d,c,s}) => {
    const x = (d/360)*W;
    g.fillStyle = c;
    g.font = `700 ${s}px Inter,sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(l, x, hY - 70);
  });

  // Degree marks
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.font = '500 16px Inter,sans-serif';
  for (let d = -180; d <= 180; d += 30) {
    const x = ((d+180)/360)*W;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(d+'°', x, hY+14);
  }

  // Stars
  for (let i = 0; i < 300; i++) {
    const sx = seededRand(i*3, 0, W);
    const sy = seededRand(i*3+1, 0, H*0.44);
    const sr = seededRand(i*3+2, 0.4, 1.8);
    g.fillStyle = `rgba(255,255,255,${seededRand(i*3+3,0.3,0.85)})`;
    g.beginPath(); g.arc(sx,sy,sr,0,Math.PI*2); g.fill();
  }

  // Landmarks
  const lms = [
    {label:'ALPHA',  deg:45,  lat:18,  col:'#FF6B6B'},
    {label:'BETA',   deg:90,  lat:-14, col:'#FFD93D'},
    {label:'GAMMA',  deg:180, lat:12,  col:'#A8E6CF'},
    {label:'DELTA',  deg:270, lat:-18, col:'#C3A6FF'},
  ];
  lms.forEach(({label,deg,lat,col}) => {
    const lx = (deg/360)*W;
    const ly = H*(0.5-lat/180);
    const bw=180, bh=54;
    g.fillStyle   = col+'1A';
    g.strokeStyle = col+'99';
    g.lineWidth   = 1.5;
    g.beginPath();
    g.roundRect(lx-bw/2, ly-bh/2, bw, bh, 8);
    g.fill(); g.stroke();
    g.fillStyle = col;
    g.font = '600 18px Inter,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('◆ '+label+' '+deg+'°', lx, ly);
  });

  // Pole labels
  [[H*0.04,'ZENITH ↑','#00C6FF'],[H*0.96,'NADIR ↓','#555E70']].forEach(([py,pl,pc]) => {
    g.fillStyle = pc;
    g.font = '700 20px Inter,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(pl, W/2, py);
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter  = THREE.LinearMipmapLinearFilter;
  tex.magFilter  = THREE.LinearFilter;
  tex.generateMipmaps = true;
  mat.map = tex;
  mat.needsUpdate = true;
  state.source = 'default';
}

function seededRand(seed, min, max) {
  const v = Math.sin(seed * 127.1) * 43758.5453;
  return min + (v - Math.floor(v)) * (max - min);
}

// ─────────────────────────────────────────────────────────
//  STATUS HELPERS
// ─────────────────────────────────────────────────────────

function setStatus(text, type = 'ready') {
  document.getElementById('status-text').textContent = text;
  const dot = document.getElementById('status-dot');
  dot.className = '';
  if (type === 'waiting') dot.classList.add('waiting');
  else if (type === 'live') dot.classList.add('live');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─────────────────────────────────────────────────────────
//  FILE UPLOAD
// ─────────────────────────────────────────────────────────

document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  setImageTexture(url);
  // Reset input so same file can be picked again
  e.target.value = '';
});

// ─────────────────────────────────────────────────────────
//  LIVE CAM MODAL — UVC + HLS tabs
// ─────────────────────────────────────────────────────────

const modal       = document.getElementById('live-modal');
const streamInput = document.getElementById('stream-url');

// ── TAB SWITCHER ──────────────────────────────────────────
document.querySelectorAll('.cam-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cam-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-uvc').style.display = tab === 'uvc' ? '' : 'none';
    document.getElementById('tab-hls').style.display = tab === 'hls' ? '' : 'none';
    if (tab === 'uvc') scanCameras();
  });
});

// ── OPEN MODAL ────────────────────────────────────────────
document.getElementById('live-btn').addEventListener('click', () => {
  modal.classList.add('open');
  scanCameras();
});

// ── CLOSE ─────────────────────────────────────────────────
function closeModal() { modal.classList.remove('open'); }
document.getElementById('live-cancel-btn').addEventListener('click', closeModal);
document.getElementById('live-cancel-btn-hls')?.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

// ── HLS CONNECT ───────────────────────────────────────────
document.getElementById('live-connect-btn').addEventListener('click', () => {
  const url = streamInput.value.trim();
  if (!url) { toast('Please enter a stream URL'); return; }
  closeModal();
  setStatus('WAITING…', 'waiting');
  setLiveStream(url);
});

// ── UVC CAMERA SCAN ───────────────────────────────────────

async function scanCameras() {
  const listEl    = document.getElementById('cam-list');
  const scanningEl = document.getElementById('cam-scanning');
  listEl.innerHTML = '';
  scanningEl.style.display = 'flex';

  try {
    // Request permission first so labels are available
    const probe = await navigator.mediaDevices.getUserMedia({ video: true });
    probe.getTracks().forEach(t => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras  = devices.filter(d => d.kind === 'videoinput');

    scanningEl.style.display = 'none';

    if (cameras.length === 0) {
      listEl.innerHTML = '<div class="cam-no-device">No cameras detected</div>';
      return;
    }

    cameras.forEach(dev => {
      const isActive = dev.deviceId === activeDeviceId;
      const item = document.createElement('div');
      item.className = 'cam-item' + (isActive ? ' active' : '');
      item.innerHTML = `
        <span class="cam-item-name">${dev.label || 'Camera ' + dev.deviceId.slice(0,6)}</span>
        <span class="cam-item-badge ${isActive ? 'live' : 'connect'}">${isActive ? 'LIVE' : 'CONNECT'}</span>
      `;
      item.addEventListener('click', () => {
        connectUVC(dev.deviceId, dev.label);
        closeModal();
      });
      listEl.appendChild(item);
    });

  } catch (err) {
    scanningEl.style.display = 'none';
    listEl.innerHTML = `<div class="cam-no-device">Camera permission denied<br><small>${err.message}</small></div>`;
  }
}

// ── CONNECT UVC DEVICE ────────────────────────────────────
async function connectUVC(deviceId, label) {
  disposeCurrentTexture();
  setStatus('CONNECTING…', 'waiting');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: deviceId },
        width:    { ideal: 3840 },
        height:   { ideal: 1920 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });

    const video = document.createElement('video');
    video.srcObject  = stream;
    video.muted      = true;
    video.playsInline = true;
    video.autoplay   = true;
    await video.play();

    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter  = THREE.LinearFilter;
    tex.magFilter  = THREE.LinearFilter;

    mat.map = tex;
    mat.needsUpdate = true;

    state._video    = video;
    state._stream   = stream;
    state.source    = 'live';
    activeDeviceId  = deviceId;

    const camName = label ? label.replace(/\s*\(.*\)/, '') : 'Camera';
    setStatus(camName.toUpperCase(), 'live');
    document.getElementById('live-btn').classList.add('active');
    toast(`${camName} connected`);

  } catch (err) {
    console.error('[CN360] UVC connect failed', err);
    toast('Failed to connect camera');
    setStatus('360 VIEWER', 'ready');
    useDefaultTexture();
  }
}

// ─────────────────────────────────────────────────────────
//  WEBXR
// ─────────────────────────────────────────────────────────

const vrBtn = document.getElementById('vr-btn');

async function initXR() {
  if (!navigator.xr) {
    showXRUnavailable(); return;
  }
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-vr');
    if (ok) {
      vrBtn.style.display = 'flex';
      vrBtn.addEventListener('click', toggleVR);
    } else {
      showXRUnavailable();
    }
  } catch {
    showXRUnavailable();
  }
}

function showXRUnavailable() {
  vrBtn.style.display = 'flex';
  vrBtn.style.opacity = '0.4';
  vrBtn.style.pointerEvents = 'none';
  vrBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    </svg>
    VR NOT AVAILABLE`;
}

let xrSession = null;

async function toggleVR() {
  if (renderer.xr.isPresenting) {
    await xrSession?.end();
    return;
  }
  try {
    xrSession = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    renderer.xr.setSession(xrSession);
    onVRStart();
    xrSession.addEventListener('end', onVREnd);
  } catch (err) {
    console.error('[CN360] VR request failed:', err);
    toast('Could not start VR session');
  }
}

function onVRStart() {
  state.isVR = true;
  document.body.classList.add('vr-on');
  vrBtn.classList.add('presenting');
  vrBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M2 8h20v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8z"/>
      <circle cx="8.5" cy="13" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="15.5" cy="13" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
    EXIT VR`;
}

function onVREnd() {
  state.isVR = false;
  xrSession  = null;
  document.body.classList.remove('vr-on');
  vrBtn.classList.remove('presenting');
  vrBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M2 8h20v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8z"/>
      <circle cx="8.5" cy="13" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="15.5" cy="13" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
    ENTER VR`;
  applyRotation();
}

// ─────────────────────────────────────────────────────────
//  RENDER LOOP
// ─────────────────────────────────────────────────────────

renderer.setAnimationLoop(() => {
  // Keep VideoTexture in sync when live
  if (mat.map instanceof THREE.VideoTexture) {
    mat.map.needsUpdate = true;
  }
  renderer.render(scene, camera);
});

// ─────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────

useDefaultTexture();
applyRotation();
setStatus('360 VIEWER', 'ready');
initXR();

console.log('[CN360] VR Viewer ready — Phase 1');
