"""Health, readiness and metrics routes for the PMO API."""

import hmac
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pmo_api import PmoApi

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response


def build_router(api: "PmoApi"):
    router = APIRouter()

    @router.get("/health")
    async def health():
        return {"status": "ok"}

    @router.get("/metrics")
    async def metrics(authorization: str = Header(default="")):
        """Return the legacy Prometheus text exposition payload."""
        metrics_token = api.os.environ.get("METRICS_TOKEN")
        # Default-deny в production: без METRICS_TOKEN эндпоинт закрыт (не отдаём разведданные о
        # маршрутах/трафике анонимам). В dev/test (не production) поведение прежнее → голдены не тронуты.
        if api.os.environ.get("ADAPTER_ENV", "").lower() == "production" and not metrics_token:
            raise HTTPException(status_code=403, detail="Forbidden")
        # Токен — только заголовком (`Authorization: Bearer …`, его умеет Prometheus). Прежний
        # ?token= оседал в журналах доступа Caddy и uvicorn вместе со строкой запроса.
        scheme, _, presented = authorization.partition(" ")
        presented = presented.strip() if scheme.lower() == "bearer" else ""
        # Байты, не str: compare_digest на str с не-ASCII бросает TypeError (был бы 500).
        if metrics_token and not hmac.compare_digest(presented.encode(), metrics_token.encode()):
            raise HTTPException(status_code=403, detail="Forbidden")  # constant-time (как auth-токены)

        output = [
            "# HELP pmo_requests_total Total HTTP requests",
            "# TYPE pmo_requests_total counter",
        ]
        for key, value in api._MX["count"].items():
            method, path = key.split(" ", 1)
            output.append(f'pmo_requests_total{{method="{method}",path="{path}"}} {value}')

        output += [
            "# HELP pmo_request_duration_seconds_sum Sum of request durations",
            "# TYPE pmo_request_duration_seconds_sum counter",
        ]
        for key, value in api._MX["sum"].items():
            method, path = key.split(" ", 1)
            output.append(
                f'pmo_request_duration_seconds_sum{{method="{method}",path="{path}"}} {value:.4f}'
            )

        output += [
            "# HELP pmo_errors_total HTTP 5xx responses",
            "# TYPE pmo_errors_total counter",
        ]
        for key, value in api._MX["err"].items():
            method, path = key.split(" ", 1)
            output.append(f'pmo_errors_total{{method="{method}",path="{path}"}} {value}')

        return Response(
            "\n".join(output) + "\n",
            media_type="text/plain; version=0.0.4",
        )

    @router.get("/ready")
    async def ready():
        """Readiness probe preserving the legacy ``openproject`` response key."""
        try:
            async with api.db.pool().acquire() as connection:
                await connection.execute("SELECT 1")
        except Exception:  # noqa: BLE001 - readiness intentionally maps all DB failures to 503
            raise HTTPException(status_code=503, detail="БД недоступна")
        return {"status": "ready", "openproject": "ok"}

    return router, health, metrics, ready
