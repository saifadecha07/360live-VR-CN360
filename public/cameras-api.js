/**
 * CN360Live — cameras-api.js
 *
 * Client-side API layer. Fetches camera list from /api/cameras
 * (or returns mock data when relay is not configured).
 *
 * Provides:
 *   fetchCameras(relayBase)   → Promise<Camera[]>
 *   startPolling(cb, ms)      → stopFn
 */

import { RELAY_BASE, CAMERA_REGISTRY } from './config.js';

/**
 * @typedef {{ id:string, name:string, model:string, path:string,
 *             type:string, status:string, streams:{hls:string,webrtc:string},
 *             message?:string }} Camera
 */

/**
 * Fetch current camera list + live status.
 * Uses /api/cameras with ?relay= param when relay is configured,
 * otherwise returns mock data immediately.
 *
 * @param {string} [relayBase]
 * @returns {Promise<Camera[]>}
 */
export async function fetchCameras(relayBase = RELAY_BASE) {
  if (!relayBase) {
    // Pure mock — no server call needed
    return CAMERA_REGISTRY.map((cam, i) => ({
      ...cam,
      status:  i === 0 ? 'waiting' : 'offline',
      streams: { hls: '', webrtc: '' },
      message: 'No relay configured',
    }));
  }

  const url = `/api/cameras?relay=${encodeURIComponent(relayBase)}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.cameras ?? [];
  } catch (err) {
    console.warn('[CN360] fetchCameras failed:', err.message);
    // Fallback: return all cameras as unreachable
    return CAMERA_REGISTRY.map(cam => ({
      ...cam,
      status:  'unreachable',
      streams: { hls: '', webrtc: '' },
      message: err.message,
    }));
  }
}

/**
 * Start auto-polling camera status.
 *
 * @param {(cameras: Camera[]) => void} callback
 * @param {number} intervalMs
 * @param {string} [relayBase]
 * @returns {() => void}  call to stop polling
 */
export function startPolling(callback, intervalMs = 4000, relayBase = RELAY_BASE) {
  let active = true;
  let timer  = null;

  async function poll() {
    if (!active) return;
    try {
      const cameras = await fetchCameras(relayBase);
      if (active) callback(cameras);
    } catch { /* already handled inside fetchCameras */ }
    if (active) timer = setTimeout(poll, intervalMs);
  }

  poll(); // immediate first fetch
  return () => {
    active = false;
    if (timer) clearTimeout(timer);
  };
}

/** Map status string to display label + CSS class */
export function statusInfo(status) {
  switch (status) {
    case 'streaming':   return { label: 'LIVE',        cls: 'live',    dot: '🟢' };
    case 'waiting':     return { label: 'WAITING',     cls: 'waiting', dot: '🟡' };
    case 'unreachable': return { label: 'UNREACHABLE', cls: 'offline', dot: '🔴' };
    case 'mock':        return { label: 'MOCK',        cls: 'waiting', dot: '🟡' };
    default:            return { label: 'OFFLINE',     cls: 'offline', dot: '🔴' };
  }
}

/** True if this camera can be viewed */
export function isViewable(camera) {
  return camera.status === 'streaming' || camera.status === 'waiting';
}
