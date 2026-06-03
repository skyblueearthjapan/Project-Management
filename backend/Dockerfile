FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Tokyo

# 必要最小限のシステム依存 (curl は healthcheck、libpq は asyncpg 念のため)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

COPY app ./app
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
