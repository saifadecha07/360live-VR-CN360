"""
protocol.py - Parser & Validator for CN360 Robot Rescue VR
"""
import json
from typing import Dict, Any, Tuple, Optional

ALLOWED_COMMANDS = {"DRIVE", "STOP"}
ALLOWED_DIRECTIONS = {"FORWARD", "BACKWARD", "LEFT", "RIGHT"}
MIN_SPEED = 0
MAX_SPEED = 255

class ProtocolValidator:
    def __init__(self):
        self.last_seq: int = -1

    def reset_sequence(self):
        """รีเซ็ต sequence number เมื่อเริ่มการเชื่อมต่อใหม่"""
        self.last_seq = -1

    def parse_and_validate(self, raw_message: str) -> Tuple[bool, Optional[Dict[str, Any]], str]:
        """
        แยกคำสั่งและตรวจสอบความถูกต้องตาม protocol.md
        คืนค่า: (is_valid, parsed_data, error_message)
        """
        # 1. ตรวจสอบการแปลงเป็น JSON
        try:
            data = json.loads(raw_message)
        except (json.JSONDecodeError, TypeError):
            return False, None, "Invalid JSON format"

        if not isinstance(data, dict):
            return False, None, "Payload must be a JSON object"

        # 2. ตรวจสอบ Field พื้นฐาน: cmd และ seq
        if "cmd" not in data or "seq" not in data:
            return False, None, "Missing required fields: 'cmd' or 'seq'"

        cmd = data["cmd"]
        seq = data["seq"]

        if not isinstance(cmd, str):
            return False, None, "'cmd' must be a string"
        if not isinstance(seq, int) or isinstance(seq, bool):
            return False, None, "'seq' must be an integer"

        if cmd not in ALLOWED_COMMANDS:
            return False, None, f"Unknown command: '{cmd}'"

        # 3. ตรวจสอบ Sequence Monotonicity (seq ต้องเพิ่มขึ้นเรื่อยๆ)
        if seq <= self.last_seq:
            return False, None, f"Out-of-order sequence: received {seq}, expected > {self.last_seq}"

        # 4. ตรวจสอบคำสั่ง DRIVE
        if cmd == "DRIVE":
            if "speed" not in data or "dir" not in data:
                return False, None, "DRIVE command requires 'speed' and 'dir'"

            speed = data["speed"]
            direction = data["dir"]

            if not isinstance(speed, int) or isinstance(speed, bool):
                return False, None, "'speed' must be an integer"
            if not isinstance(direction, str):
                return False, None, "'dir' must be a string"

            if direction not in ALLOWED_DIRECTIONS:
                return False, None, f"Invalid direction: '{direction}'"

            # ตรวจสอบช่วงค่าความเร็ว (0 - 255)
            if not (MIN_SPEED <= speed <= MAX_SPEED):
                return False, None, f"Speed out of range ({MIN_SPEED}-{MAX_SPEED}): {speed}"

        # 5. ตรวจสอบคำสั่ง STOP
        elif cmd == "STOP":
            pass

        # บันทึก seq ล่าสุดเมื่อผ่านการตรวจสอบทั้งหมด
        self.last_seq = seq
        return True, data, ""