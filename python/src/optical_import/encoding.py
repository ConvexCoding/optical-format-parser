"""Decode lens-file bytes before parsing; no filesystem or network coupling."""
from __future__ import annotations


def decode_bytes(data: bytes, format: str) -> tuple[str, str]:
    if format not in {"zemax", "oslo"}:
        raise ValueError("format must be 'zemax' or 'oslo'")
    if format == "zemax":
        if data.startswith((b"\xff\xfe", b"\xfe\xff")):
            encoding = "utf-16-le" if data.startswith(b"\xff\xfe") else "utf-16-be"
            return data[2:].decode(encoding), encoding
        # BOM-less UTF-16 is an explicit extension over the upstream reader.
        sample = data[:256]
        if len(sample) >= 4 and sample.count(0) > len(sample) // 4:
            encoding = "utf-16-le" if sample[1::2].count(0) >= sample[::2].count(0) else "utf-16-be"
            return data.decode(encoding), encoding
    try:
        return data.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        encoding = "iso-8859-1" if format == "zemax" else "cp1252"
        return data.decode(encoding), encoding
