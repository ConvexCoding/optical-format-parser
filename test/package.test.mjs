import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
test("packed dependency installs, runs and typechecks in an isolated JS/TS consumer", () => {
  const temp = mkdtempSync(join(tmpdir(), "optical-import-consumer-"));
  const run = (command, args, cwd) =>
    execFileSync(command, args, { cwd, encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const [pack] = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], root));
    const files = pack.files.map((file) => file.path);
    for (const path of [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/index.d.ts.map",
      "src/index.ts",
      "schema/prescription.schema.json",
      "README.md",
      "LICENSE",
      "docs/compatibility.md",
    ])
      assert.ok(files.includes(path), "Missing " + path);
    assert.ok(
      files.every((path) => !/^(test|examples|scripts|node_modules|python)\//.test(path)),
      "Unexpected development files in package",
    );
    assert.ok(files.every((path) => !path.endsWith(".py")));
    const consumer = join(temp, "consumer");
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
    run(
      "npm",
      ["install", join(temp, pack.filename), "--ignore-scripts", "--offline", "--omit=dev", "--no-audit", "--no-fund"],
      consumer,
    );
    writeFileSync(
      join(consumer, "consumer.mjs"),
      `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PrescriptionParseError, parseText, parseBytes, parseJson, safeParseText, stringify } from 'optical-format-import';
const source = 'NAME consumer\\nUNIT MM\\nENPD 4\\nSURF 0\\nCURV 0\\nDISZ INFINITY\\nSURF 1\\nCURV 0.05\\nDISZ 2\\n';
const data = parseText(source, {format: 'zemax', strict: true});
assert.equal(data.surfaces[1].radiusMm, 20);
assert.equal(data.surfaces[0].thicknessMm, Infinity);
assert.deepEqual(parseBytes(new TextEncoder().encode(source), {filename: 'consumer.zmx'}).surfaces, data.surfaces);
assert.deepEqual(JSON.parse(stringify(data)).surfaces[0].thicknessMm, {special: 'positiveInfinity'});
assert.deepEqual(parseJson(stringify(data)), data);
const failed = safeParseText('SURF 0\\nCURV x\\n', {format: 'zemax'});
assert.equal(failed.ok, false);
assert.ok(failed.error instanceof PrescriptionParseError);
assert.equal(failed.error.line, 2);
const schema = JSON.parse(readFileSync(new URL(import.meta.resolve('optical-format-import/schema')), 'utf8'));
assert.equal(schema.properties.schemaVersion.const, data.schemaVersion);
const pkg = JSON.parse(readFileSync('./node_modules/optical-format-import/package.json', 'utf8'));
assert.deepEqual(pkg.dependencies ?? {}, {});
assert.equal(Object.keys(pkg.scripts).some(key => ['install','postinstall','preinstall'].includes(key)), false);
const oslo = parseText('LEN NEW "consumer" 1 1\\nEBR 2; RD 0; NXT; RD 20; END 1\\n', {format:'oslo', strict:true});
assert.equal(oslo.surfaces[1].radiusMm, 20);
`,
    );
    run(process.execPath, ["consumer.mjs"], consumer);
    // CommonJS consumers can require() the ESM build on current Node releases.
    writeFileSync(
      join(consumer, "consumer.cjs"),
      `
const assert = require('node:assert/strict');
const { parseText } = require('optical-format-import');
assert.equal(typeof parseText, 'function');
assert.equal(require('optical-format-import/package.json').name, 'optical-format-import');
`,
    );
    run(process.execPath, ["consumer.cjs"], consumer);
    writeFileSync(
      join(consumer, "consumer.mts"),
      `
import { PrescriptionParseError, formatFromFilename, parseBytes, parseText, safeParseText, stringify } from 'optical-format-import';
import type { Format, Material, NormalizedPrescription, NormalizedSurface, ParseOptions, ParseResult, SystemAperture } from 'optical-format-import';
const options: ParseOptions = {format:'zemax', strict:true};
const prescription: NormalizedPrescription = parseText('text', options);
const surface: NormalizedSurface = prescription.surfaces[0]!;
const curvature: number = 1 / surface.radiusMm;
const semiDiameter: number | null = surface.semiDiameterMm;
const maxRadius: number | undefined = surface.clearAperture?.maxRadiusMm;
const output: string = stringify(prescription);
const format: Format | null = formatFromFilename('a.zmx');
async function fromFile(file: File): Promise<NormalizedPrescription> { return parseBytes(await file.arrayBuffer(), {filename: file.name}); }

// Discriminated unions narrow, and switches over them are exhaustive.
function describe(material: Material): string {
  switch (material.kind) {
    case 'air': case 'mirror': return material.kind;
    case 'catalog': return material.name + material.catalogs.join();
    case 'model': return String(material.nd + material.vd);
    case 'constantIndex': return String(material.index);
    case 'sampledIndex': return String(material.indices[0]);
    case 'unknown': return material.raw;
  }
}
function powers(s: NormalizedSurface): number[] {
  return s.type === 'evenAsphere' || s.type === 'oddAsphere' ? s.asphereTerms.map(term => term.power) : [];
}
function apertureValue(aperture: SystemAperture): number {
  if (aperture.kind === 'floatingStop' || aperture.kind === 'unspecified') { const none: null = aperture.value; return 0; }
  return aperture.value;
}
function report(result: ParseResult): string {
  if (result.ok) return result.prescription.name ?? '';
  const error: PrescriptionParseError = result.error;
  return error.code === 'strict_violation' ? error.diagnostics.map(d => d.code).join() : String(error.line);
}

declare const material: Material;
// @ts-expect-error invalid format must fail at compile time
parseText('text', {format:'invalid'});
// @ts-expect-error a property of one variant is not readable before narrowing
material.name;
// @ts-expect-error misspelled properties are rejected
material.nmae;
// @ts-expect-error asphere terms exist only on asphere surfaces
surface.asphereTerms;
// @ts-expect-error surface types are a closed set of literals
if (surface.type === 'even_asphere') {}
// @ts-expect-error aperture kinds are a closed set of literals
if (prescription.aperture.kind === 'entrancePupilDiamter') {}
// @ts-expect-error diagnostic codes are a closed set of literals
if (prescription.diagnostics[0]?.code === 'unresolved') {}
// @ts-expect-error a valued aperture kind never has a null value
if (prescription.aperture.kind === 'imageFNumber') { const none: null = prescription.aperture.value; }
// @ts-expect-error results must be narrowed on ok before reading the prescription
safeParseText('text', options).prescription;
`,
    );
    const compiler = join(root, "node_modules/typescript/bin/tsc");
    for (const [module, moduleResolution] of [
      ["NodeNext", "NodeNext"],
      ["ESNext", "Bundler"],
    ]) {
      writeFileSync(
        join(consumer, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module,
            moduleResolution,
            strict: true,
            noUnusedLocals: false,
            noEmit: true,
          },
          include: ["consumer.mts"],
        }),
      );
      run(process.execPath, [compiler, "-p", "tsconfig.json"], consumer);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
