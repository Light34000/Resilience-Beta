"""Génère les dashboards Grafana provisionnés de RESILIENCE-ALPHA.

    python infra/grafana/build_dashboards.py      # réécrit provisioning/dashboards/json/*.json
    docker compose restart grafana                # ou attendre 30 s (rechargement automatique)

Les JSON générés sont versionnés. On peut aussi modifier un dashboard dans Grafana puis exporter son JSON,
mais une régénération l'écraserait : reporter alors la modification ici.

Choix de visualisation (skill dataviz) :
- couleurs catégorielles validées (daltonisme, contraste) sur la surface sombre de Grafana ; une couleur par
  service, identique sur tous les dashboards ; légende toujours visible ;
- couleurs d'état (vert/ambre/rouge) réservées aux états, toujours avec un libellé ;
- jamais deux axes Y ; séries d'issue non empilées (une série quasi nulle empilée en haut trace un faux liseré).
"""
import json
import sys
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "provisioning" / "dashboards" / "json"
OUT.mkdir(parents=True, exist_ok=True)

PROM = {"type": "prometheus", "uid": "prometheus"}
LOKI = {"type": "loki", "uid": "loki"}

# Palette catégorielle validée (dataviz, mode sombre = thème Grafana par défaut) : la couleur suit le service.
SERVICES = [
    ("auth", "Authentification", "#3987e5"),
    ("accounts", "Comptes", "#d95926"),
    ("payments", "Paiements", "#199e70"),
    ("notifications", "Notifications", "#c98500"),
    ("audit", "Audit", "#d55181"),
]
BUSINESS = "auth|accounts|payments|notifications|audit"
# Couleurs d'état réservées (jamais pour une série) : toujours accompagnées d'un libellé.
GOOD, WARN, CRIT, NEUTRAL = "#0ca30c", "#fab219", "#d03b3b", "#898781"

_id = 0


def nid():
    global _id
    _id += 1
    return _id


def service_overrides(names=SERVICES):
    return [
        {
            "matcher": {"id": "byName", "options": key},
            "properties": [
                {"id": "displayName", "value": label},
                {"id": "color", "value": {"mode": "fixed", "fixedColor": color}},
            ],
        }
        for key, label, color in names
    ]


def fixed_overrides(pairs):
    """pairs: [(nom de série, libellé, couleur)]"""
    return service_overrides(pairs)


def target(expr, legend="", ref="A", ds=PROM, instant=False, fmt=None):
    t = {"datasource": ds, "refId": ref}
    if ds is PROM:
        t.update({"expr": expr, "legendFormat": legend or "__auto", "range": not instant, "instant": instant})
        if fmt:
            t["format"] = fmt
    else:
        t.update({"expr": expr, "queryType": "instant" if instant else "range"})
        if legend:
            t["legendFormat"] = legend
    return t


def text_row(title, y):
    return {"type": "row", "title": title, "id": nid(), "collapsed": False, "gridPos": {"h": 1, "w": 24, "x": 0, "y": y}, "panels": []}


def stat(title, desc, targets, pos, unit="none", mappings=None, thresholds=None, decimals=None, no_value="—"):
    return {
        "type": "stat",
        "id": nid(),
        "title": title,
        "description": desc,
        "datasource": targets[0]["datasource"],
        "gridPos": pos,
        "targets": targets,
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "decimals": decimals,
                "noValue": no_value,
                "mappings": mappings or [],
                "color": {"mode": "thresholds"},
                "thresholds": thresholds or {"mode": "absolute", "steps": [{"color": "text", "value": None}]},
            },
            "overrides": [],
        },
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "colorMode": "value",
            "graphMode": "none",
            "textMode": "value",
            "justifyMode": "auto",
            "orientation": "auto",
            "showPercentChange": False,
            "wideLayout": True,
        },
    }


