from __future__ import annotations

import socket
import threading

import pytest

from ams.config import Settings
from ams.mail import ConsoleMailer, Mailer, MailError, SmtpMailer, create_mailer


class TinySmtpServer:
    def __init__(self):
        self.socket = socket.socket()
        self.socket.bind(("127.0.0.1", 0))
        self.socket.listen(1)
        self.port = self.socket.getsockname()[1]
        self.commands: list[str] = []
        self.data = ""
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self):
        connection, _ = self.socket.accept()
        with connection, connection.makefile("rwb") as stream:
            def reply(line: str):
                stream.write(line.encode() + b"\r\n")
                stream.flush()

            reply("220 test ESMTP")
            while True:
                line = stream.readline().decode().rstrip("\r\n")
                if not line:
                    break
                self.commands.append(line.split(":")[0].upper() if ":" in line else line.split(" ")[0].upper())
                verb = line[:4].upper()
                if verb == "EHLO":
                    reply("250-test")
                    reply("250 AUTH PLAIN LOGIN")
                elif verb == "AUTH":
                    reply("235 ok")
                elif verb == "DATA":
                    reply("354 go")
                    lines = []
                    while (chunk := stream.readline().decode()) != ".\r\n":
                        lines.append(chunk)
                    self.data = "".join(lines)
                    reply("250 queued")
                elif verb == "QUIT":
                    reply("221 bye")
                    break
                else:
                    reply("250 ok")
        self.socket.close()


def settings(tmp_path, **extra) -> Settings:
    return Settings.from_env({"AMS_DATA_DIR": str(tmp_path), **extra})


def test_smtp_mailer_delivers_a_message(tmp_path):
    server = TinySmtpServer()
    mailer = create_mailer(
        settings(
            tmp_path,
            AMS_SMTP_HOST="127.0.0.1",
            AMS_SMTP_PORT=str(server.port),
            AMS_SMTP_SECURITY="none",
            AMS_SMTP_USER="ams@example.com",
            AMS_SMTP_PASSWORD="secret",
            AMS_SMTP_FROM="AMS <ams@example.com>",
        )
    )
    assert isinstance(mailer, SmtpMailer) and mailer.enabled
    mailer.send("maria@example.com", "Your AMS sign-in code", "Your verification code is: 123456\n")
    server.thread.join(timeout=5)

    assert "AUTH" in server.commands and "MAIL FROM" in server.commands and "RCPT TO" in server.commands
    assert "To: maria@example.com" in server.data
    assert "Subject: Your AMS sign-in code" in server.data
    assert "123456" in server.data


def test_smtp_failure_is_reported_as_a_mail_error(tmp_path):
    closed = socket.socket()
    closed.bind(("127.0.0.1", 0))
    port = closed.getsockname()[1]
    closed.close()
    mailer = create_mailer(settings(tmp_path, AMS_SMTP_HOST="127.0.0.1", AMS_SMTP_PORT=str(port), AMS_SMTP_SECURITY="none"))
    with pytest.raises(MailError):
        mailer.send("maria@example.com", "subject", "body")


def test_mail_is_disabled_unless_configured(tmp_path, capsys):
    disabled = create_mailer(settings(tmp_path))
    assert type(disabled) is Mailer and not disabled.enabled
    with pytest.raises(MailError):
        disabled.send("a@example.com", "s", "b")

    console = create_mailer(settings(tmp_path, AMS_EMAIL_DEBUG="1"))
    assert isinstance(console, ConsoleMailer)
    console.send("a@example.com", "subject", "code 654321")
    assert "654321" in capsys.readouterr().out
    assert settings(tmp_path, AMS_SMTP_SECURITY="bogus").smtp_security == "starttls"
