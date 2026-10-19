"""
test_protocol.py - Unit Tests for protocol parser and validator
"""
import unittest
from protocol import ProtocolValidator

class TestProtocolValidator(unittest.TestCase):
    def setUp(self):
        self.validator = ProtocolValidator()

    def test_valid_drive_command(self):
        msg = '{"cmd": "DRIVE", "seq": 1, "speed": 150, "dir": "FORWARD"}'
        valid, data, err = self.validator.parse_and_validate(msg)
        self.assertTrue(valid)
        self.assertEqual(data["cmd"], "DRIVE")
        self.assertEqual(data["speed"], 150)
        self.assertEqual(err, "")

    def test_valid_stop_command(self):
        msg = '{"cmd": "STOP", "seq": 1}'
        valid, data, err = self.validator.parse_and_validate(msg)
        self.assertTrue(valid)
        self.assertEqual(data["cmd"], "STOP")

    def test_invalid_json(self):
        msg = '{"cmd": "DRIVE", seq: 1'
        valid, _, err = self.validator.parse_and_validate(msg)
        self.assertFalse(valid)
        self.assertIn("Invalid JSON", err)

    def test_missing_fields(self):
        msg = '{"seq": 1}'
        valid, _, err = self.validator.parse_and_validate(msg)
        self.assertFalse(valid)
        self.assertIn("Missing required fields", err)

    def test_speed_out_of_range(self):
        msg = '{"cmd": "DRIVE", "seq": 1, "speed": 300, "dir": "FORWARD"}'
        valid, _, err = self.validator.parse_and_validate(msg)
        self.assertFalse(valid)
        self.assertIn("Speed out of range", err)

    def test_invalid_data_types(self):
        msg = '{"cmd": "DRIVE", "seq": "1", "speed": 100, "dir": "FORWARD"}'
        valid, _, err = self.validator.parse_and_validate(msg)
        self.assertFalse(valid)
        self.assertIn("'seq' must be an integer", err)

    def test_sequence_monotonicity(self):
        msg1 = '{"cmd": "DRIVE", "seq": 5, "speed": 100, "dir": "FORWARD"}'
        msg2 = '{"cmd": "DRIVE", "seq": 4, "speed": 100, "dir": "FORWARD"}'
        
        valid1, _, _ = self.validator.parse_and_validate(msg1)
        valid2, _, err2 = self.validator.parse_and_validate(msg2)
        
        self.assertTrue(valid1)
        self.assertFalse(valid2)
        self.assertIn("Out-of-order sequence", err2)

if __name__ == "__main__":
    unittest.main()