def timeseries(title, desc, targets, pos, unit="none", overrides=None, stack=False, bars=False, fill=0, min0=True,
               legend_calcs=None, color=None, decimals=None, no_value="Aucune donnée sur la période"):
    custom = {
        "drawStyle": "bars" if bars else "line",
        "lineWidth": 2,
        "fillOpacity": 80 if bars else fill,
        "gradientMode": "none",
        "showPoints": "never",
        "pointSize": 8,
        "spanNulls": False,
        "lineInterpolation": "linear",
        "barAlignment": 0,
        "axisPlacement": "auto",
        "axisSoftMin": 0 if min0 else None,
        "stacking": {"mode": "normal" if stack else "none", "group": "A"},
        "thresholdsStyle": {"mode": "off"},
    }
    return {
        "type": "timeseries",
        "id": nid(),
        "title": title,
        "description": desc,
        "datasource": targets[0]["datasource"],
        "gridPos": pos,
        "targets": targets,
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "decimals": decimals,
                "custom": custom,
                "color": color or {"mode": "palette-classic"},
                "noValue": no_value,
            },
            "overrides": overrides or [],
        },
        "options": {
            "legend": {"showLegend": True, "displayMode": "table" if legend_calcs else "list", "placement": "bottom",
                       "calcs": legend_calcs or []},
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
    }


UP_DOWN = [
    {"type": "value", "options": {
        "0": {"text": "Indisponible", "color": CRIT},
        "1": {"text": "Opérationnel", "color": GOOD},
    }},
]


def state_timeline(title, desc, targets, pos, overrides=None, mappings=UP_DOWN):
    return {
        "type": "state-timeline",
        "id": nid(),
        "title": title,
        "description": desc,
        "datasource": targets[0]["datasource"],
        "gridPos": pos,
        "targets": targets,
        "fieldConfig": {
            "defaults": {
                "mappings": mappings,
                # Mode « fixed » obligatoire : en mode « thresholds », la state-timeline de Grafana 11.3 affiche
                # les paliers de seuil (« -∞+ ») et ignore les value mappings.
                "color": {"mode": "fixed", "fixedColor": NEUTRAL},
                "custom": {"fillOpacity": 85, "lineWidth": 0, "hideFrom": {"legend": False, "tooltip": False, "viz": False}},
                "noValue": "Pas de mesure",
            },
            "overrides": overrides or [],
        },
        "options": {
            "showValue": "auto",
            "mergeValues": True,
            "alignValue": "left",
            "rowHeight": 0.8,
            "legend": {"showLegend": True, "displayMode": "list", "placement": "bottom"},
            "tooltip": {"mode": "single", "sort": "none"},
        },
    }


def logs(title, desc, expr, pos):
    return {
        "type": "logs",
        "id": nid(),
        "title": title,
        "description": desc,
        "datasource": LOKI,
        "gridPos": pos,
        "targets": [target(expr, ds=LOKI)],
        "options": {
            "showTime": True,
            "showLabels": False,
            "showCommonLabels": False,
            "wrapLogMessage": True,
            "prettifyLogMessage": False,
            "enableLogDetails": True,
            "dedupStrategy": "none",
            "sortOrder": "Descending",
        },
    }


def table(title, desc, targets, pos, rename, unit=None, sort_by=None, overrides=None):
    return {
        "type": "table",
        "id": nid(),
        "title": title,
        "description": desc,
        "datasource": targets[0]["datasource"],
        "gridPos": pos,
        "targets": targets,
        "transformations": [
            {"id": "organize", "options": {"excludeByName": {"Time": True}, "renameByName": rename}},
        ],
        "fieldConfig": {
            "defaults": {"unit": unit or "none", "custom": {"align": "auto", "cellOptions": {"type": "auto"}}, "noValue": "—"},
            "overrides": overrides or [],
        },
        "options": {"showHeader": True, "cellHeight": "sm", "footer": {"show": False, "reducer": ["sum"], "fields": ""},
                    "sortBy": sort_by or []},
    }


