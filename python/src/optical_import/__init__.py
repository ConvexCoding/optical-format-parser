"""Public standalone import API. No Optiland runtime is imported."""
from __future__ import annotations

import json
from pathlib import Path

from .encoding import decode_bytes
from .normalize import json_safe, normalize
from .oslo.parser import OsloDataParser
from .zemax.parser import ZemaxDataParser

__all__ = ["parse_text", "parse_bytes", "parse_file", "dumps"]


def parse_text(text: str, format: str, *, filename: str = "<memory>", strict: bool = False, encoding: str = "text") -> dict:
    if format == "zemax":
        model = ZemaxDataParser(filename).parse(text.lstrip("\ufeff")).to_dict()
    elif format == "oslo":
        model = OsloDataParser(filename, strict=strict).parse(text.lstrip("\ufeff")).to_dict()
    else:
        raise ValueError("format must be 'zemax' or 'oslo'")
    return normalize(model, format, filename, encoding, strict=strict)


def parse_bytes(data: bytes, format: str, *, filename: str = "<memory>", strict: bool = False) -> dict:
    text, encoding = decode_bytes(data, format)
    return parse_text(text, format, filename=filename, strict=strict, encoding=encoding)


def parse_file(path: str | Path, *, format: str | None = None, strict: bool = False) -> dict:
    path = Path(path)
    format = format or {".zmx": "zemax", ".len": "oslo"}.get(path.suffix.lower())
    if format is None:
        raise ValueError("Use a .zmx/.len extension or specify format")
    return parse_bytes(path.read_bytes(), format, filename=path.name, strict=strict)


def dumps(data: dict, *, indent: int = 2) -> str:
    return json.dumps(json_safe(data), ensure_ascii=False, indent=indent, allow_nan=False) + "\n"
