"""Normalize prescription data, preserving declarations without executing physics."""
from __future__ import annotations

import math
from typing import Any

UPSTREAM_REVISION = "4e893f53aee1312f2d091680b93dd2279711e197"
LENGTH_SCALES = {"MM": 1.0, "CM": 10.0, "M": 1000.0, "IN": 25.4, "INCH": 25.4}


def json_safe(value: Any, path: str = "$") -> Any:
    """Represent intentional infinity explicitly, reject NaN and unknown objects."""
    if isinstance(value, float):
        if math.isnan(value):
            raise ValueError(f"{path}: NaN is not valid prescription data")
        if math.isinf(value):
            return {"special": "positiveInfinity" if value > 0 else "negativeInfinity"}
    if isinstance(value, dict):
        return {str(k): json_safe(v, f"{path}.{k}") for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v, f"{path}[{i}]") for i, v in enumerate(value)]
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    raise TypeError(f"{path}: cannot serialize {type(value).__name__}")


def _material(raw: Any, surface: dict, fmt: str) -> dict:
    if isinstance(raw, dict):
        return dict(raw)
    if not raw or str(raw).upper() in {"AIR", "AIF"}:
        return {"kind": "air"}
    if str(raw).upper() in {"MIRROR", "RFL", "RFH"}:
        return {"kind": "mirror"}
    if fmt == "zemax":
        return {"kind": "catalog", "name": str(raw), "resolution": "unresolved"}
    from .oslo.syntax import decode_text, tokenize
    parts = tokenize(str(raw))
    if not parts or parts[0].upper() != "GLA":
        return {"kind": "unknown", "raw": str(raw)}
    parts = parts[1:]
    modeled = bool(parts and parts[0].upper() == "MOD")
    if modeled:
        parts = parts[1:]
    name = None
    if parts:
        try:
            float(parts[0])
        except ValueError:
            name, parts = decode_text(parts[0]), parts[1:]
    if not parts:
        if modeled or not name:
            raise ValueError("GLA requires a catalog name or refractive-index data")
        return {"kind": "catalog", "name": name, "resolution": "unresolved"}
    indices = [float(v) for v in parts]
    if any(not math.isfinite(v) or v <= 0 for v in indices):
        raise ValueError("GLA indices must be positive finite numbers")
    if modeled and len(indices) == 2:
        return {"kind": "model", "name": name, "nd": indices[0], "vd": indices[1],
                "dispersion": "unspecified", "resolution": "unresolved"}
    if len(set(indices)) == 1:
        return {"kind": "constantIndex", "name": name, "index": indices[0]}
    wavelengths = surface.get("glass_wavelengths", [0.58756, 0.48613, 0.65627])
    if len(indices) != len(wavelengths):
        raise ValueError("OSLO glass index/wavelength counts differ")
    return {"kind": "sampledIndex", "name": name, "wavelengthsUm": wavelengths, "indices": indices}


