/**
 * CN360Live — pc-mode.js
 *
 * PC Mode controller:
 *   - Shows camera list with live status
 *   - On camera select → spins up Panorama viewer in pc-canvas
 *   - Handles fullscreen, optional Enter VR
 *   - Auto-polls camera status every POLL_INTERVAL_MS
 */

import { Panorama }                         from './panorama.js';
import { fetchCameras, startPolling, statusInfo, isViewable } from './cameras-api.js';
import { getBestStreamUrl, POLL_INTERVAL_MS } from './config.js';

export class PCMode {
  /**
   * @param {{ onBack: ()=>void, toast: (msg:string)=>void,
   *            relay: string }} opts
   */
  constructor(opts) {
    this.opts     = opts;
    this._pano    = null;
    this._stopPoll = null;
    this._currentCamera = null;
    this._xrSession     = null;
    this._vrAvailable   = false;

    // DOM refs
    this._listEl    = document.getElementById('pc-cameras');
    this._listPanel = document.getElementById('pc-camera-list');
    this._viewPanel = document.getElementById('pc-viewer-panel');
    this._canvas    = document.getElementById('pc-canvas');
    this._overlay   = document.getElementById('pc-viewer-overlay');
    this._overlayIcon  = document.getElementById('pc-overlay-icon');
    this._overlayTitle = document.getElementById('pc-overlay-title');
    this._overlayMsg   = document.getElementById('pc-overlay-msg');
    this._retryBtn     = document.getElementById('pc-retry-btn');
    this._statusDot    = document.getElementById('pc-status-dot');
    this._statusText   = document.getElementById('pc-status-text');
    this._pollDot      = document.getElementById('pc-poll-dot');
    this._vrBtn        = document.getElementById('pc-vr-btn');
    this._fsBtn        = document.getElementById('pc-fullscreen-btn');
    this._viewerBackBtn = document.getElementById('pc-viewer-back-btn');

    document.getElementById('pc-back-btn')
      .addEventListener('click', () => this.opts.onBack());

    this._viewerBackBtn
      .addEventListener('click', () => this._closeViewer());

    this._retryBtn.addEventListener('click', () => {
      if (this._currentCamera) this._openViewer(this._currentCamera);
    });

    this._fsBtn.addEventListener('click', () => this._toggleFullscreen());

    this._checkXR();
  }

  /** Called when PC screen becomes visible */
  async enter() {
    this._showList();
    this._loadCameras();
    this._startPolling();
  }

  /** Called when leaving PC mode */
  leave() {
    this._stopPolling();
    if (this._pano) { this._pano.destroy(); this._pano = null; }
    if (this._xrSession) { this._xrSession.end().catch(() => {}); this._xrSession = null; }
    this._showList();
  }

  // ── CAMERA LIST ───────────────────────────────────────────

  async _loadCameras() {
    this._listEl.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div><span>Loading cameras…</span>
      </div>`;
    const cameras = await fetchCameras(this.opts.relay);
    this._renderCameraList(cameras);
  }

  _renderCameraList(cameras) {
    if (!cameras.length) {
      this._listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No Cameras Found</div>
          <div>No active cameras were detected.<br>Make sure the relay is running.</div>
        </div>`;
      return;
    }
    this._listEl.innerHTML = cameras.map(cam => {
      const info    = statusInfo(cam.status);
      const canView = isViewable(cam);
      return `
        <button
          class="camera-card ${canView ? '' : 'camera-card--disabled'}"
          data-id="${cam.id}"
          ${canView ? '' : 'disabled'}
          role="listitem"
          aria-label="${cam.name} — ${info.label}"
        >
          <div class="camera-card-top">
            <div class="camera-card-name">${cam.name}</div>
            <div class="camera-card-status status--${info.cls}">
              <span class="status-dot-sm ${info.cls === 'live' ? 'status-dot-sm--live' : ''}" aria-hidden="true"></span>
              ${info.label}
            </div>
          </div>
          <div class="camera-card-model">${cam.model}</div>
          <div class="camera-card-type">${cam.type.toUpperCase()} · 3840×1920</div>
          <div class="camera-card-action">
            ${canView
              ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg> View Camera`
              : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Unavailable`
            }
          </div>
        </button>`;
    }).join('');

