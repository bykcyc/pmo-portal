"""WP7: письма. Проверяем три вещи, которые молча не работали.

Молча — ключевое слово: отправка фоновая, ошибок пользователь не видит, поэтому «письмо
не ушло» обнаруживается только тогда, когда кто-то не узнал о своей задаче.
"""
import mailer


def test_outbox_does_not_leak_in_dry_run():
    """Подрезка жила в `finally` блока отправки, а dry-run возвращался ДО него. Так как SMTP
    не настроен, в dry-run уходят ВСЕ письма — и лимит был недостижим ровно в том режиме,
    ради которого его писали. Список рос без границ."""
    mailer.OUTBOX.clear()
    for i in range(mailer.OUTBOX_CAP + 50):
        mailer.send_email(f"u{i}@example.com", "тема", "тело")     # SMTP не настроен → dry-run
    assert len(mailer.OUTBOX) == mailer.OUTBOX_CAP
    assert mailer.OUTBOX[-1]["to"] == f"u{mailer.OUTBOX_CAP + 49}@example.com"   # хвост — свежий
    mailer.OUTBOX.clear()


def test_dry_run_is_marked_and_recorded():
    """Без SMTP письмо НЕ уходит, но должно быть видно в журнале — иначе «портал ничего не шлёт»
    выглядит как «портал сломан»."""
    mailer.OUTBOX.clear()
    rec = mailer.send_email("a@example.com", "тема", "тело")
    assert rec["sent"] is False and rec["dry_run"] is True
    assert mailer.OUTBOX == [rec]
    mailer.OUTBOX.clear()


def test_smtp_credentials_never_go_over_plaintext():
    """Логин/пароль SMTP не уходят по незашифрованному каналу — это утечка почтовых кредов."""
    mailer.OUTBOX.clear()
    mailer.configure({"host": "smtp.example.com", "from": "pm@example.com", "user": "pm@example.com",
                      "password": "secret", "starttls": False})
    try:
        rec = mailer.send_email("a@example.com", "тема", "тело")
        assert rec["sent"] is False
        assert "STARTTLS" in rec["error"]
        assert "secret" not in str(rec)          # пароль не утёк в журнал
    finally:
        mailer.configure({})
        mailer.OUTBOX.clear()
