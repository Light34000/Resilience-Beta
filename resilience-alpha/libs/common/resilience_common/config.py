import os


def env(name: str, default: str | None = None, *, required: bool = False) -> str | None:
    """Lit une variable d'environnement. Les secrets arrivent toujours par l'environnement, jamais en dur."""
    value = os.environ.get(name, default)
    if required and not value:
        raise RuntimeError(f"Variable d'environnement obligatoire manquante : {name}")
    return value
