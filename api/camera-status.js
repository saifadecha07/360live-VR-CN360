/**
 * GET /api/camera-status
 * Mock camera telemetry
 */

const START = Date.now();

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  res.status(200).json({
    status:     'waiting',
    source:     'mock',
    resolution: '3840x1920',
    fps:        30,
    uptime:     Math.floor((Date.now() - START) / 1000),
    message:    'Waiting for camera connection',
  });
};
