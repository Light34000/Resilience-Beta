"""Entraîne le détecteur hybride et enregistre le modèle (ml/model/model.joblib).

    python ml/train.py --since 30m                       # lit Loki (voir loki.py pour LOKI_URL depuis le PC)
    python ml/train.py --from-file ml/data/a.jsonl --range 1792444380 1792444740 --save-data ml/data/all.jsonl

Trois composantes, choisies après comparaison (ml/compare.py, docs/02 §3.6) :
  1. Isolation Forest, appris sur le trafic NORMAL seulement : repère ce qui sort de l'habitude, y compris
     une attaque jamais vue ;
  2. garde-fous de bornes : une variable qui dépasse nettement la plage normale (ce que la forêt ne voit pas) ;
  3. classifieur supervisé (gradient boosting), appris sur le normal + les attaques ÉTIQUETÉES présentes dans les
     données (agent « rsl-attack-… » posé par ml/traffic.py) : affine la détection des attaques connues.
     Absent si les données ne contiennent pas assez d'attaques étiquetées.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler

import loki
from features import FEATURES, WINDOW_S, compute_bounds, label_of, sliding_windows

MODEL_DIR = Path(__file__).resolve().parent / "model"
MIN_ATTACK_WINDOWS = 20


def parse_since(text: str) -> float:
    m = re.fullmatch(r"(\d+)([smhd])", text)
    if not m:
        raise SystemExit("--since attend par ex. 30m, 2h, 1d")
    return int(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)]


def load_records(args) -> list[dict]:
    records: list[dict] = []
    for path in args.from_file or []:
        records += [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    for start, end in args.range or []:
        records += list(loki.fetch(float(start), float(end)))
    if args.since:
        end = time.time()
        records += list(loki.fetch(end - parse_since(args.since), end))
    return records


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--since", help="période récente lue dans Loki, ex. 30m")
    p.add_argument("--from-file", action="append", help="lignes brutes JSONL (répétable)")
    p.add_argument("--range", nargs=2, action="append", metavar=("DEBUT", "FIN"), help="période Loki en secondes epoch (répétable)")
    p.add_argument("--save-data", help="enregistre les lignes brutes (JSONL) pour rejouer l'entraînement")
    p.add_argument("--quantile", type=float, default=0.005, help="part des fenêtres normales tolérées sous le seuil")
    p.add_argument("--trees", type=int, default=300)
    a = p.parse_args()
    if not (a.since or a.from_file or a.range):
        a.since = "60m"

    records = load_records(a)
    if a.save_data:
        Path(a.save_data).parent.mkdir(parents=True, exist_ok=True)
        Path(a.save_data).write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")
    df = sliding_windows(records)
    df["label"] = df["user_agent"].map(label_of)
    normal, attacks = df[df["label"] == "normal"], df[df["label"] != "normal"]
    if len(normal) < 100:
        raise SystemExit(f"Seulement {len(normal)} fenêtres normales : générer du trafic (traffic.py normal) puis réessayer.")

    X = normal[FEATURES].to_numpy(dtype=float)
    forest = Pipeline(
        [
            ("scale", RobustScaler()),
            ("iforest", IsolationForest(n_estimators=a.trees, max_samples="auto", contamination="auto", random_state=42)),
        ]
    )
    forest.fit(X)
    threshold = float(np.quantile(forest.score_samples(X), a.quantile))  # plus bas = plus anormal

    classifier = None
    if len(attacks) >= MIN_ATTACK_WINDOWS:
        Xs = np.vstack([X, attacks[FEATURES].to_numpy(dtype=float)])
        ys = np.r_[np.zeros(len(X)), np.ones(len(attacks))]
        classifier = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.1, class_weight="balanced", random_state=42)
        classifier.fit(Xs, ys)

    MODEL_DIR.mkdir(exist_ok=True)
    meta = {
        "features": FEATURES,
        "window_s": WINDOW_S,
        "threshold": threshold,
        "quantile": a.quantile,
        "limits": compute_bounds(normal),
        "classifier_threshold": 0.5,
        "attack_types": sorted(attacks["label"].unique().tolist()),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "windows": int(len(normal)),
        "attack_windows": int(len(attacks)),
        "clients": int(normal["key"].nunique()),
    }
    joblib.dump({"model": forest, "classifier": classifier, **meta}, MODEL_DIR / "model.joblib")
    (MODEL_DIR / "model.json").write_text(json.dumps({**meta, "supervised": classifier is not None}, indent=2, ensure_ascii=False), encoding="utf-8")
    sup = (f"classifieur supervisé appris sur {len(attacks)} fenêtres d'attaque ({', '.join(meta['attack_types'])})"
           if classifier is not None else f"pas de classifieur supervisé (moins de {MIN_ATTACK_WINDOWS} fenêtres d'attaque étiquetées)")
    print(f"Modèle enregistré : forêt + bornes sur {meta['windows']} fenêtres normales ({meta['clients']} clients), "
          f"seuil {threshold:.4f} ; {sup}.")


if __name__ == "__main__":
    main()
