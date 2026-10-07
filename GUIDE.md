# Extracting Optiland's Zemax and OSLO parsers, then porting to TypeScript

## Purpose and source revision

Build a small, offline library that reads sequential Zemax `.zmx` and OSLO `.len` prescriptions and produces a versioned, normalized JSON document. First validate the extracted Python implementation without installing Optiland; then implement the same contract in TypeScript for a browser.

The source references below use Optiland's **master branch**. This guide was checked against master commit **`4e893f53aee1312f2d091680b93dd2279711e197`**, dated 2026-10-06, on **2026-10-07**. Master moves: record the revision every time you re-extract, and review differences before updating. [Upstream repository](https://github.com/optiland/optiland/tree/master); [revision record](UPSTREAM.json).

There are two distinct JSON targets:

1. **Optiland native JSON:** load into an `Optic`, call `optic.to_dict()`, and serialize it. This includes engine-specific geometry, materials, surfaces, pickups, solves, and tracing configuration. Keeping this behavior unchanged brings in much of the optical engine.
2. **A normalized prescription JSON:** parse into intermediate records, normalize common fields, and preserve uninterpreted native data with diagnostics. This is the target of this repository. It can stay small and work offline in a browser.

This project's JSON is not an input for `Optic.from_dict()`. Parsing a solve declaration is different from calculating its result. Parsed catalogs, coordinate commands, and solves remain explicit data until a separate implementation interprets them.

## Exact upstream source map

### Zemax

