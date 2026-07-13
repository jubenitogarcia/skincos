#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error
import smtplib
from email.message import EmailMessage


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def parse_recipients(raw: str) -> list[str]:
    return [item.strip() for item in raw.replace(";", ",").split(",") if item.strip()]


def keychain_password() -> str:
    service = env("ALERT_SMTP_PASS_KEYCHAIN_SERVICE")
    account = env("ALERT_SMTP_PASS_KEYCHAIN_ACCOUNT", env("ALERT_SMTP_USER"))
    if not service or not account:
        return ""
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout.strip()
    except Exception:
        return ""


def send_webhook(subject: str, body: str) -> bool:
    webhook = env("ALERT_WEBHOOK_URL")
    if not webhook:
        return False
    payload = json.dumps({"subject": subject, "message": body}).encode("utf-8")
    req = urllib.request.Request(
        webhook,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            return True
    except urllib.error.URLError:
        return False


def send_smtp(subject: str, body: str) -> bool:
    host = env("ALERT_SMTP_HOST")
    port = int(env("ALERT_SMTP_PORT", "587") or "587")
    user = env("ALERT_SMTP_USER")
    password = env("ALERT_SMTP_PASS") or keychain_password()
    sender = env("ALERT_EMAIL_FROM", user or "monitor@localhost")
    recipients = parse_recipients(env("ALERT_EMAIL_TO"))
    use_tls = env("ALERT_SMTP_TLS", "true").lower() not in {"0", "false", "no"}

    if not host or not recipients:
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)

    password_candidates = [password]
    if password and (" " in password or "-" in password):
        normalized = password.replace(" ", "").replace("-", "")
        if normalized and normalized != password:
            password_candidates.append(normalized)

    if not user:
        password_candidates = [""]

    for current_password in password_candidates:
        try:
            with smtplib.SMTP(host, port, timeout=15) as client:
                client.ehlo()
                if use_tls:
                    client.starttls()
                    client.ehlo()
                if user and current_password:
                    client.login(user, current_password)
                elif user and not current_password:
                    continue
                client.send_message(msg)
                return True
        except smtplib.SMTPAuthenticationError:
            continue
        except Exception:
            return False
    return False


def send_macos_mail(subject: str, body: str) -> bool:
    recipients = parse_recipients(env("ALERT_EMAIL_TO"))
    if not recipients:
        return False

    escaped_subject = subject.replace("\\", "\\\\").replace('"', '\\"')
    escaped_body = body.replace("\\", "\\\\").replace('"', '\\"')
    recipients_script = "\n".join(
        [f'make new to recipient at end of to recipients with properties {{address:"{r}"}}' for r in recipients]
    )

    script = f'''
tell application "Mail"
  set newMessage to make new outgoing message with properties {{subject:"{escaped_subject}", content:"{escaped_body}", visible:false}}
  tell newMessage
    {recipients_script}
    send
  end tell
end tell
'''
    try:
        subprocess.run(["osascript", "-e", script], check=True, capture_output=True, text=True, timeout=20)
        return True
    except Exception:
        return False


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: send-alert.py <subject> <body>", file=sys.stderr)
        return 2

    subject = sys.argv[1]
    body = sys.argv[2]

    if send_webhook(subject, body):
        print("alert sent via webhook")
        return 0

    if send_smtp(subject, body):
        print("alert sent via smtp")
        return 0

    if send_macos_mail(subject, body):
        print("alert sent via macos-mail")
        return 0

    print("no alert channel configured (set ALERT_WEBHOOK_URL or SMTP vars + ALERT_EMAIL_TO)", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
