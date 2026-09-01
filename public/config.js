/**
 * CN360Live — Central Configuration
 *
 * All URLs, camera definitions, and stream-building logic live here.
 * Change the relay URL or camera list in one place.
 *
 * Environment override via query param:
 *   ?relay=https://your-ngrok-url    overrides RELAY_BASE at runtime
 *   ?debug=1                         activates developer mode
 */

// ─────────────────────────────────────────────────────────
//  RELAY BASE URL
//  Set to your current ngrok HTTP tunnel (HLS port 8888).
//  Override at runtime with ?relay=https://... in the URL.
//  Leave empty to use mock / offline mode.
// ─────────────────────────────────────────────────────────

const _params      = new URLSearchParams(window.location.search);
const _relayParam  = _params.get('relay');
const _apiParam    = _params.get('api');

export const RELAY_BASE = (_relayParam
  ? _relayParam.replace(/\/$/, '')
  : 'https://ripe-pretty-pottery-aware.trycloudflare.com'   // ← current relay tunnel (HLS :8888)
);

// MediaMTX API base (port 9997). Needed separately because tunnel hosts
// (localhost.run / ngrok) don't share a port-based URL pattern with HLS.
export const API_BASE = (_apiParam
  ? _apiParam.replace(/\/$/, '')
  : 'https://keyboard-specs-smilies-studios.trycloudflare.com'   // ← current relay tunnel (API :9997)
);

// Whether to use mock data when relay is not configured
export const USE_MOCK = !RELAY_BASE;

// Developer / debug mode
export const DEBUG_MODE = _params.get('debug') === '1';

// ─────────────────────────────────────────────────────────
//  CAMERA REGISTRY
//  Add / remove cameras here. Each entry maps to a MediaMTX path.
//  In a real multi-camera setup every entry gets its own path.
// ─────────────────────────────────────────────────────────

export const CAMERA_REGISTRY = [
  {
    id:    'x5-01',
    name:  'Camera 01',
    model: 'Insta360 X5',
    path:  'live/x5',      // MediaMTX path
    type:  '360',
  },
  // Add more cameras here, e.g.:
  // { id: 'x5-02', name: 'Camera 02', model: 'Insta360 X5', path: 'live/x5-02', type: '360' },
];

// ─────────────────────────────────────────────────────────
//  STREAM URL BUILDER
//  Single place that constructs HLS / WebRTC URLs.
//  Swap the logic here if your relay changes structure.
// ─────────────────────────────────────────────────────────

/**
 * Build stream URLs for a given camera config object.
 * @param {{ path: string }} camera
 * @param {string} [relayBase]  Override relay base URL
 * @returns {{ hls: string, webrtc: string, apiBase: string }}
 */
export function getCameraStreamUrls(camera, relayBase = RELAY_BASE) {
  const base = relayBase.replace(/\/$/, '');
  return {
    hls:     base ? `${base}/${camera.path}/index.m3u8` : '',
    webrtc:  base ? `${base.replace(':8888', ':8889')}/${camera.path}` : '',
    apiBase: base ? API_BASE : '',
  };
}

/**
 * Best available stream URL for a camera.
 * Prefer HLS (wider compatibility). WebRTC path kept for future use.
 */
export function getBestStreamUrl(camera, relayBase = RELAY_BASE) {
  const urls = getCameraStreamUrls(camera, relayBase);
  return urls.hls;
}

// ─────────────────────────────────────────────────────────
//  POLLING CONFIG
// ─────────────────────────────────────────────────────────

export const POLL_INTERVAL_MS = 4000;   // camera status poll interval

// ─────────────────────────────────────────────────────────
//  VISUAL / PERFORMANCE
// ─────────────────────────────────────────────────────────

export const SPHERE_SEGMENTS = {
  lobby:  { w: 32,  h: 16  },   // low-poly for lobby bg
  viewer: { w: 64,  h: 32  },   // 360 viewer (Pico 4 safe)
};
