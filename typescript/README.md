# Optical Format Import — TypeScript

A browser-native ESM library for parsing sequential Zemax `.zmx` and OSLO `.len` prescriptions into normalized JSON. No runtime dependencies, network access, Node globals, or Python bridge.

From the repository root:

```bash
npm --prefix typescript ci
npm --prefix typescript run build
npm --prefix typescript test
```

Install this local package in your application after building, or create a distributable package with `npm pack` from this directory. It has not been published to npm.

```ts
import { parseBytes, parseText, stringify } from "optical-format-import";
import type { NormalizedPrescription } from "optical-format-import";

const data: NormalizedPrescription = parseBytes(
  new Uint8Array(await file.arrayBuffer()),
  { format: "zemax", filename: file.name },
);
const json = stringify(data);
const other = parseText(source, { format: "oslo", strict: true });
```

Default mode preserves unresolved declarations with diagnostics. Strict mode rejects warning diagnostics. The schema is available through the `optical-format-import/schema` export in the packed package. Python and TypeScript use the same schema and common units (mm, um, degrees). Intentional infinity is represented as `{special: "positiveInfinity"}` or `{special: "negativeInfinity"}`.

This is a prescription parser. Catalog matching, optical solve execution, frame composition, and ray tracing are outside the library. Original statements and native parameters are retained. The output is distinct from Optiland's native `Optic.to_dict()` JSON.

To run the file-picker demo and browser verification page, serve the **repository root**, then open `/typescript/demo/` and `/typescript/test/browser.html`. See the root guide for exact master source paths, extraction edits, tests, and future semantic stages. Derived/adapted code retains the Optiland MIT notice in LICENSE.