def dashboard(uid, title, desc, panels, tags, links, annotations=None, templating=None, refresh="5s", time_from="now-15m"):
    return {
        "uid": uid,
        "title": title,
        "description": desc,
        "tags": ["resilience-alpha", *tags],
        "timezone": "browser",
        "editable": True,
        "graphTooltip": 1,  # curseur partagé entre panneaux
        "refresh": refresh,
        "time": {"from": time_from, "to": "now"},
        "timepicker": {"refresh_intervals": ["5s", "10s", "30s", "1m", "5m"]},
        "fiscalYearStartMonth": 0,
        "liveNow": False,
        "schemaVersion": 39,
        "version": 1,
        "links": links,
        "annotations": {"list": [
            {"builtIn": 1, "datasource": {"type": "grafana", "uid": "-- Grafana --"}, "enable": True, "hide": True,
             "iconColor": "rgba(0, 211, 255, 1)", "name": "Annotations & Alerts", "type": "dashboard"},
            *(annotations or []),
        ]},
        "templating": {"list": templating or []},
        "panels": panels,
    }


LINKS = [
    {"title": "Reprise autonome", "type": "link", "url": "/d/ra-recovery", "icon": "dashboard", "keepTime": True, "targetBlank": False, "tooltip": ""},
    {"title": "Trafic et paiements", "type": "link", "url": "/d/ra-traffic", "icon": "dashboard", "keepTime": True, "targetBlank": False, "tooltip": ""},
    {"title": "Journaux et sécurité", "type": "link", "url": "/d/ra-logs", "icon": "dashboard", "keepTime": True, "targetBlank": False, "tooltip": ""},
]

LOKI_ANNOTATIONS = [
    {"name": "Alerte de la sonde", "datasource": LOKI, "enable": True, "iconColor": WARN,
     "expr": '{service="canary"} | json | event="canary_alert_sent"', "textFormat": "Alerte envoyée à la remédiation : {{service_extracted}} ({{type}})",
     "tagKeys": "", "titleFormat": "Alerte sonde"},
    {"name": "Remédiation lancée", "datasource": LOKI, "enable": True, "iconColor": "#9085e9",
     "expr": '{service="remediation"} | json | event="remediation_step" | state="remediating"', "textFormat": "{{message}}",
     "tagKeys": "", "titleFormat": "Remédiation"},
    {"name": "Reprise prouvée", "datasource": LOKI, "enable": True, "iconColor": GOOD,
     "expr": '{service="remediation"} | json | event="remediation_step" | state="resolved"', "textFormat": "{{service_extracted}} : {{message}}",
     "tagKeys": "", "titleFormat": "Reprise prouvée"},
]

# ───────────────────────────── 1. Reprise autonome ─────────────────────────────
_id = 0
y = 0
p = []
p.append(text_row("Maintenant", y)); y += 1
p.append(stat("Paiement de contrôle",
              "canary_up : 1 si la dernière transaction de la sonde (paiement réel via la passerelle) a réussi. C'est l'indicateur « le service est utilisable ».",
              [target("canary_up")], {"h": 4, "w": 4, "x": 0, "y": y},
              mappings=[{"type": "value", "options": {"0": {"text": "En échec", "color": CRIT}, "1": {"text": "Réussie", "color": GOOD}}}]))
p.append(stat("Sans succès depuis",
              "time() - canary_last_success_timestamp_seconds. Normalement < 10 s (une sonde toutes les 5 s).",
              [target("time() - canary_last_success_timestamp_seconds")], {"h": 4, "w": 4, "x": 4, "y": y}, unit="s", decimals=0,
              thresholds={"mode": "absolute", "steps": [{"color": GOOD, "value": None}, {"color": WARN, "value": 15}, {"color": CRIT, "value": 30}]}))
