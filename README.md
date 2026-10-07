# Optical Format Import

Standalone Zemax `.zmx` and OSLO `.len` prescription parsers with a shared normalized JSON contract. Python uses only its standard library; TypeScript targets browsers and has no runtime dependencies.

Derived from Optiland **master**, inspected at `4e893f53aee1312f2d091680b93dd2279711e197` on 2026-10-07. See [UPSTREAM.json](UPSTREAM.json), [LICENSE](LICENSE), and the [extraction and port guide](GUIDE.md).

This library parses prescriptions. It preserves catalog names, direct-index samples, coordinate commands, pickups, and solve declarations as data. It does not execute optical solves, resolve glass catalogs, trace rays, or reproduce Optiland's native `Optic.to_dict()` format. Unsupported records are retained with diagnostics.

Both milestones are complete: standalone Python and browser-native TypeScript share the same JSON schema and pass comparisons for all 22 upstream fixtures.

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

Use [the guide](GUIDE.md) for the exact Optiland master source map, dependency boundaries, extraction edits, native JSON distinction, and staged semantic extensions. [The schema](schema/prescription.schema.json) specifies common lengths in mm, wavelengths in um, angles in degrees, ordered surface records, material declarations, diagnostics, and retained native data.

Default parsing preserves uninterpreted declarations with diagnostics. Pass `strict=True` in Python or `strict: true` in TypeScript to reject warnings. Infinity has explicit JSON tags; NaN and malformed common numeric data fail. Original parameters remain in prescription units under `parameters` and `raw`.

Validated locally: **17 Python tests, 34 TypeScript tests, and 24 browser checks**, including all 15 Zemax and 7 OSLO upstream inputs, cross-language output comparisons, schema validation, encoding cases, independent geometry expectations, CLI failure paths, and isolated package installation. See [validation evidence](docs/VALIDATION.md).
