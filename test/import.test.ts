import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { PrescriptionParseError, parseBytes, parseJson, parseText, stringify } from "../src/index.js";
import type { Format, NormalizedPrescription, NormalizedSurface, ParseErrorCode, Result } from "../src/index.js";
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

/** Most tests want the value: unwrap it, turning a returned error back into a thrown one. */
function must<T>([value, error]: Result<T>): T {
  if (error) throw error;
  return value;
}
const mustParseText = (...args: Parameters<typeof parseText>) => must(parseText(...args));
const mustParseBytes = (...args: Parameters<typeof parseBytes>) => must(parseBytes(...args));
const mustParseJson = (...args: Parameters<typeof parseJson>) => must(parseJson(...args));

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
      const data = mustParseBytes(bytes, { format, includeRaw: true });
      const golden = JSON.parse(readFileSync(root + `test/fixtures/golden/${filename}.json`, "utf8"));
      compare(serialized(data), golden);
      assert.ok(validate(golden), JSON.stringify(validate.errors));
      compare(mustParseJson(stringify(data)), data);

      // The default output is the same prescription without the raw model.
      const { raw, ...withoutRaw } = data;
      assert.ok(raw);
      const plain = mustParseBytes(bytes, { format });
      assert.deepEqual(plain, withoutRaw);
      assert.ok(validate(serialized(plain)), JSON.stringify(validate.errors));
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
  const data = mustParseText(text, { format, includeRaw: true });
  compare(serialized(data), fixture.expected);
  return data;
}

