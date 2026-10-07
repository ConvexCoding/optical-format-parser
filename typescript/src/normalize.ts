import { number } from "./numbers.js";
import { decodeText, tokenize } from "./oslo.js";
import type { Diagnostic, Format, JsonValue, NativeRecord, NormalizedPrescription } from "./types.js";

const REVISION = "4e893f53aee1312f2d091680b93dd2279711e197";
const scales: Record<string, number> = { MM: 1, CM: 10, M: 1000, IN: 25.4, INCH: 25.4 };
export function jsonSafe(value: unknown, path = "$"): JsonValue {
  if (typeof value === "number") {
    if (Number.isNaN(value)) throw new Error(`${path}: NaN is not valid prescription data`);
    if (!Number.isFinite(value)) return { special: value > 0 ? "positiveInfinity" : "negativeInfinity" };
    return value;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v, i) => jsonSafe(v, `${path}[${i}]`));
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v, `${path}.${k}`)]));
  }
  throw new Error(`${path}: cannot serialize ${typeof value}`);
}

function material(raw: any, surface: NativeRecord, fmt: Format): NativeRecord {
  if (raw && typeof raw === "object") return { ...raw };
  if (!raw || ["AIR", "AIF"].includes(String(raw).toUpperCase())) return { kind: "air" };
  if (["MIRROR", "RFL", "RFH"].includes(String(raw).toUpperCase())) return { kind: "mirror" };
  if (fmt === "zemax") return { kind: "catalog", name: String(raw), resolution: "unresolved" };
  let parts = tokenize(String(raw));
  if (!parts.length || parts[0] !== "GLA") return { kind: "unknown", raw: String(raw) };
  parts = parts.slice(1);
  const modeled = parts.length > 0 && parts[0].toUpperCase() === "MOD";
  if (modeled) parts = parts.slice(1);
  let name: string | null = null;
  if (parts.length) {
    try { number(parts[0]); } catch { name = decodeText(parts[0]); parts = parts.slice(1); }
  }
  if (!parts.length) {
    if (modeled || !name) throw new Error("GLA requires a catalog name or refractive-index data");
    return { kind: "catalog", name, resolution: "unresolved" };
  }
  const indices = parts.map(number);
  if (indices.some(v => !Number.isFinite(v) || v <= 0)) throw new Error("GLA indices must be positive finite numbers");
  if (modeled && indices.length === 2) return { kind: "model", name, nd: indices[0], vd: indices[1], dispersion: "unspecified", resolution: "unresolved" };
  if (new Set(indices).size === 1) return { kind: "constantIndex", name, index: indices[0] };
  const wavelengths = surface.glass_wavelengths ?? [0.58756, 0.48613, 0.65627];
  if (indices.length !== wavelengths.length) throw new Error("OSLO glass index/wavelength counts differ");
  return { kind: "sampledIndex", name, wavelengthsUm: wavelengths, indices };
}

