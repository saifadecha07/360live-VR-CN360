/**
 * GET /api/cameras
 *
 * Returns the full camera list with live status from MediaMTX.
 *
 * Query params:
 *   ?relay=URL   Base URL of the MediaMTX HTTP tunnel (ngrok or VPS)
 *                e.g. https://abc123.ngrok.io  (port 8888 tunnel)
 *                The API port 9997 is derived by replacing :8888 with :9997,
 *                or for ngrok tunnels a separate ?api=URL can be passed.
 *   ?api=URL     Explicit MediaMTX API base (port 9997 tunnel) — optional.
 *                If omitted, derived from relay URL.
 *
 * Response shape:
 *   { cameras: [ { id, name, model, path, type, status, streams } ] }
 *
 * Status values: "streaming" | "waiting" | "unreachable" | "mock"
 */

// Camera registry — mirrors public/config.js CAMERA_REGISTRY
// (Serverless functions cannot import browser ES modules directly.)
const CAMERA_REGISTRY = [
  { id: 'x5-01', name: 'Camera 01', model: 'Insta360 X5', path: 'live/x5',    type: '360' },
  // { id: 'x5-02', name: 'Camera 02', model: 'Insta360 X5', path: 'live/x5-02', type: '360' },
];

const START = Date.now();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const relayBase = req.query.relay
    ? String(req.query.relay).replace(/\/$/, '')
    : null;

  // Derive MediaMTX API base from relay URL
  // Relay tunnel points at port 8888 (HLS); API is on 9997.
  // For ngrok: pass a second tunnel as ?api= since each tunnel is unique.
  const apiBase = req.query.api
    ? String(req.query.api).replace(/\/$/, '')
    : (relayBase ? relayBase.replace(':8888', ':9997') : null);

  // ── MOCK mode — no relay configured ────────────────────────────
  if (!relayBase) {
    return res.status(200).json({
      source: 'mock',
      uptime: Math.floor((Date.now() - START) / 1000),
      cameras: CAMERA_REGISTRY.map((cam, i) => ({
        ...cam,
        status: i === 0 ? 'waiting' : 'offline',
        streams: buildStreamUrls(cam, ''),
        message: 'No relay configured. Pass ?relay=<ngrok-hls-url> to check live status.',
      })),
    });
  }

  // ── LIVE mode — query MediaMTX /v3/paths/list ──────────────────
  let paths = [];
  let relayReachable = false;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 4000);

    const r = await fetch(`${apiBase}/v3/paths/list`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(tid);

    if (!r.ok) throw new Error(`MediaMTX API returned HTTP ${r.status}`);

    const data = await r.json();
    paths = data.items ?? [];
    relayReachable = true;

  } catch (err) {
    // Relay unreachable — return all cameras as unreachable
    return res.status(200).json({
      source: 'relay',
      relay:  relayBase,
      relayReachable: false,
      uptime: Math.floor((Date.now() - START) / 1000),
      error:  err.name === 'AbortError' ? 'timeout (4s)' : err.message,
      hint:   'Make sure relay/start.bat is running and the ngrok URL is current.',
      cameras: CAMERA_REGISTRY.map(cam => ({
        ...cam,
        status: 'unreachable',
        streams: buildStreamUrls(cam, relayBase),
      })),
    });
  }

  // ── Map each registered camera to its MediaMTX path status ────
  const cameras = CAMERA_REGISTRY.map(cam => {
    const pathEntry = paths.find(p => p.name === cam.path);
    const isLive    = pathEntry?.ready === true;

    return {
      ...cam,
      status:  isLive ? 'streaming' : 'waiting',
      ready:   isLive,
      streams: buildStreamUrls(cam, relayBase),
      message: isLive
        ? `${cam.name} stream active`
        : `Relay reachable — waiting for ${cam.name} to connect`,
    };
  });

  return res.status(200).json({
    source:         'relay',
    relay:          relayBase,
    relayReachable: true,
    uptime:         Math.floor((Date.now() - START) / 1000),
    cameras,
  });
};

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────

function buildStreamUrls(cam, relayBase) {
  if (!relayBase) return { hls: '', webrtc: '' };
  const base = relayBase.replace(/\/$/, '');
  return {
    hls:    `${base}/${cam.path}/index.m3u8`,
    webrtc: `${base.replace(':8888', ':8889')}/${cam.path}`,
  };
}
