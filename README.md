# CN360Live

**360° VR Live Camera System** — Three.js · WebXR · Insta360 X5 · Pico 4

> เปิดเว็บ → เลือก PC Mode หรือ VR Mode → ดู Live 360° จากกล้อง Insta360 X5
> โดยไม่ต้องเช่า VPS — รันทุกอย่างบนเครื่อง local + ngrok tunnel

**Demo:** https://cn360-360vr-live.vercel.app

📄 **[Setup Guide ฉบับเต็ม (PDF)](docs/CN360Live-Setup.pdf)** — ติดตั้ง relay + USB stream + tunnel + deploy ครบทุกขั้นตอน

---

## สารบัญ

1. [ภาพรวม Architecture](#ภาพรวม-architecture)
2. [หน้าจอและ Mode ต่าง ๆ](#หน้าจอและ-mode-ต่าง-ๆ)
3. [การติดตั้ง Relay (ทำครั้งเดียว)](#การติดตั้ง-relay-ทำครั้งเดียว)
4. [วิธีเริ่ม Live Stream](#วิธีเริ่ม-live-stream)
5. [เปิดดูใน Browser / VR](#เปิดดูใน-browser--vr)
6. [ตั้งค่า Relay URL ใน CN360Live](#ตั้งค่า-relay-url-ใน-cn360live)
7. [การ Deploy Vercel](#การ-deploy-vercel)
8. [Project Structure](#project-structure)
9. [API Reference](#api-reference)
10. [ngrok config หลาย tunnel](#ngrok-config-หลาย-tunnel)
11. [ข้อจำกัดและ FAQ](#ข้อจำกัดและ-faq)
12. [Roadmap](#roadmap)

---

## ภาพรวม Architecture

```
Insta360 X5
(แอปมือถือ)
      │
      │  RTMP push  rtmp://...ngrok.io:PORT/live/x5
      ▼
┌─────────────────────────────────────────┐
│  เครื่อง LOCAL (PC/Laptop ของคุณ)       │
│                                         │
│  MediaMTX                               │
│   :1935  ← รับ RTMP จากกล้อง           │
│   :8888  → HLS out  (latency ~3–5s)    │
│   :8889  → WebRTC out (latency ~1s)    │
│   :9997  → HTTP API (health check)     │
│                                         │
│  ngrok                                  │
│   TCP tunnel  → :1935 (RTMP)           │
│   HTTP tunnel → :8888 (HLS)            │
└───────────────┬─────────────────────────┘
                │  public URL
                ▼
   ┌────────────────────────────┐
   │  Vercel (Cloud)            │
   │  CN360Live frontend        │
   │  /api/cameras  serverless  │
   └────────────────────────────┘
                │
                ▼
   Browser (PC/Mobile) · Pico 4 (WebXR)
```

---

## หน้าจอและ Mode ต่าง ๆ

### หน้าแรก — Mode Selection

```
          CN360Live
     LIVE 360° CAMERA SYSTEM

  ┌───────────────────────────┐
  │  🖥  PC MODE              │
  │  Watch Live 360°          │
  │  on Browser          →    │
  └───────────────────────────┘

  ┌───────────────────────────┐
  │  👓  VR MODE    [WebXR ✓] │
  │  Enter 3D Camera          │
  │  Lobby               →    │
  └───────────────────────────┘
```

- **PC MODE** → เข้า Camera List → เลือกกล้อง → 360° Browser Viewer
- **VR MODE** → เข้า 3D Camera Lobby (Three.js) → เลือกกล้อง → 360° VR Viewer + WebXR

### PC Mode

- แสดงรายการกล้องพร้อมสถานะ 🟢 LIVE / 🟡 WAITING / 🔴 OFFLINE
- กดกล้องเพื่อเปิด 360° viewer
- Mouse drag หมุนกล้อง, Scroll zoom
- ปุ่ม Fullscreen และ Enter VR (ถ้า browser รองรับ WebXR)
- สถานะกล้อง auto-refresh ทุก 4 วินาที

### VR Mode — 3D Camera Lobby

- Three.js scene แบบ futuristic — grid floor, neon blue, floating camera panels
- Panel แต่ละอันแสดงชื่อกล้อง + สถานะ + ปุ่ม VIEW CAMERA
- คลิกหรือ gaze เพื่อเลือกกล้อง
- Mouse drag หมุนมุมมอง (non-VR)
- กด ENTER XR เพื่อ immersive-vr บน Pico 4 / Meta Quest
- ปุ่ม BACK TO LOBBY และ HOME ทุกขั้นตอน

### Developer Mode (ซ่อน)

เข้าถึงได้ผ่าน URL:
```
https://your-site.vercel.app/?debug=1
```
ใช้ทดสอบ:
- Procedural default panorama
- Upload ภาพ equirectangular
- Manual stream URL (HLS/WebRTC)
- ตั้ง relay URL ใหม่

---

## การติดตั้ง Relay (ทำครั้งเดียว)

> **หมายเหตุ:** relay ปัจจุบันใช้กล้อง Insta360 X5 ต่อผ่าน **USB-C** และ tunnel ผ่าน
> **localhost.run** แทน ngrok ในหัวข้อด้านล่าง — ดูขั้นตอนที่ตรงกับ setup จริงได้ใน
> **[Setup Guide (PDF)](docs/CN360Live-Setup.pdf)**

### ขั้นตอนที่ 1 — ติดตั้ง MediaMTX

1. เปิด https://github.com/bluenviron/mediamtx/releases/latest
2. ดาวน์โหลดไฟล์ตามระบบปฏิบัติการ:
   - Windows: `mediamtx_v*_windows_amd64.zip`
   - macOS (Apple Silicon): `mediamtx_v*_darwin_arm64.tar.gz`
   - macOS (Intel): `mediamtx_v*_darwin_amd64.tar.gz`
   - Linux: `mediamtx_v*_linux_amd64.tar.gz`
3. แตกไฟล์ → **copy `mediamtx.exe` (หรือ `mediamtx`) ไว้ใน `relay/`**

### ขั้นตอนที่ 2 — ติดตั้ง ngrok

1. สมัครบัญชีฟรีที่ https://ngrok.com
2. ดาวน์โหลด ngrok จาก https://ngrok.com/download
3. แตกไฟล์ → **copy `ngrok.exe` ไว้ใน `relay/`**
4. ก็อป Authtoken จาก https://dashboard.ngrok.com/get-started/your-authtoken
5. รันคำสั่งต่อไปนี้ใน terminal (ทำครั้งเดียว):
   ```bat
   ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
   ```

### ขั้นตอนที่ 3 — ตั้งค่า ngrok สำหรับ 2 tunnel (แนะนำ)

ngrok free plan รัน 2 tunnel พร้อมกันได้ในหนึ่ง agent session ต้องใช้ config file:

สร้างไฟล์ `ngrok.yml` ใน `relay/`:
```yaml
version: "3"
agent:
  authtoken: YOUR_AUTHTOKEN_HERE

tunnels:
  rtmp:
    proto: tcp
    addr: 1935
  hls:
    proto: http
    addr: 8888
```

> ถ้าไม่ทำขั้นตอนนี้ `start.bat` จะรัน tunnel ทีละอัน และอาจเจอ error
> "session limit reached" บน free plan

---

## วิธีเริ่ม Live Stream

### ขั้นตอนที่ 1 — รัน Relay

**Windows** — ดับเบิ้ลคลิก หรือรันใน Command Prompt:
```bat
relay\start.bat
```

**Mac / Linux:**
```bash
chmod +x relay/start.sh
./relay/start.sh
```

รอจน output แสดง endpoint เช่น:
```
================================================
  STREAM ENDPOINTS
================================================

  [tcp]   tcp://0.tcp.ngrok.io:12345   ->  localhost:1935
  [http]  https://abc123.ngrok.io      ->  localhost:8888
```

> ดู URL ได้ตลอดเวลาที่ http://127.0.0.1:4040 (ngrok dashboard local)

### ขั้นตอนที่ 2 — ตั้งค่า Insta360 app

1. เปิดแอป **Insta360** บนมือถือ → เลือกกล้อง X5
2. ไปที่ **Live** → **Custom RTMP**
3. กรอก RTMP URL (ใช้ TCP URL จาก ngrok):
   ```
   rtmp://0.tcp.ngrok.io:12345/live/x5
   ```
   > แทน `0.tcp.ngrok.io:12345` ด้วย URL จริงที่ปรากฏใน terminal
4. กด **Start Live**
5. กล้องจะส่งสัญญาณเข้า MediaMTX → ไฟ Live ติด

### ขั้นตอนที่ 3 — ตรวจสอบว่า stream ขึ้น

เปิด browser บนเครื่องเดียวกับที่รัน relay:
```
http://localhost:8888/live/x5
```
ถ้าเห็น HLS player หรือ playlist ขึ้น — stream พร้อมแล้ว

---

## เปิดดูใน Browser / VR

### ทาง CN360Live (Vercel)

1. เปิด https://cn360-360vr-live.vercel.app
2. กด **PC MODE** หรือ **VR MODE**
3. ระบบโหลดรายการกล้องจาก relay อัตโนมัติ
   - ถ้ายังไม่ได้ตั้ง relay URL จะเห็นสถานะ WAITING (mock mode)
   - ดูวิธีตั้ง relay URL ที่ [หัวข้อถัดไป](#ตั้งค่า-relay-url-ใน-cn360live)

### ทดสอบ local (ไม่ต้องใช้ Vercel)

```bash
# Node.js
npx serve public

# Python
cd public && python -m http.server 3000
```
เปิด http://localhost:3000

### บน Pico 4

1. เปิด Pico browser → เปิด CN360Live (ต้องเป็น HTTPS)
2. กด **VR MODE** → เข้า 3D Lobby
3. เลือกกล้อง → กด **ENTER XR**
4. headset เข้าสู่ immersive-vr mode พร้อม head tracking

> WebXR ต้องการ secure context (HTTPS) — ถ้าทดสอบ local ต้องใช้ localhost
> หรือ ngrok HTTPS tunnel

---

## ตั้งค่า Relay URL ใน CN360Live

CN360Live ต้องรู้ URL ของ relay เพื่อดึงสถานะกล้องและ stream

### วิธี 1 — Query Parameter (แนะนำสำหรับใช้งานจริง)

ใส่ URL ต่อท้าย link:
```
https://cn360-360vr-live.vercel.app/?relay=https://abc123.ngrok.io
```

แทน `https://abc123.ngrok.io` ด้วย ngrok HTTP URL ของคุณ (URL จาก HLS tunnel ที่ชี้ port 8888)

### วิธี 2 — แก้ไฟล์ config.js (สำหรับ deploy ส่วนตัว)

เปิดไฟล์ `public/config.js`:
```js
export const RELAY_BASE = (
  _relayParam
    ? _relayParam.replace(/\/$/, '')
    : 'https://abc123.ngrok.io'   // ← ใส่ URL ตรงนี้
);
```

แล้ว commit + push → Vercel auto-deploy

> **หมายเหตุ:** ngrok free plan สร้าง URL ใหม่ทุกครั้งที่ restart — ต้องอัปเดต
> URL ทั้งใน Insta360 app (RTMP) และใน CN360Live (?relay=) ด้วยทุกครั้ง
> ใช้ **ngrok static domain** (free 1 domain) เพื่อแก้ปัญหานี้

### วิธี 3 — Developer Mode

เปิด `?debug=1` → กด DEVELOPER MODE → ใส่ relay URL → กด SET RELAY

---

## การ Deploy Vercel

### ครั้งแรก

1. ไปที่ https://vercel.com → เชื่อม GitHub repo `saifadecha07/360live-VR-CN360`
2. ตั้งค่า Project:
   - **Framework Preset:** Other
   - **Output Directory:** `public`
   - **Build Command:** *(ว่าง)*
   - **Install Command:** *(ว่าง)*
3. กด Deploy

### Deploy ครั้งต่อไป

รัน `deploy.bat` หรือ:
```bat
git add .
git commit -m "your message"
git push origin main
```
Vercel จะ auto-deploy ทุกครั้งที่ push ไป `main`

---

## Project Structure

```
360Live/
│
├── public/                     ← Static files (Vercel serves this folder)
│   ├── index.html              ← HTML shell — 4 screens: Home, PC, VR, Dev
│   ├── app.js                  ← SPA entry point & state machine
│   ├── config.js               ← Central config: relay URL, camera registry
│   ├── cameras-api.js          ← Client-side fetch + auto-polling
│   ├── panorama.js             ← Three.js 360° sphere renderer (reusable class)
│   ├── pc-mode.js              ← PC Mode: camera list + viewer controller
│   ├── vr-lobby.js             ← VR Mode: Three.js 3D camera lobby scene
│   ├── vr-viewer.js            ← VR Mode: 360° viewer + WebXR session
│   ├── viewer.js               ← Legacy shim (re-exports panorama.js)
│   └── style.css               ← Design system: glassmorphism, neon blue
│
├── api/                        ← Vercel serverless functions
│   ├── cameras.js              ← GET /api/cameras — multi-camera status
│   └── camera-status.js        ← GET /api/camera-status — legacy single-camera
│
├── relay/                      ← รัน local (ไม่ deploy ขึ้น Vercel)
│   ├── mediamtx.yml            ← MediaMTX config (RTMP/HLS/WebRTC/API)
│   ├── mediamtx.exe            ← MediaMTX binary (Windows)
│   ├── ngrok.exe               ← ngrok binary (Windows)
│   ├── ffmpeg.exe              ← FFmpeg binary
│   ├── start.bat               ← Windows launcher (MediaMTX + ngrok)
│   └── start.sh                ← Mac/Linux launcher
│
├── deploy.bat                  ← Git push helper
└── README.md
```

---

## API Reference

### `GET /api/cameras`

ตรวจสอบสถานะกล้องทั้งหมดจาก MediaMTX

**Query params:**

| Param | Required | ตัวอย่าง | ความหมาย |
|---|---|---|---|
| `relay` | ไม่บังคับ | `https://abc123.ngrok.io` | ngrok HLS tunnel URL (port 8888) |
| `api` | ไม่บังคับ | `https://xyz.ngrok.io` | ngrok API tunnel URL (port 9997) — ถ้าไม่ส่ง ระบบ derive จาก relay |

**ตัวอย่าง:**
```
GET /api/cameras
GET /api/cameras?relay=https://abc123.ngrok.io
```

**Response:**
```json
{
  "source": "mock | relay",
  "relayReachable": true,
  "cameras": [
    {
      "id": "x5-01",
      "name": "Camera 01",
      "model": "Insta360 X5",
      "path": "live/x5",
      "type": "360",
      "status": "streaming | waiting | unreachable",
      "streams": {
        "hls":    "https://abc123.ngrok.io/live/x5/index.m3u8",
        "webrtc": "https://abc123.ngrok.io/live/x5"
      }
    }
  ]
}
```

**Status values:**

| status | ความหมาย |
|---|---|
| `streaming` | กล้องกำลัง live อยู่ |
| `waiting` | relay พร้อมแต่ยังไม่มีสัญญาณจากกล้อง |
| `unreachable` | ติดต่อ relay ไม่ได้ (เครื่องปิด หรือ ngrok URL เปลี่ยน) |
| `mock` | ไม่มี relay URL — คืนข้อมูลจำลอง |

---

### `GET /api/camera-status` (Legacy)

API เดิมสำหรับ single camera ยังใช้งานได้:
```
GET /api/camera-status
GET /api/camera-status?relay=https://abc123.ngrok.io
```

---

## ngrok config หลาย tunnel

ngrok free plan รัน 2 tunnel พร้อมกันได้ใน 1 agent session
ต้องใช้ config file แทนการรัน command line แยกกัน

**สร้างไฟล์ `relay/ngrok.yml`:**
```yaml
version: "3"
agent:
  authtoken: YOUR_AUTHTOKEN_HERE

tunnels:
  rtmp:
    proto: tcp
    addr: 1935
  hls:
    proto: http
    addr: 8888
```

**แก้ `relay/start.bat`** ให้ใช้ config file:
```bat
:: แทนบรรทัด ngrok tcp 1935 และ ngrok http 8888
start "ngrok" /min ngrok start --config "%~dp0ngrok.yml" rtmp hls
```

> **ngrok static domain (free):** ลงทะเบียน 1 static domain ได้ฟรีที่
> https://dashboard.ngrok.com/domains — URL จะไม่เปลี่ยนแม้ restart

---

## ข้อจำกัดและ FAQ

**Q: URL เปลี่ยนทุกครั้งที่รีสตาร์ท relay**  
A: เป็นพฤติกรรมของ ngrok free plan — ต้องอัปเดต URL ใน Insta360 app และ `?relay=` ทุกครั้ง ใช้ ngrok static domain (ฟรี 1 domain) เพื่อแก้ปัญหา

**Q: stream ไม่ขึ้นบน Chrome / Firefox (ขึ้นได้เฉพาะ Safari)**  
A: Chrome/Firefox ไม่รองรับ HLS native — ต้องใช้ HLS.js (อยู่ใน Roadmap) ทางเลือกชั่วคราว: ใช้ WebRTC URL แทน HLS

**Q: Pico 4 โหลด stream ไม่ขึ้น ทั้งที่ URL ถูก**  
A: mixed content — หน้าเว็บโหลดจาก HTTPS แต่ stream เป็น HTTP ngrok ให้ HTTPS URL อัตโนมัติ ใช้ URL ที่ขึ้นต้น `https://`

**Q: Vercel function เช็ค relay ไม่ได้**  
A: Vercel รันบน cloud ไม่สามารถเข้าถึง `localhost:9997` ได้โดยตรง ต้องเปิด ngrok tunnel สำหรับ port 9997 ด้วย หรือส่ง `?api=<ngrok-api-url>` แยก

**Q: กล้องแสดง WAITING ตลอด ทั้งที่กดสตรีมแล้ว**  
A: ตรวจสอบ RTMP URL ใน Insta360 app — ต้องใช้รูปแบบ `rtmp://HOST:PORT/live/x5` และ PORT ต้องตรงกับที่ ngrok TCP กำหนดให้

**Q: latency สูงมาก**  
A: HLS มี latency ~3–5 วินาที เป็นเรื่องปกติ ถ้าต้องการ latency ต่ำกว่าให้ใช้ WebRTC URL (`/live/x5` แทน `/live/x5/index.m3u8`)

---

## Roadmap

### Phase 2 (ถัดไป)
- [ ] **ngrok static domain** — URL ไม่เปลี่ยนเมื่อ restart
- [ ] **HLS.js** — รองรับ Chrome/Firefox/Edge (ปัจจุบัน HLS ใช้ได้เฉพาะ Safari/Pico)
- [ ] **RTMPS** (port 1936) — RTMP over TLS ปลอดภัยกว่า
- [ ] **Auth บน MediaMTX** — `publishUser` / `publishPass` ใน `mediamtx.yml`
- [ ] **WebRTC controller raycast** — กด panel ใน VR ด้วย controller บน Pico 4
- [ ] **Multi-camera** — เพิ่มกล้องหลายตัวใน `CAMERA_REGISTRY` ใน `config.js`

### Phase 3 (อนาคต)
- [ ] VPS relay (ไม่ต้องเปิดเครื่องค้าง)
- [ ] Recording ผ่าน MediaMTX
- [ ] Spatial audio

---

*Content was rephrased for clarity and project-specific context.*
