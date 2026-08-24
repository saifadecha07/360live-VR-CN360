/**
 * GET /api/snapshot
 *
 * Parameters:
 *   yaw   – degrees, normalized to [-180,180]; in 180-mode clamped to [-90,90]
 *   pitch – degrees, clamped to [-90,90]
 *   fov   – degrees, clamped to [20,150]
 *   mode  – "360" (default) | "180"
 *   w     – output width  (default 640, max 1920)
 *   h     – output height (default 480, max 1080)
 *
 * Returns: JPEG image
 *
 * The equirectangular → perspective reprojection is done here server-side.
 * This endpoint verifies projection math independent of the Three.js viewer.
 */

import path  from 'path';
import fs    from 'fs';
import { createCanvas, loadImage } from 'canvas';

// ── PARAMETER PARSING ──────────────────────────────────────
function parseParams(query) {
  let yaw   = parseFloat(query.yaw)   || 0;
  let pitch = parseFloat(query.pitch) || 0;
  let fov   = parseFloat(query.fov)   || 90;
  const mode  = query.mode === '180' ? '180' : '360';
  const w   = Math.min(Math.max(parseInt(query.w)  || 640,  64), 1920);
  const h   = Math.min(Math.max(parseInt(query.h)  || 480,  64), 1080);

  // Normalize yaw to [-180, 180]
  yaw = yaw % 360;
  if (yaw > 180)  yaw -= 360;
  if (yaw < -180) yaw += 360;

  // 180 mode: clamp yaw to ±90
  if (mode === '180') {
    yaw = Math.max(-90, Math.min(90, yaw));
  }

  // Clamp pitch and fov
  pitch = Math.max(-90,  Math.min(90,  pitch));
  fov   = Math.max(20,   Math.min(150, fov));

  return { yaw, pitch, fov, mode, w, h };
}

// ── EQUIRECTANGULAR → PERSPECTIVE REPROJECTION ─────────────
/**
 * For each output pixel (px, py):
 *   1. Convert to normalized device coords [-1,1]
 *   2. Compute 3D ray direction in camera space using FOV
 *   3. Rotate ray by yaw/pitch
 *   4. Convert 3D direction to equirectangular (u,v)
 *   5. Sample from source image
 */
function reproject(srcImg, params, outCanvas) {
  const { yaw, pitch, fov, w, h } = params;

  const ctx    = outCanvas.getContext('2d');
  const srcW   = srcImg.width;
  const srcH   = srcImg.height;

  // Draw source to a temporary canvas to read pixels
  const tmpCanvas = createCanvas(srcW, srcH);
  const tmpCtx    = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(srcImg, 0, 0, srcW, srcH);
  const srcData = tmpCtx.getImageData(0, 0, srcW, srcH);
  const src     = srcData.data;

  const outData = ctx.createImageData(w, h);
  const out     = outData.data;

  // Pre-compute trig
  const yawRad   = yaw   * Math.PI / 180;
  const pitchRad = pitch * Math.PI / 180;
  const halfFovRad = (fov / 2) * Math.PI / 180;
  const focalLen = 1 / Math.tan(halfFovRad);   // normalized focal length

  // Rotation matrix: Ry(yaw) * Rx(-pitch)
  // R = Ry * Rx
  const cy = Math.cos(yawRad),   sy = Math.sin(yawRad);
  const cp = Math.cos(-pitchRad), sp = Math.sin(-pitchRad);

  // Ry * Rx:
  // [  cy,  sy*sp, sy*cp ]
  // [   0,     cp,   -sp ]
  // [ -sy,  cy*sp, cy*cp ]

  const R = [
    [  cy,  sy * sp,  sy * cp ],
    [   0,       cp,      -sp ],
    [ -sy,  cy * sp,  cy * cp ],
  ];

  const aspectRatio = w / h;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      // Normalized device coords [-1,1]
      const nx = (px / (w - 1)) * 2 - 1;
      const ny = 1 - (py / (h - 1)) * 2;

      // Ray in camera space (looking down +Z, right +X, up +Y)
      const dx = nx * aspectRatio;
      const dy = ny;
      const dz = focalLen;

      // Rotate into world space
      const wx = R[0][0]*dx + R[0][1]*dy + R[0][2]*dz;
      const wy = R[1][0]*dx + R[1][1]*dy + R[1][2]*dz;
      const wz = R[2][0]*dx + R[2][1]*dy + R[2][2]*dz;

      // Normalize
      const len = Math.sqrt(wx*wx + wy*wy + wz*wz);
      const rx = wx/len, ry = wy/len, rz = wz/len;

      // Equirectangular UV
      // longitude: atan2(rx, rz) → [-π, π]  maps to u [0,1]
      // latitude:  asin(ry)      → [-π/2, π/2] maps to v [0,1]
      const lon = Math.atan2(rx, rz);
      const lat = Math.asin(Math.max(-1, Math.min(1, ry)));

      const u = (lon / (2 * Math.PI) + 0.5);
      const v = (0.5 - lat / Math.PI);

      // Clamp and map to pixel
      const sx = Math.floor(Math.max(0, Math.min(srcW - 1, u * srcW)));
      const sy = Math.floor(Math.max(0, Math.min(srcH - 1, v * srcH)));

      const srcIdx = (sy * srcW + sx) * 4;
      const outIdx = (py * w    + px) * 4;

      out[outIdx]     = src[srcIdx];
      out[outIdx + 1] = src[srcIdx + 1];
      out[outIdx + 2] = src[srcIdx + 2];
      out[outIdx + 3] = 255;
    }
  }

  ctx.putImageData(outData, 0, 0);
}

// ── ASSET PATH ─────────────────────────────────────────────
const ASSET_DIR = path.join(process.cwd(), 'api', '_assets');
const EQUIRECT  = path.join(ASSET_DIR, 'equirect.jpg');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=30');

  const params = parseParams(req.query);
  const { w, h } = params;

  // Load equirect source
  let srcImg;
  try {
    srcImg = await loadImage(EQUIRECT);
  } catch (err) {
    // Fallback: generate procedural image if file missing
    try {
      srcImg = await loadImage(
        path.join(process.cwd(), 'public', 'equirect.jpg')
      );
    } catch (err2) {
      res.status(500).json({ error: 'equirect.jpg not found', detail: err2.message });
      return;
    }
  }

  // Create output canvas and reproject
  const outCanvas = createCanvas(w, h);
  reproject(srcImg, params, outCanvas);

  // Encode to JPEG
  const buf = outCanvas.toBuffer('image/jpeg', { quality: 0.92 });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('X-Snapshot-Yaw',   params.yaw);
  res.setHeader('X-Snapshot-Pitch', params.pitch);
  res.setHeader('X-Snapshot-Fov',   params.fov);
  res.setHeader('X-Snapshot-Mode',  params.mode);
  res.status(200).send(buf);
}
