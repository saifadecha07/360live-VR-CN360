/**
 * GET /api/camera-status
 *
 * Usage:
 *   /api/camera-status              → mock (Phase 1)
 *   /api/camera-status?relay=URL    → เช็ค MediaMTX API จริง
 *
 * ──────────────────────────────────────────────────────────
 * ข้อจำกัดสำคัญ (local + ngrok setup):
 *
 *   Vercel serverless function รันบน cloud ของ Vercel
 *   relay (MediaMTX) รันบนเครื่อง local ของผู้ใช้
 *
 *   การเช็คจะทำงานได้ก็ต่อเมื่อ:
 *     1. ผู้ใช้ expose ngrok HTTP tunnel สำหรับ port 9997
 *        แล้วส่ง URL นั้นมาใน ?relay= param
 *     2. หรือ relay รันบน VPS ที่มี public IP
 *
 *   ถ้าเครื่อง local ปิด หรือ ngrok URL เปลี่ยน (เกิดทุกครั้ง
 *   ที่ restart) → Vercel function จะเข้าไม่ถึง → คืน 'unreachable'
 *   ซึ่งเป็นพฤติกรรมที่ถูกต้อง ไม่ใช่ bug
 * ──────────────────────────────────────────────────────────
 */

const START = Date.now();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const relayBase = req.query.relay
    ? String(req.query.relay).replace(/\/$/, '')
    : null;

  // ── มี relay URL → เช็คสถานะจริงจาก MediaMTX API ──────────
  if (relayBase) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 3000);

      const r = await fetch(`${relayBase}/v3/paths/list`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(tid);

      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const data = await r.json();
      const paths = data.items ?? [];
      const x5    = paths.find(p => p.name === 'live/x5');
      const isLive = x5?.ready === true;

      return res.status(200).json({
        status:     isLive ? 'streaming' : 'waiting',
        source:     'relay',
        relay:      relayBase,
        path:       'live/x5',
        ready:      isLive,
        resolution: '3840x1920',
        fps:        30,
        uptime:     Math.floor((Date.now() - START) / 1000),
        message:    isLive
          ? 'Insta360 X5 stream active'
          : 'Relay reachable — waiting for camera to connect',
      });

    } catch (err) {
      // relay ไม่ตอบ: เครื่องปิด / ngrok URL เปลี่ยน / firewall block
      return res.status(200).json({
        status:  'unreachable',
        source:  'relay',
        relay:   relayBase,
        error:   err.name === 'AbortError' ? 'timeout (3s)' : err.message,
        uptime:  Math.floor((Date.now() - START) / 1000),
        message: 'Cannot reach relay — is the local relay running? ngrok URL may have changed.',
        hint:    'Make sure relay/start.bat is running and pass the current ngrok API URL as ?relay=',
      });
    }
  }

  // ── ไม่มี relay URL → mock Phase 1 ───────────────────────
  return res.status(200).json({
    status:     'waiting',
    source:     'mock',
    resolution: '3840x1920',
    fps:        30,
    uptime:     Math.floor((Date.now() - START) / 1000),
    message:    'No relay configured. Pass ?relay=<ngrok-api-url> to check live status.',
  });
};
