# CN360live

360° VR Spatial Camera Viewer — Three.js + WebXR (Pico 4 compatible)  
Deploy: Vercel static hosting · Relay: MediaMTX on VPS

---

## Features

- Full-screen equirectangular 360° sphere viewer
- Mouse / touch drag · scroll / pinch to zoom
- Upload any local 360° image
- Live camera stream via HLS or WebRTC URL
- ENTER VR — WebXR immersive-vr with head tracking

---

## Quick Start (local)

No build step needed. Open `public/index.html` directly in a browser,  
or use any static file server:

```bash
npx serve public
```

---

## Deploy to Vercel

1. Connect repo `saifadecha07/CN360live` to Vercel
2. **Project Settings → Build & Output Settings:**
   - Framework Preset: `Other`
   - Output Directory: `public`
   - Build Command: *(empty)*
   - Install Command: *(empty)*
3. Deploy — done

---

## Live Streaming Setup (Insta360 X5)

```
Insta360 X5
    │  RTMP
    ▼
MediaMTX (VPS / Docker)
    ├─── HLS  → https://stream.yourdomain.com/live/x5/index.m3u8
    └─── WebRTC → https://stream.yourdomain.com/live/x5  (WHEP)
                                │
                                ▼
                    CN360Live viewer (Vercel)
                    วางใน "Stream URL" แล้วกด CONNECT
```

### Step 1 — เตรียม VPS

- เช่า VPS ที่รัน Linux (Ubuntu 22.04 แนะนำ)
- ติดตั้ง Docker + Docker Compose
- เปิด port ใน firewall:

| Port | Protocol | ใช้ทำอะไร |
|------|----------|-----------|
| 1935 | TCP | RTMP รับจาก Insta360 |
| 8888 | TCP | HLS ขาออก |
| 8889 | TCP | WebRTC signaling |
| 8189 | UDP | WebRTC ICE media |
| 80 / 443 | TCP | Caddy HTTPS (ถ้าใช้) |

### Step 2 — รัน Relay

```bash
git clone https://github.com/saifadecha07/CN360live.git
cd CN360live/relay

# (ถ้าต้องการ HTTPS ให้แก้ Caddyfile ก่อน แล้ว uncomment caddy ใน docker-compose.yml)

docker compose up -d
```

ตรวจสอบว่า relay ทำงาน:

```bash
docker compose logs -f mediamtx
# หรือ
curl http://YOUR_VPS_IP:9997/v3/paths/list
```

### Step 3 — ตั้งค่า Insta360 app

1. เปิดแอป **Insta360** บนมือถือ
2. เชื่อมต่อกล้อง X5
3. ไปที่ **Live** → เลือก **Custom RTMP**
4. ใส่ RTMP URL:
   ```
   rtmp://YOUR_VPS_IP:1935/live/x5
   ```
5. กด **Start Live**

### Step 4 — เปิดดูใน CN360Live

เปิด [cn360-360vr-live.vercel.app](https://cn360-360vr-live.vercel.app)  
กดปุ่ม **LIVE CAM** แล้วใส่ URL:

**HLS (latency ~5–15 วินาที — เสถียรกว่า):**
```
https://stream.yourdomain.com/live/x5/index.m3u8
```

**WebRTC WHEP (latency ~1 วินาที — ต้องใช้ Caddy HTTPS):**
```
https://stream.yourdomain.com/live/x5
```

> **หมายเหตุ latency:**  
> HLS แบ่งวิดีโอเป็น segment ทำให้ delay 5–15 วิตามการตั้งค่า  
> WebRTC ใช้ UDP peer-to-peer delay ต่ำกว่า ~1 วิ แต่ต้องการ HTTPS  
> เพราะหน้าเว็บโหลดจาก Vercel (HTTPS) — browser จะ block mixed content  
> ถ้า relay ยัง HTTP อยู่

### HTTPS สำหรับ Relay (จำเป็นถ้าใช้ WebRTC)

แก้ `relay/Caddyfile` — เปลี่ยน `stream.yourdomain.com` เป็น domain จริง  
และ `https://cn360-360vr-live.vercel.app` ให้ตรงกับ URL Vercel ของคุณ  
จากนั้น uncomment บล็อก `caddy` ใน `docker-compose.yml` แล้วรัน:

```bash
docker compose up -d
```

Caddy จะขอ TLS cert จาก Let's Encrypt อัตโนมัติ

---

## Camera Status API

```
GET /api/camera-status
GET /api/camera-status?relay=https://stream.yourdomain.com
```

ถ้าไม่ส่ง `relay` → คืน mock  
ถ้าส่ง `relay` → เช็ค MediaMTX API จริงและคืนสถานะ `streaming` / `waiting` / `unreachable`

---

## Project Structure

```
360Live/
├── public/
│   ├── index.html      ← UI หลัก
│   ├── viewer.js       ← Three.js sphere + WebXR
│   └── style.css       ← Dark cinematic UI
├── api/
│   └── camera-status.js ← Vercel serverless function
├── relay/
│   ├── mediamtx.yml    ← MediaMTX config
│   ├── docker-compose.yml
│   └── Caddyfile       ← HTTPS reverse proxy (optional)
└── README.md
```

---

## Phase 2 Checklist (ยังไม่ได้ทำ)

- [ ] เพิ่ม publishUser/publishPass ใน mediamtx.yml
- [ ] เปิด RTMPS (port 1936) แทน RTMP
- [ ] ทำ UI แสดงสถานะ relay อัตโนมัติโดยดึงจาก `/api/camera-status?relay=...`
- [ ] รองรับ HLS.js สำหรับ browser ที่ไม่ support native HLS
