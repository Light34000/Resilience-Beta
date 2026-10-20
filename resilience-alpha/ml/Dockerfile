# Image du service « detector ». Contexte de build = racine du dépôt.
#   docker compose -f docker-compose.yml -f ml/docker-compose.detector.yml up -d --build detector gateway
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# Mêmes chemins relatifs que dans le dépôt : ml/requirements.txt inclut ../libs/common/requirements.txt
COPY libs/common/requirements.txt /build/libs/common/requirements.txt
COPY ml/requirements.txt /build/ml/requirements.txt
RUN pip install --no-cache-dir -r /build/ml/requirements.txt

COPY libs/common/resilience_common ./resilience_common
COPY ml/loki.py ml/features.py ml/detector.py ./

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER 10001

EXPOSE 8000
CMD ["uvicorn", "detector:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
