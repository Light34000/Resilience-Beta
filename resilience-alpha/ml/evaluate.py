"""Évalue le modèle enregistré sur une période contenant du trafic normal ET des attaques étiquetées.

    python ml/evaluate.py --since 15m
    python ml/evaluate.py --range 1792445837 1792446632

Affiche, par type de trafic, la part de fenêtres signalées (détection pour les attaques, faux positifs pour le
normal) et quelle composante les a signalées : forêt, bornes, supervisé.
"""

from __future__ import annotations

import argparse
import time

import joblib
import pandas as pd

import loki
from features import exceeded, label_of, sliding_windows
from train import MODEL_DIR, parse_since


def score(bundle: dict, df: pd.DataFrame) -> pd.DataFrame:
    """Mêmes règles que le détecteur temps réel."""
    X = df[bundle["features"]].to_numpy(dtype=float)
    df = df.copy()
    df["score"] = bundle["model"].score_samples(X)
    df["forêt"] = df["score"] < bundle["threshold"]
    df["bornes"] = df.apply(lambda r: bool(exceeded(r, bundle["limits"])), axis=1)
    clf = bundle.get("classifier")
    df["supervisé"] = clf.predict_proba(X)[:, 1] > bundle["classifier_threshold"] if clf is not None else False
    df["anomalie"] = df["forêt"] | df["bornes"] | df["supervisé"]
    return df


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--since", default="30m")
    p.add_argument("--range", nargs=2, type=float, metavar=("DEBUT", "FIN"))
    a = p.parse_args()
    bundle = joblib.load(MODEL_DIR / "model.joblib")
    if a.range:
        start, end = a.range
    else:
        end = time.time()
        start = end - parse_since(a.since)
    df = sliding_windows(list(loki.fetch(start, end)))
    df["label"] = df["user_agent"].map(label_of)
    df = score(bundle, df)

    rows = []
    order = sorted(df["label"].unique(), key=lambda s: (s == "normal", "slow" in s, s))
    for label in order:
        g = df[df["label"] == label]
        rows.append({"trafic": label, "fenêtres": len(g), "signalées": f"{g['anomalie'].mean():.0%}",
                     "forêt": int(g["forêt"].sum()), "bornes": int(g["bornes"].sum()), "supervisé": int(g["supervisé"].sum())})
    pd.set_option("display.width", 200)
    print(pd.DataFrame(rows).to_string(index=False))
    att, nor = df[df["label"] != "normal"], df[df["label"] == "normal"]
    if len(att):
        print(f"\nDétection : {att['anomalie'].mean():.0%} des fenêtres d'attaque  ·  faux positifs : "
              f"{nor['anomalie'].mean():.1%} des {len(nor)} fenêtres normales  ·  supervisé : "
              f"{'oui' if bundle.get('classifier') is not None else 'non'}")


if __name__ == "__main__":
    main()
