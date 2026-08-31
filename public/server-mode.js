/**
 * CN360Live — server-mode.js
 *
 * Server Live Mode:
 *   - Pulls stream directly from localhost:8888 (no relay URL needed)
 *   - Shows 360° preview using Panorama class
 *   - Polls MediaMTX API (localhost:9997) for live status
 *   - Displays shareable public URL (from localhost.run tunnel or LAN IP)
 *   - Records stream metrics (bitrate, uptime, viewers)
 */

import { Panorama } from './panorama.js';

// Local MediaMTX endpoints — always localhost when running as server
const LOCAL_HLS     = 'http://localhost:8888';
const LOCAL_API     = 'http://localhost:9997';
const STREAM_PATH   = 'live/x5';
const POLL_MS       = 3000;

export class ServerMode {
  /**
   * @param {{ onBack: ()=>void, toast: (msg:string)=>void }} opts
   */
  constructor(opts) {
    this.opts  = opts;
    this._pano = null;
    this._pollTimer  = null;
    this._startTime  = null;
    this._uptimeTimer = null;
    this._streaming  = false;

    // DOM refs
    this._canvas      = document.getElementById('srv-canvas');
    this._statusDot   = document.getElementById('srv-status-dot');
    this._statusText  = document.getElementById('srv-status-text');
    this._bitrateEl   = document.getElementById('srv-bitrate');
    this._uptimeEl    = document.getElementById('srv-uptime');
    this._pathEl      = document.getElementById('srv-path');
    this._shareUrl    = document.getElementById('srv-share-url');
    this._shareInput  = document.getElementById('srv-share-input');
    this._copyBtn     = document.getElementById('srv-copy-btn');
    this._overlay     = document.getElementById('srv-overlay');
    this._overlayIcon = document.getElementById('srv-overlay-icon');
    this._overlayTitle= document.getElementById('srv-overlay-title');
    this._overlayMsg  = document.getElementById('srv-overlay-msg');
    this._retryBtn    = document.getElementById('srv-retry-btn');

    document.getElementById('srv-back-btn')
      .addEventListener('click', () => this.opts.onBack());

    this._copyBtn.addEventListener('click', () => this._copyUrl());

    this._retryBtn.addEventListener('click', () => this._connect());
  }

  // ── PUBLIC ─────────────────────────────────────────────

  enter() {
    this._showOverlay('loading', 'Connecting to local stream…', '');
    this._connect();
    this._startPoll();
  }

  leave() {
    this._stopPoll();
    this._stopUptime();
    if (this._pano) { this._pano.destroy(); this._pano = null; }
    this._streaming = false;
  }

  // ── STREAM CONNECTION ──────────────────────────────────

  async _connect() {
    // Check MediaMTX is alive and path is ready
    const status = await this._fetchStatus();

    if (!status.reachable) {
      this._showOverlay('error',
        'MediaMTX Not Running',
        'Start the relay first:\n relay\\start.bat');
      this._setStatus('offline');
      return;
    }

    if (!status.ready) {
      this._showOverlay('waiting',
        'Waiting for Camera',
        'Relay is running. Connect a camera to start streaming.');
      this._setStatus('waiting');
      return;
    }

    // Stream is ready — build local HLS URL
    const url = `${LOCAL_HLS}/${STREAM_PATH}/index.m3u8`;
    this._loadStream(url);
  }

  _loadStream(url) {
    if (this._pano) { this._pano.destroy(); this._pano = null; }

    this._pano = new Panorama(this._canvas, {
      onStatus: (text, type) => {
        if (type === 'live') this._onStreamLive();
      },
      onToast: msg => this.opts.toast(msg),
      onStreamConnected: () => this._onStreamLive(),
      onStreamError: msg => {
        this._showOverlay('error', 'Stream Error', msg);
        this._setStatus('offline');
        this._streaming = false;
        this._stopUptime();
      },
    });

    this._pano.forceResize();
    this._pano.setLiveStream(url);
    this._setStatus('connecting');
    this._showOverlay('loading', 'Loading stream…', url);
  }

  _onStreamLive() {
    this._hideOverlay();
    this._setStatus('live');
    this._streaming = true;
    this._startTime = Date.now();
    this._startUptime();
    this._pathEl.textContent = STREAM_PATH;
  }

  // ── STATUS POLLING ─────────────────────────────────────

  _startPoll() {
    this._pollTimer = setInterval(() => this._poll(), POLL_MS);
  }

