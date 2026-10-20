import os
import sys
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "libs" / "common"))
