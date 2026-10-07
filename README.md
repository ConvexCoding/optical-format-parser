# Optical Format Import

Standalone Zemax `.zmx` and OSLO `.len` prescription parsers with a shared normalized JSON contract. Python uses only its standard library; TypeScript targets browsers and has no runtime dependencies.

Derived from Optiland **master**, inspected at `4e893f53aee1312f2d091680b93dd2279711e197` on 2026-10-07. See [LICENSE](LICENSE) for licensing and attribution.

This library parses prescriptions. It preserves catalog names, direct-index samples, coordinate commands, pickups, and solve declarations as data. It does not execute optical solves, resolve glass catalogs, trace rays, or reproduce Optiland's native `Optic.to_dict()` format. Unsupported records are retained with diagnostics.

Both milestones are complete: standalone Python and browser-native TypeScript share the same JSON schema and pass comparisons for all 22 upstream fixtures.

## Compatibility and limitations

**Parsing a file into JSON does not establish that every feature was interpreted or that its optical behavior matches Zemax or OSLO.** Optiland's original importers implement subsets of both formats. The caveats below describe upstream `master` at the revision recorded above; the linked master files may change.

### Original Optiland Zemax importer

- **Sequential systems only:** non-sequential mode raises an error.
- **Limited surface types:** the converter handles standard spherical/conic, even and odd aspheres, paraxial surfaces, coordinate breaks, and toroidal surfaces. Other surface types raise an error. Aspheric/toroidal conversion consumes eight coefficient parameters.
- **Unknown operands are silently ignored:** there is no OSLO-style strict compatibility mode. The parser's dispatch table does not handle `UNIT`, pickup/solve declarations, multi-configuration controls, or coating definitions. These features are not reconstructed, and non-millimeter prescriptions need particular care because `UNIT` is not converted.
- **Legacy wavelength syntax is incomplete:** the parser explicitly defers the actual `WAVL` vector layout and `WWGT` handling. Indexed `WAVM` records are handled.
- **Glass resolution can approximate dispersion:** catalog lookup can fall back to an Abbe/Buchdahl model using the saved refractive index and Abbe number. A successfully resolved material does not establish an exact match to the original catalog definition.
- **Field and coordinate behavior has limits:** vignette decentering emits an unsupported warning. Source inspection also shows that the active coordinate-break accumulation path does not consume the order flag; designs depending on that flag need independent validation. This is a code-level observation, not a documented upstream compatibility guarantee.

Sources: [`optiland/fileio/zemax/reader/parser.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/zemax/reader/parser.py) and [`optiland/fileio/zemax/reader/converter.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/zemax/reader/converter.py).

### Original Optiland OSLO importer

Upstream documents support for sequential prescriptions, unit conversion, several asphere families, coordinate transforms, static pickups, selected solves, configuration snapshots, and simple ruled gratings, with these restrictions:

- **Strict import checks compatibility, not numerical agreement:** unsupported optical commands and known approximations are rejected with `strict=True`. Every named glass requires an explicit verified material binding through `material_overrides`; permissive imports warn before database lookup or approximation.
- **Constraints become snapshots:** pickups are static, and forward/self references are rejected. Only selected solves are implemented; general simultaneous constraint solving is not provided. Unsupported or unsatisfied solves restore saved values with warnings in permissive mode and fail in strict mode.
- **Configurations have restrictions:** alternate configurations containing solves, and thickness overrides on pickup-controlled targets, are rejected. The first prescription is imported; supported configurations are selected as individual snapshots.
- **Geometry and aiming are not universally equivalent:** certain low-order aspheres retain real-ray geometry while native paraxial analysis omits their vertex, normal, or power changes. Wide-angle aiming, some telecentric launches/solves, and certain coordinate, pickup, toroidal, and mirror-bend combinations are unsupported or restricted.
- **Some optical effects are omitted:** thermal expansion coefficients are retained without temperature-dependent geometry or thermal studies. Ruled-grating blaze efficiency is not inferred.
- **Programs are not executed:** CCL, include files, optimization programs, and external executables are not run. Upstream explicitly states that its smoke checks do not establish agreement with OSLO ray intercepts.

Source: [`docs/oslo_import.rst`](https://github.com/optiland/optiland/blob/master/docs/oslo_import.rst), which contains the detailed command support matrix and validation caveats.

### This extracted library and its tests

This package captures prescription declarations and produces normalized JSON. Its scope is narrower than Optiland's full optical conversion: it does not evaluate solves or pickups, compose coordinate transforms into a verified optical model, resolve glass catalogs, or trace rays. Retaining a command in `raw` or a declaration in a surface record does not mean its optical effect has been implemented. Inspect `diagnostics` alongside the data.

Our `strict` option rejects parser warnings; it is not Optiland OSLO's optical compatibility/material verification mode. The 22-fixture comparisons establish agreement between this Python implementation and this TypeScript implementation on those inputs. Schema checks establish JSON structure. Neither establishes agreement with Optiland's converted optics, Zemax, or OSLO, nor exhaustive support for all file versions and features. Optical equivalence requires independent comparison of materials, surface geometry, transforms, constraint results, and ray behavior against the originating application.

## Python

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e ./python
.venv/bin/python -m optical_import fixtures/zemax/lens1.zmx -o lens.json
.venv/bin/python -m optical_import fixtures/oslo/test_achromat.len -o achromat.json
.venv/bin/python -I -m unittest discover -s python/tests -v
```

```python
from optical_import import parse_file, parse_bytes, parse_text, dumps

data = parse_file("lens.zmx")
json_text = dumps(data)
```

Python runtime dependencies: **none**. The runtime also passes its tests with third-party site packages disabled.

## TypeScript / browser

```bash
npm --prefix typescript ci
npm --prefix typescript run build
npm --prefix typescript test
```

After building, install the local package in your app with `npm install /path/to/optical-format-import/typescript`, or pack it with `cd typescript && npm pack`. The package is local and has not been published to npm or a remote Git host.

```ts
import { parseBytes, parseText, stringify } from "optical-format-import";

const data = parseBytes(await file.arrayBuffer(), {
  format: file.name.toLowerCase().endsWith(".zmx") ? "zemax" : "oslo",
  filename: file.name,
});
const json = stringify(data);
```

TypeScript runtime dependencies: **none**. The ESM package includes type declarations and the shared schema.

For the browser demo, serve this repository root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open [the file-picker demo](http://127.0.0.1:8765/typescript/demo/) or [the browser verification page](http://127.0.0.1:8765/typescript/test/browser.html). Parsing runs in the browser; the development server only serves files. Files selected in the demo stay local.

## JSON contract and verification

[The schema](schema/prescription.schema.json) specifies common lengths in mm, wavelengths in um, angles in degrees, ordered surface records, material declarations, diagnostics, and retained native data.

Default parsing preserves uninterpreted declarations with diagnostics. Pass `strict=True` in Python or `strict: true` in TypeScript to reject warnings. Infinity has explicit JSON tags; NaN and malformed common numeric data fail. Original parameters remain in prescription units under `parameters` and `raw`.

Validated locally: **17 Python tests, 34 TypeScript tests, and 24 browser checks**, including all 15 Zemax and 7 OSLO upstream inputs, cross-language output comparisons, schema validation, encoding cases, independent geometry expectations, CLI failure paths, and isolated package installation.
