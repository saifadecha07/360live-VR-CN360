/**
 * GET /api/camera-status
 * Mock camera telemetry — Phase 1
 * Phase 2: replace with real camera heartbeat
 */

const START = Date.now();

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  res.status(200).json({
    status:     'waiting',   // Phase 2: 'ready' | 'streaming' | 'error'
    source:     'mock',      // Phase 2: 'rtsp' | 'webrtc' | 'hls'
    resolution: '3840x1920',
    fps:        30,
    uptime:     Math.floor((Date.now() - START) / 1000),
    message:    'Waiting for camera connection',
  });
}
