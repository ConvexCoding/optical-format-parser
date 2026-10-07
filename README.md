# Optical Format Parser

A TypeScript library that parses the contents of sequential Zemax (`.zmx`) and OSLO (`.len`) prescriptions into a typed, normalized object. It takes text or bytes and never touches files itself. Runs in browsers and Node.js, with no runtime dependencies, network requests, or native modules. Distributed as ESM with TypeScript declarations and a JSON Schema.

## Install in another project

The package is not published to npm. Install it from GitHub, pinned to a release tag:

```sh
npm install github:ConvexCoding/optical-format-parser#v1.0.0
```

npm fetches the repository and builds it on install, so the consuming project needs no extra setup.

To install from a local checkout instead, use Node.js 22+ to build and pack it:

```sh
# In this repository
npm ci
npm run test:all
npm pack

# In your application
npm install /path/to/optical-format-parser/optical-format-parser-1.0.0.tgz
```

For local development, after `npm ci` in this repository you can instead install the repository root:

```sh
npm install /path/to/optical-format-parser
```

The tarball contains compiled JavaScript, type declarations with declaration maps, the TypeScript sources they point to, the schema, documentation, and the MIT license. Tests, sample files, and development dependencies are excluded. Consumers do not need a compiler or a build step. The package is ESM; bundlers (Vite, SvelteKit, webpack) and Node.js `import` use it directly, and CommonJS code can `require()` it on Node.js 22.12+.

## Usage

The library parses the contents of a prescription, as text or as undecoded bytes, and you say which format they are in. Where the contents come from (a file input, a fetch, a database, the filesystem) and how the format is chosen are up to your application.

```ts
import { parseText } from "optical-format-parser";

const [prescription, error] = parseText(contents, { format: "zemax" }); // or "oslo"
if (error) {
  console.error(error.code, error.message, error.line);
  return;
}

for (const surface of prescription.surfaces) {
  const curvature = 1 / surface.radius; // flat surfaces have radius === Infinity
  if (surface.type === "evenAsphere") {
    for (const term of surface.asphereTerms) console.log(`r^${term.power}`, term.coefficient);
  }
  if (surface.material.kind === "catalog") console.log(surface.material.name);
}
```

Parsing returns a `[value, error]` pair and does not throw for bad input. Exactly one of the two is `null`, and checking `error` narrows `prescription` from nullable to `NormalizedPrescription`.

Use `parseBytes(bytes, { format })` when you have a `Uint8Array` or `ArrayBuffer` that has not been decoded yet; lens files are often UTF-16 or Latin-1, and `parseBytes` detects that. Parsing is synchronous, runs locally, and needs only an ES2022 environment with `TextDecoder`, so it works in the browser, in a Web Worker, and on the server.

### Errors

The error is a `PrescriptionParseError`:

| Property          | Meaning                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `code`            | `"invalid_options"`, `"decoding_failed"`, `"invalid_prescription"`, `"strict_violation"` or `"invalid_json"`. |
| `message`         | Human-readable, for example `line 10: CURV: Invalid numeric token: 12junk`.                                   |
| `line`, `command` | Set when the problem is tied to a line of the contents.                                                       |
| `diagnostics`     | For `strict_violation`, everything the import reported.                                                       |

### SvelteKit

The parsed object is plain data, so it can be returned from a `load` function as is; SvelteKit's serializer preserves `Infinity`. Use `stringify`/`parseJson` (below) only when you write JSON yourself, for example with `json()` or to a file.

## API

| Export                                | Purpose                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `parseText(text, options)`            | Parse the text of a prescription. Returns `[prescription, error]`.                                                   |
| `parseBytes(data, options)`           | Parse a `Uint8Array` or `ArrayBuffer`, detecting the text encoding. Returns `[prescription, error]`.                 |
| `stringify(prescription, indent = 2)` | Serialize to portable JSON with a trailing newline.                                                                  |
| `parseJson(text)`                     | Read `stringify` output back, restoring infinities. Returns `[prescription, error]`; checks the schema version only. |
| `PrescriptionParseError`              | The error class, with `code`, `line`, `command`, `diagnostics`.                                                      |
| `ParseResult`, `Result<T>`            | The pair type the parsing functions return.                                                                          |

Options:

| Option       | Default  | Meaning                                                                        |
| ------------ | -------- | ------------------------------------------------------------------------------ |
| `format`     | required | `"zemax"` or `"oslo"`: the format of the contents.                             |
| `strict`     | `false`  | Return a `strict_violation` error if the import produces any warning.          |
| `includeRaw` | `false`  | Attach the format-specific parser model as `raw` (roughly doubles the output). |

Zemax byte decoding supports UTF-8, UTF-16 LE/BE, and Latin-1; OSLO supports UTF-8 and Windows-1252.

## The parsed prescription

All types are exported; `NormalizedPrescription` is the root. **Every length is in millimeters and every wavelength in micrometers**, whatever unit the file used, so property names carry no unit. A name includes a unit only where it departs from that rule (`units.scaleToMm`, the millimeters per source unit). Angles are in degrees. The pass-through records (`parameters`, `source`, `raw`) keep the file's own units.

