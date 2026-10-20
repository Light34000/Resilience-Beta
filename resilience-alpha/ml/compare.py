"""Banc d'essai : compare plusieurs modèles de détection sur les mêmes variables et les mêmes données.

    python ml/compare.py --normal ml/data/train-gateway.jsonl \
        --attacks-from <epoch> --attacks-to <epoch>   # attaques étiquetées pour l'apprentissage supervisé
        --test-from <epoch> --test-to <epoch>         # période d'évaluation (disjointe)

Règles du banc :
  - les modèles non supervisés n'apprennent que du trafic normal ;
  - le modèle supervisé apprend du normal + des attaques RAPIDES de la première période ;
  - le test se fait sur une autre période : attaques rapides, variantes LENTES et une attaque jamais vue
    (« stuffing », bourrage d'identifiants) — ce qui mesure la capacité à reconnaître l'inconnu.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import RobustScaler, StandardScaler
from sklearn.svm import OneClassSVM

import loki
from features import FEATURES, compute_bounds, exceeded, label_of, sliding_windows

class ECOD:
    """ECOD (Li et al., 2022) : probabilité de queue empirique par variable, sans hyperparamètre.
    Contrairement à une forêt, une valeur jamais vue sur une variable constante obtient une queue minimale."""

    def fit(self, X: np.ndarray) -> "ECOD":
        self.X = np.sort(X, axis=0)
        self.n = len(X)
        skew = pd.DataFrame(X).skew().fillna(0).to_numpy()
        self.right = skew >= 0
        return self

    def score(self, X: np.ndarray) -> np.ndarray:
        left = np.stack([np.searchsorted(self.X[:, j], X[:, j], side="right") for j in range(X.shape[1])], axis=1)
        right = self.n - np.stack([np.searchsorted(self.X[:, j], X[:, j], side="left") for j in range(X.shape[1])], axis=1)
        pl, pr = (left + 1) / (self.n + 1), (right + 1) / (self.n + 1)
        ul, ur = -np.log(pl).sum(1), -np.log(pr).sum(1)
        ua = np.where(self.right, -np.log(pr), -np.log(pl)).sum(1)
        return np.maximum.reduce([ul, ur, ua])  # plus haut = plus anormal


def load_jsonl(path: str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--normal", required=True)
    p.add_argument("--attacks-from", type=float, required=True)
    p.add_argument("--attacks-to", type=float, required=True)
    p.add_argument("--test-from", type=float, required=True)
    p.add_argument("--test-to", type=float, required=True)
    p.add_argument("--quantile", type=float, default=0.995, help="seuil des modèles non supervisés sur le normal")
    a = p.parse_args()

    train_n = sliding_windows(load_jsonl(a.normal))
    train_n = train_n[train_n["user_agent"].map(label_of) == "normal"]
    early = sliding_windows(list(loki.fetch(a.attacks_from, a.attacks_to)))
    early["label"] = early["user_agent"].map(label_of)
    train_a = early[early["label"] != "normal"]
    test = sliding_windows(list(loki.fetch(a.test_from, a.test_to)))
    test["label"] = test["user_agent"].map(label_of)

    Xn = train_n[FEATURES].to_numpy(float)
    Xt = test[FEATURES].to_numpy(float)
    q = a.quantile
    results: dict[str, np.ndarray] = {}

    iforest = make_pipeline(RobustScaler(), IsolationForest(n_estimators=300, random_state=42)).fit(Xn)
    thr = np.quantile(-iforest.score_samples(Xn), q)
    results["IsolationForest"] = -iforest.score_samples(Xt) > thr
    limits = compute_bounds(train_n)
    bounds = test.apply(lambda r: bool(exceeded(r, limits)), axis=1).to_numpy()
    results["IsolationForest + bornes"] = results["IsolationForest"] | bounds

    ecod = ECOD().fit(Xn)
    results["ECOD"] = ecod.score(Xt) > np.quantile(ecod.score(Xn), q)

    lof = make_pipeline(StandardScaler(), LocalOutlierFactor(n_neighbors=20, novelty=True)).fit(Xn)
    results["LOF (novelty)"] = -lof.score_samples(Xt) > np.quantile(-lof.score_samples(Xn), q)

    ocsvm = make_pipeline(StandardScaler(), OneClassSVM(nu=0.01, gamma="scale")).fit(Xn)
    results["One-Class SVM"] = -ocsvm.score_samples(Xt) > np.quantile(-ocsvm.score_samples(Xn), q)

    Xs = np.vstack([Xn, train_a[FEATURES].to_numpy(float)])
    ys = np.r_[np.zeros(len(Xn)), np.ones(len(train_a))]
    clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.1, class_weight="balanced", random_state=42).fit(Xs, ys)
    results["Supervisé (gradient boosting)"] = clf.predict_proba(Xt)[:, 1] > 0.5
    results["Hybride : ECOD ou supervisé"] = results["ECOD"] | results["Supervisé (gradient boosting)"]
    results["Hybride : IF + bornes ou supervisé"] = results["IsolationForest + bornes"] | results["Supervisé (gradient boosting)"]

    labels = sorted(test["label"].unique(), key=lambda s: (s == "normal", "slow" in s, s))
    table = []
    for name, pred in results.items():
        row = {"modèle": name}
        for lab in labels:
            m = (test["label"] == lab).to_numpy()
            row[lab] = f"{pred[m].mean():.0%}"
        att = (test["label"] != "normal").to_numpy()
        row["toutes attaques"] = f"{pred[att].mean():.0%}"
        row["faux positifs"] = f"{pred[~att].mean():.1%}"
        table.append(row)
    pd.set_option("display.width", 250)
    print(f"Entraînement : {len(train_n)} fenêtres normales, {len(train_a)} fenêtres d'attaque (supervisé : "
          f"{', '.join(sorted(train_a['label'].unique()))}). Test : {len(test)} fenêtres "
          f"({int((test['label'] != 'normal').sum())} d'attaque).")
    print("Fenêtres par étiquette (test) :", test["label"].value_counts().to_dict())
    print(pd.DataFrame(table).to_string(index=False))


if __name__ == "__main__":
    t = time.time()
    main()
    print(f"({time.time() - t:.1f} s)")