  _stopPoll() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  async _poll() {
    const status = await this._fetchStatus();

    // Update share URL display based on detected public URL
    this._updateShareUrl();

    // Update bitrate
    if (status.bytesIn != null) {
      const kbps = Math.round((status.bytesIn * 8) / 1024);
      this._bitrateEl.textContent = kbps > 0 ? `${kbps} kbps` : '—';
    }

    if (!status.reachable) {
      if (this._streaming) {
        this._showOverlay('error', 'Relay Disconnected', 'MediaMTX stopped responding.');
        this._setStatus('offline');
        this._streaming = false;
        this._stopUptime();
      }
      return;
    }

    if (!status.ready && this._streaming) {
      // Camera disconnected while viewing
      this._showOverlay('waiting', 'Camera Disconnected',
        'The camera stopped streaming. Waiting for reconnect…');
      this._setStatus('waiting');
      this._streaming = false;
      this._stopUptime();
      return;
    }

    if (status.ready && !this._streaming) {
      // Camera reconnected — reload stream
      this._connect();
    }
  }

  async _fetchStatus() {
    try {
      const r = await fetch(`${LOCAL_API}/v3/paths/list`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) return { reachable: false };
      const data  = await r.json();
      const items = data.items ?? [];
      const path  = items.find(p => p.name === STREAM_PATH);
      return {
        reachable: true,
        ready:     path?.ready === true,
        bytesIn:   path?.bytesReceived ?? 0,
      };
    } catch {
      return { reachable: false };
    }
  }

  // ── SHARE URL ──────────────────────────────────────────

  _updateShareUrl() {
    // Try to derive public URL from current page location
    // If served via tunnel, window.location.hostname is the tunnel host
    const loc = window.location;

    let relayBase = '';

    // Check ?relay= param first
    const relayParam = new URLSearchParams(loc.search).get('relay');
    if (relayParam) {
      relayBase = relayParam.replace(/\/$/, '');
    } else if (loc.hostname !== 'localhost' && loc.hostname !== '127.0.0.1') {
      // Running through a tunnel — use same host
      relayBase = `${loc.protocol}//${loc.host}`;
    } else {
      // Local only — use LAN IP if available
      relayBase = `${loc.protocol}//${loc.hostname}:8888`;
    }

    if (relayBase) {
      const viewUrl = `${loc.protocol}//${loc.host}${loc.pathname}?relay=${encodeURIComponent(relayBase)}`;
      const hlsUrl  = `${relayBase}/${STREAM_PATH}/index.m3u8`;
      this._shareInput.value = viewUrl;
      this._shareUrl.classList.remove('hidden');
      this._shareInput.dataset.hls = hlsUrl;
    }
  }

  async _copyUrl() {
    const val = this._shareInput.value;
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      this._copyBtn.textContent = 'Copied!';
      setTimeout(() => { this._copyBtn.textContent = 'Copy'; }, 2000);
    } catch {
      this._shareInput.select();
      this.opts.toast('Copy failed — select the URL manually');
    }
  }

  // ── UPTIME ─────────────────────────────────────────────

  _startUptime() {
    this._uptimeTimer = setInterval(() => {
      if (!this._startTime) return;
      const s = Math.floor((Date.now() - this._startTime) / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      this._uptimeEl.textContent =
        h > 0
          ? `${h}h ${String(m).padStart(2,'0')}m`
          : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    }, 1000);
  }

  _stopUptime() {
    if (this._uptimeTimer) { clearInterval(this._uptimeTimer); this._uptimeTimer = null; }
    this._uptimeEl.textContent = '—';
  }

  // ── UI HELPERS ─────────────────────────────────────────

  _setStatus(type) {
    this._statusDot.className  = `status-dot ${type === 'live' ? 'status-dot--live' : type === 'waiting' ? 'status-dot--waiting' : ''}`;
    this._statusText.textContent =
      type === 'live'       ? 'Live'       :
      type === 'waiting'    ? 'Waiting'    :
      type === 'connecting' ? 'Connecting' : 'Offline';
  }

  _showOverlay(type, title, msg) {
    this._overlay.classList.remove('hidden');
    this._overlayTitle.textContent = title;
    this._overlayMsg.textContent   = msg ?? '';
    this._retryBtn.classList.toggle('hidden', type !== 'error');

    const icons = {
      loading: '<div class="spinner"></div>',
      waiting: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFD000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      error:   '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFD000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    };
    this._overlayIcon.innerHTML = icons[type] ?? icons.loading;
  }

  _hideOverlay() {
    this._overlay.classList.add('hidden');
  }
}