p.append(stat("Données",
              "canary_data_consistent : solde de chaque compte = somme de ses écritures au ledger. Doit rester « Cohérentes », y compris après une reprise.",
              [target("canary_data_consistent")], {"h": 4, "w": 4, "x": 8, "y": y},
              mappings=[{"type": "value", "options": {"0": {"text": "Incohérentes", "color": CRIT}, "1": {"text": "Cohérentes", "color": GOOD}}}]))
p.append(stat("Incidents actifs", "remediation_active_incidents : incidents en cours de traitement par le moteur.",
              [target("remediation_active_incidents")], {"h": 4, "w": 4, "x": 12, "y": y},
              thresholds={"mode": "absolute", "steps": [{"color": "text", "value": None}, {"color": WARN, "value": 1}]}))
p.append(stat("Reprises prouvées",
              "Sur la période affichée : incidents clos « resolved » : redémarrage + nouvelle transaction réussie + données cohérentes.",
              [target('sum(increase(remediation_incidents_total{status="resolved"}[$__range]))', instant=True)],
              {"h": 4, "w": 4, "x": 16, "y": y}, decimals=0, no_value="0"))
p.append(stat("Durée de reprise p95",
              "Sur la période affichée. Durée alerte → service prouvé rétabli (histogramme remediation_recovery_seconds). Peu d'incidents = estimation grossière.",
              [target("histogram_quantile(0.95, sum by (le) (increase(remediation_recovery_seconds_bucket[$__range])))", instant=True)],
              {"h": 4, "w": 4, "x": 20, "y": y}, unit="s", decimals=1))
y += 4

p.append(text_row("Avant / pendant / après", y)); y += 1
p.append(state_timeline(
    "Disponibilité vue par la sonde",
    "Chaque ligne : /ready du service (canary_service_ready) et la transaction de bout en bout (canary_up). Vert = opérationnel, rouge = indisponible.",
    [target('canary_up', "e2e", "A"), target('canary_service_ready', "{{exported_service}}", "B")],
    {"h": 8, "w": 24, "x": 0, "y": y},
    overrides=[{"matcher": {"id": "byName", "options": "e2e"}, "properties": [{"id": "displayName", "value": "Transaction de bout en bout"}]},
               *[{"matcher": {"id": "byName", "options": k}, "properties": [{"id": "displayName", "value": f"{lbl} (/ready)"}]} for k, lbl, _ in SERVICES]],
))
y += 8
p.append(state_timeline(
    "Conteneurs scrapés par Prometheus",
    "up : 1 si Prometheus joint le /metrics du service, 0 si le conteneur est arrêté. Vue technique, complémentaire de la sonde.",
    [target('up{job="services"}', "{{service}}")],
    {"h": 8, "w": 24, "x": 0, "y": y},
    overrides=[{"matcher": {"id": "byName", "options": k}, "properties": [{"id": "displayName", "value": lbl}]}
               for k, lbl in [("auth", "Authentification"), ("accounts", "Comptes"), ("payments", "Paiements"), ("notifications", "Notifications"),
                              ("audit", "Audit"), ("remediation", "Remédiation"), ("canary", "Sonde")]],
))
y += 8
p.append(timeseries("Durée de la transaction de contrôle",
                    "canary_probe_duration_seconds : durée du dernier paiement de la sonde. Une hausse précède souvent la panne.",
                    [target("canary_probe_duration_seconds", "Durée")], {"h": 8, "w": 12, "x": 0, "y": y}, unit="s",
                    color={"mode": "fixed", "fixedColor": "#3987e5"}))
p.append(timeseries("Sondes par minute, par résultat",
                    "canary_probes_total : sondes réussies et en échec (environ 12 par minute).",
                    [target('sum by (result) (rate(canary_probes_total[$__rate_interval])) * 60', "{{result}}")],
                    {"h": 8, "w": 12, "x": 12, "y": y}, unit="short", fill=10, decimals=1,
                    overrides=fixed_overrides([("success", "Réussies", GOOD), ("failure", "En échec", CRIT)])))
