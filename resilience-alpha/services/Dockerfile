# Un seul Dockerfile pour tous les services Python. Contexte de build = racine du dépôt.
#   docker build -f services/Dockerfile --build-arg SERVICE=auth .
FROM python:3.12-slim

ARG SERVICE
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY libs/common/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY libs/common/resilience_common ./resilience_common
COPY services/${SERVICE}/app ./app

# Utilisateur non privilégié, sans shell de connexion
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER 10001

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
