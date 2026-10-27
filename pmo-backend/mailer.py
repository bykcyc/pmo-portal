# -*- coding: utf-8 -*-
"""Email-транспорт адаптера. Если SMTP не настроен (нет host) — письма складываются
в OUTBOX (dry-run), чтобы логику уведомлений можно было проверить без реального сервера.
Конфиг берётся из настроек портала (admin UI, приоритет) или из env. Имя модуля НЕ email.py —
иначе затенит stdlib `email`."""
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.mime.text import MIMEText

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587") or 587)
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "noreply@pmo.local")
SMTP_STARTTLS = os.environ.get("SMTP_STARTTLS", "1") not in ("0", "false", "False")

OUTBOX: list = []  # dry-run, когда SMTP не настроен (последние письма видны через /admin/outbox)

# Переопределение из настроек портала (UI) — приоритет над env. Ставится main._apply_smtp().
_OVERRIDE: dict = {}


def configure(cfg) -> None:
    """Применить SMTP-конфиг из настроек портала (host/port/user/password/from/starttls);
    None/{} — вернуться к env-значениям."""
    global _OVERRIDE
    _OVERRIDE = dict(cfg or {})


def _cfg(key, env_default):
    v = _OVERRIDE.get(key)
    return v if v not in (None, "") else env_default


def is_configured() -> bool:
    return bool(_cfg("host", SMTP_HOST) and _cfg("from", SMTP_FROM))


OUTBOX_CAP = 200


def _record(rec: dict) -> dict:
    """Единственная точка записи в OUTBOX — она же и подрезает.

    Раньше подрезка жила в `finally` блока отправки, а dry-run возвращался ДО этого блока.
    Когда SMTP не настроен, в dry-run уходят ВСЕ письма — и OUTBOX рос без границ,
    то есть лимит был недостижим ровно в том режиме, ради которого его писали.
    """
    OUTBOX.append(rec)
    if len(OUTBOX) > OUTBOX_CAP:
        del OUTBOX[:-OUTBOX_CAP]
    return rec


def send_email(to: str, subject: str, body: str) -> dict:
    rec = {"to": to, "subject": subject, "body": body,
           "at": datetime.now(timezone.utc).isoformat(), "sent": False}
    if not to or not is_configured():
        rec["dry_run"] = True
        return _record(rec)
    host = _cfg("host", SMTP_HOST)
    port = int(_cfg("port", SMTP_PORT) or SMTP_PORT)
    smtp_user = _cfg("user", SMTP_USER)
    smtp_pw = _cfg("password", SMTP_PASSWORD)
    frm = _cfg("from", SMTP_FROM) or smtp_user or "noreply@pmo.local"
    starttls = _cfg("starttls", SMTP_STARTTLS)
    # Не отправляем логин/пароль SMTP по незашифрованному каналу (кроме локального релея):
    # это утечка почтовых кредов. Локалхост допускаем — им пользуются в разработке.
    if smtp_user and not starttls and str(host).lower() not in ("localhost", "127.0.0.1", "::1"):
        rec["error"] = "STARTTLS обязателен при отправке SMTP-учётных данных (иначе пароль уходит открытым текстом)"
        return _record(rec)
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = frm
        msg["To"] = to
        with smtplib.SMTP(host, port, timeout=15) as s:
            if starttls:
                s.starttls(context=ssl.create_default_context())
            if smtp_user:
                s.login(smtp_user, smtp_pw)
            s.sendmail(frm, [to], msg.as_string())
        rec["sent"] = True
    except Exception as e:  # noqa: BLE001
        rec["error"] = str(e)
    # Пишем в журнал и удачные отправки: «где мы используем письма» — вопрос, на который
    # админ должен уметь ответить, а не только «что не доставилось».
    return _record(rec)