y += 8

p.append(text_row("Remédiation", y)); y += 1
p.append(table("Incidents sur la période, par service et issue",
               "increase(remediation_incidents_total[période]). L'historique détaillé est dans l'audit et dans le journal ci-contre.",
               [target('sum by (exported_service, status) (increase(remediation_incidents_total[$__range])) > 0', instant=True, fmt="table")],
               {"h": 9, "w": 9, "x": 0, "y": y},
               rename={"exported_service": "Service", "status": "Issue", "Value": "Incidents"},
               overrides=[{"matcher": {"id": "byName", "options": "Incidents"}, "properties": [{"id": "decimals", "value": 0}]},
                          {"matcher": {"id": "byName", "options": "Service"}, "properties": [
                              {"id": "mappings", "value": [{"type": "value", "options": {k: {"text": lbl} for k, lbl, _ in SERVICES}}]}]},
                          {"matcher": {"id": "byName", "options": "Issue"}, "properties": [
                              {"id": "mappings", "value": [{"type": "value", "options": {
                                  "resolved": {"text": "Résolu", "color": GOOD}, "failed": {"text": "Échec", "color": CRIT},
                                  "escalated": {"text": "Escaladé", "color": WARN}, "suppressed": {"text": "Bloqué (disjoncteur)", "color": WARN}}}]},
                              {"id": "custom.cellOptions", "value": {"type": "color-text"}}]}]))
p.append(logs("Déroulé des reprises",
              "Étapes du moteur (detected → remediating → verifying → resolved). Le service concerné est service_extracted (le champ JSON écrase le label).",
              '{service="remediation"} | json | event="remediation_step" | line_format "{{.service_extracted}} · {{.state}} · {{.message}}"',
              {"h": 9, "w": 15, "x": 9, "y": y}))
y += 9

recovery = dashboard(
    "ra-recovery", "Resilience Alpha · Reprise autonome",
    "Avant / pendant / après un incident : disponibilité, preuve de reprise, remédiation. Annotations : alertes de la sonde, remédiations lancées, reprises prouvées.",
    p, ["reprise", "jury"], LINKS, annotations=LOKI_ANNOTATIONS)

# ───────────────────────────── 2. Trafic et paiements ─────────────────────────────
_id = 0
y = 0
NOHEALTH = 'path!~"/ready|/health|/metrics"'
p = []
p.append(text_row("Synthèse", y)); y += 1
p.append(stat("Requêtes par seconde",
              "Services métier, hors /ready, /health et /metrics. Inclut le trafic de la sonde (≈ 1 paiement / 5 s).",
              [target(f'sum(rate(http_requests_total{{service=~"{BUSINESS}", {NOHEALTH}}}[$__rate_interval]))')],
              {"h": 4, "w": 6, "x": 0, "y": y}, unit="reqps", decimals=2))
p.append(stat("Part de réponses 5xx",
              "Erreurs serveur / total des réponses des services métier (hors santé).",
              [target(f'sum(rate(http_requests_total{{service=~"{BUSINESS}", {NOHEALTH}, status=~"5.."}}[$__rate_interval])) / sum(rate(http_requests_total{{service=~"{BUSINESS}", {NOHEALTH}}}[$__rate_interval]))')],
              {"h": 4, "w": 6, "x": 6, "y": y}, unit="percentunit", decimals=2, no_value="0 %",
              thresholds={"mode": "absolute", "steps": [{"color": GOOD, "value": None}, {"color": WARN, "value": 0.01}, {"color": CRIT, "value": 0.05}]}))
p.append(stat("Paiements effectués (période)", "payments_total{status=\"completed\"}, sonde comprise.",
              [target('sum(increase(payments_total{status="completed"}[$__range]))', instant=True)],
              {"h": 4, "w": 6, "x": 12, "y": y}, decimals=0, no_value="0"))
