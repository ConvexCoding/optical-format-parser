import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { parseBytes, parseText, stringify } from "../src/index.js";
import { jsonSafe } from "../src/normalize.js";
import type { Format } from "../src/index.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
const validate = ajv.compile(JSON.parse(readFileSync(root + "schema/prescription.schema.json", "utf8")));

function compare(actual: any, expected: any, path = "$"): void {
  if (typeof actual === "number" && typeof expected === "number") {
    assert.ok(Math.abs(actual - expected) <= 1e-10 + 1e-12 * Math.max(Math.abs(actual), Math.abs(expected)), `${path}: ${actual} != ${expected}`);
  } else if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, path);
    actual.forEach((v, i) => compare(v, expected[i], `${path}[${i}]`));
  } else if (actual !== null && expected !== null && typeof actual === "object" && typeof expected === "object") {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path}: keys`);
    for (const key of Object.keys(actual)) compare(actual[key], expected[key], `${path}.${key}`);
  } else assert.deepEqual(actual, expected, path);
}
for (const format of ["zemax", "oslo"] as const) {
  for (const filename of readdirSync(root + "fixtures/" + format)) {
    test(`Python golden and schema: ${filename}`, () => {
      const data = parseBytes(readFileSync(root + `fixtures/${format}/${filename}`), { format, filename });
      const golden = JSON.parse(readFileSync(root + `fixtures/golden/${filename}.json`, "utf8"));
      compare(data, golden);
      assert.ok(validate(data), JSON.stringify(validate.errors));
      assert.ok(validate(golden), JSON.stringify(validate.errors));
      compare(JSON.parse(stringify(data)), data);
    });
  }
}

const ZMX = "NAME simple\nUNIT MM\nENPD 4\nWAVM 1 0.55 1\nPWAV 1\nSURF 0\nCURV 0\nDISZ INFINITY\nSURF 1\nCURV 0.05\nDISZ 2\nSTOP\nSURF 2\nCURV -0.05\nDISZ 20\nSURF 3\nCURV 0\nDISZ 0\n";
const LEN = 'LEN NEW "simple" 50 3\nEBR 2\nANG 0\nWV 0.55\nTH 1e20; NXT\nRD 20; TH 2; AST; NXT\nRD -20; TH 20; NXT\nRD 0; END 3\n';

function python(text: string, format: Format): any {
  const result = spawnSync("python3", ["-S", "-c", "import json,sys; from optical_import import parse_text; print(json.dumps(parse_text(sys.stdin.read(),sys.argv[1]),allow_nan=False))", format], {
    input: text, encoding: "utf8", env: { ...process.env, PYTHONPATH: root + "python/src" },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("independent known geometry in both formats", () => {
  for (const [format, text] of [["zemax", ZMX], ["oslo", LEN]] as const) {
    const data = parseText(text, { format, strict: true });
    assert.deepEqual(data.surfaces.map(s => s.radiusMm), [{ special: "positiveInfinity" }, 20, -20, { special: "positiveInfinity" }]);
    assert.deepEqual(data.surfaces.map(s => s.thicknessMm), [{ special: "positiveInfinity" }, 2, 20, 0]);
    assert.equal(data.surfaces[1].stop, true);
    assert.deepEqual(data.wavelengths, { valuesUm: [0.55], weights: [1], primaryIndex: 0 });
  }
});

test("synthetic supported semantics match Python independently of goldens", () => {
  const cases: [Format, string][] = [
    ["zemax", ZMX.replace("STOP", "GLAS N-BK7 0 0 1.5168 64.17\nOBDC 1 2\nCLAP 0 3\nOBDC 4 5\nSTOP")],
    ["zemax", ZMX.replace("WAVM 1 0.55 1\nPWAV 1", "FTYP 0 0 2 2\nXFLD 0 0 99\nYFLD 0 10 99\nWAVM 2 0.6 2\nWAVM 1 0.5 1\nWAVM 3 0.9 1\nPWAV 2")],
    ["zemax", ZMX.replace("UNIT MM", "UNIT IN")],
    ["zemax", ZMX.replace("STOP", "TYPE EVENASPH\nPARM 1 1e-4\nPARM 2 2e-6\nSTOP")],
    ["oslo", LEN.replace('"simple"', '"a; // b \\"c\\""')],
    ["oslo", LEN.replace("RD 20", "GLA 1.5; AP CHK 3; RD 20")],
    ["oslo", LEN.replace("EBR 2", "EBR 2; UNI 25.4")],
    ["oslo", LEN + "CFG NEW\nTH 1 2 8\nWV1 2 0.6\nWW1 2 2\nEND\nCFWT 2 0.5\nCFAC 2 NO\n"],
    ["oslo", LEN.replace("TH 20", "PK TH 1 3; TH 20; PY 0")],
    ["oslo", LEN.replace("RD -20", "PK CV 1 0.01; CC -1; ASP ASR; AS1 1e-4; AS2 1e-6")],
    ["oslo", LEN.replace("RD 20", "DCX 1; TLA 2; DT -1; TOY 3; RD 20")],
    ["oslo", LEN + "RST NEW\nF 1 0.7 0 0 0 0 -1 1 -1 1 1\nEND\n"],
    ["oslo", LEN.replace("RD 20", "GLA MOD G1 1.6 50; RD 20")],
    ["oslo", LEN.replace("WV 0.55", "WV 0.55 0.65 0.75").replace("RD 20", "GLA 1.6 1.5 1.4; RD 20")],
    ["oslo", LEN.replace("RD 20", "ASP 1 4; AS1 0.1; ATD; PK CV 0; CSD; RD 20")],
  ];
  for (const [format, text] of cases) compare(parseText(text, { format }), python(text, format));
});

test("strict rejects partial imports and unknown records are retained", () => {
  const source = ZMX.replace("SURF 0", "BOGUS 2\nSURF 0");
  const data = parseText(source, { format: "zemax" });
  assert.ok(data.diagnostics.some(d => d.command === "BOGUS"));
  assert.ok((data.raw.records as any[]).some(r => r.text === "BOGUS 2"));
  assert.throws(() => parseText(source, { format: "zemax", strict: true }));
  assert.throws(() => parseText(LEN.replace("RD 20", "BOGUS 2; RD 20"), { format: "oslo", strict: true }));
});

test("complete numeric tokens, counts, quotes, NaN and non-sequential input fail", () => {
  const cases: [Format, string][] = [
    ["zemax", ZMX.replace("CURV 0.05", "CURV 12junk")], ["zemax", ZMX.replace("CURV 0.05", "CURV NaN")],
    ["zemax", ZMX + "MODE NSC\n"], ["zemax", ZMX.replace("UNIT MM", "UNIT BOGUS")],
    ["oslo", LEN.replace("RD 20", "RD NaN")], ["oslo", LEN.replace("RD 20", "RD 12junk")],
    ["oslo", LEN.replace("END 3", "END 2")], ["oslo", LEN.replace('"simple"', '"broken')],
    ["oslo", LEN + "CFG NEW\nTH 1 2 8\n"], ["oslo", LEN.replace("WV 0.55", "WV2 0.6; WV8 0.7")],
  ];
  for (const [format, text] of cases) assert.throws(() => parseText(text, { format }));
  assert.throws(() => jsonSafe({ x: NaN }));
  assert.deepEqual(jsonSafe({ x: -Infinity }), { x: { special: "negativeInfinity" } });
});

test("UTF-8 BOM and UTF-16 LE/BE including no BOM", () => {
  const expected = parseText(ZMX, { format: "zemax" });
  const utf8 = new TextEncoder().encode(ZMX);
  const payloads = [utf8, new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])];
  for (const big of [false, true]) {
    const bytes = new Uint8Array(ZMX.length * 2);
    for (let i = 0; i < ZMX.length; i++) { const code = ZMX.charCodeAt(i); bytes[i * 2 + (big ? 1 : 0)] = code & 255; bytes[i * 2 + (big ? 0 : 1)] = code >> 8; }
    payloads.push(bytes, new Uint8Array([...(big ? [0xfe, 0xff] : [0xff, 0xfe]), ...bytes]));
  }
  for (const bytes of payloads) {
    const data = parseBytes(bytes, { format: "zemax" }); data.source.encoding = "text";
    compare(data, expected);
  }
});

test("true Latin-1 differs from Windows-1252 and matches Python policy", () => {
  const source = ZMX.replace("simple", "café\u0080");
  const latin = Uint8Array.from([...source].map(c => c.charCodeAt(0)));
  assert.equal(parseBytes(latin, { format: "zemax" }).name, "café\u0080");
  const cp = Uint8Array.from([...LEN.replace("simple", "smart \u0093quotes\u0094")].map(c => c.charCodeAt(0)));
  assert.equal(parseBytes(cp, { format: "oslo" }).name, "smart “quotes”");
});

test("ArrayBuffer input and repeated calls are deterministic", () => {
  const buffer = new TextEncoder().encode(ZMX).buffer;
  compare(parseBytes(buffer, { format: "zemax" }), parseBytes(buffer, { format: "zemax" }));
});

test("source package has no runtime dependencies or Node imports", () => {
  const pkg = JSON.parse(readFileSync(root + "typescript/package.json", "utf8"));
  assert.deepEqual(pkg.dependencies, {});
  for (const file of readdirSync(root + "typescript/src")) {
    const source = readFileSync(root + "typescript/src/" + file, "utf8");
    assert.doesNotMatch(source, /(?:from\s+["'](?:node:|fs|path)|\bBuffer\b|\bprocess\.)/);
  }
});

test("invalid common numbers and clear aperture bounds fail", () => {
  for (const insertion of ["CONI Infinity", "CLAP 4 2", "CLAP 0 Infinity", "PARM 1 Infinity", "XFLD Infinity"]) assert.throws(() => parseText(ZMX.replace("STOP", insertion + "\nSTOP"), { format: "zemax" }));
  for (const replacement of ["ENPD Infinity", "ENPD -2"]) assert.throws(() => parseText(ZMX.replace("ENPD 4", replacement), { format: "zemax" }));
});
test("short weight columns are diagnosed and still schema-valid", () => {
  const source = ZMX.replace("STOP", "XFLD 0 1\nYFLD 0 1\nFWGN\nSTOP");
  const data = parseText(source, { format: "zemax" });
  assert.deepEqual(data.fields.points.map(p => p.weight), [1, 1]);
  assert.ok(validate(data), JSON.stringify(validate.errors));
  compare(data, python(source, "zemax"));
});
test("uninterpreted OSLO footer and phase features are explicit", () => {
  const data = parseText(LEN + "BOGUS 2\n", { format: "oslo" });
  assert.ok(data.diagnostics.some(d => d.command === "BOGUS"));
  assert.throws(() => parseText(LEN + "BOGUS 2\n", { format: "oslo", strict: true }));
  const source = LEN.replace("RD 20", "GSP 0.01; GOR 1; RD 20");
  const phase = parseText(source, { format: "oslo" });
  assert.ok(phase.diagnostics.some(d => d.code === "unresolved_optical_feature"));
  compare(phase, python(source, "oslo"));
});
test("unknown type and prototype-property command names preserve Python behavior", () => {
  const source = ZMX.replace("STOP", "TYPE constructor\nSTOP") + "__proto__ 1\n";
  const data = parseText(source, { format: "zemax" });
  assert.equal(data.surfaces[1].type, "constructor");
  assert.ok(data.diagnostics.some(d => d.code === "unresolved_surface_type"));
  assert.ok(data.diagnostics.some(d => d.command === "__proto__"));
  compare(data, python(source, "zemax"));
});
