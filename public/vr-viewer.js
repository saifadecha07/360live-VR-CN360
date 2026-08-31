/**
 * CN360Live — vr-viewer.js
 *
 * VR-mode 360° viewer.
 * Wraps Panorama class, adds WebXR session management and
 * the floating back-to-lobby HUD.
 */

import { Panorama }    from './panorama.js';
import { getBestStreamUrl } from './config.js';

export class VRViewer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onBack: ()=>void, toast: (msg:string)=>void, relay: string }} opts
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts   = opts;
    this._pano  = null;
    this._xrSession = null;
    this._currentCamera = null;
    this._vrAvailable   = false;

    // HUD elements
    this._hud        = document.getElementById('vr-viewer-hud');
    this._hudName    = document.getElementById('vr-viewer-cam-name');
    this._hudStatus  = document.getElementById('vr-viewer-status');
    this._overlay    = document.getElementById('vr-viewer-overlay');
    this._overlayIcon  = document.getElementById('vr-overlay-icon');
    this._overlayTitle = document.getElementById('vr-overlay-title');
    this._overlayMsg   = document.getElementById('vr-overlay-msg');
    this._retryBtn     = document.getElementById('vr-retry-btn');
    this._enterXRBtn   = document.getElementById('vr-enter-xr-btn');

    document.getElementById('vr-back-btn')
      .addEventListener('click', () => this._handleBack());

    this._retryBtn.addEventListener('click', () => {
      if (this._currentCamera) this.loadCamera(this._currentCamera);
    });

    this._checkXR();
  }

  // ── PUBLIC API ────────────────────────────────────────────

  /**
   * Load a camera into the 360° viewer.
   * @param {object} camera  Camera object from cameras-api
   */
  async loadCamera(camera) {
    this._currentCamera = camera;

    // Show the VR viewer HUD
    this._hud.classList.remove('hidden');
    this._hudName.textContent = camera.name.toUpperCase();
    this._setHudStatus('CONNECTING', 'waiting');
    this._showOverlay('loading', 'Connecting…', `Loading ${camera.name}`);

    // Destroy previous pano if any
    if (this._pano) { this._pano.destroy(); this._pano = null; }

    this._pano = new Panorama(this.canvas, {
      onStatus: (text, type) => this._setHudStatus(text, type),
      onToast:  msg => this.opts.toast(msg),
      onStreamConnected: () => {
        this._hideOverlay();
        this._setHudStatus('LIVE', 'live');
      },
      onStreamError: msg => {
        this._showOverlay('error', 'Stream Unavailable', msg);
        this._setHudStatus('ERROR', 'waiting');
      },
    });

    const url = getBestStreamUrl(camera, this.opts.relay);

    if (!url) {
      this._pano.useDefaultTexture();
      this._showOverlay('waiting', 'Waiting for Stream',
        'Configure relay URL to connect to a live camera.');
      this._setHudStatus('WAITING', 'waiting');
    } else {
      this._pano.setLiveStream(url);
    }
  }

  /** Properly tear down viewer and return to lobby */
  unload() {
    this._hud.classList.add('hidden');
    this._hideOverlay();
    if (this._xrSession) {
      this._xrSession.end().catch(() => {});
      this._xrSession = null;
    }
    if (this._pano) { this._pano.destroy(); this._pano = null; }
    this._currentCamera = null;
  }

  forceResize() { this._pano?.forceResize(); }

  // ── XR ────────────────────────────────────────────────────

  async _checkXR() {
    if (!navigator.xr) return;
    try {
      const ok = await navigator.xr.isSessionSupported('immersive-vr');
      if (ok) {
        this._vrAvailable = true;
        this._enterXRBtn.style.display = 'flex';
        this._enterXRBtn.addEventListener('click', () => this._toggleXR());
      }
    } catch { /* XR not available */ }
  }

  async _toggleXR() {
    if (!this._pano) return;
    if (this._pano.renderer.xr.isPresenting) {
      await this._xrSession?.end();
      return;
    }
    try {
      this._xrSession = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      await this._pano.setXRSession(this._xrSession);
      document.body.classList.add('vr-on');
      this._enterXRBtn.textContent = 'EXIT XR';
      this._xrSession.addEventListener('end', () => {
        document.body.classList.remove('vr-on');
        this._enterXRBtn.textContent = 'ENTER XR';
        this._pano._state.isVR = false;
        this._xrSession = null;
      });
    } catch (err) {
      this.opts.toast('Could not start VR session');
      console.error('[CN360] XR error:', err);
    }
  }

  // ── HUD ────────────────────────────────────────────────────

  _setHudStatus(text, type) {
    // HUD status element may contain either a status-dot or status-dot-sm
    const dot  = this._hudStatus.querySelector('.status-dot, .status-dot-sm');
    const span = this._hudStatus.querySelector('span');
    if (dot) {
      // Normalise to status-dot-sm class set
      dot.className = 'status-dot-sm';
      if (type === 'live')    dot.classList.add('status-dot-sm--live');
      if (type === 'waiting') dot.classList.add('status-dot-sm--waiting');
    }
    if (span) span.textContent = text;
  }

  _showOverlay(type, title, msg) {
    this._overlay.classList.remove('hidden');
    this._overlayTitle.textContent = title;
    this._overlayMsg.textContent   = msg ?? '';

    if (type === 'loading') {
      this._overlayIcon.innerHTML = '<div class="spinner"></div>';
      this._retryBtn.classList.add('hidden');
    } else if (type === 'waiting') {
      this._overlayIcon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFD000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
      this._retryBtn.classList.add('hidden');
    } else {
      this._overlayIcon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFD000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      this._retryBtn.classList.remove('hidden');
    }
  }

  _hideOverlay() {
    this._overlay.classList.add('hidden');
  }

  _handleBack() {
    this.unload();
    this.opts.onBack();
  }
}
