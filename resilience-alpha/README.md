# PROJECT RESILIENCE-ALPHA — Backend de la plateforme de paiement fictive

Plateforme de paiement **fictive** (aucune donnée réelle) conçue pour démontrer une **reprise autonome** après
incident : un incident est provoqué depuis le PC Attaquant, il est détecté, le moteur de remédiation agit seul,
puis la reprise est **prouvée** par une nouvelle transaction réussie et des données cohérentes.

Ce document s'adresse à toute l'équipe : backend, front React, Grafana/Prometheus/Loki, IA, cyber, gouvernance.

Documents détaillés : `docs/01-donnees-et-services.md` (structure des tables, fonctionnement de chaque service,
Swagger), `docs/02-reprise-idempotence-ml.md` (reprise sur erreur, idempotence, détection ML et blocage),
`docs/api/index.html` (visionneuse Swagger : `python -m http.server 8088 --directory docs/api`).
Les sections 9 (front) et 10 (observabilité) sont écrites pour ceux qui ne touchent pas au Python.

## Sommaire

1. [État d'avancement](#1-état-davancement)
2. [Démarrage rapide](#2-démarrage-rapide)
3. [Architecture](#3-architecture)
4. [Arborescence](#4-arborescence)
5. [Scripts et fichiers utilitaires](#5-scripts-et-fichiers-utilitaires)
6. [Configuration (.env)](#6-configuration-env)
7. [Les services](#7-les-services)
8. [Base de données](#8-base-de-données)
9. [Guide pour le front (React)](#9-guide-pour-le-front-react)
10. [Guide pour Grafana, Prometheus et Loki](#10-guide-pour-grafana-prometheus-et-loki)
11. [Scénario d'incident et de reprise](#11-scénario-dincident-et-de-reprise)
12. [Sécurité : choix et limites connues](#12-sécurité--choix-et-limites-connues)
13. [Tests, conventions, dépannage](#13-tests-conventions-dépannage)

---

## 1. État d'avancement

| Domaine | Statut |
|---|---|
| 7 services Python (auth, accounts, payments, notifications, audit, remediation, canary) | Écrits |
| `docker-compose.yml`, réseaux cloisonnés, durcissement des conteneurs | Écrits, syntaxe validée (`docker compose config`) |
| Passerelle Nginx (routage, limitation de débit, en-têtes de sécurité) | Écrite, **WAF à brancher** |
| Prometheus, Loki, Promtail, Grafana | Câblés ; 3 dashboards provisionnés (section 10.6) |
| Tests unitaires de la bibliothèque commune | 7 tests, passent |
| Parcours de bout en bout (`scripts/smoke.py`) | Exécuté sur une pile Docker réelle le 2026-10-19 : OK |
| Remédiation autonome (panne → redémarrage → preuve) | Vérifiée sur pile réelle le 2026-10-19 après deux correctifs (`events.py`, proxy Docker) |
| Front Next.js/Tailwind | Écrit : `frontend/` (voir `frontend/README.md`) |
| API de supervision pour le tableau de bord | Non nécessaire pour le front : état des services via la passerelle, incidents via l'audit (voir `frontend/README.md`) |
| Service de détection ML (`detector`) | Écrit, **optionnel** : `ml/` (Isolation Forest + garde-fous, détecteur temps réel, blocage à la passerelle), testé de bout en bout le 2026-10-19. Voir `docs/02-reprise-idempotence-ml.md` §3 |
| Assistant RAG (Ollama/LangChain), WAF, SIEM, Vault/SOPS, Ansible | Hors de ce dépôt backend |

Les durées indiquées dans ce document (délais de détection, de reprise) sont déduites du code et des valeurs
par défaut. Elles n'ont pas été mesurées sur une pile en fonctionnement.

## 2. Démarrage rapide

Prérequis : Docker Desktop (WSL2) démarré, Python 3.10+ pour les scripts.

```bash
python scripts/gen_env.py                  # crée .env avec des secrets aléatoires (jamais commité)
docker compose up -d --build               # construit et démarre toute la pile
docker compose ps                          # attendre que tout soit "healthy"
pip install httpx                          # dépendance du script de test (idéalement dans un venv)
python scripts/smoke.py                    # parcours complet : doit finir par "Tout est OK."
```

| Accès | Adresse | Remarque |
|---|---|---|
| API (passerelle) | `http://localhost:8080` | Seul port exposé au réseau 192.168.137.0/24 |
| Front Next.js | `http://localhost:3001` | Lié à `127.0.0.1`, accès local uniquement |
| Grafana | `http://localhost:3000` | Local au PC Hôte. Utilisateur `admin`, mot de passe `GRAFANA_ADMIN_PASSWORD` |
| PostgreSQL (DBeaver) | `localhost:5432` | **Optionnel**, voir ci-dessous |
| Prometheus, Loki, services | non publiés | Joignables uniquement depuis les conteneurs |

Accès DBeaver / psql à la base (port lié à `127.0.0.1` uniquement) :

```bash
docker compose -f docker-compose.yml -f docker-compose.dbeaver.yml up -d
```

Base `resilience`, utilisateur `pgadmin`, mot de passe `POSTGRES_ADMIN_PASSWORD`. Pour refermer l'accès, relancer
`docker compose up -d` sans le second fichier.

Arrêt : `docker compose down`. Remise à zéro complète (efface la base) : `docker compose down -v`.

## 3. Architecture

```
   PC Attaquant                  PC Hôte (Docker Desktop, 192.168.137.1)
   192.168.137.x
        │ :8080                  ┌───────────────────────────────────────────────────────────────────┐
        ▼                        │  réseau "edge"          réseau "backend" (interne, sans Internet)  │
  ┌───────────┐ (WAF à brancher) │                                                                   │
  │  gateway  │──────────────────┼─► auth ───────────┐                                               │
  │  (Nginx)  │──────────────────┼─► accounts ◄──────┤ chaque service lit/écrit SON schéma           │
  └───────────┘──────────────────┼─► payments ──► accounts   (transfert, idempotent par tx_id)      │
        ▲                        │     │ └──► notifications                  ▼                       │
        │                        │     └──────► audit  ◄── tous les services   postgres             │
        │ transaction réelle     │                                   (1 schéma + 1 rôle par service) │
        └────────────────────────┼─ canary ──(alerte)──► remediation ──► proxy Docker restreint ──► conteneurs
                                 │  prometheus ◄─ /metrics     loki ◄─ promtail ◄─ logs des conteneurs │
                                 │  grafana (127.0.0.1:3000) lit prometheus + loki                   │
                                 └───────────────────────────────────────────────────────────────────┘
```

**Réseaux Docker**

| Réseau | Interne ? | Contenu | Rôle |
|---|---|---|---|
| `edge` | non | gateway, grafana | Passerelle accessible depuis le réseau local ; Grafana en local |
| `frontend` | non | frontend, gateway | Réseau dédié au front ; accès API uniquement via la passerelle |
| `backend` | **oui** | tous les services, postgres, prometheus, loki, promtail | Pas d'accès Internet, pas de port publié |
| `remediation` | **oui** | remediation, docker-proxy-remediation | Isole le seul composant qui touche à Docker |
| `obs` | **oui** | promtail, docker-proxy-ro | Lecture des conteneurs par Promtail |

Le front est raccordé à un réseau dédié partagé uniquement avec la passerelle ; son port est publié uniquement sur
`127.0.0.1`. La passerelle reste le seul service publié sur le réseau local. L'accès DBeaver passe par un fichier
compose séparé qui ajoute un réseau dédié.

**Principes de conception à connaître**

- **Un seul point d'entrée** : tout le trafic externe passe par la passerelle. Les routes `/internal/*`, `/metrics`,
  `/ready` et `/docs` n'y sont volontairement pas routées (404).
- **Moindre privilège** : un rôle PostgreSQL et un schéma par service ; aucun service n'exécute de DDL ; les
  appels entre services sont authentifiés par un jeton de service qui nomme l'appelant.
- **Preuve de reprise** : un conteneur qui redémarre ne prouve rien. La reprise est validée par (1) `/ready` du
  service, (2) une **nouvelle transaction réussie** exécutée par la sonde `canary`, (3) un contrôle de
  **cohérence** soldes/écritures.
- **Pas de redémarrage automatique des services métier** : `restart: "no"` est voulu sur auth, accounts,
  payments, notifications. Si Docker les relançait seul, la démonstration de remédiation serait faussée. Un
  service arrêté le reste tant que le moteur de remédiation ne le relance pas. Audit, remediation, canary et la
  pile d'observabilité sont en `restart: unless-stopped`.
- **Pas de socket Docker dans les services** : le moteur de remédiation passe par un proxy qui n'autorise que
  l'inspection et le redémarrage/arrêt de conteneurs.

## 4. Arborescence

```
resilience-alpha/
├── docker-compose.yml             # toute la pile (services, réseaux, observabilité)
├── docker-compose.dbeaver.yml     # option : publie PostgreSQL sur 127.0.0.1:5432
├── .env.example                   # modèle de configuration (aucun secret)
├── requirements-dev.txt           # dépendances locales : bibliothèque commune + pytest
├── .gitignore / .dockerignore     # .env exclu de Git et des images
├── .gitattributes                 # force LF sur .sh/.sql/.yml/.conf (évite "bad interpreter" sous Windows)
│
├── gateway/
│   └── nginx.conf                 # routage /api/*, limitation de débit du login, logs JSON, en-têtes
├── db/init/
│   ├── 01-roles.sh                # rôles svc_* et schémas (exécuté une seule fois, à la création du volume)
│   └── 02-schema.sql              # tables, contraintes, droits (GRANT)
│
├── libs/common/
│   ├── requirements.txt           # dépendances Python communes à tous les services
│   └── resilience_common/         # bibliothèque partagée (voir 7.8)
│       ├── app.py                 # fabrique FastAPI : /health, /ready, /metrics, middleware
│       ├── security.py            # JWT, bcrypt, rôles, jetons de service
│       ├── logs.py                # logs JSON, request_id, log_event()
│       ├── metrics.py             # compteurs et histogrammes HTTP
│       ├── events.py              # audit() et notify() : émission d'événements
│       ├── db.py                  # pool asyncpg restreint au schéma du service
│       └── config.py              # lecture des variables d'environnement
│
├── services/
│   ├── Dockerfile                 # image unique, paramétrée par SERVICE (utilisateur non root)
│   ├── auth/app/main.py           # comptes utilisateurs, login, JWT
│   ├── accounts/app/main.py       # comptes bancaires fictifs + ledger (écritures)
│   ├── payments/app/main.py       # paiements, idempotence, réconciliation
│   ├── notifications/app/main.py  # notifications simulées
│   ├── audit/app/main.py          # piste d'audit chaînée par hachage
│   ├── remediation/app/main.py    # moteur de remédiation (liste blanche, disjoncteur, preuve de reprise)
│   └── canary/app/main.py         # sonde : transaction réelle de bout en bout
│
├── infra/
│   ├── prometheus/prometheus.yml  # cibles scrapées toutes les 5 s
│   ├── promtail/promtail.yml      # collecte des logs des conteneurs vers Loki
│   └── grafana/provisioning/
│       ├── alerting/                                      # Règles et contact points Grafana
│       ├── datasources/datasources.yml                    # Prometheus (défaut) + Loki
│       └── dashboards/                                     # Dashboards provisionnés
│
├── scripts/                       # voir section 5
├── tests/                         # tests pytest de la bibliothèque commune
└── docs/api/*.openapi.json        # spécification OpenAPI de chaque service (générée)
```

## 5. Scripts et fichiers utilitaires

| Fichier | Rôle | Quand l'utiliser |
|---|---|---|
| `scripts/gen_env.py` | Crée `.env` depuis `.env.example` en remplaçant chaque `CHANGE_ME` par un secret aléatoire. Stdlib uniquement : pas de venv nécessaire. Refuse d'écraser un `.env` existant sans `--force`. | Une fois, avant le premier `docker compose up`. Après `--force`, faire aussi `docker compose down -v` : les mots de passe de la base changent. |
| `scripts/smoke.py` | Parcours de bout en bout via la passerelle : inscription, mauvais mot de passe, connexion, API protégée, 2 comptes, paiement, rejeu idempotent, soldes, solde insuffisant, plafond, notification, intégrité de l'audit. Quitte avec un code ≠ 0 au premier échec. Nécessite `httpx`. | Après chaque démarrage, et juste avant la démo. `ADMIN_PASSWORD=... python scripts/smoke.py` ajoute la vérification de la chaîne d'audit. `BASE_URL=http://192.168.137.1:8080` pour le lancer depuis un autre poste. |
| `scripts/export_openapi.py` | Génère `docs/api/<service>.openapi.json` en important chaque application. Nécessite `pip install -r requirements-dev.txt`. | Après toute modification d'un endpoint. Livrable « documentation d'API ». |
| `db/init/01-roles.sh` | Crée les 5 rôles `svc_*` (mots de passe issus de `.env`) et les 5 schémas. | Automatique, **uniquement à la création du volume `pgdata`**. |
| `db/init/02-schema.sql` | Crée les tables et accorde les droits minimaux. | Idem. Modifier ce fichier n'a aucun effet sur une base existante : `docker compose down -v` pour réappliquer. |
| `services/Dockerfile` | Construit n'importe quel service : `--build-arg SERVICE=<nom>`. Copie la bibliothèque commune et le code du service. | Utilisé par le compose. |
| `docker-compose.dbeaver.yml` | Publie PostgreSQL sur `127.0.0.1:5432` pour DBeaver. | Développement et démonstration du modèle de données. |
| `tests/` | `PYTHONPATH=libs/common pytest tests` : hachage, JWT (expiré, mauvaise signature), format des logs, contrôle d'accès. | Avant un commit. |

## 6. Configuration (.env)

Le `.env` est généré par `gen_env.py` et **ne doit jamais être commité ni inclus dans l'archive de rendu**.
Cible industrielle : migrer vers Vault ou SOPS.

| Variable | Défaut | Rôle |
|---|---|---|
| `JWT_SECRET` | généré | Clé de signature HS256, partagée par tous les services |
| `POSTGRES_ADMIN_PASSWORD` | généré | Compte `pgadmin` (superuser), jamais utilisé par les services |
| `AUTH_DB_PASSWORD`, `ACCOUNTS_DB_PASSWORD`, `PAYMENTS_DB_PASSWORD`, `NOTIFICATIONS_DB_PASSWORD`, `AUDIT_DB_PASSWORD` | généré | Mots de passe des rôles `svc_*` |
| `ADMIN_PASSWORD` | généré | Mot de passe du compte `admin` créé au démarrage de `auth` (identifiant fixe : `admin`) |
| `CANARY_PASSWORD` | généré | Mot de passe du compte `canary-bot`, créé automatiquement par la sonde |
| `GRAFANA_ADMIN_PASSWORD` | généré | Compte `admin` de Grafana |
| `GRAFANA_DISCORD_WEBHOOK_URL` | à fournir dans `.env` | URL secrète du webhook du contact point Discord ; jamais commiter |
| `LOG_LEVEL` | `INFO` | Niveau de log de tous les services |
| `PAYMENT_MAX_AMOUNT` | `5000` | Plafond d'un paiement |
| `CANARY_ALERTS_ENABLED` | `true` | Si `false`, la sonde mesure mais n'alerte pas (utile pour tester le détecteur ML seul) |

Réglages avancés (variables d'environnement des conteneurs, non listées dans `.env.example`, à ajouter à la
section `environment` du service concerné dans le compose) :

| Variable | Service | Défaut | Rôle |
|---|---|---|---|
| `ACCESS_TTL_SECONDS` | auth | 900 | Durée de vie du jeton d'accès (15 min) |
| `LOGIN_MAX_FAILURES` / `LOGIN_WINDOW_SECONDS` | auth | 5 / 60 | Blocage après échecs, par IP et par compte |
| `RECONCILE_INTERVAL_SECONDS` | payments | 15 | Fréquence de rejeu des paiements `pending` |
| `PROBE_INTERVAL_SECONDS` | canary | 5 | Fréquence de la transaction de sonde |
| `PROBE_FAILURES_BEFORE_ALERT` | canary | 3 | Échecs consécutifs avant alerte |
| `RECOVERY_TIMEOUT_SECONDS` | remediation | 90 | Attente maximale du retour d'un service |
| `REMEDIATION_MAX_PER_WINDOW` / `REMEDIATION_WINDOW_SECONDS` | remediation | 3 / 600 | Disjoncteur : max de remédiations par service et fenêtre |

Variables **injectées par le compose** (adresses internes et connexion ; à ne modifier que pour ajouter un service) :

| Variable | Utilisée par | Valeur |
|---|---|---|
| `DATABASE_URL` | auth, accounts, payments, notifications, audit | `postgresql://svc_<service>:<mot de passe>@postgres:5432/resilience` |
| `AUDIT_URL`, `NOTIFICATIONS_URL` | tous (via `events.py`) | `http://audit:8000`, `http://notifications:8000` ; si absentes, l'émission est ignorée |
| `ACCOUNTS_URL` | payments, remediation, canary | `http://accounts:8000` |
| `CANARY_URL`, `REMEDIATION_URL` | remediation / canary | `http://canary:8000`, `http://remediation:8000` |
| `GATEWAY_URL` | canary | `http://gateway:8080` (la sonde passe par la porte d'entrée, comme un client) |
| `DOCKER_API_URL` | remediation | `http://docker-proxy-remediation:2375` (jamais le socket Docker) |
| `ADMIN_USERNAME`, `CANARY_USERNAME` | auth, canary | Non définies dans le compose : défauts `admin` et `canary-bot` |

## 7. Les services

Tous les services sont des applications FastAPI construites par la même fabrique (`create_app`) et exposent donc
tous, en interne : `GET /health` (le processus répond), `GET /ready` (la base répond, sinon 503) et
`GET /metrics` (Prometheus). Port interne : **8000**. Tous les endpoints `/api/*` passent par la passerelle ;
les endpoints `/internal/*` ne sont atteignables qu'entre conteneurs.

| Service | Schéma BDD | Rôle en une phrase | Redémarré par Docker |
|---|---|---|---|
| auth | `auth` | Inscription, connexion, émission des JWT | non (remédiation) |
| accounts | `accounts` | Comptes et ledger, intégrité des soldes | non (remédiation) |
| payments | `payments` | Création et règlement des paiements | non (remédiation) |
| notifications | `notifications` | Notifications client (envoi simulé) | non (remédiation) |
| audit | `audit` | Piste d'audit infalsifiable | oui |
| remediation | aucun | Reprend les services en panne et prouve la reprise | oui |
| canary | aucun | Exécute en continu une vraie transaction | oui |

### 7.1 auth

Gère les utilisateurs et délivre les jetons. Les mots de passe sont hachés avec bcrypt (jamais stockés en clair).

| Endpoint | Accès | Description |
|---|---|---|
| `POST /api/auth/register` | public | Crée un compte `customer`. 409 si le nom est pris |
| `POST /api/auth/login` | public | Retourne un JWT. 401 identifiants invalides, 429 trop de tentatives |
| `GET /api/auth/me` | jeton | Identité du porteur du jeton |

- Au démarrage, crée le compte `admin` (rôle `admin`) si `ADMIN_PASSWORD` est défini.
- Anti-force brute à deux niveaux : Nginx (10 requêtes/min par IP sur le login, rafale de 5, puis 429) et le
  service (5 échecs par minute par IP **et** par compte, puis 429 avec `Retry-After`). Les compteurs sont en mémoire :
  ils sont remis à zéro quand le service redémarre.
- Le temps de réponse est identique que le compte existe ou non (pas d'énumération d'utilisateurs).
- Émet des événements d'audit : `user_registered`, `login_success`, `login_failed`, `login_blocked`.

### 7.2 accounts (comptes et ledger)

Source de vérité des soldes. Un **ledger** enregistre chaque mouvement sous forme d'écritures immuables
(débit/crédit). Invariant : *le solde d'un compte = somme de ses écritures*.

| Endpoint | Accès | Description |
|---|---|---|
| `POST /api/accounts` | customer, admin | Ouvre un compte. **Démo** : crédit initial fictif (`initial_balance`, défaut 1000.00, max 100000) |
| `GET /api/accounts/me` | jeton | Comptes du porteur du jeton |
| `GET /api/accounts/{id}` | propriétaire ou admin | Un compte. 404 aussi si le compte appartient à un autre (pas d'énumération) |
| `POST /internal/transfer` | service `payments` uniquement | Transfert atomique débit + crédit |
| `GET /internal/integrity` | admin, service | Compare chaque solde à la somme de ses écritures |

Le transfert : verrouille les deux comptes dans un ordre fixe (pas d'interblocage), vérifie propriétaire, devise
et solde, applique débit/crédit et écritures dans **une seule transaction**. Il est **idempotent** par `tx_id`
(identifiant du paiement) : un rejeu retourne `already_applied` sans rien débiter de plus.
Refus possibles : `account_not_found` (404), `not_account_owner` (403), `currency_mismatch`,
`insufficient_funds`, `same_account` (422).

`/internal/integrity` est la **preuve de cohérence des données** après reprise : utilisé par la sonde et par le
moteur de remédiation. Une incohérence journalise `integrity_violation` (niveau ERROR).

### 7.3 payments

Orchestre un paiement : enregistre une demande puis demande le transfert au ledger.

| Endpoint | Accès | Description |
|---|---|---|
| `POST /api/payments` | customer, admin | Crée un paiement. **En-tête `Idempotency-Key` obligatoire** (8 à 64 caractères) |
| `GET /api/payments` | jeton | Ses propres paiements, du plus récent au plus ancien (`?limit=`, 1 à 200, défaut 50) |
| `GET /api/payments/{id}` | propriétaire ou admin | Un paiement |

Cycle de vie : `pending` → `completed` ou `failed` (avec `failure_reason`).

- **Idempotence** : même `Idempotency-Key` + même corps = même paiement (HTTP 200 au lieu de 201, aucun double
  débit). Même clé avec un corps différent : 409.
- **Résilience** : si le ledger est injoignable ou en erreur transitoire (5xx, 401, 408, 429), le paiement reste
  `pending` et la requête reçoit un **503** avec `Retry-After: 5`. Une boucle de **réconciliation** (toutes les
  15 s) rejoue les paiements `pending` de plus de 10 s : après la reprise du ledger, ils se règlent sans doublon.
- Refus métier (solde insuffisant, compte introuvable…) : le paiement est enregistré en `failed` et la réponse est
  un **201** avec `status: "failed"` ; seules les violations de plafond (> `PAYMENT_MAX_AMOUNT`) ou de comptes
  identiques sont refusées en **422**, sans enregistrement.
- Événements : audit `payment_completed` / `payment_failed` / `payment_rejected`, notification au client,
  métrique `payments_total{status}`.

### 7.4 notifications

Reçoit des événements métier et les enregistre comme notifications. L'envoi (email) est **simulé** : il est
journalisé avec `channel="email_simulated"`.

| Endpoint | Accès | Description |
|---|---|---|
| `POST /internal/events` | services `payments`, `auth`, `remediation` | Crée une notification |
| `GET /api/notifications/me` | jeton | Notifications du porteur (`?limit=`, 1 à 200) |

Aujourd'hui seule `payments` émet des notifications (`payment_completed`, `payment_failed`).

### 7.5 audit

Piste **métier et sécurité** en ajout seul : connexions, paiements, actions de remédiation. Elle complète les
logs techniques (stdout → Promtail → Loki).

- Chaque événement contient le hash du précédent (`prev_hash`) : modifier ou supprimer une ligne casse la chaîne.
- Le rôle PostgreSQL `svc_audit` n'a **ni UPDATE ni DELETE**.
- Le nom du service émetteur vient du jeton, pas du corps de la requête : un service ne peut pas écrire sous le
  nom d'un autre.

| Endpoint | Accès | Description |
|---|---|---|
| `POST /internal/events` | tout service | Ajoute un événement |
| `GET /api/audit/events` | admin | Liste filtrable (`service`, `action`, `limit` jusqu'à 500) |
| `GET /api/audit/verify` | admin | Recalcule toute la chaîne : `{valid, checked, first_invalid_id}` |

Actions auditées : `user_registered`, `login_success`, `login_failed`, `login_blocked`, `account_opened`,
`payment_completed`, `payment_failed`, `payment_rejected`, `incident_opened`, `incident_resolved`,
`incident_failed`, `incident_escalated`, `incident_suppressed`.

### 7.6 remediation (moteur de remédiation)

Reçoit une alerte, agit sur le service concerné, puis **prouve** la reprise. Non exposé par la passerelle.

| Endpoint | Accès | Description |
|---|---|---|
| `POST /internal/alerts` | services `detector` ou `canary` uniquement | Ouvre un incident (HTTP 202) |
| `GET /internal/incidents` | admin, service | Liste (200 derniers, en mémoire) |
| `GET /internal/incidents/{id}` | admin, service | Détail avec **chronologie** (`timeline`) |

Corps d'une alerte :

```json
{ "source": "detector", "service": "payments", "type": "service_down",
  "severity": "high", "score": 0.97, "details": {} }
```

`service` ∈ `auth | accounts | payments | notifications` ; `type` ∈ `service_down | availability_degraded | anomaly` ;
`severity` ∈ `low | medium | high | critical`.

Déroulé d'un incident (`status`) : `detected` → `remediating` → `verifying` → **`resolved`**, ou une fin
anormale : `failed`, `escalated`, `suppressed`.

1. **Si `type = anomaly`** : vérification préalable. Si le service est sain (`/ready` OK et sonde OK), **aucune
   action** : statut `escalated`. Raison : une anomalie sans perte de service évoque une compromission, et
   redémarrer effacerait les preuves sans corriger quoi que ce soit.
2. Sinon, redémarrage du conteneur via le proxy Docker restreint.
3. Attente du retour de `/ready` (jusqu'à 90 s), puis jusqu'à 5 tentatives de **transaction de contrôle** via la sonde.
4. Contrôle d'**intégrité** du ledger. Incohérence : `failed` avec renvoi vers la restauration (PRA).
5. `resolved` : transaction réussie **et** données cohérentes.

Garde-fous : **liste blanche** de 4 conteneurs (`rsl-auth`, `rsl-accounts`, `rsl-payments`, `rsl-notifications`,
jamais Postgres, ni lui-même, ni le proxy) ; **déduplication** (un seul incident actif par service) ;
**disjoncteur** (3 remédiations par service en 10 min, ensuite `suppressed` et escalade humaine).

Brancher le détecteur ML : le service `detector` doit (1) être sur le réseau `backend`, (2) poster sur
`http://remediation:8000/internal/alerts`, (3) présenter un JWT de service : HS256 signé avec `JWT_SECRET`, claims
`iss="resilience-alpha"`, `sub="detector"`, `role="service"`, `exp` courte. Le plus simple en Python :
`from resilience_common.security import service_token; service_token("detector")`.

Métriques : `remediation_incidents_total{service,status}`, `remediation_active_incidents`,
`remediation_recovery_seconds` (histogramme : durée alerte → service prouvé rétabli).

L'historique des incidents est **en mémoire** : il est perdu si le moteur redémarre. La trace durable est dans
l'audit et dans Loki (événement `remediation_step`).

### 7.7 canary (sonde synthétique)

Toutes les 5 s, exécute une **vraie transaction** via la passerelle, comme un client : connexion (compte
`canary-bot`, créé automatiquement), ouverture de deux comptes au premier passage, paiement de **0,01 EUR**
alterné entre les deux, puis contrôle d'intégrité. Elle vérifie aussi `/ready` de chaque service pour désigner le
fautif.

- Après **3 échecs consécutifs** (≈ 15 s), alerte vers `remediation` (désactivable par `CANARY_ALERTS_ENABLED=false`),
  avec un délai de 30 s entre deux alertes sur le même service. C'est le filet de sécurité déterministe ;
  le déclencheur principal prévu est le détecteur ML.
- C'est elle qui alimente le tableau de bord en état **avant / pendant / après** (métriques `canary_*`).

| Endpoint | Accès | Description |
|---|---|---|
| `GET /internal/probe` | admin, service | Exécute une sonde immédiate (utilisé par la remédiation) |
| `GET /internal/status` | admin, service | Dernier résultat et nombre d'échecs consécutifs |
| `GET /internal/history` | admin, service | 120 derniers résultats |

Attention au volume : la sonde crée **un paiement, une notification et un événement d'audit toutes les 5 s**
(environ 17 000 paiements par jour). Cela compte dans `payments_total` et dans les métriques HTTP, et
`/api/audit/verify` est plafonné à 100 000 événements. Pour distinguer le trafic de la sonde, utiliser
l'utilisateur `canary-bot` (tables), ou le `user_agent` `resilience-canary/1.0` (logs de la passerelle ; posé sur la
requête de paiement uniquement).

### 7.8 Bibliothèque commune (`libs/common/resilience_common`)

Code partagé par tous les services (copié dans chaque image).

| Module | Contenu |
|---|---|
| `app.py` | `create_app()` : logs JSON, métriques, `/health`, `/ready`, `/metrics`, gestionnaire d'erreur global (500 sans fuite de détails), pool Postgres. Génère un `x-request-id` (repris de la passerelle) renvoyé dans la réponse |
| `security.py` | bcrypt, création/décodage JWT, dépendances `require_roles(...)` et `require_service(...)` |
| `logs.py` | Format JSON ; `log_event(logger, "nom_evenement", **champs)` ; `request_id` dans chaque ligne |
| `metrics.py` | `http_requests_total` et `http_request_duration_seconds` |
| `events.py` | `audit(...)` et `notify(...)` : envoi **asynchrone, au mieux** (timeout 2 s). Une panne d'audit ou de notifications ne fait jamais échouer un paiement ; l'échec est journalisé (`event_delivery_failed`) |
| `db.py` | Pool asyncpg dont le `search_path` est limité au schéma du service ; réessaie 30 s au démarrage |
| `config.py` | `env("NOM", defaut, required=True)` |

Ajouter un service : créer `services/<nom>/app/main.py` avec `app = create_app("<nom>", db_schema="<schéma>")`,
l'ajouter au compose (copier un bloc existant), à `infra/prometheus/prometheus.yml` et à `scripts/export_openapi.py`.

## 8. Base de données

PostgreSQL 16, base `resilience`, **un schéma par service**. Chaque service se connecte avec son propre rôle
(`svc_<service>`) qui n'a de droits que sur son schéma ; son `search_path` est réglé sur ce schéma, d'où des
requêtes sans préfixe dans le code. Aucune clé étrangère entre schémas : les références inter-services
(`owner_id`, `created_by`, `from_account`…) sont **logiques** et validées par les services, pour garder les
domaines indépendants.

```
auth.users ──(id)──► accounts.accounts.owner_id
                     accounts.accounts ──(id)──► accounts.ledger_entries.account_id   (clé étrangère réelle)
                     accounts.accounts ──(id)──► payments.payments.from_account / to_account   (logique)
auth.users ──(id)──► payments.payments.created_by ; notifications.notifications.user_id   (logique)
payments.payments.id ═══► accounts.ledger_entries.tx_id    (le paiement est la transaction du ledger)
audit.events                                              (indépendante, chaînée par hash)
```

### auth.users

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, généré |
| `username` | text | NOT NULL, **UNIQUE** (stocké en minuscules) |
| `password_hash` | text | NOT NULL (bcrypt) |
| `role` | text | NOT NULL, `'customer'` ou `'admin'` |
| `created_at` | timestamptz | NOT NULL, défaut `now()` |

Droits de `svc_auth` : SELECT, INSERT.

### accounts.accounts

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, généré |
| `owner_id` | uuid | NOT NULL, indexé (référence logique `auth.users.id`) |
| `currency` | char(3) | NOT NULL, défaut `'EUR'` |
| `balance` | numeric(18,2) | NOT NULL, défaut 0, **CHECK ≥ 0** : pas de découvert, garanti par la base |
| `created_at` | timestamptz | NOT NULL |

### accounts.ledger_entries

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | bigserial | PK |
| `tx_id` | uuid | NOT NULL, indexé. = `payments.payments.id` ; aléatoire pour un crédit initial |
| `account_id` | uuid | NOT NULL, **FK** → `accounts.accounts(id)`, indexé |
| `direction` | text | NOT NULL, `'debit'` ou `'credit'` |
| `amount` | numeric(18,2) | NOT NULL, **CHECK > 0** |
| `created_at` | timestamptz | NOT NULL |

`UNIQUE (tx_id, account_id, direction)` : garantit l'idempotence des transferts même sous concurrence. Un transfert
produit 2 lignes (un débit, un crédit) avec le même `tx_id`. Droits de `svc_accounts` : SELECT, INSERT, UPDATE sur
`accounts` ; **SELECT, INSERT seulement** sur `ledger_entries` (écritures immuables).

### payments.payments

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, généré (devient le `tx_id` du ledger) |
| `idempotency_key` | text | NOT NULL |
| `created_by` | uuid | NOT NULL (référence logique `auth.users.id`) |
| `from_account`, `to_account` | uuid | NOT NULL (références logiques) |
| `amount` | numeric(18,2) | NOT NULL, **CHECK > 0** |
| `currency` | char(3) | NOT NULL, défaut `'EUR'` |
| `status` | text | NOT NULL, `'pending'`, `'completed'` ou `'failed'` |
| `failure_reason` | text | NULL sauf si `failed` (ex. `insufficient_funds`, `account_not_found`, `not_account_owner`, `currency_mismatch`) |
| `created_at`, `updated_at` | timestamptz | NOT NULL |

`UNIQUE (created_by, idempotency_key)` porte l'idempotence. Index sur `(status, created_at)` (réconciliation) et
`(created_by, created_at DESC)` (historique). Droits : SELECT, INSERT, UPDATE.

### notifications.notifications

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | NOT NULL, indexé avec `created_at DESC` |
| `kind` | text | NOT NULL (ex. `payment_completed`) |
| `message` | text | NOT NULL |
| `data` | jsonb | NOT NULL, défaut `{}` (ex. `payment_id`) |
| `status` | text | NOT NULL, défaut `'sent'` |
| `created_at` | timestamptz | NOT NULL |

Droits : SELECT, INSERT.

### audit.events

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | bigserial | PK (ordre de la chaîne) |
| `ts` | timestamptz | NOT NULL, indexé |
| `service` | text | NOT NULL (émetteur, imposé par le jeton) |
| `action` | text | NOT NULL, indexé |
| `actor` | text | NULL (nom d'utilisateur ou identifiant) |
| `outcome` | text | NOT NULL (`success`, `failure`, `denied`) |
| `details` | jsonb | NOT NULL |
| `prev_hash`, `hash` | text | NOT NULL. `hash = SHA-256(prev_hash ∣ ts ∣ service ∣ action ∣ actor ∣ outcome ∣ details)` ; le premier événement a pour `prev_hash` 64 zéros |

Droits de `svc_audit` : SELECT, INSERT uniquement.

### Requêtes utiles (DBeaver)

```sql
-- Cohérence des soldes : doit retourner 0 ligne
SELECT a.id, a.balance, COALESCE(SUM(CASE l.direction WHEN 'credit' THEN l.amount ELSE -l.amount END), 0) AS ledger
FROM accounts.accounts a LEFT JOIN accounts.ledger_entries l ON l.account_id = a.id
GROUP BY a.id, a.balance
HAVING a.balance <> COALESCE(SUM(CASE l.direction WHEN 'credit' THEN l.amount ELSE -l.amount END), 0);

-- Paiements par statut
SELECT status, count(*) FROM payments.payments GROUP BY status;

-- Dernières actions d'audit
SELECT id, ts, service, action, actor, outcome FROM audit.events ORDER BY id DESC LIMIT 20;
```

Se connecter avec `pgadmin` pour voir tous les schémas (voir section 2). Le compte `pgadmin` est superuser : il
contourne les restrictions des rôles `svc_*`, à ne jamais donner à un service.

## 9. Guide pour le front (React)

Le front livré est dans `frontend/` (Next.js, serveur intermédiaire qui garde le jeton dans un cookie httpOnly :
pas de CORS nécessaire). Les sections ci-dessous restent la référence de l'API pour tout autre client.

### 9.1 Adresse de l'API et CORS

Le front Next.js est le service Compose `frontend`, servi sur `http://localhost:3001` (local au PC hôte). Le
navigateur communique uniquement avec Next.js ; les Server Components et Server Actions appellent la passerelle
à `http://gateway:8080` sur le réseau Docker interne `frontend`. L'URL est configurée par `GATEWAY_URL` dans
Compose. Aucun en-tête CORS n'est nécessaire. Pour les autres clients, l'API reste disponible à
`http://localhost:8080` (ou `http://192.168.137.1:8080` depuis un autre poste).

Swagger (`/docs`) n'est pas accessible via la passerelle. La référence des endpoints est dans
`docs/api/*.openapi.json` (à ouvrir dans https://editor.swagger.io) et ci-dessous.

### 9.2 Endpoints disponibles via la passerelle

| Méthode et chemin | Accès | Corps / paramètres | Réponse |
|---|---|---|---|
| `POST /api/auth/register` | public | `{username, password}` : identifiant 3-32 caractères `[a-zA-Z0-9_.-]`, mot de passe 8-72 | 201 `{id, username, role}` |
| `POST /api/auth/login` | public | `{username, password}` | 200 `{access_token, token_type, expires_in}` |
| `GET /api/auth/me` | jeton | | `{id, username, role}` |
| `POST /api/accounts` | jeton | `{currency?, initial_balance?}` (défaut `EUR`, 1000.00) | 201 compte |
| `GET /api/accounts/me` | jeton | | liste de comptes |
| `GET /api/accounts/{id}` | jeton | | compte (404 si absent ou d'un autre) |
| `POST /api/payments` | jeton | en-tête `Idempotency-Key` ; `{from_account, to_account, amount, currency?}` | 201 ou 200 paiement |
| `GET /api/payments` | jeton | `?limit=` | liste de ses paiements |
| `GET /api/payments/{id}` | jeton | | paiement |
| `GET /api/notifications/me` | jeton | `?limit=` | liste de notifications |
| `GET /api/audit/events` | **admin** | `?service=&action=&limit=` | liste d'événements |
| `GET /api/audit/verify` | **admin** | | `{valid, checked, first_invalid_id}` |

Compte `admin` : identifiant `admin`, mot de passe `ADMIN_PASSWORD` du `.env`. Un compte `canary-bot` existe aussi
(la sonde) : ne pas l'afficher comme un vrai client.

### 9.3 Conventions de données

- **Authentification** : `Authorization: Bearer <access_token>` sur tout sauf register/login. Le jeton vit
  **15 minutes** (`expires_in: 900`) et il n'y a **pas de refresh token** : sur un 401, renvoyer l'utilisateur
  vers la connexion. Le rôle (`customer` ou `admin`) est dans le jeton (JWT, partie centrale en base64) et dans
  `GET /api/auth/me` ; s'appuyer sur `me` pour décider de l'affichage (menu audit réservé à `admin`).
- **Montants** : renvoyés sous forme de **chaînes** (`"74.50"`), jamais en nombre. Les envoyer en chaîne de
  préférence (`"25.50"`), 2 décimales maximum. Ne pas calculer en `float` ; utiliser une bibliothèque décimale ou
  n'afficher que la chaîne reçue.
- **Identifiants** : UUID v4 (chaînes). **Dates** : ISO 8601 en UTC (`2026-10-19T09:30:00+00:00`).
- **En-tête de réponse `x-request-id`** : identifiant de corrélation. L'afficher dans les messages d'erreur
  facilite la recherche dans Loki (champ `request_id`).
- **Erreurs** : `{"detail": "message"}`. Les erreurs de validation (422) renvoient `detail` sous forme de **liste**
  d'objets `{loc, msg, type}`. Le 503 des paiements renvoie un `detail` **objet** (voir plus bas).

| Code | Signification courante |
|---|---|
| 200 / 201 | Succès. Pour un paiement : 201 = créé, 200 = rejeu de la même clé d'idempotence |
| 401 | Jeton absent, invalide ou expiré (ou identifiants faux au login) |
| 403 | Droits insuffisants (ex. un `customer` appelle l'audit) |
| 404 | Ressource inexistante **ou appartenant à un autre utilisateur** |
| 409 | Nom d'utilisateur pris ; clé d'idempotence réutilisée avec un autre corps |
| 422 | Validation (comptes identiques, montant > plafond, format) |
| 429 | Trop de tentatives de connexion (en-tête `Retry-After`) |
| 502 / 503 | Un service est en panne ou en reprise : réessayer |

### 9.4 Faire un paiement correctement

```js
const key = crypto.randomUUID();           // une clé par INTENTION de paiement, pas par clic
const res = await fetch('/api/payments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': key },
  body: JSON.stringify({ from_account, to_account, amount: '25.50' }),
});
```

- **Réutiliser la même clé pour tout nouvel essai** du même paiement (erreur réseau, 502, 503). Le serveur garantit
  qu'il n'y aura pas de double débit. Générer une **nouvelle clé seulement pour un nouveau paiement**.
- **201 avec `status: "failed"`** n'est pas une erreur HTTP : c'est un refus métier (`failure_reason` :
  `insufficient_funds`, `account_not_found`, `not_account_owner`, `currency_mismatch`). Afficher un message adapté.
- **503** `{"detail": {"error": "ledger_unavailable", "payment_id": "...", "status": "pending"}}` : la demande est
  enregistrée mais pas réglée. Afficher « en cours de traitement », respecter `Retry-After` (5 s), puis interroger
  `GET /api/payments/{payment_id}` : le paiement passe à `completed` après la reprise du service.
- Un paiement **ne peut pas viser un compte inconnu par nom** : le destinataire se désigne par l'**UUID de son
  compte**. Il n'existe pas d'annuaire ni de recherche de comptes d'autres utilisateurs. Pour la démo, ouvrir
  deux comptes pour le même utilisateur et virer de l'un à l'autre.

### 9.5 Notifications

Pas de temps réel (ni WebSocket ni SSE) : interroger `GET /api/notifications/me` toutes les quelques secondes ou à
chaque paiement. Les notifications sont créées **de façon asynchrone** juste après le paiement (compter jusqu'à
une seconde).

### 9.6 Ce que le front ne peut pas encore afficher : l'interface de supervision

Le sujet demande une interface de supervision (composants, événements, alertes, avancement de la reprise). Les
données existent mais ne sont **pas exposées** : `GET /internal/incidents` (remediation) et `GET /internal/status`,
`/history` (canary) sont des endpoints internes, non routés par la passerelle (404 depuis l'extérieur).

Voies possibles, **non implémentées** à ce jour :

1. **Recommandé** : un petit service `supervision` (backend) qui agrège incidents, historique de la sonde et état
   des services, protégé par le rôle `admin`, routé sous `/api/supervision/*`. Le front n'a alors qu'une API.
2. Router `/api/incidents` et `/api/canary` directement vers remediation et canary avec contrôle du rôle `admin`
   (plus rapide, mais ouvre ces composants sensibles sur la passerelle).
3. Intégrer des panneaux Grafana en iframe : à éviter par défaut (la passerelle envoie `X-Frame-Options: DENY`,
   et Grafana n'est joignable que depuis le PC Hôte).

Forme des données à afficher : un **incident** contient `id`, `service`, `type`, `severity`, `source`, `score`,
`status`, `created_at`, `duration_seconds` et une `timeline` d'étapes `{ts, state, message}`. Un résultat de **sonde**
contient `ok`, `duration_ms`, `ready` (carte service → booléen), `consistent`, `failed_phase`, `error`.

### 9.7 Essai rapide en ligne de commande

```bash
curl -s -X POST localhost:8080/api/auth/register -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"MotDePasse-123"}'
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"MotDePasse-123"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -X POST localhost:8080/api/accounts -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

## 10. Guide pour Grafana, Prometheus et Loki

### 10.1 Chaîne d'observabilité

```
services ──/metrics──► Prometheus (scrape toutes les 5 s) ──► Grafana (datasource « Prometheus », par défaut)
conteneurs ──stdout JSON──► Promtail ──► Loki ──► Grafana (datasource « Loki »)
```

- **Seul Grafana est joignable depuis le PC Hôte** (`http://localhost:3000`). Prometheus (`prometheus:9090`) et Loki
  (`loki:3100`) ne publient aucun port : on les interroge **via Grafana → Explore**, ou depuis un conteneur du
  réseau `backend`.
- Les datasources sont **provisionnées** (`infra/grafana/provisioning/datasources/datasources.yml`) : rien à
  configurer à la main.
- Les datasources ont des uid fixes (`prometheus`, `loki`) référencés par les dashboards : ne pas les renommer.
- Les règles et le contact point Discord sont provisionnés dans `infra/grafana/provisioning/alerting/`.
  L'URL privée du webhook doit être définie par `GRAFANA_DISCORD_WEBHOOK_URL` dans `.env` (ne pas la commiter).
  La politique de notification envoie les alertes à Discord ; aucun SMTP n'est configuré.
- **Trois dashboards sont provisionnés** dans le dossier Grafana « Resilience Alpha » (détail en 10.6). Leur JSON est
  dans `infra/grafana/provisioning/dashboards/json/`, généré par `python infra/grafana/build_dashboards.py`
  (couleurs, libellés et requêtes au même endroit). Grafana recharge les fichiers toutes les 30 s.
- Les modifications faites dans l'interface ne sont **pas** écrites sur le disque et une régénération les écraserait :
  exporter le JSON, puis reporter le changement dans `build_dashboards.py` (ou y remplacer le fichier JSON).
- **Persistance** : Prometheus et Loki n'ont pas de volume. `docker compose stop` conserve les données,
  `docker compose down` les **efface**. Même remarque pour Grafana (réglages faits dans l'interface).

### 10.2 Métriques disponibles

Tous les services exposent les métriques HTTP et celles de `prometheus_client` (processus, ramasse-miettes).

| Métrique | Type | Labels | Origine / signification |
|---|---|---|---|
| `up` | gauge | `service`, `job` | **Générée par Prometheus** : 1 si le scrape du service réussit, **0 si le service est arrêté** |
| `http_requests_total` | counter | `service`, `method`, `path`, `status` | Requêtes par service. `path` = gabarit de route (`/api/accounts/{account_id}`), pas l'URL réelle |
| `http_request_duration_seconds` | histogram | `service`, `method`, `path` | Latence (`_bucket`, `_sum`, `_count`) |
| `payments_total` | counter | `status` | Paiements arrivés à un statut final (`completed`, `failed`) |
| `notifications_sent_total` | counter | `kind` | Notifications envoyées |
| `canary_up` | gauge | | **1 si la dernière transaction de sonde a réussi** : l'indicateur « le service est utilisable » |
| `canary_probe_duration_seconds` | gauge | | Durée de la dernière transaction de bout en bout |
| `canary_last_success_timestamp_seconds` | gauge | | Horodatage de la dernière réussite (`time() - ...` = durée sans succès) |
| `canary_data_consistent` | gauge | | 1 si soldes et écritures sont cohérents |
| `canary_service_ready` | gauge | `service` | `/ready` de chaque service métier |
| `canary_probes_total` | counter | `result` | Sondes exécutées (`success` / `failure`) |
| `remediation_incidents_total` | counter | `service`, `status` | Incidents terminés (`resolved`, `failed`, `escalated`, `suppressed`) |
| `remediation_active_incidents` | gauge | | Incidents en cours de traitement |
| `remediation_recovery_seconds` | histogram | | Durée alerte → service **prouvé** rétabli |

### 10.3 Piège : labels `service` et `exported_service`

Prometheus ajoute à chaque métrique le label `service` de la **cible scrapée** (`prometheus.yml`). Quand la métrique
porte déjà un label `service`, Prometheus, avec la configuration actuelle (`honor_labels` par défaut), **renomme le
label de la métrique en `exported_service`**. Conséquences attendues (à confirmer dans Explore) :

- `http_requests_total` : `service` = `exported_service` (même valeur), sans conséquence.
- `canary_service_ready` et `remediation_incidents_total` : `service` vaut `canary` / `remediation` (la cible) et le
  service réellement concerné est dans **`exported_service`**. Par exemple :
  `canary_service_ready{exported_service="payments"}`.

Décision prise avec les dashboards : la configuration actuelle est **conservée** et les dashboards lisent
`exported_service`. Passer à `honor_labels: true` obligerait à réécrire leurs requêtes (`build_dashboards.py`).

Même piège dans Loki : les lignes JSON contiennent un champ `service`, qui entre en conflit avec le label `service`.
Après `| json`, le champ s'appelle `service_extracted`. Pour la remédiation, c'est lui qui désigne le service réparé.

### 10.4 Requêtes PromQL utiles

```promql
canary_up                                              # 1 = service utilisable, 0 = incident (état global)
canary_service_ready{exported_service="payments"}      # état d'un service (voir 10.3)
up{service=~"auth|accounts|payments|notifications"}    # 0 = conteneur arrêté
time() - canary_last_success_timestamp_seconds         # secondes sans transaction réussie
canary_probe_duration_seconds                          # latence de la sonde (dégradation avant panne)

# Débit et erreurs de l'API (incluent le trafic de la sonde, voir 10.7)
sum(rate(http_requests_total{service="payments"}[1m]))
sum(rate(http_requests_total{status=~"5.."}[1m])) by (service)
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="payments"}[1m])) by (le))

sum(rate(payments_total[1m])) by (status)              # paiements par statut
remediation_active_incidents                           # remédiation en cours
increase(remediation_incidents_total[1h])              # incidents sur l'heure
histogram_quantile(0.95, sum(rate(remediation_recovery_seconds_bucket[1h])) by (le))   # durée de reprise
```

### 10.5 Logs dans Loki

Chaque service écrit **une ligne JSON par événement** sur stdout. Promtail les collecte via le proxy Docker en
lecture seule et pose **deux labels** : `service` (nom du service Compose : `payments`, `gateway`, `postgres`…) et
`level` (`INFO`, `WARNING`, `ERROR`). Tout le reste se filtre dans la requête avec `| json`. Les conteneurs non
Python (postgres, grafana, loki) sont collectés aussi mais ne sont pas en JSON.

Champs communs : `ts`, `level`, `service`, `logger`, `msg`, `request_id`, plus des champs propres à l'événement.
La clé **`event`** (snake_case) identifie le type d'événement.

```logql
{service="payments"} | json | event="payment_failed"
{level=~"WARNING|ERROR"}
{service="auth"} | json | event=~"login_failed|login_blocked"          # force brute
{service=~".+"} | json | request_id="<id vu dans une réponse>"          # suivre une requête de bout en bout
sum by (service) (count_over_time({level="WARNING"}[1m]))               # métrique tirée des logs
{service="remediation"} | json | event="remediation_step"               # déroulé de la reprise
```

Journal d'accès de la passerelle (`{service="gateway"}`, JSON avec d'autres champs) : `remote_addr`, `method`, `uri`,
`status`, `request_time`, `user_agent`, `request_id`. C'est la source naturelle pour le WAF/SIEM et la détection.
Les services journalisent aussi `http_request` avec `client_ip`, `path`, `status`, `duration_ms`.

Événements notables, utiles pour des alertes et pour le SIEM :

| `event` | Service | Sens |
|---|---|---|
| `login_failed`, `login_blocked` | auth | Échec de connexion, blocage anti-force brute (WARNING) |
| `payment_completed`, `payment_failed`, `payment_rejected` | payments | Issue d'un paiement ; `payment_rejected` = plafond dépassé |
| `ledger_unreachable`, `ledger_error`, `payment_reconciled` | payments | Panne du ledger et rattrapage |
| `integrity_violation` | accounts | **Soldes incohérents** (ERROR) |
| `not_ready`, `db_connect_retry` | tous | Service sans base de données |
| `event_delivery_failed` | tous | Audit ou notifications injoignables |
| `canary_probe_failed`, `canary_recovered`, `canary_alert_sent` | canary | Début, fin et alerte d'un incident |
| `remediation_step` | remediation | Étape de reprise (`state`, `message`) |
| `audit_chain_broken` | audit | **Piste d'audit altérée** (ERROR) |
| `unhandled_exception` | tous | Erreur interne (ERROR) |

### 10.6 Dashboard « avant / pendant / après » (critère de jury, axe 3)

Le jury doit voir l'état du service avant l'incident, pendant et après la remédiation. Trois dashboards provisionnés,
reliés entre eux par des liens en haut de page :

| Dashboard (uid) | Pour qui | Contenu |
|---|---|---|
| **Reprise autonome** (`/d/ra-recovery`) | Jury, démo | Tuiles « maintenant » (paiement de contrôle, temps sans succès, cohérence des données, incidents actifs, reprises prouvées, durée de reprise p95) ; frise d'état par service vue par la sonde (`canary_service_ready`, `canary_up`) et par Prometheus (`up`) ; durée et résultat des sondes ; incidents par service et issue ; déroulé des reprises (Loki). Actualisation 5 s, fenêtre 15 min |
| **Trafic et paiements** (`/d/ra-traffic`) | Équipe infra | Débit, part de 5xx, latence p95, 4xx/5xx par service (hors `/ready`, `/health`, `/metrics`) ; paiements et notifications par minute ; routes les plus sollicitées |
| **Journaux et sécurité** (`/d/ra-logs`) | Cyber, SIEM | Volume de logs par niveau ; avertissements par service ; connexions réussies / échouées / bloquées et top des IP en échec ; réponses de la passerelle par classe ; trafic hors sonde ; erreurs critiques ; exploration par service et texte ; **suivi d'une requête** par `request_id` (variable en haut) |

**Annotations** (lignes verticales sur les graphiques) : alerte de la sonde, remédiation lancée, reprise prouvée.
Elles rendent les trois phases lisibles d'un coup d'œil.

Pour la démo : ouvrir « Reprise autonome », laisser la fenêtre sur 15 min, provoquer l'incident depuis le PC
Attaquant, puis suivre la bande rouge sur la frise et les annotations. Les mêmes informations sont visibles côté
produit dans la page Supervision du front.

### 10.7 Points d'attention

- **La sonde fausse les débits** : elle génère environ 0,2 paiement et plusieurs requêtes HTTP par seconde. Les
  graphiques de « trafic client » incluent ce trafic de fond (repérable dans les logs de la passerelle par `user_agent="resilience-canary/1.0"` sur les requêtes de paiement).
- **Un service arrêté disparaît de ses propres métriques** : `up` passe à 0, mais ses compteurs ne montent plus.
  Pour détecter une panne, utiliser `up`, `canary_up` ou `absent(...)`, pas un taux d'erreurs.
- **Un compteur repart de zéro** quand un service redémarre (c'est le cas après chaque remédiation) : toujours
  utiliser `rate()` ou `increase()`, jamais la valeur brute.
- **Ajouter une cible** : une ligne dans `infra/prometheus/prometheus.yml` (le service doit exposer `/metrics` sur le réseau
  `backend`), puis `docker compose restart prometheus`. Un service qui utilise `create_app()` l'expose déjà.
- **Cardinalité** : le label `path` des métriques HTTP est un gabarit de route. Ne jamais mettre un identifiant
  d'utilisateur ou un UUID dans un label.

## 11. Scénario d'incident et de reprise

Séquence nominale (valeurs par défaut) pour un service métier qui tombe :

| Étape | Qui | Détail |
|---|---|---|
| 1. Incident | PC Attaquant | L'attaque rend un service indisponible (le choix du scénario appartient à l'équipe cyber) |
| 2. Mesure | canary | La sonde échoue (`canary_up` = 0, `canary_probe_failed`) ; `canary_service_ready` désigne le fautif |
| 3. Détection | detector (ML) ou canary | Alerte vers `remediation` ; filet de sécurité : 3 échecs consécutifs ≈ 15 s |
| 4. Décision | remediation | Dédoublonnage, disjoncteur, liste blanche ; `anomaly` sans panne = escalade sans action |
| 5. Action | remediation | Redémarrage du conteneur via le proxy Docker restreint |
| 6. Preuve | remediation, canary | `/ready` + **nouvelle transaction réussie** + cohérence du ledger |
| 7. Clôture | remediation | `resolved`, durée enregistrée, audit `incident_resolved` |

**Simuler une panne en développement** (équivalent d'une attaque de disponibilité, à ne pas utiliser pour la démo,
qui doit partir du PC Attaquant) :

```bash
docker stop rsl-payments                    # coupe le service
docker compose logs -f remediation canary   # suit la détection et la reprise
docker compose ps                           # rsl-payments doit repasser "healthy" sans intervention
```

Pendant la panne : les appels aux paiements reçoivent une erreur de la passerelle (un 502 est attendu), et
`up{service="payments"}` vaut 0. Si les alertes de la sonde sont désactivées (`CANARY_ALERTS_ENABLED=false`) et qu'aucun
détecteur n'est branché, le service **restera arrêté** : c'est voulu (`restart: "no"`). Si trois remédiations ont déjà eu lieu en 10 minutes sur le même service, la suivante
est `suppressed` : attendre la fin de la fenêtre ou redémarrer `remediation`.

Une **restauration de disponibilité n'est pas une correction de compromission** : le moteur redémarre un service
en panne, mais face à une anomalie sans panne (exfiltration, injection, élévation de privilèges) il ne détruit pas
les preuves et escalade. Les réponses attendues pour ces cas (isolation, blocage d'IP, rotation de secrets) sont à
documenter dans le PCA/PRA.

## 12. Sécurité : choix et limites connues

À présenter honnêtement au jury : ce que l'on protège, les compromis, ce que l'on ferait autrement en production.

| Sujet | Choix actuel | Limite / amélioration industrielle |
|---|---|---|
| Jetons | JWT HS256, secret partagé `JWT_SECRET` | Tout service connaissant le secret peut fabriquer un jeton de service. Cible : clés asymétriques par service via Vault |
| Révocation | Jetons de 15 min, sans refresh ni révocation | Liste de révocation ou sessions côté serveur |
| Anti-force brute | Nginx + compteurs en mémoire du service auth | Compteurs perdus au redémarrage ; en multi-réplicas, utiliser Redis |
| Accès Docker | Proxy `tecnativa/docker-socket-proxy` limité à stop/restart/kill (`POST=1`, `ALLOW_RESTARTS=1`, `CONTAINERS=0` : ni inspection ni création) ; liste blanche de 4 conteneurs **dans le code du moteur** | Le proxy autorise stop/restart/kill de **n'importe quel** conteneur ; épingler l'image (actuellement `latest`) |
| Exposition | Seule la passerelle (`0.0.0.0:8080`) et Grafana (`127.0.0.1:3000`) | Pas de TLS (HTTP en laboratoire) ; **WAF non branché** |
| Prometheus, Loki | Sans authentification, non publiés | Ne jamais publier sans authentification |
| Adresse IP client | `X-Real-IP` posé par la passerelle, approuvé car les services ne sont joignables que par elle | **Sous Docker Desktop (Windows), la passerelle ne voit jamais l'IP réelle** : tous les clients extérieurs arrivent en `172.21.0.1` (vérifié le 2026-10-19). La limite de connexion Nginx et l'anti-force brute « par IP » d'auth sont donc **communs à tous les clients** : une attaque bloque aussi les utilisateurs légitimes. Correctifs : proxy sur l'hôte qui transmet l'IP (`X-Forwarded-For` + module `realip`), ou pile sur un hôte Linux. Voir `docs/02-reprise-idempotence-ml.md` §3.1 |
| Données | Un rôle et un schéma par service, ledger sans UPDATE/DELETE, `balance >= 0` en base | Le compte `pgadmin` (superuser) existe : ne pas l'exposer |
| Secrets | `.env` généré aléatoirement, ignoré par Git | Migrer vers Vault ou SOPS ; ne jamais livrer `.env` dans l'archive |
| Solde de démonstration | `initial_balance` permet un crédit fictif libre à l'ouverture | **Démo uniquement** : à supprimer en production |
| Historique d'incidents | En mémoire dans `remediation` | Persister (audit et Loki en gardent la trace) |
| Audit | Chaîne de hachage vérifiable | `verify` plafonné à 100 000 événements ; sans ancrage externe, une réécriture complète de la table reste possible pour un superuser |

## 13. Tests, conventions, dépannage

**Tests** : `pip install -r requirements-dev.txt` puis `PYTHONPATH=libs/common pytest tests` (PowerShell :
`$env:PYTHONPATH="libs/common"; pytest tests`). Les 7 tests couvrent la bibliothèque commune ; il n'y a pas de test
automatisé des services. `scripts/smoke.py` fait office de test d'intégration manuel.

**Conventions** : événements de log et actions d'audit en `snake_case` ; un nom d'événement = un sens stable (ils
servent de clés de requête LogQL et de règles SIEM) ; commentaires et messages utilisateur en français ; images
Python 3.12 ; aucun secret dans le code, uniquement par variables d'environnement.

| Symptôme | Cause probable et correction |
|---|---|
| `No module named 'httpx'` au lancement de `smoke.py` | `pip install httpx` (idéalement dans un venv) |
| `requis - lancer python scripts/gen_env.py` au `docker compose up` | `.env` absent : lancer `gen_env.py` |
| `password authentication failed` après avoir régénéré `.env` | La base garde les anciens mots de passe : `docker compose down -v` puis `up` |
| Modification de `02-schema.sql` sans effet | Les scripts d'initialisation ne tournent qu'à la création du volume : `docker compose down -v` |
| `bad interpreter` / erreur sur `01-roles.sh` | Fin de ligne Windows (CRLF) : `.gitattributes` impose LF ; reclonez ou convertissez le fichier |
| `smoke.py` : connexion refusée | Pile pas démarrée ou pas encore `healthy` (`docker compose ps`) |
| 429 au login | Limite de tentatives : attendre 60 s |
| Erreur CORS dans le navigateur | Voir section 9.1 |
| Grafana : aucun dashboard | Menu Dashboards → dossier « Resilience Alpha ». Sinon vérifier `docker compose logs grafana` (provisioning) |
| Grafana : « datasource not found » dans les panneaux | Datasource renommée ou uid modifié : les dashboards attendent les uid `prometheus` et `loki` |
| Pas de métrique `canary_*` | Le service `canary` n'est pas `healthy`, ou Prometheus n'a pas encore scrapé (5 s) |
| Un service arrêté ne revient pas | Voulu (`restart: "no"`) : la remédiation doit le relancer ; voir ses logs et la section 11 |
| DBeaver : connexion refusée | Lancer avec `-f docker-compose.dbeaver.yml` (section 2) |
| Port 8080 ou 3000 déjà pris | Un autre programme l'occupe : le libérer ou changer le port côté gauche du mapping |

Livrables du sujet à tenir à jour avec ce dépôt : `Workshop2026-M2-G<n>-Code.zip` (sources, configurations, scripts
d'attaque et de ML, tests, documentation d'API, README) **sans aucun secret**, soit sans `.env`.