test("independent known geometry in both formats", () => {
  for (const [format, text] of [
    ["zemax", ZMX],
    ["oslo", LEN],
  ] as const) {
    const data = mustParseText(text, { format, strict: true });
    assert.deepEqual(
      data.surfaces.map((s) => s.radius),
      [Infinity, 20, -20, Infinity],
    );
    assert.deepEqual(
      data.surfaces.map((s) => s.thickness),
      [Infinity, 2, 20, 0],
    );
    assert.deepEqual(
      data.surfaces.map((s) => s.role),
      ["object", "surface", "surface", "image"],
    );
    assert.equal(data.surfaces[1]?.stop, true);
    assert.deepEqual(data.wavelengths, { values: [0.55], weights: [1], primaryIndex: 0 });
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
  const zemax = mustParseText(ZMX.replace("STOP", "GCAT SCHOTT\nGLAS N-BK7 0 0 1.5168 64.17\nSTOP"), {
    format: "zemax",
  });
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
    mustParseText(LEN.replace("RD 20", `${declaration}; RD 20`), { format: "oslo" }).surfaces[1]?.material;
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
  const even = surfaceOfType(
    mustParseText(ZMX.replace("STOP", asphere), { format: "zemax" }).surfaces[1],
    "evenAsphere",
  );
  assert.equal(even.nativeType, "EVENASPH");
  assert.deepEqual(even.asphereTerms, [
    { power: 2, coefficient: 1e-4, native: "PARM 1" },
    { power: 4, coefficient: 2e-6, native: "PARM 2" },
  ]);

  // In inches, sag = a * r^p with r in inches; in millimeters the coefficient is a * 25.4^(1 - p).
  const inches = mustParseText(ZMX.replace("UNIT MM", "UNIT IN").replace("STOP", asphere), { format: "zemax" });
  const scaled = surfaceOfType(inches.surfaces[1], "evenAsphere");
  assert.equal(scaled.radius, 20 * 25.4);
  compare(
    scaled.asphereTerms.map((term) => term.coefficient),
    [1e-4 / 25.4, 2e-6 / 25.4 ** 3],
  );

  const odd = mustParseText(ZMX.replace("STOP", "TYPE ODDASPHE\nPARM 1 0.5\nPARM 3 7\nSTOP"), { format: "zemax" });
  assert.deepEqual(
    surfaceOfType(odd.surfaces[1], "oddAsphere").asphereTerms.map((term) => term.power),
    [1, 3],
  );

  const oslo = (declarations: string) =>
    mustParseText(LEN.replace("RD 20", `${declarations}; RD 20`), { format: "oslo" }).surfaces[1];
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
  const zemax = mustParseText(ZMX.replace("UNIT MM", "UNIT CM").replace("STOP", "DIAM 1.5 0 0 0 1\nCLAP 0 1.2\nSTOP"), {
    format: "zemax",
  });
  assert.equal(zemax.surfaces[1]?.semiDiameter, 15);
  assert.deepEqual(zemax.surfaces[1]?.clearAperture, {
    kind: "annulus",
    minRadius: 0,
    maxRadius: 12,
    offsetX: 0,
    offsetY: 0,
    checked: null,
    checkingEnabled: null,
  });
  assert.equal(zemax.surfaces[2]?.semiDiameter, null);
  assert.equal(zemax.surfaces[2]?.clearAperture, null);

  const oslo = mustParseText(LEN.replace("RD 20", "AP CHK 3; RD 20"), { format: "oslo" });
  assert.equal(oslo.surfaces[1]?.semiDiameter, 3);
  assert.deepEqual(oslo.surfaces[1]?.clearAperture, {
    kind: "annulus",
    minRadius: 0,
    maxRadius: 3,
    offsetX: 0,
    offsetY: 0,
    checked: true,
    checkingEnabled: true,
  });
});

test("wavelengths are micrometers", () => {
  const zemax = mustParseText(ZMX.replace("WAVM 1 0.55 1", "WAVM 1 0.55 1\nWAVM 2 0.5875618 1"), { format: "zemax" });
  assert.equal(zemax.units.wavelength, "um");
  assert.deepEqual(zemax.wavelengths.values, [0.55, 0.5875618]);

  const sampled = LEN.replace("WV 0.55", "WV 0.55 0.65 0.75").replace("RD 20", "GLA 1.6 1.5 1.4; RD 20");
  assert.deepEqual(mustParseText(sampled, { format: "oslo" }).surfaces[1]?.material, {
    kind: "sampledIndex",
    name: null,
    wavelengths: [0.55, 0.65, 0.75],
    indices: [1.6, 1.5, 1.4],
  });
  // OSLO's default d, F and C lines.
  assert.deepEqual(
    mustParseText(LEN.replace("WV 0.55\n", ""), { format: "oslo" }).wavelengths.values,
    [0.58756, 0.48613, 0.65627],
  );
});

test("fields always provide points; OSLO tables are reported as relative points", () => {
  const none = { decenterX: 0, decenterY: 0, compressX: 0, compressY: 0, tangentAngle: 0 };
  const zemax = mustParseText(
    ZMX.replace("PWAV 1", "PWAV 1\nFTYP 1 0 2 1\nXFLD 0 0\nYFLD 0 5\nFWGN 1 2\nVCYN 0 0.25"),
    {
      format: "zemax",
    },
  );
  assert.equal(zemax.fields.kind, "objectHeight");
  assert.equal(zemax.fields.specification, "pointList");
  assert.deepEqual(zemax.fields.points, [
    { x: 0, y: 0, weight: 1, vignetting: none },
    { x: 0, y: 5, weight: 2, vignetting: { ...none, compressY: 0.25 } },
  ]);
  assert.deepEqual(zemax.fields.relativePoints, []);

  const oslo = mustParseText(LEN.replace("ANG 0", "ANG 20") + "RST NEW\nF 1 0.7 0 0 0 0 -1 1 -1 1 1\nEND\n", {
    format: "oslo",
  });
  assert.equal(oslo.fields.kind, "angle");
  assert.equal(oslo.fields.specification, "fullField");
  assert.deepEqual(oslo.fields.points, [{ x: 0, y: 20, weight: 1, vignetting: none }]);
  assert.deepEqual(oslo.fields.relativePoints, [{ index: 1, x: 0, y: 0.7, weight: 1, vignetteX: 0, vignetteY: 0 }]);
  assert.ok(oslo.diagnostics.some((d) => d.code === "relative_field_table"));
});

test("system aperture kinds and units", () => {
  const zemax = mustParseText(ZMX.replace("UNIT MM", "UNIT CM"), { format: "zemax" });
  assert.deepEqual(zemax.aperture, { kind: "entrancePupilDiameter", value: 40, source: { EPD: 4 } });
  const floating = mustParseText(ZMX.replace("ENPD 4", "FLOA"), { format: "zemax" });
  assert.deepEqual(floating.aperture, { kind: "floatingStop", value: null, source: { floating_stop: true } });
  const oslo = mustParseText(LEN, { format: "oslo" });
  assert.deepEqual(oslo.aperture, { kind: "beamRadiusAtSurface1", value: 2, source: { EPD: 4 } });
  const unspecified = mustParseText(LEN.replace("EBR 2\n", ""), { format: "oslo" });
  assert.deepEqual(unspecified.aperture, { kind: "unspecified", value: null, source: {} });
});

test("strict rejects partial imports and unknown records are retained", () => {
  const source = ZMX.replace("SURF 0", "BOGUS 2\nSURF 0");
  const data = mustParseText(source, { format: "zemax", includeRaw: true });
  assert.ok(data.diagnostics.some((d) => d.command === "BOGUS"));
  assert.ok((data.raw?.records as any[]).some((r) => r.text === "BOGUS 2"));
  expectError(() => mustParseText(source, { format: "zemax", strict: true }), "strict_violation");
  expectError(
    () => mustParseText(LEN.replace("RD 20", "BOGUS 2; RD 20"), { format: "oslo", strict: true }),
    "strict_violation",
  );
});

test("strict errors carry every diagnostic of the rejected import", () => {
  const source = ZMX.replace("SURF 0", "BOGUS 2\nVERS 1\nSURF 0") + "OTHER 3\n";
  const error = expectError(() => mustParseText(source, { format: "zemax", strict: true }), "strict_violation");
  assert.deepEqual(
    error.diagnostics.map((d) => [d.severity, d.command, d.line, d.surface]),
    [
      ["warning", "BOGUS", 6, undefined],
      ["info", "VERS", 7, undefined],
      ["warning", "OTHER", 21, 3],
    ],
  );
  assert.match(error.message, /2 warning\(s\)/);
});

test("malformed input reports where it failed", () => {
  const zemax = expectError(
    () => mustParseText(ZMX.replace("CURV 0.05", "CURV 12junk"), { format: "zemax" }),
    "invalid_prescription",
  );
  assert.deepEqual([zemax.line, zemax.command], [10, "CURV"]);
  assert.equal(zemax.message, "line 10: CURV: Invalid numeric token: 12junk");
  assert.equal(zemax.name, "PrescriptionParseError");
  assert.ok(zemax instanceof Error);

  const oslo = expectError(
    () => mustParseText(LEN.replace("RD 20", "RD 12junk"), { format: "oslo" }),
    "invalid_prescription",
  );
  assert.equal(oslo.line, 6);
  assert.equal(oslo.message, "line 6: Invalid numeric token: 12junk");

  // Problems found after the last line have no line number.
  const unit = expectError(
    () => mustParseText(ZMX.replace("UNIT MM", "UNIT BOGUS"), { format: "zemax" }),
    "invalid_prescription",
  );
  assert.equal(unit.line, undefined);
  assert.equal(unit.message, "Unsupported Zemax length unit: BOGUS");
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
  for (const [format, text] of cases) expectError(() => mustParseText(text, { format }), "invalid_prescription");
});

test("parsing returns [value, error] pairs and never throws for bad input", () => {
  const [prescription, noError] = parseText(ZMX, { format: "zemax" });
  assert.equal(noError, null);
  assert.equal(prescription?.surfaces.length, 4);

  const [nothing, error] = parseText(ZMX.replace("CURV 0.05", "CURV 12junk"), { format: "zemax" });
  assert.equal(nothing, null);
  assert.ok(error instanceof PrescriptionParseError);
  assert.deepEqual([error.code, error.line, error.command], ["invalid_prescription", 10, "CURV"]);

  const codes = [
    parseText(ZMX + "BOGUS 1\n", { format: "zemax", strict: true }),
    parseText(ZMX, { format: "codev" as Format }),
    parseText(ZMX, undefined as never),
    parseText(undefined as never, { format: "zemax" }),
    parseBytes(new Uint8Array([0xff, 0xfe, 0x00, 0xd8, 0x41]), { format: "zemax" }),
    parseBytes(new Uint8Array([0x81, 0xff]), { format: "oslo" }),
    parseBytes(null as never, { format: "zemax" }),
    parseJson("{nope"),
    parseJson('{"schemaVersion":"0.0"}'),
  ].map(([value, failure]) => [value, failure?.code]);
  assert.deepEqual(codes, [
    [null, "strict_violation"],
    [null, "invalid_options"],
    [null, "invalid_options"],
    [null, "invalid_options"],
    [null, "decoding_failed"],
    [null, "decoding_failed"],
    [null, "invalid_options"],
    [null, "invalid_json"],
    [null, "invalid_json"],
  ]);

  const [fromBytes] = parseBytes(new TextEncoder().encode(LEN), { format: "oslo" });
  const [fromText] = parseText(LEN, { format: "oslo" });
  assert.deepEqual(fromBytes?.surfaces, fromText?.surfaces);
  const [restored, jsonError] = parseJson(stringify(must(parseText(ZMX, { format: "zemax" }))));
  assert.equal(jsonError, null);
  assert.equal(restored?.surfaces[0]?.radius, Infinity);
});

test("the format is always explicit and bad options are reported", () => {
  expectError(() => mustParseText(ZMX, {} as never), "invalid_options");
  assert.deepEqual(Object.keys(mustParseText(ZMX, { format: "zemax" }).source).sort(), [
    "encoding",
    "format",
    "upstreamRevision",
  ]);
  expectError(() => mustParseText(ZMX, { format: "codev" as Format }), "invalid_options");
  expectError(() => mustParseText(ZMX, undefined as never), "invalid_options");
  expectError(() => mustParseBytes(new Uint8Array([0x81, 0xff]), { format: "oslo" }), "decoding_failed");
});

test("JSON round trip tags and restores infinities", () => {
  const data = mustParseText(ZMX, { format: "zemax", includeRaw: true });
  const json = stringify(data);
  assert.ok(json.endsWith("}\n"));
  assert.deepEqual(JSON.parse(json).surfaces[0].radius, { special: "positiveInfinity" });
  assert.equal(JSON.parse(json).raw.surfaces[0].thickness.special, "positiveInfinity");
  assert.ok(validate(JSON.parse(json)), JSON.stringify(validate.errors));
  assert.deepEqual(mustParseJson(json), data);
  assert.equal(mustParseJson(json).surfaces[0]?.radius, Infinity);

  assert.deepEqual(tagSpecialNumbers({ x: -Infinity }), { x: { special: "negativeInfinity" } });
  assert.throws(() => tagSpecialNumbers({ x: NaN }));
  expectError(() => mustParseJson("{nope"), "invalid_json");
  expectError(() => mustParseJson('{"schemaVersion":"0.0"}'), "invalid_json");
  expectError(() => mustParseJson("null"), "invalid_json");
});

test("UTF-8 BOM and UTF-16 LE/BE including no BOM", () => {
  const expected = mustParseText(ZMX, { format: "zemax" });
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
    const data = mustParseBytes(bytes, { format: "zemax" });
    assert.equal(data.source.encoding, encoding);
    assert.deepEqual({ ...data, source: expected.source }, expected);
  }
});

