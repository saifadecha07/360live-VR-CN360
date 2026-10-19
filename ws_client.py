"""
ws_client.py - WebSocket Client for connecting to control server
"""
import asyncio
import json
import websockets

async def send_command(uri: str, command_dict: dict):
    """ส่งคำสั่ง JSON ผ่าน WebSocket ไปยังเซิร์ฟเวอร์"""
    try:
        async with websockets.connect(uri) as websocket:
            message = json.dumps(command_dict)
            await websocket.send(message)
            print(f"[SENT] {message}")
            response = await websocket.recv()
            print(f"[RECV] {response}")
    except Exception as e:
        print(f"[ERROR] Connection failed: {e}")

if __name__ == "__main__":
    # ตัวอย่างทดสอบส่งคำสั่งไปยัง localhost
    test_cmd = {"cmd": "DRIVE", "seq": 1, "speed": 150, "dir": "FORWARD"}
    asyncio.run(send_command("ws://localhost:8080/ws", test_cmd))