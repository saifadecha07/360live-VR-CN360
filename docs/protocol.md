# CN360 Robot Rescue VR - Communication Protocol Specification

Version: 1.0.0
Transport: WebSocket (JSON text frame)

## 1. Message Structure
ทุกข้อความที่ส่งมายังเซิร์ฟเวอร์ควบคุมหุ่นยนต์ต้องเป็น JSON Object ที่มีโครงสร้างดังนี้:

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `cmd` | String | Yes | คำสั่งควบคุม: `"DRIVE"` หรือ `"STOP"` |
| `seq` | Integer | Yes | ลำดับแพ็กเก็ต (Sequence Number) ค่าต้องเป็นจำนวนเต็มบวก และเพิ่มขึ้นเรื่อยๆ |
| `speed` | Integer | Conditional | ความเร็วของมอเตอร์ มีเฉพาะเมื่อ `cmd == "DRIVE"` (ช่วงที่อนุญาต: 0 ถึง 255) |
| `dir` | String | Conditional | ทิศทางการเคลื่อนที่ มีเฉพาะเมื่อ `cmd == "DRIVE"`: `"FORWARD"`, `"BACKWARD"`, `"LEFT"`, `"RIGHT"` |

## 2. Validation Rules
1. **Field Completeness:** 
   - ข้อความต้องแปลงเป็น JSON ได้
   - มี `cmd` และ `seq` เสมอ
   - หาก `cmd == "DRIVE"` ต้องมี `speed` และ `dir` ครบถ้วน
2. **Type Checking:** 
   - `cmd` และ `dir` ต้องเป็น String
   - `seq` และ `speed` ต้องเป็น Integer (ไม่ใช่ Float หรือ String)
3. **Value Clamping / Range:**
   - `speed` ต้องอยู่ระหว่าง `0` ถึง `255` หากเกินช่วงให้ปฏิเสธคำสั่ง (Invalid) หรือ clamp ตามการตั้งค่า
4. **Sequence Monotonicity:**
   - `seq` ใหม่ต้องมากกว่า `seq` ล่าสุดที่ยอมรับเสมอ (`seq_new > seq_last`) เพื่อป้องกัน Replay Attack หรือแพ็กเก็ตที่ส่งมาล่าช้า

## 3. Failsafe Requirements
- หากไม่มีคำสั่ง `DRIVE` ใหม่เข้ามาเกิน **300 ms** ระบบต้องส่งสัญญาณหยุดฉุกเฉิน (Emergency Stop) ทันที
- หาก WebSocket ขาดการเชื่อมต่อ ให้สั่งหยุดมอเตอร์ทันที