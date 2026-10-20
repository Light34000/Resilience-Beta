# ml/ — détection d'anomalies (Isolation Forest)

Explications complètes, résultats mesurés et limites : **`docs/02-reprise-idempotence-ml.md`, section 3**.

| Fichier | Rôle |
|---|---|
| `features.py` | Variables par client (`IP|agent`) et par fenêtre de 30 s, à partir du journal d'accès de la passerelle |
| `loki.py` | Lecture de ce journal dans Loki (direct depuis un conteneur, ou via le proxy Grafana depuis le PC) |
| `traffic.py` | Générateur de trafic : `normal` (base d'apprentissage) et attaques signées (`bruteforce`, `scan`, `enumeration`, `flood`, `payspam`, `stuffing`, option `--slow`) — **laboratoire uniquement** |
| `train.py` | Entraînement du modèle hybride : Isolation Forest + bornes (trafic normal) + classifieur supervisé (attaques étiquetées) → `model/model.joblib` + `model/model.json` |
| `compare.py` | Banc d'essai : IF, IF + bornes, ECOD, LOF, One-Class SVM, supervisé, hybrides (docs/02 §3.6) |
| `evaluate.py` | Taux de détection par attaque et taux de faux positifs |
| `detector.py` | Service temps réel : note le trafic toutes les 5 s, bloque, alerte la remédiation, trace dans l'audit |
| `Dockerfile`, `docker-compose.detector.yml`, `nginx.detector.conf` | Déploiement optionnel du détecteur et de la passerelle avec contrôle `auth_request` |

Démarrage rapide (PC Hôte, PowerShell ou bash) :

```bash
python -m venv ml/.venv && ml/.venv/Scripts/pip install -r ml/requirements.txt     # Linux/macOS : ml/.venv/bin/
export LOKI_URL=http://localhost:3000/api/datasources/proxy/uid/loki GRAFANA_USER=admin GRAFANA_PASSWORD=<.env>
ml/.venv/Scripts/python ml/traffic.py normal --users 8 --duration 900   # 15 min de trafic légitime
for a in scan enumeration flood payspam bruteforce; do ml/.venv/Scripts/python ml/traffic.py $a --duration 45; done
ml/.venv/Scripts/python ml/train.py --since 25m
docker compose -f docker-compose.yml -f ml/docker-compose.detector.yml up -d --build detector gateway
```

`model/` et `data/` sont ignorés par Git : le modèle est entraîné sur les données de votre propre pile.
