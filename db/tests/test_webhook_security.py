from __future__ import annotations

import unittest
from unittest.mock import patch

from db.src.webhook_security import validate_webhook_url


class WebhookSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def test_accepts_public_https_target(self):
        with patch("db.src.webhook_security._resolve_host", return_value={"93.184.216.34"}):
            self.assertEqual(
                await validate_webhook_url("https://example.com/hook"),
                "https://example.com/hook",
            )

    async def test_rejects_loopback(self):
        with patch("db.src.webhook_security._resolve_host", return_value={"127.0.0.1"}):
            with self.assertRaisesRegex(ValueError, "private or reserved"):
                await validate_webhook_url("http://localhost/hook")

    async def test_rejects_private_ipv6(self):
        with patch("db.src.webhook_security._resolve_host", return_value={"fd00::1"}):
            with self.assertRaisesRegex(ValueError, "private or reserved"):
                await validate_webhook_url("https://internal.example/hook")

    async def test_rejects_mixed_public_and_private_answers(self):
        answers = {"93.184.216.34", "169.254.169.254"}
        with patch("db.src.webhook_security._resolve_host", return_value=answers):
            with self.assertRaisesRegex(ValueError, "private or reserved"):
                await validate_webhook_url("https://example.com/hook")

    async def test_rejects_credentials(self):
        with self.assertRaisesRegex(ValueError, "credentials"):
            await validate_webhook_url("https://user:pass@example.com/hook")

    async def test_rejects_non_http_scheme(self):
        with self.assertRaisesRegex(ValueError, "http or https"):
            await validate_webhook_url("file:///etc/passwd")


if __name__ == "__main__":
    unittest.main()