test("true Latin-1 differs from Windows-1252", () => {
  const source = ZMX.replace("simple", "café\u0080");
  const latin = Uint8Array.from([...source].map((c) => c.charCodeAt(0)));
  assert.equal(mustParseBytes(latin, { format: "zemax" }).name, "café\u0080");
  const cp = Uint8Array.from([...LEN.replace("simple", "smart \u0093quotes\u0094")].map((c) => c.charCodeAt(0)));
  const oslo = mustParseBytes(cp, { format: "oslo" });
  assert.equal(oslo.name, "smart “quotes”");
  assert.equal(oslo.source.encoding, "cp1252");
});

test("ArrayBuffer input and repeated calls are deterministic", () => {
  const buffer = new TextEncoder().encode(ZMX).buffer;
  assert.deepEqual(mustParseBytes(buffer, { format: "zemax" }), mustParseBytes(buffer, { format: "zemax" }));
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
      () => mustParseText(ZMX.replace("STOP", insertion + "\nSTOP"), { format: "zemax" }),
      "invalid_prescription",
    );
  }
  for (const replacement of ["ENPD Infinity", "ENPD -2"]) {
    expectError(() => mustParseText(ZMX.replace("ENPD 4", replacement), { format: "zemax" }), "invalid_prescription");
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
  const data = mustParseText(LEN + "BOGUS 2\n", { format: "oslo" });
  assert.ok(data.diagnostics.some((d) => d.command === "BOGUS"));
  expectError(() => mustParseText(LEN + "BOGUS 2\n", { format: "oslo", strict: true }), "strict_violation");
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

// ---------------------------------------------------------------------------------------------
// Surface properties a consumer needs to build optics from the surface list. The inputs are the
// synthetic prescriptions in test/fixtures/adoption.

function adoption(filename: string, options: Partial<Parameters<typeof parseBytes>[1]> = {}) {
  const format: Format = filename.endsWith(".len") ? "oslo" : "zemax";
  return parseBytes(readFileSync(root + "test/fixtures/adoption/" + filename), { format, ...options });
}
const adopted = (filename: string) => {
  const data = must(adoption(filename));
  assert.ok(validate(serialized(data)), JSON.stringify(validate.errors));
  return data;
};
/** The optical content of a prescription, without source lines or diagnostics. */
const geometry = (data: NormalizedPrescription) => ({
  name: data.name,
  wavelengths: data.wavelengths,
  aperture: data.aperture,
  surfaces: data.surfaces.map(({ line, ...surface }) => surface),
});

test("mechanical semi-diameter is separate from the clear semi-diameter and in millimeters", () => {
  const sizes = (filename: string) =>
    adopted(filename).surfaces.map((surface) => [surface.semiDiameter, surface.mechanicalSemiDiameter]);
  assert.deepEqual(sizes("mechanical-diameter-mm.zmx"), [
    [null, null],
    [5, 6],
    [5, 6],
    [10, null],
  ]);
  assert.deepEqual(sizes("mechanical-diameter-cm.zmx")[1], [50, 60]);
  assert.ok(adopted("mechanical-diameter-mm.zmx").diagnostics.every((d) => d.command !== "MEMA"));
  for (const value of ["6junk", "Infinity", "-1", ""]) {
    const error = expectError(
      () => mustParseText(ZMX.replace("STOP", `MEMA ${value}\nSTOP`), { format: "zemax" }),
      "invalid_prescription",
    );
    assert.deepEqual([error.line, error.command], [12, "MEMA"]);
  }
});

test("notes, designer, surface comments and coatings are typed and unquoted", () => {
  const zemax = adopted("metadata.zmx");
  assert.equal(zemax.name, "Parser adoption singlet");
  assert.deepEqual(zemax.notes, ["First design note", "Second design note"]);
  assert.equal(zemax.designer, null);
  assert.deepEqual(
    zemax.surfaces.map((surface) => [surface.comment, surface.coating]),
    [
      [null, null],
      ["Front lens surface", "AR_TEST"],
      [null, null],
      [null, null],
    ],
  );
  assert.ok(zemax.diagnostics.every((d) => !["NOTE", "COMM", "COAT", "NAME"].includes(d.command ?? "")));

  const oslo = adopted("metadata.len");
  assert.equal(oslo.designer, "OSLO design description");
  assert.deepEqual(oslo.notes, ["First design note"]);
  assert.equal(oslo.surfaces[1]?.comment, "Front lens surface");
  assert.equal(oslo.surfaces[1]?.coating, null);

  // Only an enclosing pair of quotes is a delimiter; inner quotes and spacing are content.
  const quoted = mustParseText(
    ZMX.replace("NAME simple", 'NAME "f = 2"  lens"\nNOTE 0 "say "hi""\nNOTE 0\nNOTE 4 plain  text').replace(
      "STOP",
      'COMM a "b" c\nSTOP',
    ),
    { format: "zemax" },
  );
  assert.equal(quoted.name, 'f = 2"  lens');
  assert.deepEqual(quoted.notes, ['say "hi"', "plain  text"]);
  assert.equal(quoted.surfaces[1]?.comment, 'a "b" c');
});

test("OSLO SEF is not a surface delimiter", () => {
  // SEF is not an OSLO record: OSLO writes NXT. It stays an unknown record and the count fails.
  const [value, error] = adoption("sef-singlet.len");
  assert.equal(value, null);
  assert.deepEqual([error?.code, error?.message], ["invalid_prescription", "surface records do not match LEN count"]);
});

test("OSLO asphere coefficients follow the program reference and unresolved ones are reported", () => {
  const terms = (filename: string) => {
    const surface = adopted(filename).surfaces[2];
    return [surface?.type, surface && "asphereTerms" in surface ? surface.asphereTerms : null, surface?.unresolvedSag];
  };
  // AS3 is the standard asphere's AE: both multiply r^6.
  const sixth = [{ power: 6, coefficient: -2e-8, native: "AS3" }];
  assert.deepEqual(terms("asphere-implicit.len"), ["evenAsphere", sixth, []]);
  assert.deepEqual(terms("asphere-explicit-asr.len"), ["evenAsphere", sixth, []]);
  assert.deepEqual(terms("asphere-explicit-ara.len"), [
    "oddAsphere",
    [{ power: 3, coefficient: -2e-8, native: "AS3" }],
    [],
  ]);

  const surface = (declarations: string) =>
    mustParseText(LEN.replace("RD 20", `${declarations}; RD 20`), { format: "oslo" }).surfaces[1];
  // AD..AG and AS2..AS5 are one set of coefficients: the later declaration replaces the earlier.
  assert.deepEqual(surfaceOfType(surface("AD 1e-5; AS2 2e-5; AS3 3e-7; AE 4e-7"), "evenAsphere").asphereTerms, [
    { power: 4, coefficient: 2e-5, native: "AS2" },
    { power: 6, coefficient: 4e-7, native: "AE" },
  ]);
  assert.deepEqual(surfaceOfType(surface("ASP ASR; AS0 1e-3; AD 1e-5; AS7 1e-12"), "evenAsphere").asphereTerms, [
    { power: 0, coefficient: 1e-3, native: "AS0" },
    { power: 4, coefficient: 1e-5, native: "AD" },
    { power: 14, coefficient: 1e-12, native: "AS7" },
  ]);

  // A standard asphere has no coefficient beyond r^10, so AS7 has no known meaning there.
  const partial = mustParseText(LEN.replace("RD 20", "AS7 1e-12; AS6 0; RD 20"), { format: "oslo" });
  assert.equal(partial.surfaces[1]?.type, "standard");
  assert.deepEqual(partial.surfaces[1]?.unresolvedSag, ["AS7"]);
  assert.deepEqual(
    partial.diagnostics.filter((d) => d.code === "unresolved_geometry").map((d) => [d.severity, d.surface]),
    [["warning", 1]],
  );
  assert.deepEqual(surface("ASP ARA; AD 1e-5; AS1 0.1")?.unresolvedSag, ["AD"]);
  assert.deepEqual(surface("ASP ASX; AS4 1e-3")?.unresolvedSag, ["AS4"]);
  assert.deepEqual(surface("CC -1")?.unresolvedSag, []);
});

test("Zemax SURF indices must count up from zero", () => {
  adopted("control.zmx");
  const failure = (filename: string) => {
    const [value, error] = adoption(filename);
    assert.equal(value, null);
    return [error?.code, error?.line, error?.command, error?.message];
  };
  assert.deepEqual(failure("surface-index-junk.zmx"), [
    "invalid_prescription",
    12,
    "SURF",
    "line 12: SURF: Invalid integer: 1junk",
  ]);
  assert.deepEqual(failure("surface-index-duplicate.zmx"), [
    "invalid_prescription",
    18,
    "SURF",
    "line 18: SURF: index 1 is out of sequence; expected 2",
  ]);
  assert.deepEqual(failure("surface-index-gap.zmx").slice(0, 3), ["invalid_prescription", 18, "SURF"]);
  for (const replacement of ["SURF", "SURF -1", "SURF 1", "SURF 0 0", "SURF 1e0"]) {
    expectError(() => mustParseText(ZMX.replace("SURF 0", replacement), { format: "zemax" }), "invalid_prescription");
  }
});

test("declarations say what the file states, so a consumer can require it", () => {
  const explicit = {
    units: "explicit",
    wavelengths: "explicit",
    wavelengthWeights: "explicit",
    primaryWavelength: "inferred",
    aperture: "explicit",
    fields: "defaulted",
    terminator: "explicit",
  };
  assert.deepEqual(adopted("control.len").declarations, explicit);
  assert.deepEqual(adopted("missing-end.len").declarations, { ...explicit, terminator: "absent" });
  assert.deepEqual(adopted("missing-wavelengths.len").declarations, {
    ...explicit,
    wavelengths: "defaulted",
    wavelengthWeights: "defaulted",
  });
  assert.deepEqual(adopted("partial-weights.len").declarations, { ...explicit, wavelengthWeights: "padded" });
  assert.deepEqual(adopted("partial-weights.len").wavelengths.weights, [1, 1]);
  assert.deepEqual(adopted("control.zmx").declarations, {
    ...explicit,
    primaryWavelength: "explicit",
    terminator: "notApplicable",
  });
  assert.equal(adopted("missing-units.zmx").declarations.units, "defaulted");
  assert.equal(adopted("field-order-duplicates.zmx").declarations.fields, "explicit");
  const partial = mustParseText(ZMX.replace("PWAV 1", "WAVM 2 0.6"), { format: "zemax" }).declarations;
  assert.deepEqual([partial.wavelengthWeights, partial.primaryWavelength], ["padded", "defaulted"]);
  assert.equal(mustParseText(LEN.replace("EBR 2\n", ""), { format: "oslo" }).declarations.aperture, "absent");

  // Each default is also an info diagnostic, so strict parsing is unaffected by it.
  const cases: [string, string, keyof NormalizedPrescription["declarations"]][] = [
    ["missing-end.len", "missing_end", "terminator"],
    ["missing-wavelengths.len", "default_wavelengths", "wavelengths"],
    ["partial-weights.len", "padded_wavelength_weights", "wavelengthWeights"],
    ["missing-units.zmx", "assumed_units", "units"],
  ];
  for (const [filename, code, declaration] of cases) {
    const data = adopted(filename);
    assert.equal(data.diagnostics.find((d) => d.code === code)?.severity, "info", filename);
    assert.notEqual(data.declarations[declaration], "explicit", filename);
    assert.ok(must(adoption(filename, { strict: false })), filename);
  }
  must(parseText(LEN.replace("EBR 2", "EBR 2; UNI 1"), { format: "oslo", strict: true }));
});

test("Zemax fields keep declared order and repeated coordinates", () => {
  const { fields } = adopted("field-order-duplicates.zmx");
  assert.deepEqual(
    fields.points.map((point) => [point.x, point.y, point.weight, point.vignetting.decenterX]),
    [
      [0, 5, 2, 0],
      [0, 0, 1, 0],
      [0, -5, 3, 0],
      [0, 5, 7, 0.1],
    ],
  );
});

test("coordinate declarations are typed, in millimeters and degrees", () => {
  const none = {
    decenterX: 0,
    decenterY: 0,
    decenterZ: 0,
    tiltX: 0,
    tiltY: 0,
    tiltZ: 0,
    order: "decenterThenTilt",
    bend: false,
    returnTo: null,
    returnBase: false,
    globalReference: null,
    tiltOffsetX: 0,
    tiltOffsetY: 0,
    tiltOffsetZ: 0,
  };
  const zemax = adopted("fold-coordinates.zmx");
  assert.deepEqual(
    zemax.surfaces.map((surface) => surface.coordinates),
    [null, null, { ...none, tiltX: -45, order: "tiltThenDecenter" }, null, { ...none, tiltX: -45 }, null],
  );
  // The file is in centimeters: normalized lengths are scaled, `parameters` are as written.
  assert.deepEqual([zemax.surfaces[4]?.thickness, zemax.surfaces[4]?.parameters.thickness], [-20, -2]);
  const decentered = mustParseText(
    ZMX.replace("UNIT MM", "UNIT CM").replace("STOP", "TYPE COORDBRK\nPARM 1 0.5\nPARM 2 -1\nPARM 5 30"),
    { format: "zemax" },
  );
  assert.deepEqual(decentered.surfaces[1]?.coordinates, { ...none, decenterX: 5, decenterY: -10, tiltZ: 30 });

  const oslo = adopted("fold-coordinates.len");
  assert.deepEqual(
    oslo.surfaces.map((surface) => surface.coordinates),
    [null, { ...none, tiltX: 45, bend: true, returnBase: true }, null],
  );
  assert.equal(oslo.surfaces[1]?.material.kind, "mirror");
  assert.ok(oslo.diagnostics.every((d) => d.command !== "BCR"));
  assert.deepEqual(
    oslo.diagnostics.filter((d) => d.code === "unresolved_coordinates").map((d) => d.surface),
    [1],
  );
  const full = mustParseText(
    LEN.replace("EBR 2", "EBR 2; UNI 10").replace("RD 20", "DCX 1; DCZ 2; TLB 3; DT -1; TOY 4; RCO 1; GC 0; RD 20"),
    { format: "oslo" },
  );
  assert.deepEqual(full.surfaces[1]?.coordinates, {
    ...none,
    decenterX: 10,
    decenterZ: 20,
    tiltY: 3,
    order: "tiltThenDecenter",
    returnTo: 1,
    globalReference: 0,
    tiltOffsetY: 40,
  });
  assert.equal(
    mustParseText(LEN.replace("RD 20", "TLA 5; TDD; RD 20"), { format: "oslo" }).surfaces[1]?.coordinates,
    null,
  );
});

test("pickups and solves are typed declarations and a picked-up glass is not reported as air", () => {
  const data = adopted("pickups-and-focus.len");
  const aperturePickup = (line: number) => ({
    property: "aperture",
    native: "AP",
    negated: false,
    reference: -1,
    arguments: [],
    line,
  });
  assert.deepEqual(
    data.surfaces.map((surface) => surface.pickups),
    [
      [],
      [],
      [aperturePickup(16)],
      [{ property: "material", native: "GLA", negated: false, reference: -2, arguments: [], line: 19 }],
      [aperturePickup(26)],
      [],
    ],
  );
  assert.deepEqual(data.surfaces[3]?.material, { kind: "pickup", reference: -2 });
  assert.deepEqual(
    data.surfaces.map((surface) => surface.semiDiameter),
    [null, 5, null, 5, null, 10],
  );
  assert.deepEqual(data.surfaces[4]?.solves, [
    { kind: "axialRayHeight", native: "PY", target: "thickness", value: 0, line: 28 },
  ]);
  assert.deepEqual(
    data.diagnostics.filter((d) => d.code === "unresolved_constraints").map((d) => d.surface),
    [2, 3, 4],
  );

  const surface = (declarations: string, units = "") =>
    mustParseText(LEN.replace("EBR 2", "EBR 2" + units).replace("TH 20", "TH 20; " + declarations), { format: "oslo" })
      .surfaces[2];
  assert.deepEqual(surface("PK CVM 1 0.01; PK LN 0 1 2.5")?.pickups, [
    { property: "curvature", native: "CVM", negated: true, reference: 1, arguments: [0.01], line: 7 },
    { property: "thickness", native: "LN", negated: false, reference: 0, arguments: [1, 2.5], line: 7 },
  ]);
  // A saved glass stays the reported medium; the pickup that controls it is still listed.
  const saved = surface("GLA BK7; PK GLA 1");
  assert.equal(saved?.material.kind, "catalog");
  assert.equal(saved?.pickups[0]?.property, "material");
  // A later direct value replaces the pickup or solve of the same property.
  assert.deepEqual(surface("PK TH 1; PY 0; TH 20")?.pickups, []);
  assert.deepEqual(surface("PK TH 1; PY 0; TH 20")?.solves, []);
  // Heights are lengths and are scaled; slopes are not. PYC replaces EC: both set the thickness.
  assert.deepEqual(surface("PU -0.1; EC 0.5; PYC 2", "; UNI 10")?.solves, [
    { kind: "chiefRayHeight", native: "PYC", target: "thickness", value: 20, line: 7 },
    { kind: "axialRayAngle", native: "PU", target: "curvature", value: -0.1, line: 7 },
  ]);
  expectError(() => mustParseText(LEN.replace("RD -20", "PK CV 1 x"), { format: "oslo" }), "invalid_prescription");
});

test("inert OSLO footer records are told apart from records that may be optical", () => {
  const control = adopted("control.len");
  const footer = adopted("display-footer.len");
  assert.deepEqual(geometry(footer), geometry(control));
  assert.deepEqual(footer.fields, control.fields);
  assert.deepEqual(
    footer.diagnostics.map((d) => [d.severity, d.code, d.command ?? null, d.line ?? null]),
    [
      ["info", "inert_record", "DLRS", 22],
      ["info", "inert_record", "DLNR", 23],
      ["info", "inert_record", "SDAD", 24],
      ["info", "inert_record", "OPDF", 25],
      ["info", "inert_record", "R", 27],
      ["info", "inert_record", "O", 30],
      ["warning", "unresolved_material", null, null],
    ],
  );
  // Field tables and configurations after END are still read, and unknown records still warn.
  const mixed = mustParseText(
    LEN + "DLRS 3\nRST NEW\nR 1 0 0 0.5\nF 1 0.7 0 0 0 0 -1 1 -1 1 1\nEND\nBOGUS 1\nCFG NEW\nTH 1 2 8\nEND\n",
    { format: "oslo", includeRaw: true },
  );
  assert.deepEqual(
    mixed.fields.relativePoints.map((point) => point.y),
    [0.7],
  );
  assert.deepEqual((mixed.raw as any).configurations[2].thicknesses, { 1: 8 });
  assert.deepEqual(
    mixed.diagnostics.filter((d) => d.command).map((d) => [d.code, d.command]),
    [
      ["inert_record", "DLRS"],
      ["inert_record", "R"],
      ["uninterpreted_record", "BOGUS"],
    ],
  );
});

test("surfaces report the line that opens them", () => {
  assert.deepEqual(
    adopted("control.zmx").surfaces.map((surface) => surface.line),
    [9, 12, 18, 23],
  );
  assert.deepEqual(
    adopted("control.len").surfaces.map((surface) => surface.line),
    [1, 8, 13, 18],
  );
});

// Issue #12. What the OSLO Program Reference settles: `wv`/`ww` set the lists and `wvi`/`wwi` one
// slot (Chapter 3 and the command summary), each wavelength has one weight ("Wavelength"), and
// arguments are separated by blanks or commas ("Command Syntax"). These inputs are synthetic, not
// OSLO exports.
const spectrum = (records: string, options: { strict?: boolean; includeRaw?: boolean } = {}) =>
  parseText(LEN.replace("WV 0.55\n", records + "\n"), { format: "oslo", ...options });
const TWO = "WV 0.5876 0.6328\n";

test("OSLO weights are only accepted for wavelengths that are defined", () => {
  const valid: [string, number[], string][] = [
    [TWO + "WW 1 0.5", [1, 0.5], "explicit"],
    [TWO + "WW 1,0.5", [1, 0.5], "explicit"],
    [TWO + "WW 1 , 0.5", [1, 0.5], "explicit"],
    [TWO + "WW 1\nWW2 0.5", [1, 0.5], "explicit"],
    [TWO + "WW 1 0.25\nWW 1 0.5", [1, 0.5], "explicit"],
    [TWO + "WW 1", [1, 1], "padded"],
    // Only the second weight is declared; the first is not passed off as explicit.
    [TWO + "WW2 0.5", [1, 0.5], "padded"],
    [TWO + "WV3 0.7\nWW 1 0.5 0.25", [1, 0.5, 0.25], "explicit"],
    // Without WV the three default wavelengths are defined.
    ["WW 1 0.5 0.25", [1, 0.5, 0.25], "explicit"],
    ["WW 1 0.5\n" + TWO.trim(), [1, 0.5], "explicit"],
  ];
  for (const [records, weights, declaration] of valid) {
    const data = must(spectrum(records));
    assert.deepEqual(data.wavelengths.weights, weights, records);
    assert.equal(data.declarations.wavelengthWeights, declaration, records);
    assert.equal(data.wavelengths.values.length, weights.length, records);
    assert.ok(!data.diagnostics.some((d) => d.code === "dropped_wavelength_weights"), records);
    assert.equal(
      data.diagnostics.some((d) => d.code === "padded_wavelength_weights"),
      declaration === "padded",
      records,
    );
    assert.ok(validate(serialized(data)), JSON.stringify(validate.errors));
  }

  const invalid: [string, number, string][] = [
    [TWO + "WW 1 0.5 0.25", 5, "WW"],
    // A later, well-formed vector does not make the earlier one legal.
    [TWO + "WW 1 0.5 0.25\nWW 1 0.5", 5, "WW"],
    [TWO + "WW3 0.25", 5, "WW3"],
    ["WW 1 1 1 1", 4, "WW"],
    [TWO + "WV4 0.7", 5, "WV4"],
  ];
  for (const [records, line, command] of invalid) {
    for (const strict of [false, true]) {
      const [value, error] = spectrum(records, { strict });
      assert.equal(value, null, records);
      assert.equal(error?.code, "invalid_prescription", records);
      assert.deepEqual([error?.line, error?.command], [line, command], records);
    }
  }
});

test("OSLO weights dropped by a shorter wavelength list are reported without raw", () => {
  const data = must(spectrum("WW 1 0.5 0.25\n" + TWO.trim(), { includeRaw: false }));
  assert.deepEqual(data.wavelengths, { values: [0.5876, 0.6328], weights: [1, 0.5], primaryIndex: 0 });
  assert.equal(data.declarations.wavelengthWeights, "explicit");
  const dropped = data.diagnostics.filter((d) => d.code === "dropped_wavelength_weights");
  assert.deepEqual(
    dropped.map((d) => [d.severity, d.command, d.line, d.surface]),
    [["info", "WV", 5, undefined]],
  );
  assert.ok(validate(serialized(data)), JSON.stringify(validate.errors));
  // Replacing wavelengths whose weights were never declared loses nothing.
  assert.ok(!must(spectrum("WW 1\n" + TWO.trim())).diagnostics.some((d) => d.code === "dropped_wavelength_weights"));
});

test("OSLO commas separate arguments only", () => {
  for (const records of [TWO + "WW,1,0.5", TWO + "WW,1,0.5,0.25", TWO + "WW 1,,0.5", TWO + "WW 1 0.5,", "WV,0.55"]) {
    const error = expectError(() => must(spectrum(records)), "invalid_prescription");
    assert.match(error.message, /comma/, records);
    assert.equal(error.command?.slice(0, 1), "W", records);
  }
  expectError(() => mustParseText(LEN.replace("RD 20", "RD,20"), { format: "oslo" }), "invalid_prescription");
  expectError(() => mustParseText(LEN + "CFWT,1,2\n", { format: "oslo" }), "invalid_prescription");
  // Records that are retained rather than read keep whatever punctuation they have.
  const retained = mustParseText(LEN.replace("RD 20", "BOGUS,1; DRW,ON; RD 20") + "SDAD,32\n", { format: "oslo" });
  assert.equal(retained.surfaces[1]?.radius, 20);
});

test("OSLO free text keeps its commas and spacing", () => {
  const source = LEN.replace("EBR 2", 'EBR 2; SNO1 first, second  third\nDES "Smith, J"').replace(
    "RD 20",
    "NOT front, coated; RD 20",
  );
  const data = mustParseText(source, { format: "oslo" });
  assert.deepEqual(data.notes, ["first, second  third"]);
  assert.equal(data.designer, "Smith, J");
  assert.equal(data.surfaces[1]?.comment, "front, coated");
});

test("OSLO PUK keeps its sign and TELE ON is reported", () => {
  const slope = mustParseText(LEN.replace("EBR 2", "PUK -0.1"), { format: "oslo" }).aperture;
  assert.deepEqual(slope, { kind: "imageSlope", value: 0.1, source: { PUK: -0.1 } });

  const telecentric = mustParseText(LEN.replace("EBR 2", "EBR 2; TELE ON"), { format: "oslo" });
  assert.equal(telecentric.diagnostics.find((d) => d.code === "telecentric_declaration")?.severity, "warning");
  assert.ok(validate(serialized(telecentric)), JSON.stringify(validate.errors));
  const off = mustParseText(LEN.replace("EBR 2", "EBR 2; TELE ON; TELE OFF"), { format: "oslo", strict: true });
  assert.ok(!off.diagnostics.some((d) => d.code === "telecentric_declaration"));
});

test("Zemax records that used to be dropped silently are errors or diagnostics", () => {
  const zemax = (text: string, strict = false) => parseText(text, { format: "zemax", strict });
  const invalid: [string, string, number, string][] = [
    ["surface data before SURF", ZMX.replace("SURF 0", "CURV 0.1\nSURF 0"), 6, "CURV"],
    ["wavelength slot 0", ZMX.replace("PWAV 1", "WAVM 0 0.6 1\nPWAV 1"), 5, "WAVM"],
    ["non-integer FTYP flag", ZMX.replace("PWAV 1", "FTYP 0 0 one 1"), 5, "FTYP"],
    ["negative PARM", ZMX.replace("STOP", "PARM -1 2\nSTOP"), 12, "PARM"],
  ];
  for (const [name, text, line, command] of invalid) {
    const [value, error] = zemax(text);
    assert.equal(value, null, name);
    assert.equal(error?.code, "invalid_prescription", name);
    assert.deepEqual([error?.line, error?.command], [line, command], name);
  }
  // An older, shorter FTYP is still read, and PARM 0 is what Zemax writes on toroidal surfaces.
  assert.equal(must(zemax(ZMX.replace("PWAV 1", "FTYP 1 0"))).fields.kind, "objectHeight");
  assert.equal(must(zemax(ZMX.replace("STOP", "PARM 0 0\nSTOP"), true)).surfaces[1]?.parameters["param_-1"], 0);

  const reported: [string, string, string, string | undefined][] = [
    ["unmapped F-number mode", ZMX.replace("ENPD 4", "ENPD 4\nFNUM 2.8 7"), "uninterpreted_record", "FNUM"],
    ["unmapped object aperture mode", ZMX.replace("ENPD 4", "ENPD 4\nOBNA 0.1 7"), "uninterpreted_record", "OBNA"],
    ["unknown field type", ZMX.replace("PWAV 1", "FTYP 9 0 1 1"), "unresolved_field_type", undefined],
    ["fewer wavelengths than declared", ZMX.replace("PWAV 1", "FTYP 0 0 1 3"), "wavelength_count_mismatch", undefined],
  ];
  for (const [name, text, code, command] of reported) {
    const data = must(zemax(text));
    const diagnostic = data.diagnostics.find((d) => d.code === code && d.command === command);
    assert.equal(diagnostic?.severity, "warning", name);
    assert.ok(validate(serialized(data)), JSON.stringify(validate.errors));
    assert.equal(zemax(text, true)[1]?.code, "strict_violation", name);
  }
  // Slots beyond the declared count are inactive, as Zemax writes them: not a mismatch.
  must(zemax(ZMX.replace("PWAV 1", "FTYP 0 0 1 1\nWAVM 2 0.6 1\nPWAV 1"), true));
});

test("parseText and parseBytes agree on validation and diagnostics", () => {
  const cases: [Format, string][] = [
    ["oslo", LEN.replace("WV 0.55", TWO + "WW 1 0.5 0.25")],
    ["oslo", LEN.replace("WV 0.55", "WW 1 0.5 0.25\n" + TWO.trim())],
    ["oslo", LEN.replace("WV 0.55", TWO + "WW,1,0.5")],
    ["oslo", LEN.replace("EBR 2", "EBR 2; TELE ON")],
    ["zemax", ZMX.replace("SURF 0", "CURV 0.1\nSURF 0")],
    ["zemax", ZMX.replace("PWAV 1", "FTYP 9 0 1 3")],
  ];
  for (const [format, text] of cases) {
    for (const strict of [false, true]) {
      const [fromText, textError] = parseText(text, { format, strict });
      const [fromBytes, bytesError] = parseBytes(new TextEncoder().encode(text), { format, strict });
      const describe = (error: PrescriptionParseError | null) =>
        error && [error.code, error.message, error.line, error.command, error.diagnostics];
      assert.deepEqual(describe(bytesError), describe(textError), text);
      assert.deepEqual(fromBytes && { ...fromBytes, source: null }, fromText && { ...fromText, source: null }, text);
    }
  }
});