| Master source path | What to take or study | Standalone boundary |
| --- | --- | --- |
| [`optiland/fileio/zemax/reader/parser.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/zemax/reader/parser.py) | `ZemaxDataParser`, operand dispatch, field/wavelength slots, surface records, encoding behavior | Extract and adapt. It imports backend, material classes, catalog matching, and physical apertures; unchanged copying is not a lightweight parser. |
| [`optiland/fileio/zemax/model.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/zemax/model.py) | `ZemaxDataModel`, `to_dict()` | Dataclasses and typing only. The original `to_dict()` omits `mode`, and its surfaces can contain live material/aperture objects. |
| [`optiland/fileio/zemax/reader/source.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/zemax/reader/source.py) | `ZemaxFileSourceHandler`: local paths, HTTP, temporary-file cleanup | Optional; uses `requests`. Omit from an offline parser. Accept bytes/text instead. |
| [`optiland/fileio/zemax/reader/converter.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/zemax/reader/converter.py) | `ZemaxToOpticConverter.read()` / `.convert()`; surface parameters, asphere coefficient mapping, coordinate breaks, aperture and field semantics | Use as a semantic reference and optional oracle. It constructs `Optic` and `CoordinateSystem` and calls optical core APIs. |
| [`optiland/fileio/zemax/surfaces.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/zemax/surfaces.py) | Shared surface handler registry: standard, paraxial, even/odd asphere, coordinate break, toroidal | Reference only for this extraction. It has backend-dependent helpers; the inspected reader converter performs its own surface mapping. |

### OSLO

| Master source path | What to take or study | Standalone boundary |
| --- | --- | --- |
| [`optiland/fileio/oslo/reader/parser.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/reader/parser.py) | `OsloDataParser`, command dispatch, quoted statements, footer field/configuration tables, strict diagnostics | Extract. Standard-library imports plus the model, constants, syntax, and configuration helpers below. |
| [`optiland/fileio/oslo/model.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/model.py) | `OsloDataModel`, `OsloDiagnostic`, `OsloConfiguration`, `to_dict()` via `dataclasses.asdict()` | Extract; standard library only. |
| [`optiland/fileio/oslo/syntax.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/syntax.py) | `tokenize()`, `decode_text()` | Extract; regular expressions only. Semicolons and `//` inside quoted strings must remain text. |
| [`optiland/fileio/oslo/constants.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/constants.py) | Default wavelengths and object/non-object infinity thresholds | Extract. Preserve the comments identifying upstream optical conventions. |
| [`optiland/fileio/oslo/reader/configurations.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/reader/configurations.py) | Declarative configuration records, spectrum validation, independent configuration snapshots | Extract after removing its import of `SOLVES` from `reader/solves.py`. Inline only the solve-name constant; otherwise SciPy and optical-engine dependencies sneak back in. |
| [`optiland/fileio/oslo/reader/geometry.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/reader/geometry.py) | `surface_geometry()`: radius, conic, ADO/ASR/ARA/ASX aspheres, toroidal geometry, dimensional scaling | Optional semantic extension; this helper is standard-library-only. Do not import the converter merely to reuse it. |
| [`optiland/fileio/oslo/reader/pickups.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/reader/pickups.py) | `resolve_pickups()`: preceding-surface copies, signs, additive offsets, profile copying | Optional later stage. Its `reference_index` import pulls in `coordinates.py`; move that small integer-index helper into a separate pure module first. |
| [`optiland/fileio/oslo/reader/coordinates.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/reader/coordinates.py) | Relative references, intrinsic rotations, pivots, global/return/bend transforms | Uses NumPy and SciPy `Rotation`. Keep declarations initially; port frame mathematics separately with tests. |
| [`optiland/fileio/oslo/reader/solves.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/reader/solves.py) | `SOLVES`, `apply_solve()`, `check_solve()` | Uses SciPy `root_scalar`, the backend, paraxial geometry, and `SolveFactory`. Copying this is no longer parser-only extraction. |
| [`optiland/fileio/oslo/reader/converter.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/reader/converter.py) | `OsloToOpticConverter`: configuration selection → pickups → materials → optic → solves → image focus | Semantic reference and optional oracle; also interprets glass samples, finite-object apertures, relative fields, and defocus. |
| [`optiland/fileio/oslo/validation.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/validation.py) | Optical object-NA checks | Converter/physics stage, not required for parsing declarations. |
| [`optiland/fileio/oslo/surfaces.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/oslo/surfaces.py) | Shared reader/writer surface handlers | Backend and geometry dependencies; reference only for this extraction. |

### Native JSON and public entry points

| Master source path | Relevant API |
| --- | --- |
| [`optiland/fileio/__init__.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/__init__.py) | `load_zemax_file(source)` and `load_oslo_file(source, strict=False, configuration=1, material_overrides=None)` |
| [`optiland/fileio/optiland_handler.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/optiland_handler.py) | `save_obj_to_json()`, `save_optiland_file()`, `OptilandEncoder`; save calls `obj.to_dict()` |
| [`optiland/optic/optic.py`](https://github.com/optiland/optiland/blob/master/optiland/optic/optic.py) | `Optic.to_dict()` delegates to `OpticSerializer` |
| [`optiland/optic/optic_serializer.py`](https://github.com/optiland/optiland/blob/master/optiland/optic/optic_serializer.py) | Native top-level JSON: `version`, `name`, `aperture`, `fields`, `wavelengths`, `apodization`, `pickups`, `solves`, `surface_group`, `ray_tracer`, optional `sequences` |
| [`pyproject.toml`](https://github.com/optiland/optiland/blob/master/pyproject.toml) | Full Optiland dependencies and Python requirement; do not copy its dependency list into the standalone project |
| [`LICENSE`](https://github.com/optiland/optiland/blob/master/LICENSE) | Retain the upstream MIT license and copyright notice with substantial copied/adapted code |

Native serialization recursively calls other objects' `to_dict()` methods. The JSON handler imports `Optic`, so copying that file alone does not remove engine dependencies. Its encoder supports arrays/tensors through `tolist()` and `item()`, but does not automatically serialize material objects buried in a raw Zemax model. Its `json.dump()` also uses Python's default nonfinite-number policy; bare `Infinity`/`NaN` output is not portable strict JSON.

## Dependency boundaries and minimal project

Use a new namespace, such as `optical_import`, and inert package initializers. An import such as `from optiland.fileio.oslo.reader.parser import OsloDataParser` still executes parent `__init__.py` files. In this master revision those initializers import converters, writers, optimization, surfaces, and visualization; a deep import does not isolate the parser.

The small runtime should retain:

- Python standard library: dataclasses, typing, math, re, pathlib, json, copy, argparse.
- Zemax parser/model, with material and aperture construction replaced by records.
- OSLO parser/model/constants/syntax/configuration records, with solver names separated from solver execution.
- A shared byte decoder, normalizer, diagnostic policy, and strict JSON serializer.

Exclude ray tracing, optimizers, plotting, VTK, NumPy/SciPy backends, CODE V, Zemax/OSLO writers, catalog loading, and source downloading from the core. If later adding glass resolution, inspect [`optiland/materials/`](https://github.com/optiland/optiland/tree/master/optiland/materials) and [`optiland/database/`](https://github.com/optiland/optiland/tree/master/optiland/database), treat catalog data as a separate optional asset, and review its own provenance. A glass name plus Nd/Vd is not a complete catalog dispersion model.

Suggested layout, also used here:

```text
optical-format-import/
  README.md, GUIDE.md, LICENSE, UPSTREAM.json
  schema/prescription.schema.json
  fixtures/
    zemax/*.zmx, oslo/*.len, golden/*.json
  python/
    pyproject.toml
    src/optical_import/
      __init__.py, __main__.py, encoding.py, normalize.py
      zemax/model.py, zemax/parser.py
      oslo/model.py, oslo/parser.py, oslo/constants.py
      oslo/syntax.py, oslo/configurations.py
    tests/test_import.py, tests/update_golden.py
  typescript/
    package.json, package-lock.json, tsconfig.json
    src/types.ts, src/index.ts, src/encoding.ts
    src/zemax.ts, src/oslo.ts, src/normalize.ts
    test/*.test.ts
```

### Concrete extraction edits

1. Copy the parser/model files and listed OSLO helpers, retain attribution, and rewrite imports into the new package. Rebuild all parent package initializers instead of copying upstream re-exports.
2. In Zemax `_read_radius()` and `_read_thickness()`, use `math.inf` instead of `be.inf`.
3. Replace Zemax `_read_glass()` with plain material records. Preserve glass name, declared `GCAT` catalogs, Nd/Vd, and `MIRROR`. Remove `_resolve_glass_by_catalog_and_index()` and all material/backend imports. Record `resolution: "unresolved"`; never silently replace an unknown glass with air. This intentionally defers upstream catalog search and Buchdahl fallback.
4. Replace `_make_circular_aperture()` with `{kind, r_min, r_max, offset_x, offset_y}`. Update `_read_aperture_decenter()` to read dictionary keys rather than `.r_min`/`.r_max`. Test both `OBDC` before and after `CLAP`.
5. In OSLO configurations, inline the names `PU`, `PUC`, `PY`, `PYC`, `EC`; do not import the module that computes solves. Preserve base/alternative configuration records without mutating the base.
6. Separate byte decoding from text parsing. Decode once, create fresh parser state per call, and attach filename/line diagnostics. Upstream Zemax retries encodings while mutating state; the extracted implementation avoids partially parsed retries. OSLO already resets its state at parse start.
7. Add a `records` collection and structured diagnostics. Preserve ignored source statements as well as parsed parameters. A recognized token does not guarantee that every associated optical effect is understood.
8. Normalize the shared fields and serialize strict JSON. Add no `Optic`, `Material`, aperture object, tensor, NumPy scalar, or remote request to this path.

The normalized units extension interprets Zemax `UNIT` (MM/CM/M/IN/INCH). The inspected upstream parser does not dispatch `UNIT`. Missing Zemax units use a documented millimeter assumption; unsupported units fail. This is an intentional extension, not a claim of unchanged upstream behavior.

## Milestone 1: Python works independently

### Get a reproducible reference

```bash
git clone --depth 1 --branch master https://github.com/optiland/optiland.git work/optiland
git -C work/optiland rev-parse HEAD
```

To reproduce this guide's snapshot after master moves, fetch/check out the revision in `UPSTREAM.json` in your reference checkout. Keep the full checkout outside the standalone runtime package.

### Run this extracted implementation

From this repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e ./python
.venv/bin/python -m unittest discover -s python/tests -v
.venv/bin/python -m optical_import fixtures/zemax/lens1.zmx -o lens.json
.venv/bin/python -m optical_import fixtures/oslo/test_achromat.len -o achromat.json
```

No Optiland installation is needed. As an additional dependency boundary check, the test suite also runs directly with site packages disabled:

```bash
PYTHONPATH=python/src python3 -S -m unittest discover -s python/tests -v
```

Python API:

```python
from optical_import import parse_file, parse_text, parse_bytes, dumps

data = parse_file("lens.zmx")
json_text = dumps(data)
data = parse_bytes(file_bytes, "oslo", filename="lens.len")
data = parse_text(source_text, "zemax", strict=True)
```

`strict=True` rejects warnings about uninterpreted records or unresolved semantics. Default mode returns declarations plus diagnostics. Inspect `diagnostics` before treating a document as fully interpreted. The CLI reports errors on stderr and exits nonzero; successful stdout contains JSON only.

### Validation strategy and source tests

Upstream tests and fixture paths to inspect:

| Master path | Coverage to adapt |
| --- | --- |
| [`tests/test_fileio/test_zemax_reader.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_zemax_reader.py) | Operands, import behavior, material/aperture handling, folded systems |
| [`tests/test_fileio/test_zemax_ftyp_counts.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_zemax_ftyp_counts.py) | Declared counts, padded/inactive slots, primary wavelength identity |
| [`tests/test_fileio/test_oslo_reader.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_oslo_reader.py) | Basic parsing, materials, loader behavior |
| [`tests/test_fileio/test_oslo_commands.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_oslo_commands.py), [`test_oslo_edge_cases.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_oslo_edge_cases.py) | Command grammar, quoting, malformed input |
| [`tests/test_fileio/test_oslo_configurations.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_oslo_configurations.py), [`test_oslo_fields.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_oslo_fields.py) | Overrides, relative field tables and optical conversions |
| [`tests/test_fileio/test_oslo_positions.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_oslo_positions.py), [`test_oslo_solves.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_oslo_solves.py), [`test_oslo_focus.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_oslo_focus.py) | Semantic reference for future frames, solves and detector focus |
| [`tests/test_fileio/test_oslo_catalogs.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_oslo_catalogs.py), [`test_oslo_core_boundaries.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_oslo_core_boundaries.py) | Catalog identity and strict support boundaries |
| [`tests/test_fileio/test_optiland_handler.py`](https://github.com/optiland/optiland/blob/master/tests/test_fileio/test_optiland_handler.py) | Native JSON save/load, separate from normalized JSON |
| [`tests/zemax_files/`](https://github.com/optiland/optiland/tree/master/tests/zemax_files), [`tests/test_fileio/oslo/`](https://github.com/optiland/optiland/tree/master/tests/test_fileio/oslo) | Real prescription fixtures |

Do not copy the whole upstream test harness: many tests import `Optic`, fixtures with backend controls, and shared optical assertions. Adapt parser-only tests to the standalone package; keep optical-engine tests in the optional reference environment.

Acceptance checks:

- Parse every corpus file and produce valid JSON; validate against the shared schema. Passing means prescription extraction works, not that every optical feature is implemented.
- Use a synthetic four-record lens with independently known radii `infinite, 20, -20, infinite`, thicknesses `infinite, 2, 20, 0`, wavelength `0.55 um`, and stop at surface 1. Compare common geometry across both formats.
- Test UTF-8/BOM, UTF-16 LE/BE and BOM-less UTF-16 for Zemax, true Latin-1 fallback, and UTF-8/Windows-1252 for OSLO. Keep binary fixtures byte-for-byte.
- Test zero curvature, signed infinite distances, fractional/exponential numbers, malformed numeric tokens, NaN rejection, aperture offsets, and units.
- Test field/wavelength count trimming, repeated/out-of-order indexed wavelength records, missing primary slots, and consistent indices after compaction.
- Test OSLO quoted semicolons/comments, escaped quotes, comma separators, `NXT`/`GTO`, surface counts, configuration overrides, declaration clearing/replacement, and strict diagnostics.
- Audit imports; run with no Optiland installed. Reuse parser objects to verify state resets. Test CLI success and failure independently of the API.
- Commit reviewed golden outputs; tests read them without regenerating them. Review output differences before updating a golden.

Generate golden files intentionally with `PYTHONPATH=python/src python3 python/tests/update_golden.py`.

### Optional full-Optiland oracle

In a separate environment, install the checked-out reference and its test requirements:

```bash
python3 -m venv work/oracle-venv
work/oracle-venv/bin/python -m pip install ./work/optiland pytest pytest-xdist
cd work/optiland
../../work/oracle-venv/bin/python -m pytest -o addopts="" \
  tests/test_fileio/test_zemax_reader.py \
  tests/test_fileio/test_oslo_reader.py \
  tests/test_fileio/test_optiland_handler.py
```

For native JSON, the public route is:

```python
from optiland.fileio import load_zemax_file, load_oslo_file, save_optiland_file

optic = load_zemax_file("lens.zmx")
save_optiland_file(optic, "lens.optiland.json")
optic = load_oslo_file("lens.len", configuration=1)
native_dict = optic.to_dict()
```

Compare overlapping quantities with documented tolerances, not entire normalized JSON against entire native JSON. Exclude expected differences: unresolved catalog objects, OSLO generated field samples, applied solves/focus, coordinate-break folding, and engine-derived aperture conversion. The small Python implementation does not claim full native JSON equivalence.

## JSON schema and normalization rules

The machine-readable contract is [`schema/prescription.schema.json`](schema/prescription.schema.json), JSON Schema draft 2020-12. The TypeScript declarations describe the same public contract. Use `schemaVersion: "1.0"` independently of Optiland's native numeric `version: 1.0`.

Core fields:

| Field | Meaning |
| --- | --- |
| `source` | Format, filename, detected encoding, upstream revision; no machine-specific absolute path |
| `units` | Common lengths in millimeters, wavelengths in micrometers, angles in degrees; original length unit and scale retained |
| `aperture` | Named prescription quantity, value, original declarations. OSLO EBR becomes `beamRadiusAtSurface1`; it is not automatically equivalent to an entrance pupil for finite objects. |
| `fields` | Zemax explicit field points; OSLO reference extent and relative source table without generated optical sampling |
| `wavelengths` | Aligned `valuesUm` / `weights`, zero-based `primaryIndex`; native slots retained in source records |
| `surfaces` | Ordered array with explicit source index, object/image/coordinate-break role, common geometry, material and clear-aperture records |
| `diagnostics` | Severity, code, message, optional source command/line/surface |
| `raw` | Parsed native model and original nonempty source statements, including declarations outside the common schema |

Examples of portable nonfinite values:

```json
{
  "radiusMm": {"special": "positiveInfinity"},
  "thicknessMm": {"special": "negativeInfinity"}
}
```

Use finite numbers for ordinary values, tagged infinity for physical planes/distances, and `null` only for a genuinely missing optional value. Reject NaN. Never rely on Python `json.dumps()` emitting `Infinity`, or JavaScript `JSON.stringify(Infinity)` converting it to `null`. Integer-keyed dictionaries become JSON object keys; use the explicit surface array for ordering, and sort native index keys numerically when interpreting them.

Material records distinguish air, mirror, named unresolved catalog glass, constant refractive index, sampled indices, and model Nd/Vd declarations. Preserve each sampled index's wavelength association. Report an unresolved catalog rather than guessing an identity. Adding a catalog resolver later must state its matching policy and data revision.

`parameters` and `raw` stay in **native prescription units**. Only explicitly named common dimensions such as `radiusMm`, `thicknessMm`, and clear-aperture dimensions are scaled. Do not multiply every `PARM` by the length scale: asphere coefficients have power-dependent units, coordinate rotations are angular, and toroidal parameters have distinct meanings. A future coefficient normalizer should carry explicit polynomial powers and use `scale ** (1 - power)` where appropriate.

Keep object and image records, signed radii/thicknesses, stop flags, mirror declarations, and coordinate-break records. Do not silently remove coordinate breaks and renumber surfaces. OSLO `LEN ... N` expects `N + 1` records including the object; upstream Zemax assigns surface indices by encounter order rather than the numeric `SURF` token. Preserve original statements so those distinctions remain inspectable.

Notable source limitations to retain in diagnostics or address as separate changes: Zemax `WAVL` uses legacy token consumption and does not fully implement vector `WAVL`/`WWGT`; its field finalizer deduplicates coordinates and sorts by Y and may truncate short columns; full multi-configuration Zemax behavior is not implemented. OSLO optical solves, coordinate frames, catalog identity, field-table interpretation, finite-object aperture mapping, grating behavior, and image defocus require semantic work beyond token parsing.

Schema validation must be supplemented by invariants: wavelength array lengths agree; primary index is in range; surface indices are unique/ordered; unit scales and lengths are intentional; unsupported or unresolved semantics are diagnosed. Unknown optical commands must remain discoverable through diagnostics and retained records.

## Staged TypeScript browser port

1. **Freeze the contract and corpus.** Commit the schema, encoding policy, support boundaries, synthetic expectations, and Python golden JSON before implementing TypeScript. Object key order is irrelevant; array order and scalar meaning are part of the contract.
2. **Port the byte decoder and lexers.** Accept `Uint8Array` / `ArrayBuffer` and text; keep file/network UI out of the core. Use `TextDecoder` with fatal UTF-8 decoding and explicit UTF-16 handling. JavaScript's `iso-8859-1` label maps to Windows-1252, so implement true Latin-1 explicitly for Python parity. Reject invalid numeric tokens completely; `parseFloat("12junk")` is not a valid substitute for Python `float()`.
3. **Port Zemax state and dispatch.** Mirror defaults, final surface flushing, field/wavelength slots, aperture/material records, and diagnostics. Preserve `PWAV` slot identity across sorting/count trimming. Test each normalization decision against Python.
4. **Port OSLO statement scanning and command state.** Handle quotes/backslashes, semicolons and `//` correctly; then port command aliases, deletion and constraint precedence, footer field/configuration tables, declared counts, and strict diagnostics. Keep CCL/analysis blocks as uninterpreted data; do not execute file contents.
5. **Port normalization and serialization.** Use discriminated record types and tagged infinity; preserve native extension data. Compare all 22 real fixture outputs to committed Python goldens using recursive numeric tolerance (e.g. absolute `1e-10`, relative `1e-12`), with exact strings/booleans/indices and arrays. Validate every output against the schema. Add independent synthetic tests so Python mistakes do not become the specification by accident.
6. **Package as a browser library.** Export `parseText()` and `parseBytes()`, emitted ESM and declarations. No Node filesystem APIs, `Buffer`, process state, Python bridge, network access, Optiland, or runtime dependencies belong in the distributed core. Demonstrate `File.arrayBuffer()` input and downloadable JSON. For large files, move parsing to a Web Worker and bound input sizes in the application's UI.
7. **Add semantic features separately.** Optional static pickups, configuration snapshots, explicit asphere coefficient normalization, coordinate frames, catalog assets, and optical solves each need their own support declaration and tests. Maintain source statements and diagnostics even after adding interpretations.

Browser integration:

```ts
import { parseBytes } from "optical-format-import";

const data = parseBytes(new Uint8Array(await file.arrayBuffer()), {
  format: file.name.toLowerCase().endsWith(".zmx") ? "zemax" : "oslo",
  filename: file.name,
});
const blob = new Blob([JSON.stringify(data, null, 2)], {
  type: "application/json",
});
```

Do not download/open anything during parsing. A UI can inspect diagnostics and decide whether to show a partial import, request a supported subset, or use a separate optical engine.

## Milestone evidence

The repository is developed in staged Git commits. The Python milestone includes a zero-dependency package, CLI, source/schema contract, 22 corpus goldens, independent synthetic cases, malformed-input checks, and an import boundary audit. TypeScript completion is recorded in the README with the final test and browser verification results.

Validation of this extraction concerns parsing and JSON declarations. Full Optiland loader/engine oracle tests are an additional optional check and were not used to assert optical equivalence.
