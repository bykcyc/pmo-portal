"""Конфиг связки Fireflies: флаги, списки ограничений и fail-fast в production."""
import logging

import pytest

import fireflies_sync as ffs
import main
import security


def test_flag_parsing():
    for v in ("1", "true", "TRUE", "yes", "on", " On "):
        assert ffs.env_flag(v) is True
    for v in ("", "0", "false", "no", "off", None, "maybe"):
        assert ffs.env_flag(v) is False


def test_list_parsing():
    assert ffs.env_list("102, 101 ,,101") == ("102", "101")
    assert ffs.env_list("") == ()
    assert ffs.env_list(None) == ()
    assert ffs.env_list(" A@EXAMPLE.com;b@example.com ", lower=True) == ("a@example.com", "b@example.com")


def test_everything_off_by_default():
    """Без явного включения связка не делает ничего: ни вебхука, ни воркера, ни комментариев."""
    assert main.FIREFLIES_ENABLED is False
    assert main.FIREFLIES_BITRIX_COMMENTS is False
    assert main.FIREFLIES_ALLOWED_PROJECTS == () and main.FIREFLIES_ALLOWED_HOSTS == ()


def _prod_ok(**ff):
    security.enforce_prod_secrets(
        environment={"ADAPTER_ENV": "production"}, secret=b"real-secret-abcdefghijklmnopqrstuvwxyz",
        users_fallback=False, bitrix_url="", bitrix_inbound_token="", logger=logging.getLogger("t"), **ff)


def test_prod_fails_fast_when_fireflies_enabled_without_secrets():
    with pytest.raises(RuntimeError, match="FIREFLIES_WEBHOOK_SECRET"):
        _prod_ok(fireflies_enabled=True, fireflies_api_key="k", fireflies_webhook_secret="")
    with pytest.raises(RuntimeError, match="FIREFLIES_API_KEY"):
        _prod_ok(fireflies_enabled=True, fireflies_api_key="", fireflies_webhook_secret="s")
    _prod_ok(fireflies_enabled=True, fireflies_api_key="k", fireflies_webhook_secret="s")
    _prod_ok(fireflies_enabled=False, fireflies_api_key="", fireflies_webhook_secret="")
    _prod_ok()  # прежние вызывающие (без аргументов Fireflies) не ломаются


def test_dev_does_not_fail_with_fireflies_enabled_without_secrets():
    security.enforce_prod_secrets(
        environment={}, secret=b"x", users_fallback=True, bitrix_url="", bitrix_inbound_token="",
        logger=logging.getLogger("t"), fireflies_enabled=True, fireflies_api_key="", fireflies_webhook_secret="")


def test_main_passes_fireflies_config_to_fail_fast(monkeypatch):
    seen = {}

    def fake(**kw):
        seen.update(kw)

    monkeypatch.setattr(main.security_ops, "enforce_prod_secrets", fake)
    monkeypatch.setattr(main, "FIREFLIES_ENABLED", True)
    monkeypatch.setattr(main, "FIREFLIES_API_KEY", "k")
    monkeypatch.setattr(main, "FIREFLIES_WEBHOOK_SECRET", "s")
    main._enforce_prod_secrets()
    assert (seen["fireflies_enabled"], seen["fireflies_api_key"], seen["fireflies_webhook_secret"]) == (True, "k", "s")


def test_prod_compose_declares_fireflies_variables_without_values():
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                        "deploy", "docker-compose.prod.yml")
    text = open(path, encoding="utf-8").read()
    for name in ("FIREFLIES_ENABLED", "FIREFLIES_API_KEY", "FIREFLIES_WEBHOOK_SECRET", "FIREFLIES_BITRIX_COMMENTS",
                 "FIREFLIES_ALLOWED_PROJECTS", "FIREFLIES_ALLOWED_HOSTS", "FIREFLIES_EXTRA_BITRIX_USERS"):
        assert f"{name}: ${{{name}:-}}" in text, name
