/**
 * GET /api/camera-status
 *
 * ถ้าส่ง ?relay=https://stream.yourdomain.com จะพยายาม
 * เช็ค MediaMTX API (/v3/paths/list) แล้วคืนสถานะจริง
 *
 * ข้อจำกัด:
 *   Vercel serverless function อยู่บน infrastructure ของ Vercel
 *   (ไม่ใช่ VPS เดียวกับ relay) ดังนั้นการเช็คจะทำงานได้ก็ต่อเมื่อ
 *   relay server เปิด port 9997 หรือ expose ผ่าน HTTPS เท่านั้น
 *   ถ้า relay อยู่ใน private network / ไม่มี public URL → fallback mock
 */

const START = Date.now();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const relayBase = req.query.relay
    ? String(req.query.relay).replace(/\/$/, '')
    : null;

  // ── ถ้ามี relay URL → เช็คสถานะจริง ──────────────────────
  if (relayBase) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const apiRes = await fetch(`${relayBase}/v3/paths/list`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);

      if (!apiRes.ok) throw new Error(`HTTP ${apiRes.status}`);

      const data = await apiRes.json();

      // MediaMTX /v3/paths/list คืน { items: [ { name, ready, ... } ] }
      const paths = data.items ?? [];
      const x5 = paths.find(p => p.name === 'live/x5');

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
          : 'Relay reachable — waiting for camera',
      });
    } catch (err) {
      // relay ไม่ตอบ หรือ network ไม่ถึง → บอก client ตามตรง
      return res.status(200).json({
        status:  'unreachable',
        source:  'relay',
        relay:   relayBase,
        error:   err.name === 'AbortError' ? 'timeout' : err.message,
        message: 'Cannot reach relay API — check VPS firewall / port 9997',
        uptime:  Math.floor((Date.now() - START) / 1000),
      });
    }
  }

  // ── ไม่มี relay URL → mock (Phase 1) ─────────────────────
  return res.status(200).json({
    status:     'waiting',
    source:     'mock',
    resolution: '3840x1920',
    fps:        30,
    uptime:     Math.floor((Date.now() - START) / 1000),
    message:    'No relay configured — pass ?relay=https://... to check live status',
  });
};
