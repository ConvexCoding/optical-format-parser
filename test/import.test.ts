import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  PrescriptionParseError,
  formatFromFilename,
  parseBytes,
  parseJson,
  parseText,
  safeParseBytes,
  safeParseText,
  stringify,
} from "../src/index.js";
import type { Format, NormalizedPrescription, NormalizedSurface, ParseErrorCode } from "../src/index.js";
import { tagSpecialNumbers } from "../src/json.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
const validate = ajv.compile(JSON.parse(readFileSync(root + "schema/prescription.schema.json", "utf8")));

function compare(actual: any, expected: any, path = "$"): void {
  if (typeof actual === "number" && typeof expected === "number") {
    const tolerance = 1e-10 + 1e-12 * Math.max(Math.abs(actual), Math.abs(expected));
    assert.ok(actual === expected || Math.abs(actual - expected) <= tolerance, `${path}: ${actual} != ${expected}`);
  } else if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, path);
    actual.forEach((v, i) => compare(v, expected[i], `${path}[${i}]`));
  } else if (actual !== null && expected !== null && typeof actual === "object" && typeof expected === "object") {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path}: keys`);
    for (const key of Object.keys(actual)) compare(actual[key], expected[key], `${path}.${key}`);
  } else assert.deepEqual(actual, expected, path);
}
/** The JSON form of a prescription: what `stringify` writes and the schema describes. */
const serialized = (data: NormalizedPrescription): unknown => JSON.parse(stringify(data));

function expectError(action: () => unknown, code: ParseErrorCode): PrescriptionParseError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof PrescriptionParseError, `expected PrescriptionParseError, got ${String(error)}`);
    assert.equal(error.code, code, error.message);
    return error;
  }
  assert.fail(`expected a ${code} error`);
}
function surfaceOfType<T extends NormalizedSurface["type"]>(surface: NormalizedSurface | undefined, type: T) {
  assert.equal(surface?.type, type);
  return surface as Extract<NormalizedSurface, { type: T }>;
}

for (const format of ["zemax", "oslo"] as const) {
  for (const filename of readdirSync(root + "test/fixtures/" + format)) {
    test(`Fixture regression and schema: ${filename}`, () => {
      const bytes = readFileSync(root + `test/fixtures/${format}/${filename}`);
      const data = parseBytes(bytes, { format, filename, includeRaw: true });
      const golden = JSON.parse(readFileSync(root + `test/fixtures/golden/${filename}.json`, "utf8"));
      compare(serialized(data), golden);
      assert.ok(validate(golden), JSON.stringify(validate.errors));
      compare(parseJson(stringify(data)), data);

      // Format inference and the default (no raw) output agree with the explicit call.
      const { raw, ...withoutRaw } = data;
      assert.ok(raw);
      const inferred = parseBytes(bytes, { filename });
      assert.deepEqual(inferred, withoutRaw);
      assert.ok(validate(serialized(inferred)), JSON.stringify(validate.errors));
    });
  }
}

const ZMX =
  "NAME simple\nUNIT MM\nENPD 4\nWAVM 1 0.55 1\nPWAV 1\nSURF 0\nCURV 0\nDISZ INFINITY\nSURF 1\nCURV 0.05\nDISZ 2\nSTOP\nSURF 2\nCURV -0.05\nDISZ 20\nSURF 3\nCURV 0\nDISZ 0\n";
const LEN =
  'LEN NEW "simple" 50 3\nEBR 2\nANG 0\nWV 0.55\nTH 1e20; NXT\nRD 20; TH 2; AST; NXT\nRD -20; TH 20; NXT\nRD 0; END 3\n';

const regressions: { format: Format; text: string; expected: unknown }[] = JSON.parse(
  readFileSync(root + "test/fixtures/regressions.json", "utf8"),
);
function compareRegression(text: string, format: Format): NormalizedPrescription {
  const fixture = regressions.find((entry) => entry.format === format && entry.text === text);
  assert.ok(fixture, "Missing regression fixture for " + format);
  assert.ok(validate(fixture.expected), JSON.stringify(validate.errors));
  const data = parseText(text, { format, includeRaw: true });
  compare(serialized(data), fixture.expected);
  return data;
}

test("independent known geometry in both formats", () => {
  for (const [format, text] of [
    ["zemax", ZMX],
    ["oslo", LEN],
  ] as const) {
    const data = parseText(text, { format, strict: true });
    assert.deepEqual(
      data.surfaces.map((s) => s.radiusMm),
      [Infinity, 20, -20, Infinity],
    );
    assert.deepEqual(
      data.surfaces.map((s) => s.thicknessMm),
      [Infinity, 2, 20, 0],
    );
    assert.deepEqual(
      data.surfaces.map((s) => s.role),
      ["object", "surface", "surface", "image"],
    );
    assert.equal(data.surfaces[1]?.stop, true);
    assert.deepEqual(data.wavelengths, { valuesUm: [0.55], weights: [1], primaryIndex: 0 });
    assert.equal("raw" in data, false);
  }
});

test("synthetic prescription declarations match saved regressions", () => {
  const cases: [Format, string][] = [
    ["zemax", ZMX.replace("STOP", "GLAS N-BK7 0 0 1.5168 64.17\nOBDC 1 2\nCLAP 0 3\nOBDC 4 5\nSTOP")],
    [
      "zemax",
      ZMX.replace(
        "WAVM 1 0.55 1\nPWAV 1",
        "FTYP 0 0 2 2\nXFLD 0 0 99\nYFLD 0 10 99\nWAVM 2 0.6 2\nWAVM 1 0.5 1\nWAVM 3 0.9 1\nPWAV 2",
      ),
    ],
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
  for (const [format, text] of cases) compareRegression(text, format);
});

test("materials are a discriminated union with uniform catalog records", () => {
  const zemax = parseText(ZMX.replace("STOP", "GCAT SCHOTT\nGLAS N-BK7 0 0 1.5168 64.17\nSTOP"), { format: "zemax" });
  assert.deepEqual(zemax.surfaces[1]?.material, {
    kind: "catalog",
    name: "N-BK7",
    catalogs: ["SCHOTT"],
    nd: 1.5168,
    vd: 64.17,
    resolution: "unresolved",
  });
  assert.deepEqual(zemax.surfaces[2]?.material, { kind: "air" });
  const material = (declaration: string) =>
    parseText(LEN.replace("RD 20", `${declaration}; RD 20`), { format: "oslo" }).surfaces[1]?.material;
  assert.deepEqual(material("GLA BK7"), {
    kind: "catalog",
    name: "BK7",
    catalogs: [],
    nd: null,
    vd: null,
    resolution: "unresolved",
  });
  assert.deepEqual(material("GLA 1.5"), { kind: "constantIndex", name: null, index: 1.5 });
  assert.deepEqual(material("RFL"), { kind: "mirror" });
});

test("asphere terms carry explicit powers and millimeter coefficients", () => {
  const asphere = "TYPE EVENASPH\nPARM 1 1e-4\nPARM 2 2e-6\nSTOP";
  const even = surfaceOfType(parseText(ZMX.replace("STOP", asphere), { format: "zemax" }).surfaces[1], "evenAsphere");
  assert.equal(even.nativeType, "EVENASPH");
  assert.deepEqual(even.asphereTerms, [
    { power: 2, coefficient: 1e-4, native: "PARM 1" },
    { power: 4, coefficient: 2e-6, native: "PARM 2" },
  ]);

  // In inches, sag = a * r^p with r in inches; in millimeters the coefficient is a * 25.4^(1 - p).
  const inches = parseText(ZMX.replace("UNIT MM", "UNIT IN").replace("STOP", asphere), { format: "zemax" });
  const scaled = surfaceOfType(inches.surfaces[1], "evenAsphere");
  assert.equal(scaled.radiusMm, 20 * 25.4);
  compare(
    scaled.asphereTerms.map((term) => term.coefficient),
    [1e-4 / 25.4, 2e-6 / 25.4 ** 3],
  );

  const odd = parseText(ZMX.replace("STOP", "TYPE ODDASPHE\nPARM 1 0.5\nPARM 3 7\nSTOP"), { format: "zemax" });
  assert.deepEqual(
    surfaceOfType(odd.surfaces[1], "oddAsphere").asphereTerms.map((term) => term.power),
    [1, 3],
  );

  const oslo = (declarations: string) =>
    parseText(LEN.replace("RD 20", `${declarations}; RD 20`), { format: "oslo" }).surfaces[1];
  assert.deepEqual(surfaceOfType(oslo("AD 1e-5; AF 3e-9"), "evenAsphere").asphereTerms, [
    { power: 4, coefficient: 1e-5, native: "AD" },
    { power: 8, coefficient: 3e-9, native: "AF" },
  ]);
  assert.deepEqual(surfaceOfType(oslo("ASP ASR; AS2 1e-6; AS1 1e-4"), "evenAsphere").asphereTerms, [
    { power: 2, coefficient: 1e-4, native: "AS1" },
    { power: 4, coefficient: 1e-6, native: "AS2" },
  ]);
  assert.deepEqual(surfaceOfType(oslo("ASP ARA; AS3 2e-5"), "oddAsphere").asphereTerms, [
    { power: 3, coefficient: 2e-5, native: "AS3" },
  ]);
  assert.equal("asphereTerms" in (oslo("CC -1") ?? {}), false);
});

test("semi-diameters and clear apertures are in millimeters for both formats", () => {
  const zemax = parseText(ZMX.replace("UNIT MM", "UNIT CM").replace("STOP", "DIAM 1.5 0 0 0 1\nCLAP 0 1.2\nSTOP"), {
    format: "zemax",
  });
  assert.equal(zemax.surfaces[1]?.semiDiameterMm, 15);
  assert.deepEqual(zemax.surfaces[1]?.clearAperture, {
    kind: "annulus",
    minRadiusMm: 0,
    maxRadiusMm: 12,
    offsetXMm: 0,
    offsetYMm: 0,
    checked: null,
    checkingEnabled: null,
  });
  assert.equal(zemax.surfaces[2]?.semiDiameterMm, null);
  assert.equal(zemax.surfaces[2]?.clearAperture, null);

  const oslo = parseText(LEN.replace("RD 20", "AP CHK 3; RD 20"), { format: "oslo" });
  assert.equal(oslo.surfaces[1]?.semiDiameterMm, 3);
  assert.deepEqual(oslo.surfaces[1]?.clearAperture, {
    kind: "annulus",
    minRadiusMm: 0,
    maxRadiusMm: 3,
    offsetXMm: 0,
    offsetYMm: 0,
    checked: true,
    checkingEnabled: true,
  });
});

test("fields always provide points; OSLO tables are reported as relative points", () => {
  const none = { decenterX: 0, decenterY: 0, compressX: 0, compressY: 0, tangentAngle: 0 };
  const zemax = parseText(ZMX.replace("PWAV 1", "PWAV 1\nFTYP 1 0 2 1\nXFLD 0 0\nYFLD 0 5\nFWGN 1 2\nVCYN 0 0.25"), {
    format: "zemax",
  });
  assert.equal(zemax.fields.kind, "objectHeight");
  assert.equal(zemax.fields.specification, "pointList");
  assert.deepEqual(zemax.fields.points, [
    { x: 0, y: 0, weight: 1, vignetting: none },
    { x: 0, y: 5, weight: 2, vignetting: { ...none, compressY: 0.25 } },
  ]);
  assert.deepEqual(zemax.fields.relativePoints, []);

  const oslo = parseText(LEN.replace("ANG 0", "ANG 20") + "RST NEW\nF 1 0.7 0 0 0 0 -1 1 -1 1 1\nEND\n", {
    format: "oslo",
  });
  assert.equal(oslo.fields.kind, "angle");
  assert.equal(oslo.fields.specification, "fullField");
  assert.deepEqual(oslo.fields.points, [{ x: 0, y: 20, weight: 1, vignetting: none }]);
  assert.deepEqual(oslo.fields.relativePoints, [{ index: 1, x: 0, y: 0.7, weight: 1, vignetteX: 0, vignetteY: 0 }]);
  assert.ok(oslo.diagnostics.some((d) => d.code === "relative_field_table"));
});

test("system aperture kinds and units", () => {
  const zemax = parseText(ZMX.replace("UNIT MM", "UNIT CM"), { format: "zemax" });
  assert.deepEqual(zemax.aperture, { kind: "entrancePupilDiameter", value: 40, source: { EPD: 4 } });
  const floating = parseText(ZMX.replace("ENPD 4", "FLOA"), { format: "zemax" });
  assert.deepEqual(floating.aperture, { kind: "floatingStop", value: null, source: { floating_stop: true } });
  const oslo = parseText(LEN, { format: "oslo" });
  assert.deepEqual(oslo.aperture, { kind: "beamRadiusAtSurface1", value: 2, source: { EPD: 4 } });
  const unspecified = parseText(LEN.replace("EBR 2\n", ""), { format: "oslo" });
  assert.deepEqual(unspecified.aperture, { kind: "unspecified", value: null, source: {} });
});

test("strict rejects partial imports and unknown records are retained", () => {
  const source = ZMX.replace("SURF 0", "BOGUS 2\nSURF 0");
  const data = parseText(source, { format: "zemax", includeRaw: true });
  assert.ok(data.diagnostics.some((d) => d.command === "BOGUS"));
  assert.ok((data.raw?.records as any[]).some((r) => r.text === "BOGUS 2"));
  expectError(() => parseText(source, { format: "zemax", strict: true }), "strict_violation");
  expectError(
    () => parseText(LEN.replace("RD 20", "BOGUS 2; RD 20"), { format: "oslo", strict: true }),
    "strict_violation",
  );
});

test("strict errors carry every diagnostic of the rejected import", () => {
  const source = ZMX.replace("SURF 0", "BOGUS 2\nVERS 1\nSURF 0") + "OTHER 3\n";
  const error = expectError(
    () => parseText(source, { format: "zemax", strict: true, filename: "a.zmx" }),
    "strict_violation",
  );
  assert.deepEqual(
    error.diagnostics.map((d) => [d.severity, d.command, d.line, d.surface]),
    [
      ["warning", "BOGUS", 6, undefined],
      ["info", "VERS", 7, undefined],
      ["warning", "OTHER", 21, 3],
    ],
  );
  assert.equal(error.filename, "a.zmx");
  assert.match(error.message, /2 warning\(s\)/);
});

test("malformed input reports where it failed", () => {
  const zemax = expectError(
    () => parseText(ZMX.replace("CURV 0.05", "CURV 12junk"), { format: "zemax", filename: "bad.zmx" }),
    "invalid_prescription",
  );
  assert.deepEqual([zemax.filename, zemax.line, zemax.command], ["bad.zmx", 10, "CURV"]);
  assert.equal(zemax.message, "bad.zmx:10: CURV: Invalid numeric token: 12junk");
  assert.equal(zemax.name, "PrescriptionParseError");
  assert.ok(zemax instanceof Error);

  const oslo = expectError(
    () => parseText(LEN.replace("RD 20", "RD 12junk"), { filename: "bad.len" }),
    "invalid_prescription",
  );
  assert.deepEqual([oslo.filename, oslo.line], ["bad.len", 6]);

  // Problems found after the last line have no line number but still name the file.
  const unit = expectError(
    () => parseText(ZMX.replace("UNIT MM", "UNIT BOGUS"), { filename: "u.zmx" }),
    "invalid_prescription",
  );
  assert.deepEqual([unit.filename, unit.line], ["u.zmx", undefined]);
});

test("complete numeric tokens, counts, quotes, NaN and non-sequential input fail", () => {
  const cases: [Format, string][] = [
    ["zemax", ZMX.replace("CURV 0.05", "CURV 12junk")],
    ["zemax", ZMX.replace("CURV 0.05", "CURV NaN")],
    ["zemax", ZMX.replace("DISZ 2", "DISZ NaN")],
    ["zemax", ZMX + "MODE NSC\n"],
    ["zemax", ZMX.replace("UNIT MM", "UNIT BOGUS")],
    ["zemax", ZMX.replace("ENPD 4\n", "")],
    ["oslo", LEN.replace("RD 20", "RD NaN")],
    ["oslo", LEN.replace("RD 20", "RD 12junk")],
    ["oslo", LEN.replace("END 3", "END 2")],
    ["oslo", LEN.replace('"simple"', '"broken')],
    ["oslo", LEN + "CFG NEW\nTH 1 2 8\n"],
    ["oslo", LEN.replace("WV 0.55", "WV2 0.6; WV8 0.7")],
  ];
  for (const [format, text] of cases) expectError(() => parseText(text, { format }), "invalid_prescription");
});

test("safe parsing returns errors instead of throwing", () => {
  const good = safeParseText(ZMX, { format: "zemax" });
  assert.ok(good.ok);
  assert.equal(good.prescription.surfaces.length, 4);

  const bad = safeParseText(ZMX.replace("CURV 0.05", "CURV 12junk"), { format: "zemax" });
  assert.ok(!bad.ok);
  assert.equal(bad.error.code, "invalid_prescription");
  assert.equal(bad.error.line, 10);

  const bytes = safeParseBytes(new Uint8Array([0xff, 0xfe, 0x00, 0xd8, 0x41]), { format: "zemax" });
  assert.ok(!bytes.ok);
  assert.equal(bytes.error.code, "decoding_failed");
  assert.equal(safeParseBytes(new TextEncoder().encode(LEN), { filename: "x.LEN" }).ok, true);
});

test("format is inferred from the filename and bad options are reported", () => {
  assert.equal(formatFromFilename("Design.ZMX"), "zemax");
  assert.equal(formatFromFilename("dir/lens.len"), "oslo");
  assert.equal(formatFromFilename("lens.json"), null);
  assert.equal(parseText(ZMX, { filename: "simple.zmx" }).source.format, "zemax");
  assert.equal(parseText(ZMX, { filename: "misnamed.len", format: "zemax" }).source.format, "zemax");
  expectError(() => parseText(ZMX, {}), "invalid_options");
  expectError(() => parseText(ZMX, { filename: "lens.txt" }), "invalid_options");
  expectError(() => parseText(ZMX, { format: "codev" as Format }), "invalid_options");
  expectError(() => parseText(ZMX, undefined as never), "invalid_options");
  expectError(() => parseBytes(new Uint8Array([0x81, 0xff]), { format: "oslo" }), "decoding_failed");
});

test("JSON round trip tags and restores infinities", () => {
  const data = parseText(ZMX, { format: "zemax", includeRaw: true });
  const json = stringify(data);
  assert.ok(json.endsWith("}\n"));
  assert.deepEqual(JSON.parse(json).surfaces[0].radiusMm, { special: "positiveInfinity" });
  assert.equal(JSON.parse(json).raw.surfaces[0].thickness.special, "positiveInfinity");
  assert.ok(validate(JSON.parse(json)), JSON.stringify(validate.errors));
  assert.deepEqual(parseJson(json), data);
  assert.equal(parseJson(json).surfaces[0]?.radiusMm, Infinity);

  assert.deepEqual(tagSpecialNumbers({ x: -Infinity }), { x: { special: "negativeInfinity" } });
  assert.throws(() => tagSpecialNumbers({ x: NaN }));
  expectError(() => parseJson("{nope"), "invalid_json");
  expectError(() => parseJson('{"schemaVersion":"1.0"}'), "invalid_json");
  expectError(() => parseJson("null"), "invalid_json");
});

test("UTF-8 BOM and UTF-16 LE/BE including no BOM", () => {
  const expected = parseText(ZMX, { format: "zemax" });
  const utf8 = new TextEncoder().encode(ZMX);
  const payloads: [Uint8Array, string][] = [
    [utf8, "utf-8"],
    [new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]), "utf-8"],
  ];
  for (const big of [false, true]) {
    const bytes = new Uint8Array(ZMX.length * 2);
    for (let i = 0; i < ZMX.length; i++) {
      const code = ZMX.charCodeAt(i);
      bytes[i * 2 + (big ? 1 : 0)] = code & 255;
      bytes[i * 2 + (big ? 0 : 1)] = code >> 8;
    }
    const encoding = big ? "utf-16-be" : "utf-16-le";
    payloads.push([bytes, encoding], [new Uint8Array([...(big ? [0xfe, 0xff] : [0xff, 0xfe]), ...bytes]), encoding]);
  }
  for (const [bytes, encoding] of payloads) {
    const data = parseBytes(bytes, { format: "zemax" });
    assert.equal(data.source.encoding, encoding);
    assert.deepEqual({ ...data, source: expected.source }, expected);
  }
});

test("true Latin-1 differs from Windows-1252", () => {
  const source = ZMX.replace("simple", "café\u0080");
  const latin = Uint8Array.from([...source].map((c) => c.charCodeAt(0)));
  assert.equal(parseBytes(latin, { format: "zemax" }).name, "café\u0080");
  const cp = Uint8Array.from([...LEN.replace("simple", "smart \u0093quotes\u0094")].map((c) => c.charCodeAt(0)));
  const oslo = parseBytes(cp, { format: "oslo" });
  assert.equal(oslo.name, "smart “quotes”");
  assert.equal(oslo.source.encoding, "cp1252");
});

test("ArrayBuffer input and repeated calls are deterministic", () => {
  const buffer = new TextEncoder().encode(ZMX).buffer;
  assert.deepEqual(parseBytes(buffer, { format: "zemax" }), parseBytes(buffer, { format: "zemax" }));
});

test("source package has no runtime dependencies or Node imports", () => {
  const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  for (const file of readdirSync(root + "src")) {
    const source = readFileSync(root + "src/" + file, "utf8");
    assert.doesNotMatch(source, /(?:from\s+["'](?:node:|fs|path)|\bBuffer\b|\bprocess\.)/);
  }
});

test("invalid common numbers and clear aperture bounds fail", () => {
  for (const insertion of [
    "CONI Infinity",
    "CLAP 4 2",
    "CLAP 0 Infinity",
    "PARM 1 Infinity",
    "XFLD Infinity",
    "DIAM Infinity",
  ]) {
    expectError(
      () => parseText(ZMX.replace("STOP", insertion + "\nSTOP"), { format: "zemax" }),
      "invalid_prescription",
    );
  }
  for (const replacement of ["ENPD Infinity", "ENPD -2"]) {
    expectError(() => parseText(ZMX.replace("ENPD 4", replacement), { format: "zemax" }), "invalid_prescription");
  }
});

test("short weight columns are diagnosed and still schema-valid", () => {
  const source = ZMX.replace("STOP", "XFLD 0 1\nYFLD 0 1\nFWGN\nSTOP");
  const data = compareRegression(source, "zemax");
  assert.deepEqual(
    data.fields.points.map((p) => p.weight),
    [1, 1],
  );
  assert.ok(data.diagnostics.some((d) => d.code === "field_count_mismatch"));
});

test("uninterpreted OSLO footer and phase features are explicit", () => {
  const data = parseText(LEN + "BOGUS 2\n", { format: "oslo" });
  assert.ok(data.diagnostics.some((d) => d.command === "BOGUS"));
  expectError(() => parseText(LEN + "BOGUS 2\n", { format: "oslo", strict: true }), "strict_violation");
  const phase = compareRegression(LEN.replace("RD 20", "GSP 0.01; GOR 1; RD 20"), "oslo");
  assert.ok(phase.diagnostics.some((d) => d.code === "unresolved_optical_feature"));
});

test("unknown type and prototype-property command names are retained", () => {
  const source = ZMX.replace("STOP", "TYPE constructor\nSTOP") + "__proto__ 1\n";
  const data = compareRegression(source, "zemax");
  assert.equal(data.surfaces[1]?.type, "unknown");
  assert.equal(data.surfaces[1]?.nativeType, "CONSTRUCTOR");
  assert.ok(data.diagnostics.some((d) => d.code === "unresolved_surface_type"));
  assert.ok(data.diagnostics.some((d) => d.command === "__proto__"));
});