    this._listEl.querySelectorAll('.camera-card:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const cam = cameras.find(c => c.id === btn.dataset.id);
        if (cam) this._openViewer(cam);
      });
    });
  }

  _startPolling() {
    this._stopPoll = startPolling(cameras => {
      // Pulse the poll indicator
      this._pollDot?.classList.add('pulse');
      setTimeout(() => this._pollDot?.classList.remove('pulse'), 400);

      // If viewer panel is open — check if current camera went offline
      if (!this._viewPanel.classList.contains('hidden')) {
        if (this._currentCamera) {
          const current = cameras.find(c => c.id === this._currentCamera.id);
          if (current && !isViewable(current)) {
            this._showOverlay('error', 'Connection Lost',
              `${this._currentCamera.name} is no longer streaming.`);
          }
        }
        return; // don't re-render list while viewer is open
      }

      // List panel is open — refresh cards
      this._renderCameraList(cameras);
    }, POLL_INTERVAL_MS, this.opts.relay);
  }

  _stopPolling() {
    this._stopPoll?.();
    this._stopPoll = null;
  }

  // ── VIEWER ────────────────────────────────────────────────

  _openViewer(camera) {
    this._currentCamera = camera;
    this._showViewer();
    this._showOverlay('loading', 'Connecting…', `Loading ${camera.name}`);

    // Destroy previous pano if any
    if (this._pano) { this._pano.destroy(); this._pano = null; }

    this._pano = new Panorama(this._canvas, {
      onStatus: (text, type) => this._setStatus(text, type),
      onToast:  msg => this.opts.toast(msg),
      onStreamConnected: () => {
        this._hideOverlay();
        this._setStatus('LIVE', 'live');
      },
      onStreamError: msg => {
        this._showOverlay('error', 'Stream Unavailable', msg);
      },
    });

    // Trigger resize now pano exists
    this._pano.forceResize();

    const url = getBestStreamUrl(camera, this.opts.relay);

    if (!url) {
      // No relay — show default panorama with waiting status
      this._pano.useDefaultTexture();
      this._showOverlay('waiting',
        'Waiting for Stream',
        'Configure relay URL to connect to a live camera.');
      this._setStatus('WAITING', 'waiting');
    } else {
      this._pano.setLiveStream(url);
    }
  }

  _closeViewer() {
    if (this._pano) { this._pano.destroy(); this._pano = null; }
    this._currentCamera = null;
    this._hideOverlay();
    this._showList();
    // Refresh camera list
    this._loadCameras();
  }

  // ── XR ────────────────────────────────────────────────────

  async _checkXR() {
    if (!navigator.xr) return;
    try {
      const ok = await navigator.xr.isSessionSupported('immersive-vr');
      if (ok) {
        this._vrAvailable = true;
        this._vrBtn.style.display = 'flex';
        this._vrBtn.addEventListener('click', () => this._toggleVR());
      }
    } catch { /* XR not available */ }
  }

  async _toggleVR() {
    if (!this._vrAvailable || !this._pano) return;
    if (this._pano.renderer.xr.isPresenting) {
      await this._xrSession?.end();
      return;
    }
    try {
      this._xrSession = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      this._pano.setXRSession(this._xrSession);
      document.body.classList.add('vr-on');
      this._vrBtn.classList.add('active');
      this._xrSession.addEventListener('end', () => {
        document.body.classList.remove('vr-on');
        this._vrBtn.classList.remove('active');
        this._pano._state.isVR = false;
        this._xrSession = null;
      });
    } catch (err) {
      this.opts.toast('Could not start VR session');
      console.error('[CN360] VR error:', err);
    }
  }

  // ── HELPERS ───────────────────────────────────────────────

  _showList() {
    this._listPanel.classList.remove('hidden');
    this._viewPanel.classList.add('hidden');
  }

  _showViewer() {
    this._listPanel.classList.add('hidden');
    this._viewPanel.classList.remove('hidden');
  }

  _setStatus(text, type) {
    if (this._statusText) this._statusText.textContent = text;
    if (this._statusDot) {
      this._statusDot.className = 'status-dot';
      if (type === 'waiting') this._statusDot.classList.add('status-dot--waiting');
      else if (type === 'live') this._statusDot.classList.add('status-dot--live');
    }
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

  _toggleFullscreen() {
    if (!document.fullscreenElement) {
      this._viewPanel.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }
}
