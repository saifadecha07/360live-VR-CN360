/**
 * CN360Live — panorama.js
 *
 * Reusable 360° equirectangular sphere renderer.
 * Extracted from the original viewer.js.
 *
 * Usage:
 *   const pano = new Panorama(canvas);
 *   pano.useDefaultTexture();
 *   pano.setLiveStream(url);
 *   pano.setImageTexture(url);
 *   pano.setXRSession(session);   // hand off to WebXR
 *   pano.destroy();
 */

import * as THREE from 'three';
import { SPHERE_SEGMENTS } from './config.js';

export class Panorama {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onStatus?: (text:string, type:string)=>void,
   *            onToast?:  (msg:string)=>void,
   *            onStreamConnected?: ()=>void,
   *            onStreamError?: (err:string)=>void,
   *            segments?: {w:number,h:number} }} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts   = opts;
    this._state = { yaw: 0, pitch: 0, fov: 90, isVR: false, source: 'none' };
    this._drag  = { active: false, x: 0, y: 0 };
    this._video = null;
    this._xrSession = null;

    const seg = opts.segments ?? SPHERE_SEGMENTS.viewer;

    // ── Renderer ──────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.xr.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping      = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // ── Scene ─────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(90, 1, 0.01, 1000);
    this.camera.position.set(0, 0, 0.001);
    this.scene.add(this.camera);

    // Inside-out sphere
    const geo = new THREE.SphereGeometry(50, seg.w, seg.h);
    geo.scale(-1, 1, 1);

    this.mat = new THREE.MeshBasicMaterial({
      side: THREE.FrontSide,
      depthWrite: false,
      color: 0xffffff,
    });

    this.sphere = new THREE.Mesh(geo, this.mat);
    this.scene.add(this.sphere);

    // ── Bind event handlers so we can remove them ─────────
    this._onResize     = this._resize.bind(this);
    this._onMouseDown  = this._mouseDown.bind(this);
    this._onTouchStart = this._touchStart.bind(this);
    this._onMouseMove  = this._mouseMove.bind(this);
    this._onTouchMove  = this._touchMove.bind(this);
    this._onMouseUp    = this._pointerUp.bind(this);
    this._onTouchEnd   = this._pointerUp.bind(this);
    this._onWheel      = this._wheel.bind(this);

    window.addEventListener('resize',     this._onResize);
    canvas.addEventListener('mousedown',  this._onMouseDown);
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
    window.addEventListener('mousemove',  this._onMouseMove);
    window.addEventListener('touchmove',  this._onTouchMove,  { passive: true });
    window.addEventListener('mouseup',    this._onMouseUp);
    window.addEventListener('touchend',   this._onTouchEnd);
    canvas.addEventListener('wheel',      this._onWheel, { passive: false });

    this._resize();
    this._startLoop();
  }

  // ── PUBLIC API ────────────────────────────────────────────

  /** Load procedural default panorama */
  useDefaultTexture() {
    this._disposeTexture();
    this._buildDefaultTexture();
    this._state.source = 'default';
    this._emitStatus('360 VIEWER', 'ready');
  }

  /** Load equirectangular image from URL */
  setImageTexture(url) {
    this._disposeTexture();
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      tex => {
        tex.colorSpace      = THREE.SRGBColorSpace;
        tex.minFilter       = THREE.LinearMipmapLinearFilter;
        tex.magFilter       = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy      = this.renderer.capabilities.getMaxAnisotropy();
        this.mat.map = tex;
        this.mat.needsUpdate = true;
        this._state.source = 'upload';
        this._emitStatus('360', 'ready');
        this._emitToast('Image loaded');
      },
      undefined,
      () => {
        this._emitToast('Failed to load image');
        this._buildDefaultTexture();
      }
    );
  }

  /**
   * Connect a live stream URL (HLS .m3u8 or WebRTC).
   * Falls back to default texture on error.
   */
  setLiveStream(url) {
    this._disposeTexture();
    this._emitStatus('CONNECTING…', 'waiting');

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.loop        = true;
    video.muted       = true;
    video.playsInline = true;
    video.autoplay    = true;
    video.src         = url;
    this._video = video;

    video.addEventListener('canplay', () => {
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter  = THREE.LinearFilter;
      tex.magFilter  = THREE.LinearFilter;
      this.mat.map = tex;
      this.mat.needsUpdate = true;
      video.play().catch(() => {});
      this._state.source = 'live';
      this._emitStatus('LIVE', 'live');
      this._emitToast('Live stream connected');
      this.opts.onStreamConnected?.();
    }, { once: true });

    video.addEventListener('error', () => {
      const msg = 'Stream connection failed';
      this._emitToast(msg);
      this._emitStatus('360', 'ready');
      this.opts.onStreamError?.(msg);
      this._buildDefaultTexture();
    }, { once: true });
  }

  /** Reset back to default panorama, stop any video */
  reset() {
    this._disposeTexture();
    this._buildDefaultTexture();
    this._state.source = 'default';
    this._state.yaw   = 0;
    this._state.pitch = 0;
    this._state.fov   = 90;
    this._applyRotation();
    this._emitStatus('360 VIEWER', 'ready');
  }

  /** Hand off to WebXR session */
  async setXRSession(session) {
    this.renderer.xr.setSession(session);
    this._state.isVR = true;
  }

  /** Resize renderer to current canvas parent size */
  forceResize() { this._resize(); }

  /** Clean up everything */
  destroy() {
    this._stopLoop();
    this._disposeTexture();
    this.renderer.dispose();

    window.removeEventListener('resize',    this._onResize);
    this.canvas.removeEventListener('mousedown',  this._onMouseDown);
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('touchmove', this._onTouchMove);
    window.removeEventListener('mouseup',   this._onMouseUp);
    window.removeEventListener('touchend',  this._onTouchEnd);
    this.canvas.removeEventListener('wheel', this._onWheel);
  }

  // ── INTERNAL ──────────────────────────────────────────────

  _resize() {
    const w = this.canvas.clientWidth  || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov    = this._state.fov;
    this.camera.updateProjectionMatrix();
  }

  _applyRotation() {
    if (this.renderer.xr.isPresenting) return;
    this.camera.quaternion.setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(this._state.pitch),
        THREE.MathUtils.degToRad(-this._state.yaw),
        0, 'YXZ'
      )
    );
    this.camera.fov = this._state.fov;
    this.camera.updateProjectionMatrix();
  }

  _getXY(e) {
    return e.touches
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : { x: e.clientX,            y: e.clientY };
  }

  _mouseDown(e) {
    if (this._state.isVR) return;
    this._drag.active = true;
    const p = this._getXY(e);
    this._drag.x = p.x; this._drag.y = p.y;
  }

  _touchStart(e) {
    if (this._state.isVR) return;
    this._drag.active = true;
    const p = this._getXY(e);
    this._drag.x = p.x; this._drag.y = p.y;
  }

  _mouseMove(e) {
    if (!this._drag.active || this._state.isVR) return;
    const p = this._getXY(e);
    this._state.yaw   -= (p.x - this._drag.x) * 0.22;
    this._state.pitch += (p.y - this._drag.y) * 0.16;
    this._state.pitch  = Math.max(-88, Math.min(88, this._state.pitch));
    this._drag.x = p.x; this._drag.y = p.y;
    this._applyRotation();
  }

  _touchMove(e) {
    if (!this._drag.active || this._state.isVR) return;
    const p = this._getXY(e);
    this._state.yaw   -= (p.x - this._drag.x) * 0.22;
    this._state.pitch += (p.y - this._drag.y) * 0.16;
    this._state.pitch  = Math.max(-88, Math.min(88, this._state.pitch));
    this._drag.x = p.x; this._drag.y = p.y;
    this._applyRotation();
  }

  _pointerUp() { this._drag.active = false; }

  _wheel(e) {
    if (this._state.isVR) return;
    e.preventDefault();
    this._state.fov = Math.max(30, Math.min(120, this._state.fov + e.deltaY * 0.04));
    this._applyRotation();
  }

  _startLoop() {
    this.renderer.setAnimationLoop(() => {
      if (this.mat.map instanceof THREE.VideoTexture) {
        this.mat.map.needsUpdate = true;
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  _stopLoop() {
    this.renderer.setAnimationLoop(null);
  }

  _disposeTexture() {
    if (this.mat.map) {
      this.mat.map.dispose();
      this.mat.map = null;
    }
    if (this._video) {
      this._video.pause();
      this._video.src = '';
      this._video = null;
    }
    this.mat.needsUpdate = true;
  }

  _buildDefaultTexture() {
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

    // Grid lines
    g.strokeStyle = 'rgba(0,198,255,0.07)';
    g.lineWidth   = 1;
    for (let i = 0; i <= 24; i++) {
      const x = (i / 24) * W;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    for (let i = 0; i <= 12; i++) {
      const y = (i / 12) * H;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }

    // Horizon
    const hY = H / 2;
    g.strokeStyle = 'rgba(0,198,255,0.3)';
    g.lineWidth   = 1.5;
    g.beginPath(); g.moveTo(0, hY); g.lineTo(W, hY); g.stroke();

    // Cardinal directions
    [
      { l: 'N', d: 0,   c: '#00C6FF',              s: 36 },
      { l: 'E', d: 90,  c: 'rgba(255,255,255,0.7)', s: 28 },
      { l: 'S', d: 180, c: 'rgba(255,255,255,0.7)', s: 28 },
      { l: 'W', d: 270, c: 'rgba(255,255,255,0.7)', s: 28 },
    ].forEach(({ l, d, c, s }) => {
      const x = (d / 360) * W;
      g.fillStyle = c;
      g.font = `700 ${s}px Inter,sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(l, x, hY - 70);
    });

    // Degree marks
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.font = '500 16px Inter,sans-serif';
    for (let d = -180; d <= 180; d += 30) {
      const x = ((d + 180) / 360) * W;
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText(d + '°', x, hY + 14);
    }

    // Stars
    for (let i = 0; i < 300; i++) {
      const sx = _seededRand(i * 3,     0,   W);
      const sy = _seededRand(i * 3 + 1, 0,   H * 0.44);
      const sr = _seededRand(i * 3 + 2, 0.4, 1.8);
      g.fillStyle = `rgba(255,255,255,${_seededRand(i * 3 + 3, 0.3, 0.85)})`;
      g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
    }

    // Landmarks
    [
      { label: 'ALPHA', deg: 45,  lat: 18,  col: '#FF6B6B' },
      { label: 'BETA',  deg: 90,  lat: -14, col: '#FFD93D' },
      { label: 'GAMMA', deg: 180, lat: 12,  col: '#A8E6CF' },
      { label: 'DELTA', deg: 270, lat: -18, col: '#C3A6FF' },
    ].forEach(({ label, deg, lat, col }) => {
      const lx = (deg / 360) * W;
      const ly = H * (0.5 - lat / 180);
      const bw = 180, bh = 54;
      g.fillStyle   = col + '1A';
      g.strokeStyle = col + '99';
      g.lineWidth   = 1.5;
      g.beginPath();
      g.roundRect(lx - bw / 2, ly - bh / 2, bw, bh, 8);
      g.fill(); g.stroke();
      g.fillStyle = col;
      g.font = '600 18px Inter,sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('◆ ' + label + ' ' + deg + '°', lx, ly);
    });

    // Pole labels
    [[H * 0.04, 'ZENITH ↑', '#00C6FF'], [H * 0.96, 'NADIR ↓', '#555E70']].forEach(([py, pl, pc]) => {
      g.fillStyle = pc;
      g.font = '700 20px Inter,sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(pl, W / 2, py);
    });

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter  = THREE.LinearMipmapLinearFilter;
    tex.magFilter  = THREE.LinearFilter;
    tex.generateMipmaps = true;
    this.mat.map = tex;
    this.mat.needsUpdate = true;
  }

  _emitStatus(text, type) {
    this.opts.onStatus?.(text, type);
  }

  _emitToast(msg) {
    this.opts.onToast?.(msg);
  }
}

function _seededRand(seed, min, max) {
  const v = Math.sin(seed * 127.1) * 43758.5453;
  return min + (v - Math.floor(v)) * (max - min);
}
