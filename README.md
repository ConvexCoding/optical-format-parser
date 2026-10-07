# Optical Format Import

A TypeScript library that parses sequential Zemax `.zmx` and OSLO `.len` files into normalized JSON. Runs in browsers and Node.js, with no runtime dependencies, network requests, or native modules. Distributed as ESM with TypeScript declarations and a JSON Schema.

## Install in another project

The package is local and has not been published to npm. Use Node.js 22+ to build and test it:

```sh
# In this repository
npm ci
npm run test:all
npm pack

# In your application
npm install /path/to/optical-format-import/optical-format-import-0.1.0.tgz
```

For local development, after `npm ci` in this repository you can instead install the repository root:

```sh
npm install /path/to/optical-format-import
```

The tarball contains compiled JavaScript, type declarations, the schema, documentation, and the MIT license. Development sources, tests, sample files, and development dependencies are excluded. Consumers do not need a compiler or a build step to run the installed library. ESM applications use `import`; CommonJS applications can use asynchronous `import('optical-format-import')`.

## Browser usage

Read a browser `File` and choose the format explicitly:

```ts
import { parseBytes, stringify } from 'optical-format-import';
import type { NormalizedPrescription } from 'optical-format-import';

async function importLens(file: File): Promise<NormalizedPrescription> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'zmx' && extension !== 'len') {
    throw new Error('Choose a .zmx or .len file');
  }
  return parseBytes(await file.arrayBuffer(), {
    format: extension === 'zmx' ? 'zemax' : 'oslo',
    filename: file.name,
  });
}

const prescription = await importLens(file);
const json = stringify(prescription);
console.log(prescription.diagnostics);
```

Parsing is synchronous after reading the file and runs locally. The library supports ES2022 environments with `TextEncoder`/`TextDecoder`; it can also run in a Web Worker.

For an already decoded string:

```ts
import { parseText } from 'optical-format-import';

const prescription = parseText(lensText, {
  format: 'oslo',
  filename: 'design.len',
  strict: true,
});
```

## Node.js usage

```js
import { readFile, writeFile } from 'node:fs/promises';
import { parseBytes, stringify } from 'optical-format-import';

const prescription = parseBytes(await readFile('design.zmx'), {
  format: 'zemax',
  filename: 'design.zmx',
});
await writeFile('design.json', stringify(prescription));
```

Filesystem access belongs to your application; the parser itself accepts only bytes or text.

## API

| Export | Purpose |
| --- | --- |
| `parseBytes(data, options)` | Parse a `Uint8Array` or `ArrayBuffer`; detect supported file encodings. |
| `parseText(text, options)` | Parse an already decoded string. |
| `stringify(prescription, indent = 2)` | Serialize portable JSON with a trailing newline. |
| `NormalizedPrescription`, `ParseOptions`, `Format`, `Diagnostic`, `OpticalNumber`, `MaterialRecord`, `NormalizedSurface`, `JsonValue`, `JsonObject` | Exported TypeScript types. |

`options.format` is required: `'zemax'` or `'oslo'`. `options.filename` defaults to `'<memory>'`. `options.strict` defaults to `false`.

Default mode retains unsupported or unresolved declarations with diagnostics. Strict mode throws on warning diagnostics; malformed input throws in either mode. Catch errors at your application's import boundary. Zemax byte decoding supports UTF-8, UTF-16 LE/BE, and Latin-1; OSLO supports UTF-8 and Windows-1252.

## JSON contract

The [schema](schema/prescription.schema.json) describes schema version `1.0`. The output includes source metadata, common units, aperture and field declarations, wavelengths, ordered surface records, diagnostics, and format-specific `raw` data.

Common lengths use millimeters, wavelengths use micrometers, and angles use degrees. Native `parameters` and `raw` retain prescription units and declarations. Intentional infinities are tagged objects:

```json
{ "special": "positiveInfinity" }
```

`negativeInfinity` is also supported. NaN is rejected. Narrow `OpticalNumber` before using a radius or thickness in arithmetic:

```ts
const radius = prescription.surfaces[1].radiusMm;
if (typeof radius === 'number') {
  console.log(radius);
} else {
  console.log(radius.special);
}
```

The schema is also exported as `optical-format-import/schema`. In Node.js:

```js
import { readFile } from 'node:fs/promises';

const schema = JSON.parse(await readFile(
  new URL(import.meta.resolve('optical-format-import/schema')),
  'utf8',
));
```

Runtime schema validation is optional and supplied by the consuming application.

## Compatibility and limitations

**Parsing into JSON does not establish optical equivalence with Zemax or OSLO.** This library captures prescription declarations. Catalog names, direct-index samples, coordinate commands, pickups, and solve declarations are retained as data. Catalog resolution, dispersion fitting, solve/pickup execution, global frame composition, thermal analysis, and ray tracing are outside its scope.

Review `diagnostics` alongside the data. A retained command or surface type does not mean its optical effect was implemented. Strict parsing rejects warning diagnostics; it does not certify optical accuracy. Legacy Zemax `WAVL` vector syntax and `WWGT` are not fully interpreted. Alternative OSLO configurations remain declarations in `raw`; common surfaces describe the base prescription. Native asphere coefficients retain their original units.

[Detailed compatibility notes](docs/compatibility.md) document the original importer restrictions and how this library's scope differs. Adapted code and test inputs retain their required [MIT attribution](LICENSE).

## Development and tests

```sh
npm ci
npm run check          # Type-check source and TypeScript tests
npm test               # 34 parser regression/schema/edge-case tests
npm run build          # Generate dist/ JavaScript and declarations
npm run test:package   # Install the tarball in an isolated JS/TS consumer
npm run test:all       # All checks above
npm run demo          # Build and serve the browser example and checks
```

The fixture suite covers all 15 Zemax and 7 OSLO inputs, plus 18 saved synthetic regression cases and independent assertions for geometry, units, encodings, quoting, diagnostics, and malformed data. Tests run entirely in JavaScript/TypeScript and never regenerate expectations. The package test checks installed runtime exports, the schema export, and TypeScript resolution in NodeNext and Bundler modes. These checks establish parser regression behavior and JSON structure, not ray-trace accuracy.

`npm run demo` serves [the browser example](http://127.0.0.1:8765/examples/browser/) and [24 browser checks](http://127.0.0.1:8765/test/browser.html). Set `PORT` to change the default port, 8765. Files selected in the example stay local.

```text
src/                  Library implementation and public types
schema/               Normalized JSON Schema
test/                 TypeScript tests, fixtures, browser and package checks
examples/browser/     File-picker example
scripts/              Local demo server
docs/                 Compatibility notes
dist/                 Generated ESM and declarations (ignored by Git)
```

CI is configured to install, type-check, test, build, and verify the package on Node.js 22 and 24.
