from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from .config import Settings

log = logging.getLogger("ams.mail")


class MailError(Exception):
    pass


class Mailer:
    enabled = False

    def send(self, to: str, subject: str, body: str) -> None:
        raise MailError("E-mail is not configured on this server")


class SmtpMailer(Mailer):
    enabled = True

    def __init__(self, settings: Settings):
        self.host = settings.smtp_host
        self.port = settings.smtp_port
        self.security = settings.smtp_security
        self.username = settings.smtp_user
        self.password = settings.smtp_password
        self.sender = settings.smtp_from or settings.smtp_user

    def send(self, to: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = to
        message["Subject"] = subject
        message["Date"] = formatdate(localtime=False)
        message["Message-ID"] = make_msgid(domain="ams.invalid")
        message.set_content(body)

        tls = ssl.create_default_context()
        try:
            if self.security == "ssl":
                server: smtplib.SMTP = smtplib.SMTP_SSL(self.host, self.port, timeout=15, context=tls)
            else:
                server = smtplib.SMTP(self.host, self.port, timeout=15)
            with server:
                if self.security == "starttls":
                    server.starttls(context=tls)
                if self.username:
                    server.login(self.username, self.password or "")
                server.send_message(message)
        except (OSError, smtplib.SMTPException) as error:
            log.error("Sending e-mail failed: %s", error.__class__.__name__)
            raise MailError("The e-mail could not be sent") from error


class ConsoleMailer(Mailer):
    enabled = True

    def send(self, to: str, subject: str, body: str) -> None:
        print(f"\n--- e-mail (AMS_EMAIL_DEBUG) to {to} ---\n{subject}\n\n{body}\n---\n", flush=True)


def create_mailer(settings: Settings) -> Mailer:
    if settings.smtp_host:
        return SmtpMailer(settings)
    if settings.email_debug:
        return ConsoleMailer()
    return Mailer()
