"""Explicit maintenance command; tests never rewrite golden outputs."""
from pathlib import Path
from optical_import import dumps, parse_file

root = Path(__file__).resolve().parents[2]
for folder in ("zemax", "oslo"):
    for source in sorted((root / "fixtures" / folder).iterdir()):
        (root / "fixtures/golden" / (source.name + ".json")).write_text(dumps(parse_file(source)), encoding="utf-8")