def normalize(model: dict, fmt: str, filename: str, encoding: str, *, strict: bool = False) -> dict:
    diagnostics = [
        {"severity": d.get("severity", "warning"), "code": "uninterpreted_record",
         "command": d["command"], "line": d["line"], "surface": d["surface"], "message": d["message"]}
        for d in model.get("diagnostics", [])
    ]

    def warn(code: str, message: str, **location: Any) -> None:
        diagnostics.append({"severity": "warning", "code": code, "message": message, **location})

    if fmt == "zemax":
        source_unit = model["units"]
        if source_unit not in LENGTH_SCALES:
            raise ValueError(f"Unsupported Zemax length unit: {source_unit}")
        scale = LENGTH_SCALES[source_unit]
        if not any(r["text"].startswith("UNIT ") for r in model["records"]):
            diagnostics.append({"severity": "info", "code": "assumed_units", "message": "No UNIT record; assuming millimeters"})
    else:
        source_unit, scale = "lensUnit", model["units"]

    if not math.isfinite(scale) or scale <= 0:
        raise ValueError("Length scale must be a positive finite number")

    aperture_source = model["aperture"]
    if any(not isinstance(v, bool) and (not math.isfinite(v) or v < 0) for v in aperture_source.values()):
        raise ValueError("Aperture values must be finite and nonnegative")
    aperture = {"kind": "unspecified", "value": None, "source": aperture_source}
    if aperture_source:
        key = next(iter(aperture_source))
        if fmt == "oslo" and key == "EPD":
            aperture.update(kind="beamRadiusAtSurface1", value=aperture_source[key] * scale / 2)
        else:
            aperture.update(kind={"EPD": "entrancePupilDiameter", "FNO": "imageFNumber", "imageFNO": "imageFNumber",
                                  "paraxialImageFNO": "paraxialImageFNumber", "NAO": "objectNA", "objectNA": "objectNA",
                                  "NAP": "imageNA", "PUK": "imageSlope", "floating_stop": "floatingStop"}.get(key, key),
                            value=None if isinstance(aperture_source[key], bool) else aperture_source[key] * (scale if key == "EPD" else 1))
    if len(aperture_source) > 1:
        warn("multiple_apertures", "Multiple aperture declarations retained; first is reported as the common aperture")

    fields_source = model["fields"]
    for key, column in fields_source.items():
        if isinstance(column, list) and any(not math.isfinite(v) for v in column):
            raise ValueError(f"Field {key} must contain finite numbers")
    if any(w < 0 for w in fields_source.get("weights", [])):
        raise ValueError("Field weights must be nonnegative")
    field_kind = fields_source.get("type", "angle")
    field_scale = scale if field_kind in {"object_height", "paraxial_image_height", "real_image_height", "gaussian_image_height"} else 1
    points = []
    if fmt == "zemax":
        xs, ys = fields_source.get("x", []), fields_source.get("y", [])
        extras = {key: fields_source[key] for key in ("weights", "vignette_decenter_x", "vignette_decenter_y", "vignette_compress_x", "vignette_compress_y", "vignette_tangent_angle") if key in fields_source}
        if len(xs) != len(ys) or any(len(v) != len(xs) for v in extras.values()) or fields_source.get("num_fields", len(xs)) != len(xs):
            warn("field_count_mismatch", "Declared and parsed field columns differ; raw columns retained")
        for i, (x, y) in enumerate(zip(xs, ys)):
            field_weights = fields_source.get("weights", [])
            point = {"x": x * field_scale, "y": y * field_scale, "weight": field_weights[i] if i < len(field_weights) else 1}
            point["vignetting"] = {key: values[i] for key, values in extras.items() if key != "weights" and i < len(values)}
            points.append(point)
    else:
        # OSLO ANG/OBH/GIH are reference extents, not an explicit field sampling.
        if "points" in fields_source:
            warn("relative_field_table", "OSLO field-table coordinates are retained as relative prescription data; no optical conversion is executed")
    fields = {"kind": field_kind, "points": points,
              "reference": None if fmt == "zemax" else {"y": fields_source.get("y", [0])[0] * field_scale, "coordinates": "prescriptionExtent"},
              "source": fields_source}

    waves = model["wavelengths"]
    values = waves.get("data" if fmt == "zemax" else "values", [])
    weights = waves.get("weights", [])
    primary = waves.get("primary_index", 0 if values else None)
    if len(values) != len(weights) or any(not math.isfinite(v) or v <= 0 for v in values) or any(not math.isfinite(w) or w < 0 for w in weights):
        raise ValueError("Wavelength values/weights must align and be finite, positive/nonnegative")
    if primary is not None and (type(primary) is not int or not 0 <= primary < len(values)):
        raise ValueError("Primary wavelength index is outside active wavelengths")
    if values and primary is None:
        warn("missing_primary_wavelength", "Declared primary wavelength is not in the active slots")
    if fmt == "zemax" and any(r["text"].startswith("WAVL ") for r in model["records"]):
        warn("legacy_wavl", "WAVL follows upstream legacy token consumption; vector WAVL/WWGT is not fully interpreted")

    surfaces = []
    max_index = max(model["surfaces"], default=0)
    has_stop = any(s.get("AST", False) for s in model["surfaces"].values())
    for index, surface in sorted(model["surfaces"].items()):
        for key, value in surface.items():
            if key not in {"radius", "thickness", "RD", "TH"} and isinstance(value, (int, float)) and not math.isfinite(value):
                raise ValueError(f"Surface {index} {key} must be finite")
        native_type = surface.get("type", surface.get("ASP", "ADO"))
        kind = native_type if fmt == "zemax" else {"ADO": "standard", "ASR": "even_asphere", "ARA": "odd_asphere", "ASX": "polynomial"}.get(native_type, "unknown")
        if fmt == "oslo" and any(k in surface for k in ("AD", "AE", "AF", "AG")):
            kind = "even_asphere"
        if fmt == "oslo" and "CVX" in surface:
            kind = "toroidal"
        if fmt == "oslo" and "PFL" in surface:
            kind = "paraxial"
        if kind not in {"standard", "even_asphere", "odd_asphere", "toroidal", "coordinate_break", "paraxial", "polynomial"}:
            warn("unresolved_surface_type", "Surface type retained without a common geometry interpretation", surface=index)
        radius = surface.get("radius" if fmt == "zemax" else "RD", math.inf)
        thickness = surface.get("thickness" if fmt == "zemax" else "TH", 0.0)
        if fmt == "oslo" and abs(thickness) >= (1e8 if index == 0 else 9.9e9):
            thickness = math.copysign(math.inf, thickness)
        material = _material(surface.get("material", "air"), surface, fmt)
        if material["kind"] in {"catalog", "model"}:
            warn("unresolved_material", "Material identity preserved; catalog lookup and dispersion fitting are not executed", surface=index)
        if kind == "coordinate_break" or any(k in surface for k in ("DCX", "DCY", "DCZ", "TLA", "TLB", "TLC", "GC", "RCO", "BEN", "TOX", "TOY", "TOZ")):
            warn("unresolved_coordinates", "Coordinate declarations retained; no global frame is calculated", surface=index)
        if any(k in surface for k in ("pickups", "PY", "PYC", "PU", "PUC", "EC")):
            warn("unresolved_constraints", "Pickup/solve declarations retained; literal values are not a solved snapshot", surface=index)
        if any(k in surface for k in ("PFL", "PFM", "GSP", "GOR", "TCE")):
            warn("unresolved_optical_feature", "Perfect-imagery, grating or thermal declarations retained without optical interpretation", surface=index)
        if fmt == "oslo" and index == max_index and thickness:
            warn("image_focus_declaration", "Image TH is OSLO defocus, retained as a declaration rather than applied to the preceding gap", surface=index)
        clear = surface.get("aperture")
        if clear is not None:
            if any(not math.isfinite(clear[k]) for k in ("r_min", "r_max", "offset_x", "offset_y")) or not 0 <= clear["r_min"] <= clear["r_max"]:
                raise ValueError("Clear aperture radii/offsets must be finite with 0 <= r_min <= r_max")
            clear = {**clear, **{k: clear[k] * scale for k in ("r_min", "r_max", "offset_x", "offset_y")}}
        elif fmt == "oslo" and "AP" in surface:
            clear = {"kind": "annulus", "r_min": 0.0, "r_max": surface["AP"] * scale, "offset_x": 0.0, "offset_y": 0.0,
                     "checked": surface.get("aperture_checked", False), "checkingEnabled": model["settings"].get("aperture_check", True)}
        surfaces.append({"index": index, "role": "coordinateBreak" if kind == "coordinate_break" else "object" if index == 0 else "image" if index == max_index else "surface",
                         "type": kind, "radiusMm": radius * scale, "thicknessMm": thickness * scale,
                         "conic": surface.get("conic" if fmt == "zemax" else "CC", 0.0),
                         "stop": surface.get("is_stop", False) if fmt == "zemax" else surface.get("AST", not has_stop and index == 1),
                         "material": material, "clearAperture": clear, "parameters": surface})
    if not surfaces:
        raise ValueError("No optical surfaces parsed")
    if fmt == "oslo" and len(model["configurations"]) > 1:
        warn("configuration_declarations", "Base prescription reported; alternative configuration overrides retained in raw.configurations")
    if strict and any(d["severity"] == "warning" for d in diagnostics):
        first = next(d for d in diagnostics if d["severity"] == "warning")
        raise ValueError(f"Strict import: {first['code']}: {first['message']}")
    return json_safe({"schemaVersion": "1.0", "source": {"format": fmt, "filename": filename, "encoding": encoding, "upstreamRevision": UPSTREAM_REVISION},
                      "name": model["name"], "mode": "sequential", "units": {"length": "mm", "wavelength": "um", "angle": "deg", "sourceLength": source_unit, "scaleToMm": scale},
                      "aperture": aperture, "fields": fields,
                      "wavelengths": {"valuesUm": values, "weights": weights, "primaryIndex": primary},
                      "surfaces": surfaces, "diagnostics": diagnostics, "raw": model})