p.append(stat("Paiements refusés (période)", "payments_total{status=\"failed\"} : refus métier (solde, compte, devise).",
              [target('sum(increase(payments_total{status="failed"}[$__range]))', instant=True)],
              {"h": 4, "w": 6, "x": 18, "y": y}, decimals=0, no_value="0"))
y += 4

p.append(text_row("Services", y)); y += 1
p.append(timeseries("Requêtes par seconde, par service",
                    "rate(http_requests_total) hors routes de santé. Un service arrêté disparaît : sa courbe s'interrompt.",
                    [target(f'sum by (service) (rate(http_requests_total{{service=~"{BUSINESS}", {NOHEALTH}}}[$__rate_interval]))', "{{service}}")],
                    {"h": 8, "w": 12, "x": 0, "y": y}, unit="reqps", overrides=service_overrides(), decimals=2))
p.append(timeseries("Latence p95, par service",
                    "histogram_quantile(0.95) de http_request_duration_seconds, hors routes de santé.",
                    [target(f'histogram_quantile(0.95, sum by (service, le) (rate(http_request_duration_seconds_bucket{{service=~"{BUSINESS}", {NOHEALTH}}}[$__rate_interval])))', "{{service}}")],
                    {"h": 8, "w": 12, "x": 12, "y": y}, unit="s", overrides=service_overrides()))
y += 8
p.append(timeseries("Réponses 5xx par seconde, par service",
                    "Erreurs serveur vues par chaque service. Pendant une panne, ce sont surtout les appelants (ex. paiements quand le ledger tombe) qui en renvoient.",
                    [target(f'sum by (service) (rate(http_requests_total{{service=~"{BUSINESS}", status=~"5.."}}[$__rate_interval]))', "{{service}}")],
                    {"h": 8, "w": 12, "x": 0, "y": y}, unit="reqps", overrides=service_overrides(), decimals=3,
                    no_value="Aucune réponse 5xx des services sur la période (les 502 de la passerelle sont dans « Journaux et sécurité »)"))
p.append(timeseries("Réponses 4xx par seconde, par service",
                    "Refus côté client : authentification (401), droits (403), validation (422), limitation (429).",
                    [target(f'sum by (service) (rate(http_requests_total{{service=~"{BUSINESS}", status=~"4.."}}[$__rate_interval]))', "{{service}}")],
                    {"h": 8, "w": 12, "x": 12, "y": y}, unit="reqps", overrides=service_overrides(), decimals=3))
y += 8

p.append(text_row("Paiements et notifications", y)); y += 1
p.append(timeseries("Paiements par minute, par issue",
                    "rate(payments_total) × 60. Effectués et refusés ; les paiements en attente n'y figurent qu'une fois réglés.",
                    [target('sum by (status) (rate(payments_total[$__rate_interval])) * 60', "{{status}}")],
                    {"h": 8, "w": 12, "x": 0, "y": y}, unit="short", decimals=1, fill=10,
                    overrides=fixed_overrides([("completed", "Effectués", GOOD), ("failed", "Refusés", CRIT)])))
p.append(timeseries("Notifications par minute",
                    "notifications_sent_total : notifications (e-mail simulé) envoyées après chaque paiement.",
                    [target('sum by (kind) (rate(notifications_sent_total[$__rate_interval])) * 60', "{{kind}}")],
                    {"h": 8, "w": 12, "x": 12, "y": y}, unit="short", decimals=1, fill=10,
                    overrides=fixed_overrides([("payment_completed", "Paiement effectué", GOOD), ("payment_failed", "Paiement refusé", CRIT)])))
y += 8
p.append(table("Routes les plus sollicitées (5 dernières minutes)",
               "Top 10 des gabarits de route par débit, hors santé.",
               [target(f'topk(10, sum by (service, method, path) (rate(http_requests_total{{{NOHEALTH}}}[5m])))', instant=True, fmt="table")],
               {"h": 9, "w": 24, "x": 0, "y": y},
               rename={"service": "Service", "method": "Méthode", "path": "Route", "Value": "Requêtes/s"}, unit="reqps",
               sort_by=[{"displayName": "Requêtes/s", "desc": True}]))
