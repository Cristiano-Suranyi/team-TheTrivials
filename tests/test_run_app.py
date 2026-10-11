"""Launcher checks must not start a second server or kill another application."""
import json
import unittest
from unittest.mock import patch, MagicMock
import run_app


class LauncherTests(unittest.TestCase):
    def test_free_port(self):
        with patch.object(run_app.socket, 'create_connection', side_effect=ConnectionRefusedError):
            self.assertFalse(run_app.existing_service(8787))

    def test_existing_hidden_exits_before_setup_or_start(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({'service': 'hidden', 'status': 'ok'}).encode()
        with patch.object(run_app.socket, 'create_connection'), patch.object(run_app, 'urlopen', return_value=response), \
             patch.object(run_app.sys, 'argv', ['run_app.py']), patch.object(run_app.subprocess, 'run') as setup:
            self.assertEqual(run_app.run(), 0)
            setup.assert_not_called()

    def test_unrelated_service_is_not_reused(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"status":"ok"}'
        with patch.object(run_app.socket, 'create_connection'), patch.object(run_app, 'urlopen', return_value=response):
            with self.assertRaisesRegex(SystemExit, 'another service'):
                run_app.existing_service(8787)

    def test_unresponsive_listener_has_clear_error(self):
        with patch.object(run_app.socket, 'create_connection'), patch.object(run_app, 'urlopen', side_effect=TimeoutError):
            with self.assertRaisesRegex(SystemExit, '--port 8788'):
                run_app.existing_service(8787)
