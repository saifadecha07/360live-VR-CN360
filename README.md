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

## Viewport API — request an angle, get a 2D image back

นอกจาก client-side 360° viewer (`viewer.js`) แล้ว ยังมี **Viewport API** —
server ท้องถิ่นตัวเล็ก ๆ ที่รับพารามิเตอร์มุม (`yaw` / `pitch` / `fov`)
พร้อม option ดึงแบบ `360` (rectilinear crop ปกติ) หรือ `180`
(fisheye hemisphere) แล้วส่งภาพ JPEG กลับมาให้ทันที — เหมาะสำหรับทดสอบผ่าน
web request/curl/browser โดยตรง หรือต่อยอดไปยังอุปกรณ์ที่ไม่มี 3D engine

```
Insta360 X5 ──RTMP──▶ MediaMTX ──RTSP :8554──▶ ffmpeg (v360 filter) ──▶ JPEG
                                                       ▲
                                          GET /api/view?yaw=&pitch=&fov=&mode=
```

ใช้แค่ Python 3 (standard library) + `relay/ffmpeg.exe` ที่มีอยู่แล้ว
ไม่ต้องติดตั้งอะไรเพิ่ม

### รัน

`relay/start.bat` (หรือ `start.sh`) รัน Viewport API ให้อัตโนมัติเป็นขั้นที่ 3
อยู่แล้ว (ถ้ามี `python` ใน PATH) หรือรันแยกเองก็ได้:

```bat
relay\view_start.bat
```
```bash
./relay/view_start.sh
```

Default listen ที่ `http://localhost:8095`

### ใช้งาน

```
GET /api/view?yaw=<-180..180>&pitch=<-90..90>&fov=<30..120>&mode=360|180&path=live/x5
```

| Param | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `yaw` | `0` | มุมหมุนแนวนอน (องศา) |
| `pitch` | `0` | มุมเงย/ก้ม (องศา) |
| `fov` | `90` | มุมมอง — ใช้เฉพาะ `mode=360` |
| `mode` | `360` | `360` = ตัดภาพ rectilinear ปกติ, `180` = fisheye ครึ่งทรงกลม 180° รอบจุด yaw/pitch |
| `path` | `live/x5` | ชื่อ path ของสตรีมใน MediaMTX |

ตัวอย่าง:
```
http://localhost:8095/api/view?yaw=90&pitch=0&fov=90&mode=360
http://localhost:8095/api/view?yaw=180&pitch=-10&mode=180
```

เช็คว่า relay พร้อมไหม (ไม่ต้อง spawn ffmpeg):
```
GET /api/view/status   →  {"relay": "up" | "down"}
```

> **latency:** ffmpeg ต้องรอ keyframe (IDR) แรกที่มาถึงก่อนถึงจะ crop ภาพได้
> ยิ่ง keyframe interval ของสตรีมสั้น (ปกติ live stream ~1-2s) ยิ่งตอบเร็ว
> ถ้าตอบช้าผิดปกติ (>5s) ให้เช็ค encoder settings ฝั่งกล้อง

### ทดลองผ่านหน้าเว็บ

เปิด [`public/view-test.html`](public/view-test.html) — มี slider ปรับ
yaw/pitch/fov, toggle 360/180, ปุ่ม fetch และแสดง URL ที่ยิงจริงให้คัดลอกไปใช้
กับ curl ได้ด้วย

---

## เชื่อมแว่น VR (Pico 4) เข้ากับสตรีมจริง

ส่วนนี้ทำงานอยู่แล้วใน `viewer.js`/`index.html` ไม่ต้องแก้โค้ดเพิ่ม —
แค่ต่อ hardware ตามขั้นตอน relay ด้านบน แล้ว:

1. เปิด CN360Live บน browser ของ Pico 4 (ต้องเป็น HTTPS หรือ localhost —
   WebXR ต้องการ secure context)
2. กด **LIVE CAM** → tab **HLS Stream** → ใส่ HLS URL ของสตรีม Insta360 X5
   (ngrok URL หรือ URL ในเครือข่ายเดียวกัน) → **CONNECT**
3. กด **ENTER VR** — Pico 4 จะเข้าสู่โหมด immersive-vr พร้อม head tracking
   บนสตรีมสด

> ถ้าโหลดวิดีโอไม่ขึ้นบน Pico 4 ทั้งที่ต่อ HLS URL ถูกแล้ว มักเป็นเพราะ
> mixed content (หน้าเว็บ HTTPS แต่สตรีม HTTP) — ลองใช้ `relay/cloudflared.exe`
> เปิด HTTPS tunnel ให้ MediaMTX แทน ngrok plain HTTP

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
│   ├── style.css         ← Dark cinematic UI
│   └── view-test.html    ← Viewport API test page (yaw/pitch/fov -> image)
├── api/
│   └── camera-status.js  ← Vercel serverless (mock + optional relay check)
├── relay/
│   ├── mediamtx.yml      ← MediaMTX config
│   ├── start.bat         ← Windows launcher (MediaMTX + ngrok + Viewport API)
│   ├── start.sh          ← Mac/Linux launcher
│   ├── view_server.py    ← Viewport API (yaw/pitch/fov -> JPEG via ffmpeg v360)
│   ├── view_start.bat    ← Viewport API launcher (standalone, Windows)
│   └── view_start.sh     ← Viewport API launcher (standalone, Mac/Linux)
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