y += 9

traffic = dashboard("ra-traffic", "Resilience Alpha · Trafic et paiements",
                    "Débit, erreurs et latence des services métier ; paiements et notifications. Le trafic de la sonde est inclus.",
                    p, ["metriques"], LINKS, annotations=LOKI_ANNOTATIONS)

# ───────────────────────────── 3. Journaux et sécurité ─────────────────────────────
_id = 0
y = 0
p = []
templating = [
    {"type": "query", "name": "service", "label": "Service", "datasource": LOKI, "query": {"label": "service", "stream": "", "type": 1, "refId": "LokiVariableQueryEditor-VariableQuery"},
     "definition": "label_values(service)", "multi": True, "includeAll": True, "allValue": "auth|accounts|payments|notifications|audit|remediation|canary|gateway|postgres", "current": {"selected": True, "text": ["All"], "value": ["$__all"]},
     "refresh": 2, "sort": 1, "hide": 0},
    {"type": "textbox", "name": "recherche", "label": "Texte (filtre de ligne)", "query": "", "current": {"value": "", "text": ""}, "hide": 0},
    {"type": "textbox", "name": "request_id", "label": "request_id (suivi d'une requête)", "query": "", "current": {"value": "", "text": ""}, "hide": 0},
]
p.append(text_row("Volume", y)); y += 1
p.append(timeseries("Lignes de log par minute, par niveau",
                    "Services Python (JSON). Les conteneurs non Python (Postgres, Grafana…) n'ont pas de niveau et n'y figurent pas.",
                    [target('sum by (level) (count_over_time({service=~"$service", level=~".+"} [1m]))', "{{level}}", ds=LOKI)],
                    {"h": 8, "w": 12, "x": 0, "y": y}, unit="short", fill=10,
                    overrides=fixed_overrides([("INFO", "INFO", NEUTRAL), ("WARNING", "WARNING", WARN), ("ERROR", "ERROR", CRIT)])))
p.append(timeseries("Avertissements et erreurs par minute, par service",
                    "Lignes WARNING et ERROR. Une panne fait monter les services appelants (ledger_unreachable, event_delivery_failed…).",
                    [target('sum by (service) (count_over_time({service=~"$service", level=~"WARNING|ERROR"} [1m]))', "{{service}}", ds=LOKI)],
                    {"h": 8, "w": 12, "x": 12, "y": y}, unit="short",
                    overrides=service_overrides([*SERVICES, ("remediation", "Remédiation", "#9085e9"), ("canary", "Sonde", NEUTRAL)])))
y += 8

p.append(text_row("Sécurité", y)); y += 1
p.append(timeseries("Connexions par minute, par issue",
                    "Événements du service auth. Une hausse des échecs puis des blocages = tentative de force brute.",
                    [target('sum(count_over_time({service="auth"} | json | event="login_success" [1m]))', "Réussies", "A", ds=LOKI),
                     target('sum(count_over_time({service="auth"} | json | event="login_failed" [1m]))', "Échouées", "B", ds=LOKI),
                     target('sum(count_over_time({service="auth"} | json | event="login_blocked" [1m]))', "Bloquées", "C", ds=LOKI)],
                    {"h": 8, "w": 12, "x": 0, "y": y}, unit="short",
                    overrides=fixed_overrides([("Réussies", "Réussies", GOOD), ("Échouées", "Échouées", WARN), ("Bloquées", "Bloquées", CRIT)])))
