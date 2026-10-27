FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# P0 hardening: run as a non-root user. The backend persists everything to
# PostgreSQL (no runtime filesystem writes), so an unprivileged user is safe.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8002
CMD ["uvicorn", "asgi:app", "--host", "0.0.0.0", "--port", "8002"]