export function normalize(model: NativeRecord, fmt: Format, filename: string, encoding: string, strict: boolean): NormalizedPrescription {
  const diagnostics: Diagnostic[] = model.diagnostics.map((d: NativeRecord) => ({ severity: d.severity ?? "warning", code: "uninterpreted_record",
    command: d.command, line: d.line, surface: d.surface, message: d.message }));
  const warn = (code: string, message: string, location: Partial<Diagnostic> = {}) => { diagnostics.push({ severity: "warning", code, message, ...location }); };
  const sourceUnit = fmt === "zemax" ? model.units : "lensUnit";
  const scale = fmt === "zemax" ? scales[sourceUnit] : model.units;
  if (scale === undefined) throw new Error(`Unsupported Zemax length unit: ${sourceUnit}`);
  if (fmt === "zemax" && !model.records.some((r: NativeRecord) => r.text.startsWith("UNIT "))) diagnostics.push({ severity: "info", code: "assumed_units", message: "No UNIT record; assuming millimeters" });

  const apertureSource = model.aperture;
  const aperture: NativeRecord = { kind: "unspecified", value: null, source: apertureSource };
  const keys = Object.keys(apertureSource);
  if (keys.length) {
    const key = keys[0];
    if (fmt === "oslo" && key === "EPD") Object.assign(aperture, { kind: "beamRadiusAtSurface1", value: apertureSource[key] * scale / 2 });
    else Object.assign(aperture, { kind: ({ EPD: "entrancePupilDiameter", FNO: "imageFNumber", imageFNO: "imageFNumber", paraxialImageFNO: "paraxialImageFNumber", NAO: "objectNA", objectNA: "objectNA", NAP: "imageNA", PUK: "imageSlope", floating_stop: "floatingStop" } as Record<string, string>)[key] ?? key,
      value: typeof apertureSource[key] === "boolean" ? null : apertureSource[key] * (key === "EPD" ? scale : 1) });
  }
  if (keys.length > 1) warn("multiple_apertures", "Multiple aperture declarations retained; first is reported as the common aperture");

  const fieldsSource = model.fields, fieldKind = fieldsSource.type ?? "angle";
  const fieldScale = ["object_height", "paraxial_image_height", "real_image_height", "gaussian_image_height"].includes(fieldKind) ? scale : 1;
  const points: NativeRecord[] = [];
  if (fmt === "zemax") {
    const xs = fieldsSource.x ?? [], ys = fieldsSource.y ?? [];
    const extras = Object.fromEntries(["weights", "vignette_decenter_x", "vignette_decenter_y", "vignette_compress_x", "vignette_compress_y", "vignette_tangent_angle"].filter(k => k in fieldsSource).map(k => [k, fieldsSource[k]]));
    if (xs.length !== ys.length || Object.values(extras).some(v => v.length !== xs.length) || (fieldsSource.num_fields ?? xs.length) !== xs.length) warn("field_count_mismatch", "Declared and parsed field columns differ; raw columns retained");
    for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
      const point: NativeRecord = { x: xs[i] * fieldScale, y: ys[i] * fieldScale, weight: (fieldsSource.weights ?? Array(xs.length).fill(1))[i] };
      point.vignetting = Object.fromEntries(Object.entries(extras).filter(([key, values]) => key !== "weights" && i < values.length).map(([key, values]) => [key, values[i]]));
      points.push(point);
    }
  } else if ("points" in fieldsSource) warn("relative_field_table", "OSLO field-table coordinates are retained as relative prescription data; no optical conversion is executed");
  const fields = { kind: fieldKind, points, reference: fmt === "zemax" ? null : { y: (fieldsSource.y ?? [0])[0] * fieldScale, coordinates: "prescriptionExtent" }, source: fieldsSource };

  const waves = model.wavelengths, values: number[] = waves[fmt === "zemax" ? "data" : "values"] ?? [], weights: number[] = waves.weights ?? [];
  const primary = "primary_index" in waves ? waves.primary_index : values.length ? 0 : null;
  if (values.length !== weights.length || values.some(v => !Number.isFinite(v) || v <= 0) || weights.some(w => !Number.isFinite(w) || w < 0)) throw new Error("Wavelength values/weights must align and be finite, positive/nonnegative");
  if (primary !== null && (!Number.isInteger(primary) || primary < 0 || primary >= values.length)) throw new Error("Primary wavelength index is outside active wavelengths");
  if (values.length && primary === null) warn("missing_primary_wavelength", "Declared primary wavelength is not in the active slots");
  if (fmt === "zemax" && model.records.some((r: NativeRecord) => r.text.startsWith("WAVL "))) warn("legacy_wavl", "WAVL follows upstream legacy token consumption; vector WAVL/WWGT is not fully interpreted");

  const surfaces: NativeRecord[] = [];
  const indices = Object.keys(model.surfaces).map(Number).sort((a, b) => a - b), maxIndex = Math.max(0, ...indices);
  const hasStop = Object.values(model.surfaces).some((s: any) => s.AST ?? false);
  for (const index of indices) {
    const surface = model.surfaces[index], nativeType = surface.type ?? surface.ASP ?? "ADO";
    let kind = fmt === "zemax" ? nativeType : ({ ADO: "standard", ASR: "even_asphere", ARA: "odd_asphere", ASX: "polynomial" } as Record<string, string>)[nativeType] ?? "unknown";
    if (fmt === "oslo" && ["AD", "AE", "AF", "AG"].some(k => k in surface)) kind = "even_asphere";
    if (fmt === "oslo" && "CVX" in surface) kind = "toroidal";
    if (fmt === "oslo" && "PFL" in surface) kind = "paraxial";
    const radius = surface[fmt === "zemax" ? "radius" : "RD"] ?? Infinity;
    let thickness = surface[fmt === "zemax" ? "thickness" : "TH"] ?? 0;
    if (fmt === "oslo" && Math.abs(thickness) >= (index === 0 ? 1e8 : 9.9e9)) thickness = thickness < 0 ? -Infinity : Infinity;
    const mat = material(surface.material ?? "air", surface, fmt);
    if (["catalog", "model"].includes(mat.kind)) warn("unresolved_material", "Material identity preserved; catalog lookup and dispersion fitting are not executed", { surface: index });
    if (kind === "coordinate_break" || ["DCX", "DCY", "DCZ", "TLA", "TLB", "TLC", "GC", "RCO", "BEN", "TOX", "TOY", "TOZ"].some(k => k in surface)) warn("unresolved_coordinates", "Coordinate declarations retained; no global frame is calculated", { surface: index });
    if (["pickups", "PY", "PYC", "PU", "PUC", "EC"].some(k => k in surface)) warn("unresolved_constraints", "Pickup/solve declarations retained; literal values are not a solved snapshot", { surface: index });
    if (fmt === "oslo" && index === maxIndex && thickness) warn("image_focus_declaration", "Image TH is OSLO defocus, retained as a declaration rather than applied to the preceding gap", { surface: index });
    let clear = surface.aperture ?? null;
    if (clear !== null) clear = { ...clear, ...Object.fromEntries(["r_min", "r_max", "offset_x", "offset_y"].map(k => [k, clear[k] * scale])) };
    else if (fmt === "oslo" && "AP" in surface) clear = { kind: "annulus", r_min: 0, r_max: surface.AP * scale, offset_x: 0, offset_y: 0, checked: surface.aperture_checked ?? false, checkingEnabled: model.settings.aperture_check ?? true };
    surfaces.push({ index, role: kind === "coordinate_break" ? "coordinateBreak" : index === 0 ? "object" : index === maxIndex ? "image" : "surface",
      type: kind, radiusMm: radius * scale, thicknessMm: thickness * scale, conic: surface[fmt === "zemax" ? "conic" : "CC"] ?? 0,
      stop: fmt === "zemax" ? surface.is_stop ?? false : surface.AST ?? (!hasStop && index === 1), material: mat, clearAperture: clear, parameters: surface });
  }
  if (!surfaces.length) throw new Error("No optical surfaces parsed");
  if (fmt === "oslo" && Object.keys(model.configurations).length > 1) warn("configuration_declarations", "Base prescription reported; alternative configuration overrides retained in raw.configurations");
  if (strict && diagnostics.some(d => d.severity === "warning")) {
    const first = diagnostics.find(d => d.severity === "warning")!;
    throw new Error(`Strict import: ${first.code}: ${first.message}`);
  }
  return jsonSafe({ schemaVersion: "1.0", source: { format: fmt, filename, encoding, upstreamRevision: REVISION }, name: model.name, mode: "sequential",
    units: { length: "mm", wavelength: "um", angle: "deg", sourceLength: sourceUnit, scaleToMm: scale }, aperture, fields,
    wavelengths: { valuesUm: values, weights, primaryIndex: primary }, surfaces, diagnostics, raw: model }) as unknown as NormalizedPrescription;
}
