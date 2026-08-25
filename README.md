# CN360live

360° VR Spatial Camera Viewer — Three.js + WebXR (Pico 4)
Deploy: Vercel static · Relay: MediaMTX on local machine + ngrok

---

## Features

- Full-screen equirectangular 360° sphere viewer
- Mouse / touch drag · scroll / pinch to zoom FOV
- Upload any local 360° equirectangular image
- Live camera stream via HLS or WebRTC URL
- ENTER VR — WebXR immersive-vr with head tracking (Pico 4)

---

## Quick Start (local preview)

```bash
npx serve public
# เปิด http://localhost:3000
```

---

## Deploy to Vercel

1. Connect repo `saifadecha07/360live-VR-CN360` to Vercel
2. **Project Settings → Build & Output Settings:**
   - Framework Preset: `Other`
   - Output Directory: `public`
   - Build Command: *(empty)*
   - Install Command: *(empty)*
3. Save → Deploy

---

## Live Streaming Setup (Free · Local + ngrok)

ไม่ต้องเช่า VPS — รันทุกอย่างบนเครื่องของคุณ + ngrok tunnel

```
Insta360 X5 (Wi-Fi)
      │  RTMP
      ▼
MediaMTX (เครื่อง local :1935)
      │
      ├── HLS    :8888  ──┐
      └── WebRTC :8889  ──┤
                          │  ngrok tunnel
                          ▼
              public URL (เปลี่ยนทุกครั้งที่ restart)
                          │
                          ▼
              CN360Live (Vercel) — ใส่ URL ใน LIVE CAM
```

### ขั้นตอนที่ 1 — ติดตั้ง (ทำครั้งเดียว)

**MediaMTX**
1. ดาวน์โหลดจาก https://github.com/bluenviron/mediamtx/releases/latest
2. เลือกไฟล์ `mediamtx_*_windows_amd64.zip` (Windows) หรือ `*_linux_amd64.tar.gz`
3. แตกไฟล์ → copy `mediamtx.exe` ไว้ใน `relay/` หรือเพิ่มใน PATH

