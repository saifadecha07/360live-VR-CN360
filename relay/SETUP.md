# Setup Relay บนเครื่องใหม่ (USB + localhost.run)

คู่มือนี้ใช้กับ setup ปัจจุบัน: กล้อง Insta360 X5 ต่อผ่าน USB-C (Webcam Mode) เข้าเครื่องที่รัน relay โดยตรง แล้วส่งสัญญาณออกอินเทอร์เน็ตผ่าน SSH tunnel ของ localhost.run (ไม่ใช้ ngrok)

## สิ่งที่ต้องมีในเครื่องใหม่

1. Git clone repo นี้
2. `mediamtx.exe` — ดาวน์โหลดจาก https://github.com/bluenviron/mediamtx/releases/latest แล้ววางไว้ใน `relay/`
3. `ffmpeg.exe` (build ที่มี libx264) — วางไว้ใน `relay/`
4. SSH client — Windows 10/11 มีติดตั้งมาให้แล้ว (`ssh` อยู่ใน PATH) ไม่ต้องสมัครบัญชี localhost.run
5. เชื่อมกล้อง Insta360 X5 เข้าเครื่องผ่าน USB-C แล้วเปิด **USB Webcam Mode** บนกล้อง ถ้า Windows หา device ไม่เจอให้ลง driver Insta360 ก่อน

> `relay/*.exe` ไม่ได้ commit เข้า git (ดู `.gitignore`) ต้องโหลดเองทุกเครื่อง

## ขั้นตอนรัน

### 1. เปิด MediaMTX

```
relay\mediamtx.exe relay\mediamtx.yml
```

เปิด listener: RTMP `:1935`, HLS `:8888`, API `:9997`

### 2. เช็คชื่อ device กล้อง/ไมค์

ชื่อ device ต่างกันได้ตามเครื่อง ต้องเช็คใหม่ทุกเครื่อง:

```
ffmpeg -list_devices true -f dshow -i dummy
```

จะเห็นรายการ เช่น `"Insta360 X5"` (video), `"Microphone (Insta360 X5)"` (audio)

เช็ค resolution ที่กล้องรองรับจริงด้วย (X5 USB webcam มักรองรับแค่ 1920x1080 กับ 2880x1440 ไม่รองรับ resolution กลาง ๆ):

```
ffmpeg -f dshow -list_options true -i video="Insta360 X5"
```

> **สำคัญมาก:** ต้อง capture ที่ **2880x1440 (อัตราส่วน 2:1) เท่านั้น** — ตามเอกสาร Insta360
> เฉพาะ resolution นี้กล้องถึงจะ auto-output เป็น **stitched equirectangular panorama**
> (ภาพ 360 ต่อเนื่องจริง) ถ้า capture ที่ 1920x1080 (16:9) กล้องจะสลับไปโหมด
> **Reframe/dual-lens** แทน (เฟรมหน้า/หลังแยกกันซ้อนกัน ไม่ใช่ panorama) แม้ ffmpeg
> จะ capture ได้ปกติไม่มี error ก็ตาม — เคยเสียเวลา debug เรื่องนี้เพราะลด resolution
> ไปแก้ปัญหา ffmpeg ค้าง (ดูข้อควรระวังท้ายไฟล์) แล้วดันได้ภาพผิดโหมดแทน
> **ห้าม scale ลงจาก 2880x1440 — ให้ capture/encode ตรงที่ 2880x1440 เท่านั้น**

### 3. Push stream เข้า MediaMTX

```
ffmpeg ^
  -f dshow -video_size 2880x1440 -framerate 30 -vcodec mjpeg -i video="Insta360 X5" ^
  -f dshow -i audio="Microphone (Insta360 X5)" ^
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -b:v 4000k -maxrate 4000k -bufsize 8000k -g 60 -threads 4 ^
  -c:a aac -b:a 96k ^
  -f flv rtmp://127.0.0.1:1935/live/x5
```

ปรับชื่อ device ตามที่เจอใน step 2 — **อย่าเปลี่ยน `-video_size` จาก 2880x1440**

เช็คว่า path ขึ้นจริง:

```
curl http://127.0.0.1:9997/v3/paths/list
```

### 4. เปิด SSH tunnel ออกอินเทอร์เน็ต (2 เส้น)

```
ssh -R 80:127.0.0.1:8888 nokey@localhost.run   # HLS
ssh -R 80:127.0.0.1:9997 nokey@localhost.run   # API
```

แต่ละเส้นจะได้ URL รูปแบบ `https://xxxxxxxxxxxxxx.lhr.life`

### 5. อัปเดต URL ใน CN360Live

แก้ `public/config.js`:

```js
export const RELAY_BASE = (...  : 'https://<HLS-tunnel>.lhr.life')
export const API_BASE   = (...  : 'https://<API-tunnel>.lhr.life')
```

หรือใช้ query param ตรง ๆ โดยไม่ต้อง deploy ใหม่:

```
https://cn360-360vr-live.vercel.app/?relay=https://<HLS-tunnel>.lhr.life&api=https://<API-tunnel>.lhr.life
```

### 6. Deploy (ถ้าแก้ config.js)

```
deploy.bat
```

## ข้อควรระวัง

- localhost.run tunnel **เปลี่ยน URL ทุกครั้งที่รีสตาร์ท ssh** — ต้องอัป `config.js` หรือ query param ใหม่ทุกรอบที่รีสตาร์ท relay
- อยากได้ URL คงที่ ต้องสมัคร account ที่ localhost.run + ใช้ SSH key (ดู https://localhost.run/docs/forever-free/)
- เครื่อง relay ต้องเปิดค้างตลอดช่วง live (MediaMTX + ffmpeg push + ssh tunnel ทั้ง 2 เส้น)
