"""
code.py - Robot Controller with Mock Mode and Failsafe Timer
"""
import time
import argparse
from typing import Dict, Any
from protocol import ProtocolValidator

FAILSAFE_TIMEOUT_SEC = 0.300  # 300 ms

class RobotController:
    def __init__(self, mock: bool = True):
        self.mock = mock
        self.validator = ProtocolValidator()
        self.current_state = {"cmd": "STOP", "speed": 0, "dir": "NONE"}
        self.last_drive_time = 0.0
        self.is_stopped = True

        if self.mock:
            print("[INFO] Running in MOCK mode (Hardware Serial disabled)")
        else:
            print("[INFO] Running in HARDWARE mode (Serial enabled)")

    def handle_message(self, raw_message: str):
        """รับและประมวลผลข้อความดิบผ่าน Validator"""
        is_valid, data, err = self.validator.parse_and_validate(raw_message)
        if not is_valid:
            print(f"[REJECT] Invalid packet: {err}")
            return

        cmd = data["cmd"]
        if cmd == "DRIVE":
            self.last_drive_time = time.time()
            self.is_stopped = False
            self.current_state = {
                "cmd": "DRIVE",
                "speed": data["speed"],
                "dir": data["dir"]
            }
            self._apply_drive(self.current_state)
        elif cmd == "STOP":
            self._apply_stop(reason="STOP command received")

    def check_failsafe(self):
        """ตรวจสอบ Timeout 300ms หากเกินให้สั่งหยุดทันที"""
        if not self.is_stopped:
            elapsed = time.time() - self.last_drive_time
            if elapsed > FAILSAFE_TIMEOUT_SEC:
                self._apply_stop(reason=f"Failsafe timeout ({elapsed*1000:.1f}ms > 300ms)")

    def _apply_drive(self, state: Dict[str, Any]):
        if self.mock:
            print(f"[MOCK ROBOT] DRIVE -> Direction: {state['dir']}, Speed: {state['speed']}")
        else:
            pass

    def _apply_stop(self, reason: str = ""):
        self.is_stopped = True
        self.current_state = {"cmd": "STOP", "speed": 0, "dir": "NONE"}
        if self.mock:
            print(f"[MOCK ROBOT] STOPPED -> {reason}")
        else:
            pass

def main():
    parser = argparse.ArgumentParser(description="RescueBot Controller")
    parser.add_argument("--mock", action="store_true", default=True, help="Run without real hardware")
    args = parser.parse_args()

    controller = RobotController(mock=args.mock)
    print("[READY] Robot controller started.")

    # ทดสอบจำลองส่งคำสั่ง DRIVE และ Failsafe
    print("\n--- Running automated failsafe test ---")
    controller.handle_message('{"cmd": "DRIVE", "seq": 1, "speed": 180, "dir": "FORWARD"}')
    time.sleep(0.35)
    controller.check_failsafe()
    print("--- End test ---\n")

if __name__ == "__main__":
    main()