| Property               | Type                  | Notes                                                                                                                                                       |
| ---------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surfaces`             | `NormalizedSurface[]` | Union discriminated by `type`: `"standard"`, `"evenAsphere"`, `"oddAsphere"`, `"toroidal"`, `"coordinateBreak"`, `"paraxial"`, `"polynomial"`, `"unknown"`. |
| `surfaces[i].material` | `Material`            | Union discriminated by `kind`: `"air"`, `"mirror"`, `"catalog"`, `"model"`, `"constantIndex"`, `"sampledIndex"`, `"unknown"`.                               |
| `aperture`             | `SystemAperture`      | Union discriminated by `kind`; `value` is `null` only for `"floatingStop"` and `"unspecified"`.                                                             |
| `fields`               | `Fields`              | `points` is never empty. `specification` says whether they are the file's point list (Zemax) or its single full-field point (OSLO).                         |
| `wavelengths`          | `Wavelengths`         | Parallel `values` (micrometers) and `weights`, plus `primaryIndex`.                                                                                         |
| `diagnostics`          | `Diagnostic[]`        | `severity` is `"info"` or `"warning"`; `code` is a closed set of literals.                                                                                  |

Every surface has `radius` (`Infinity` when flat), `thickness`, `conic`, `stop`, `clearAperture`, `semiDiameter`, `nativeType` (the format's own type name) and `parameters` (every declaration as the file spells it, in file units). Asphere surfaces add `asphereTerms`: each term is `coefficient * r^power` with `r` and sag in millimeters, so the format-specific coefficient naming and unit scaling are already resolved.

| Source                      | Term                |
| --------------------------- | ------------------- |
| Zemax `EVENASPH` `PARM n`   | r^(2n)              |
| Zemax `ODDASPHE` `PARM n`   | r^n                 |
| OSLO `AD`, `AE`, `AF`, `AG` | r^4, r^6, r^8, r^10 |
| OSLO `ASn` under `ASP ASR`  | r^(2n)              |
| OSLO `ASn` under `ASP ARA`  | r^n                 |

OSLO declares only the maximum field, so `fields.points` holds that one point. Rows of an OSLO field table are fractions of the full field and are reported unconverted in `fields.relativePoints`.

## JSON contract

The [schema](schema/prescription.schema.json) describes schema version `2.0`: the JSON that `stringify` writes. JSON cannot represent infinity, so infinite radii and thicknesses are written as tagged objects, and `parseJson` turns them back into numbers:

```json
{ "special": "positiveInfinity" }
```

NaN is rejected. The schema is also exported as `optical-format-parser/schema`. In a bundler, `import schema from "optical-format-parser/schema"`; in Node.js:

```js
import schema from "optical-format-parser/schema" with { type: "json" };
```

Runtime schema validation is optional and supplied by the consuming application.

## Compatibility and limitations

**Parsing into JSON does not establish optical equivalence with Zemax or OSLO.** This library captures prescription declarations. Catalog names, direct-index samples, coordinate commands, pickups, and solve declarations are retained as data. Catalog resolution, dispersion fitting, solve/pickup execution, global frame composition, thermal analysis, and ray tracing are outside its scope.

Review `diagnostics` alongside the data. A retained command or surface type does not mean its optical effect was implemented. Strict parsing rejects warning diagnostics; it does not certify optical accuracy. Legacy Zemax `WAVL` vector syntax and `WWGT` are not fully interpreted. Alternative OSLO configurations remain declarations in `raw` (with `includeRaw`); common surfaces describe the base prescription. Values in `parameters`, the `source` records and `raw` keep the file's own units; the normalized properties are in millimeters and micrometers. The OSLO `ASn` powers above follow the upstream importer's documentation and have not been checked against OSLO itself.

[Detailed compatibility notes](docs/compatibility.md) document the original importer restrictions and how this library's scope differs. Adapted code and test inputs retain their required [MIT attribution](LICENSE).

## Development and tests

```sh
npm ci
npm run check          # Type-check source and TypeScript tests
npm test               # 44 parser regression/schema/API/edge-case tests
npm run build          # Generate dist/ JavaScript and declarations
npm run test:package   # Install the tarball in an isolated JS/TS consumer
npm run test:all       # Formatting check plus all checks above
npm run format         # Format with Prettier
npm run release        # Run all checks, then bump the version, commit, tag and push (bumpp)
npm run demo          # Build and serve the browser example and checks
```

The fixture suite covers all 15 Zemax and 7 OSLO inputs, plus 18 saved synthetic regression cases and independent assertions for geometry, units, encodings, quoting, diagnostics, and malformed data. Tests run entirely in JavaScript/TypeScript and never regenerate expectations. The package test installs the tarball and checks its runtime exports from ESM and CommonJS, the schema export, TypeScript resolution in NodeNext and Bundler modes, and compile-time behavior of the public types (narrowing, exhaustive switches, and rejected typos). These checks establish parser regression behavior and JSON structure, not ray-trace accuracy.

`npm run demo` serves [the browser example](http://127.0.0.1:8765/examples/browser/) and [25 browser checks](http://127.0.0.1:8765/test/browser.html). Set `PORT` to change the default port, 8765. Files selected in the example stay local.

```text
src/                  Library implementation and public types
schema/               Normalized JSON Schema
test/                 TypeScript tests, fixtures, browser and package checks
examples/browser/     File-picker example
scripts/              Local demo server
docs/                 Compatibility notes
dist/                 Generated ESM and declarations (ignored by Git)
```

CI is configured to install, check formatting, type-check, test, build, and verify the package on Node.js 22 and 24.