**ngrok**
1. สมัครฟรีที่ https://ngrok.com
2. ดาวน์โหลด ngrok จาก https://ngrok.com/download
3. รัน: `ngrok config add-authtoken YOUR_AUTHTOKEN`
   (token อยู่ใน https://dashboard.ngrok.com/get-started/your-authtoken)

### ขั้นตอนที่ 2 — รัน Relay

**Windows** — ดับเบิ้ลคลิก หรือรันใน terminal:
```bat
relay\start.bat
```

**Mac / Linux:**
```bash
chmod +x relay/start.sh
./relay/start.sh
```

สคริปต์จะ:
- รัน MediaMTX รับ RTMP ที่ port 1935
- เปิด ngrok tunnel สำหรับ RTMP (TCP) และ HLS (HTTP)
- ดึง public URL จาก ngrok API แสดงผลทันที

ตัวอย่าง output:
```
 ================================================
  STREAM ENDPOINTS
 ================================================

  [tcp]   tcp://0.tcp.ngrok.io:12345   ->  localhost:1935
  [http]  http://abc123.ngrok.io       ->  localhost:8888
```

> **ngrok free plan:** รัน 2 tunnel พร้อมกันได้ แต่ต้องอยู่ใน
> session เดียวกัน ถ้าพบ error "session limit" ให้ดู
> [วิธีตั้งค่า ngrok config](#ngrok-config-หลาย-tunnel) ด้านล่าง

### ขั้นตอนที่ 3 — ตั้งค่า Insta360 app

1. เชื่อม Wi-Fi เดียวกับเครื่องที่รัน relay (หรือใช้ ngrok URL)
2. เปิดแอป **Insta360** → เลือกกล้อง X5
3. ไปที่ **Live** → **Custom RTMP**
4. ใส่ RTMP URL:
   ```
   rtmp://0.tcp.ngrok.io:12345/live/x5
   ```
   (แทน `0.tcp.ngrok.io:12345` ด้วย TCP URL ที่ ngrok ให้มา)
5. กด **Start Live**

### ขั้นตอนที่ 4 — เปิดดูใน CN360Live

เปิด https://cn360-360vr-live.vercel.app → กด **LIVE CAM** → ใส่ URL:

**HLS (latency ~3–5 วินาที — เสถียรกว่า, รองรับทุก browser):**
```
http://abc123.ngrok.io/live/x5/index.m3u8
```

**WebRTC (latency ~1 วินาที — ต้องการ HTTPS, browser บางตัวอาจ block mixed content):**
```
http://abc123.ngrok.io/live/x5
```

กด **CONNECT**

> **latency:**
> - HLS แบ่งเป็น segment ~1s → delay รวม 3–5s
> - WebRTC ส่ง UDP โดยตรง → delay ~1s แต่ต้องการ HTTPS ถ้าหน้าเว็บโหลดจาก HTTPS

### ข้อควรรู้

| ข้อจำกัด | รายละเอียด |
|---|---|
| URL เปลี่ยนทุกครั้ง | ngrok free plan สร้าง URL ใหม่ทุกครั้งที่ restart — ต้องอัปเดตใน Insta360 app และ CN360Live ด้วย |
| เครื่องต้องเปิดค้าง | MediaMTX และ ngrok ต้องรันตลอดช่วงที่สตรีม |
| latency เพิ่มขึ้น | RTMP → ngrok → MediaMTX → HLS → ngrok → browser มี hop หลายชั้น |
| ngrok free = 1 agent | รัน 2 tunnel ได้ใน 1 session ผ่าน config file |

### ngrok config หลาย tunnel

สร้างไฟล์ `~/.config/ngrok/ngrok.yml` (หรือ `%USERPROFILE%\.ngrok2\ngrok.yml` บน Windows):

```yaml
version: "2"
authtoken: YOUR_AUTHTOKEN
tunnels:
  rtmp:
    proto: tcp
    addr: 1935
  hls:
    proto: http
    addr: 8888
```

แล้วรัน:
```bash
ngrok start rtmp hls
```

---

## Camera Status API

```
GET /api/camera-status
GET /api/camera-status?relay=http://abc123.ngrok.io
```

- ไม่ส่ง `relay` → คืน mock status
- ส่ง `relay` → เช็ค MediaMTX `/v3/paths/list` จริง
- ถ้า relay ไม่ตอบ (เครื่องปิด / ngrok URL เปลี่ยน) → คืน `"status": "unreachable"`

> **หมายเหตุ:** Vercel function อยู่บน cloud ของ Vercel  
> relay อยู่บนเครื่อง local → เช็คได้ก็ต่อเมื่อ ngrok expose port 9997  
> หรือ relay มี public URL เท่านั้น

---

## Project Structure

```
360Live/
├── public/
│   ├── index.html        ← UI หลัก
│   ├── viewer.js         ← Three.js sphere + WebXR
│   └── style.css         ← Dark cinematic UI
├── api/
│   └── camera-status.js  ← Vercel serverless (mock + optional relay check)
├── relay/
│   ├── mediamtx.yml      ← MediaMTX config
│   ├── start.bat         ← Windows launcher
│   └── start.sh          ← Mac/Linux launcher
├── deploy.bat            ← Git push helper
└── README.md
```

---

## Phase 2 Checklist

- [ ] ngrok static domain (free 1 domain) เพื่อให้ URL ไม่เปลี่ยน
- [ ] publishUser/publishPass ใน mediamtx.yml
- [ ] HLS.js สำหรับ browser ที่ไม่ support native HLS
- [ ] UI แสดงสถานะ relay อัตโนมัติผ่าน `/api/camera-status?relay=...`
- [ ] RTMPS (port 1936) แทน RTMP plain
