import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
test("packed dependency installs, runs and typechecks in an isolated JS/TS consumer", () => {
  const temp = mkdtempSync(join(tmpdir(), "optical-format-parser-consumer-"));
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
import { PrescriptionParseError, parseText, parseBytes, parseJson, stringify } from 'optical-format-parser';
const source = 'NAME consumer\\nUNIT MM\\nENPD 4\\nSURF 0\\nCURV 0\\nDISZ INFINITY\\nSURF 1\\nCURV 0.05\\nDISZ 2\\n';
const [data, error] = parseText(source, {format: 'zemax', strict: true});
assert.equal(error, null);
assert.equal(data.surfaces[1].radius, 20);
assert.equal(data.surfaces[0].thickness, Infinity);
assert.deepEqual(parseBytes(new TextEncoder().encode(source), {format: 'zemax'})[0].surfaces, data.surfaces);
assert.deepEqual(JSON.parse(stringify(data)).surfaces[0].thickness, {special: 'positiveInfinity'});
assert.deepEqual(parseJson(stringify(data)), [data, null]);
const [nothing, failure] = parseText('SURF 0\\nCURV x\\n', {format: 'zemax'});
assert.equal(nothing, null);
assert.ok(failure instanceof PrescriptionParseError);
assert.equal(failure.line, 2);
const schema = JSON.parse(readFileSync(new URL(import.meta.resolve('optical-format-parser/schema')), 'utf8'));
assert.equal(schema.properties.schemaVersion.const, data.schemaVersion);
const pkg = JSON.parse(readFileSync('./node_modules/optical-format-parser/package.json', 'utf8'));
assert.deepEqual(pkg.dependencies ?? {}, {});
assert.equal(Object.keys(pkg.scripts).some(key => ['install','postinstall','preinstall'].includes(key)), false);
const [oslo] = parseText('LEN NEW "consumer" 1 1\\nEBR 2; RD 0; NXT; RD 20; END 1\\n', {format:'oslo', strict:true});
assert.equal(oslo.surfaces[1].radius, 20);
`,
    );
    run(process.execPath, ["consumer.mjs"], consumer);
    // CommonJS consumers can require() the ESM build on current Node releases.
    writeFileSync(
      join(consumer, "consumer.cjs"),
      `
const assert = require('node:assert/strict');
const { parseText } = require('optical-format-parser');
assert.equal(parseText('', {format: 'zemax'})[1].code, 'invalid_prescription');
assert.equal(require('optical-format-parser/package.json').name, 'optical-format-parser');
`,
    );
    run(process.execPath, ["consumer.cjs"], consumer);
    writeFileSync(
      join(consumer, "consumer.mts"),
      `
import { PrescriptionParseError, parseBytes, parseJson, parseText, stringify } from 'optical-format-parser';
import type { Format, Material, NormalizedPrescription, NormalizedSurface, ParseOptions, ParseResult, SystemAperture } from 'optical-format-parser';
const options: ParseOptions = {format:'zemax', strict:true};
const [parsed, parseError] = parseText('text', options);
// @ts-expect-error the value is nullable until the error has been checked
parsed.surfaces;
if (parseError) throw parseError;
// Checking the error narrows the value.
const prescription: NormalizedPrescription = parsed;
const surface: NormalizedSurface = prescription.surfaces[0]!;
const curvature: number = 1 / surface.radius;
const semiDiameter: number | null = surface.semiDiameter;
const maxRadius: number | undefined = surface.clearAperture?.maxRadius;
const edge: number | null = surface.mechanicalSemiDiameter;
const label: string | null = surface.comment ?? surface.coating;
const tilt: number | undefined = surface.coordinates?.tiltX;
const controlled: string[] = [...surface.pickups.map(pickup => pickup.property), ...surface.solves.map(solve => solve.target)];
const complete: boolean = surface.unresolvedSag.length === 0;
const declared: boolean = prescription.declarations.units === 'explicit' && prescription.notes.length > 0;
const output: string = stringify(prescription);
const format: Format = prescription.source.format;
async function fromFile(file: File): Promise<NormalizedPrescription | null> {
  const [fromBytes, bytesError] = parseBytes(await file.arrayBuffer(), options);
  if (bytesError !== null) { const line: number | undefined = bytesError.line; return null; }
  return fromBytes;
}
function fromJson(text: string): NormalizedPrescription {
  const [restored, jsonError] = parseJson(text);
  if (jsonError) throw jsonError;
  return restored;
}

// Discriminated unions narrow, and switches over them are exhaustive.
function describe(material: Material): string {
  switch (material.kind) {
    case 'air': case 'mirror': return material.kind;
    case 'catalog': return material.name + material.catalogs.join();
    case 'model': return String(material.nd + material.vd);
    case 'constantIndex': return String(material.index);
    case 'sampledIndex': return String(material.indices[0]);
    case 'pickup': return String(material.reference);
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
function report([value, error]: ParseResult): string {
  if (!error) return value.name ?? '';
  return error.code === 'strict_violation' ? error.diagnostics.map(d => d.code).join() : String(error.line);
}

declare const material: Material;
// @ts-expect-error invalid format must fail at compile time
parseText('text', {format:'invalid'});
// @ts-expect-error the format is required
parseText('text', {});
// @ts-expect-error the library takes contents, not file names
parseText('text', {format:'zemax', filename:'a.zmx'});
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
// @ts-expect-error a result is a pair, not the prescription itself
parseText('text', options).surfaces;
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