p.append(table("Échecs de connexion par IP et identifiant (période)",
               "Top 10. Attention : les connexions passées par le front Next.js portent toutes l'IP du serveur du front.",
               [target('topk(10, sum by (client_ip, username) (count_over_time({service="auth"} | json | event=~"login_failed|login_blocked" [$__range])))',
                       instant=True, ds=LOKI)],
               {"h": 8, "w": 12, "x": 12, "y": y},
               rename={"client_ip": "IP source", "username": "Identifiant", "Value #A": "Échecs", "Value": "Échecs"},
               sort_by=[{"displayName": "Échecs", "desc": True}]))
y += 8
p.append(timeseries("Réponses de la passerelle par minute, par classe",
                    "Journal d'accès Nginx (point d'entrée unique). Source naturelle pour le WAF et le SIEM.",
                    [target('sum(count_over_time({service="gateway"} | json | __error__="" | status < 400 [1m]))', "2xx/3xx", "A", ds=LOKI),
                     target('sum(count_over_time({service="gateway"} | json | __error__="" | status >= 400 | status < 500 [1m]))', "4xx", "B", ds=LOKI),
                     target('sum(count_over_time({service="gateway"} | json | __error__="" | status >= 500 [1m]))', "5xx", "C", ds=LOKI)],
                    {"h": 8, "w": 12, "x": 0, "y": y}, unit="short", fill=10,
                    overrides=fixed_overrides([("2xx/3xx", "2xx/3xx", NEUTRAL), ("4xx", "4xx", WARN), ("5xx", "5xx", CRIT)])))
p.append(timeseries("Trafic de la passerelle hors sonde, par minute",
                    "Requêtes dont l'agent n'est pas la sonde (resilience-canary/1.0, posé sur ses paiements) : le trafic des vrais clients.",
                    [target('sum(count_over_time({service="gateway"} | json | __error__="" | user_agent != "resilience-canary/1.0" [1m]))', "Hors sonde", "A", ds=LOKI),
                     target('sum(count_over_time({service="gateway"} | json | __error__="" | user_agent = "resilience-canary/1.0" [1m]))', "Paiements de la sonde", "B", ds=LOKI)],
                    {"h": 8, "w": 12, "x": 12, "y": y}, unit="short",
                    overrides=fixed_overrides([("Hors sonde", "Hors sonde", "#3987e5"), ("Paiements de la sonde", "Paiements de la sonde", "#d95926")])))
y += 8
p.append(logs("Événements critiques",
              "Erreurs (ERROR) : soldes incohérents (integrity_violation), piste d'audit altérée (audit_chain_broken), exceptions non gérées.",
              '{level="ERROR"} | json | line_format "{{.service}} · {{.event}} · {{.msg}}"',
              {"h": 8, "w": 24, "x": 0, "y": y}))
y += 8

p.append(text_row("Exploration", y)); y += 1
p.append(logs("Journal (service et texte choisis en haut)",
              "Toutes les lignes des services sélectionnés contenant le texte saisi. Vide = tout.",
              '{service=~"$service"} |= `$recherche`', {"h": 12, "w": 24, "x": 0, "y": y}))
y += 12
p.append(logs("Suivi d'une requête (request_id)",
              "Collez le x-request-id affiché par le front dans une erreur (champ request_id en haut) : toutes les lignes de la passerelle et des services pour cette requête. Vide tant qu'aucun identifiant n'est saisi.",
              '{service=~".+"} |= `request_id` |~ `"request_id": ?"$request_id"`', {"h": 10, "w": 24, "x": 0, "y": y}))
y += 10

logs_db = dashboard("ra-logs", "Resilience Alpha · Journaux et sécurité",
                    "Loki : volume et niveaux, connexions, passerelle, erreurs critiques, exploration et suivi d'une requête.",
                    p, ["logs", "securite"], LINKS, templating=templating, refresh="10s", time_from="now-30m")

for name, d in [("recovery", recovery), ("traffic", traffic), ("logs", logs_db)]:
    (OUT / f"{name}.json").write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(OUT / f"{name}.json", len(d["panels"]), "panneaux")
