import { DeclarationError, PrescriptionParseError } from "./errors.js";
import { toJsonObject } from "./json.js";
import type { NativeDiagnostic, OsloModel, OsloSolve, OsloSurface, ZemaxModel, ZemaxSurface } from "./models.js";
import { isNumberToken, parseNumber } from "./numbers.js";
import { DEFAULT_WAVELENGTHS, decodeText, tokenize } from "./oslo.js";
import type {
  AsphereTerm,
  ClearAperture,
  CoordinateDeclaration,
  Declarations,
  Diagnostic,
  DiagnosticCode,
  FieldKind,
  FieldPoint,
  Fields,
  Format,
  Material,
  NormalizedPrescription,
  NormalizedSurface,
  Pickup,
  Solve,
  SourceEncoding,
  SurfaceRole,
  SurfaceType,
  SystemAperture,
  Units,
  ValuedAperture,
  Vignetting,
  Wavelengths,
} from "./types.js";

const UPSTREAM_REVISION = "4e893f53aee1312f2d091680b93dd2279711e197";

export interface NormalizeContext {
  encoding: SourceEncoding;
  strict: boolean;
  includeRaw: boolean;
}

type SurfaceBase = Omit<NormalizedSurface, "type">;

// ---------------------------------------------------------------------------------------------
// Shared pieces

class DiagnosticLog {
  readonly items: Diagnostic[];

  constructor(native: readonly NativeDiagnostic[]) {
    this.items = native.map((entry) => ({
      severity: entry.severity ?? "warning",
      code: entry.code ?? (entry.severity === "info" ? "inert_record" : "uninterpreted_record"),
      message: entry.message,
      command: entry.command,
      line: entry.line,
      ...(entry.surface >= 0 ? { surface: entry.surface } : {}),
    }));
  }
  info(code: DiagnosticCode, message: string): void {
    this.items.push({ severity: "info", code, message });
  }
  warn(code: DiagnosticCode, message: string, surface?: number): void {
    this.items.push({ severity: "warning", code, message, ...(surface === undefined ? {} : { surface }) });
  }
}

const NO_VIGNETTING: Vignetting = { decenterX: 0, decenterY: 0, compressX: 0, compressY: 0, tangentAngle: 0 };
const HEIGHT_FIELDS: readonly FieldKind[] = [
  "objectHeight",
  "paraxialImageHeight",
  "realImageHeight",
  "gaussianImageHeight",
];

function checkScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new DeclarationError("Length scale must be a positive finite number");
}

/** The first declared aperture becomes the system aperture; the rest stay in `source`. */
function systemAperture(
  declarations: Readonly<Record<string, number | boolean>>,
  kinds: ReadonlyMap<string, ValuedAperture["kind"]>,
  scale: number,
  log: DiagnosticLog,
): SystemAperture {
  const entries = Object.entries(declarations);
  // A ray slope is signed; every other aperture is a size.
  const valid = ([key, value]: [string, number | boolean]) =>
    typeof value === "boolean" || (Number.isFinite(value) && (value >= 0 || kinds.get(key) === "imageSlope"));
  if (!entries.every(valid)) throw new DeclarationError("Aperture values must be finite and nonnegative");
  if (entries.length > 1) {
    log.warn("multiple_apertures", "Multiple aperture declarations retained; first is reported as the common aperture");
  }
  const source = toJsonObject(declarations);
  const first = entries[0];
  if (!first) return { kind: "unspecified", value: null, source };
  const [key, value] = first;
  const kind = kinds.get(key);
  if (typeof value === "boolean") return { kind: "floatingStop", value: null, source };
  if (kind === undefined) return { kind: "unspecified", value: null, source };
  if (kind === "entrancePupilDiameter") return { kind, value: value * scale, source };
  if (kind === "beamRadiusAtSurface1") return { kind, value: (value * scale) / 2, source };
  if (kind === "imageSlope") return { kind, value: Math.abs(value), source };
  return { kind, value, source };
}

function wavelengths(
  values: number[],
  weights: number[],
  primaryIndex: number | null,
  log: DiagnosticLog,
): Wavelengths {
  const valid =
    values.length === weights.length &&
    values.every((value) => Number.isFinite(value) && value > 0) &&
    weights.every((weight) => Number.isFinite(weight) && weight >= 0);
  if (!valid) throw new DeclarationError("Wavelength values/weights must align and be finite, positive/nonnegative");
  if (primaryIndex !== null && (!Number.isInteger(primaryIndex) || primaryIndex < 0 || primaryIndex >= values.length)) {
    throw new DeclarationError("Primary wavelength index is outside active wavelengths");
  }
  if (values.length && primaryIndex === null) {
    log.warn("missing_primary_wavelength", "Declared primary wavelength is not in the active slots");
  }
  return { values: [...values], weights: [...weights], primaryIndex };
}

/** Report every declaration the file left to a default, so none passes for a declared value. */
function noteDefaults(declarations: Declarations, log: DiagnosticLog): void {
  if (declarations.units === "defaulted") log.info("assumed_units", "No length unit record; assuming millimeters");
  if (declarations.wavelengths === "defaulted") {
    log.info("default_wavelengths", "No wavelengths declared; assuming the d, F and C lines");
  }
  if (declarations.wavelengthWeights === "padded") {
    log.info("padded_wavelength_weights", "Fewer weights than wavelengths; missing weights reported as 1");
  }
  if (declarations.terminator === "absent") log.info("missing_end", "Prescription stops without END");
}

function surfaceIndices(surfaces: Readonly<Record<number, unknown>>): number[] {
  return Object.keys(surfaces)
    .map(Number)
    .sort((a, b) => a - b);
}

function surfaceRole(type: SurfaceType, index: number, lastIndex: number): SurfaceRole {
  if (type === "coordinateBreak") return "coordinateBreak";
  if (index === 0) return "object";
  return index === lastIndex ? "image" : "surface";
}

/** Radius and thickness may be infinite; no other declared number may be. */
function checkFinite(surface: object, index: number, unbounded: readonly string[]): void {
  for (const [key, value] of Object.entries(surface)) {
    if (!unbounded.includes(key) && typeof value === "number" && !Number.isFinite(value)) {
      throw new DeclarationError(`Surface ${index} ${key} must be finite`);
    }
  }
}

function typedSurface(base: SurfaceBase, type: SurfaceType, terms: AsphereTerm[]): NormalizedSurface {
  if (type === "evenAsphere" || type === "oddAsphere") {
    return { ...base, type, asphereTerms: terms.sort((a, b) => a.power - b.power) };
  }
  return { ...base, type };
}

/** A sag coefficient for `r^power` in source length units, re-expressed for `r` in millimeters. */
function asphereTerm(power: number, coefficient: number, native: string, scale: number): AsphereTerm {
  return { power, coefficient: coefficient * scale ** (1 - power), native };
}

function noteCommonWarnings(type: SurfaceType, material: Material, index: number, log: DiagnosticLog): void {
  if (type === "unknown") {
    log.warn("unresolved_surface_type", "Surface type retained without a common geometry interpretation", index);
  }
  if (material.kind === "catalog" || material.kind === "model") {
    log.warn(
      "unresolved_material",
      "Material identity preserved; catalog lookup and dispersion fitting are not executed",
      index,
    );
  }
}

function finish(
  format: Format,
  context: NormalizeContext,
  log: DiagnosticLog,
  model: ZemaxModel | OsloModel,
  parts: Pick<
    NormalizedPrescription,
    "designer" | "notes" | "units" | "aperture" | "fields" | "wavelengths" | "surfaces"
  >,
): NormalizedPrescription {
  if (!parts.surfaces.length) throw new DeclarationError("No optical surfaces parsed");
  const warnings = log.items.filter((entry) => entry.severity === "warning");
  if (context.strict && warnings[0]) {
    throw new PrescriptionParseError(
      "strict_violation",
      `Strict import rejected ${warnings.length} warning(s); first: ${warnings[0].code}: ${warnings[0].message}`,
      { diagnostics: log.items },
    );
  }
  const prescription: NormalizedPrescription = {
    schemaVersion: "1.0",
    source: { format, encoding: context.encoding, upstreamRevision: UPSTREAM_REVISION },
    name: model.name,
    mode: "sequential",
    declarations: { ...model.declarations },
    ...parts,
    diagnostics: log.items,
  };
  if (context.includeRaw) prescription.raw = toJsonObject(model);
  return prescription;
}

// ---------------------------------------------------------------------------------------------
// Zemax

const ZEMAX_UNITS = { MM: 1, CM: 10, M: 1000, IN: 25.4, INCH: 25.4 } as const;
const isZemaxUnit = (unit: string): unit is keyof typeof ZEMAX_UNITS => Object.hasOwn(ZEMAX_UNITS, unit);

const ZEMAX_APERTURES = new Map<string, ValuedAperture["kind"]>([
  ["EPD", "entrancePupilDiameter"],
  ["imageFNO", "imageFNumber"],
  ["paraxialImageFNO", "paraxialImageFNumber"],
  ["objectNA", "objectNA"],
  ["object_cone_angle", "objectConeAngle"],
]);
const ZEMAX_FIELDS = new Map<string, FieldKind>([
  ["angle", "angle"],
  ["object_height", "objectHeight"],
  ["paraxial_image_height", "paraxialImageHeight"],
  ["real_image_height", "realImageHeight"],
  ["theodolite_angle", "theodoliteAngle"],
]);
/** Parser type name to normalized type and the type name as Zemax writes it. */
const ZEMAX_SURFACES = new Map<string, { type: SurfaceType; native: string }>([
  ["standard", { type: "standard", native: "STANDARD" }],
  ["even_asphere", { type: "evenAsphere", native: "EVENASPH" }],
  ["odd_asphere", { type: "oddAsphere", native: "ODDASPHE" }],
  ["toroidal", { type: "toroidal", native: "TOROIDAL" }],
  ["coordinate_break", { type: "coordinateBreak", native: "COORDBRK" }],
  ["paraxial", { type: "paraxial", native: "PARAXIAL" }],
  ["polynomial", { type: "polynomial", native: "POLYNOMIAL" }],
]);
const ZEMAX_VIGNETTING = [
  ["decenterX", "vignette_decenter_x"],
  ["decenterY", "vignette_decenter_y"],
  ["compressX", "vignette_compress_x"],
  ["compressY", "vignette_compress_y"],
  ["tangentAngle", "vignette_tangent_angle"],
] as const;

function zemaxFields(model: ZemaxModel, scale: number, log: DiagnosticLog): Fields {
  const source = model.fields;
  const kind = ZEMAX_FIELDS.get(source.type ?? "angle") ?? "unknown";
  if (kind === "unknown") {
    log.warn("unresolved_field_type", "Field type is not mapped; field coordinates are reported in file units");
  }
  for (const [key, column] of Object.entries(source)) {
    if (Array.isArray(column) && column.some((value) => !Number.isFinite(value))) {
      throw new DeclarationError(`Field ${key} must contain finite numbers`);
    }
  }
  if (source.weights?.some((weight) => weight < 0)) throw new DeclarationError("Field weights must be nonnegative");

  const xs = source.x ?? [];
  const ys = source.y ?? [];
  const extras = [source.weights, ...ZEMAX_VIGNETTING.map(([, column]) => source[column])];
  if (
    xs.length !== ys.length ||
    extras.some((column) => column !== undefined && column.length !== xs.length) ||
    (source.num_fields ?? xs.length) !== xs.length
  ) {
    log.warn("field_count_mismatch", "Declared and parsed field columns differ; raw columns retained");
  }
  const fieldScale = HEIGHT_FIELDS.includes(kind) ? scale : 1;
  const points: FieldPoint[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const vignetting = { ...NO_VIGNETTING };
    for (const [name, column] of ZEMAX_VIGNETTING) vignetting[name] = source[column]?.[i] ?? 0;
    points.push({
      x: (xs[i] ?? 0) * fieldScale,
      y: (ys[i] ?? 0) * fieldScale,
      weight: source.weights?.[i] ?? 1,
      vignetting,
    });
  }
  return { kind, specification: "pointList", points, relativePoints: [], source: toJsonObject(source) };
}

function zemaxMaterial(surface: ZemaxSurface): Material {
  const native = surface.material;
  if (native === "air") return { kind: "air" };
  if (native.kind === "mirror") return { kind: "mirror" };
  return { ...native, catalogs: [...native.catalogs] };
}

function zemaxClearAperture(surface: ZemaxSurface, scale: number): ClearAperture | null {
  const native = surface.aperture;
  if (!native) return null;
  const numbers = [native.r_min, native.r_max, native.offset_x, native.offset_y];
  if (numbers.some((value) => !Number.isFinite(value)) || !(0 <= native.r_min && native.r_min <= native.r_max)) {
    throw new DeclarationError("Clear aperture radii/offsets must be finite with 0 <= r_min <= r_max");
  }
  return {
    kind: "annulus",
    minRadius: native.r_min * scale,
    maxRadius: native.r_max * scale,
    offsetX: native.offset_x * scale,
    offsetY: native.offset_y * scale,
    checked: null,
    checkingEnabled: null,
  };
}

/** A coordinate break's `PARM 1`..`PARM 6`: decenter x, y; tilt x, y, z; order flag. */
function zemaxCoordinates(surface: ZemaxSurface, scale: number): CoordinateDeclaration {
  const parameter = (number: number) => surface[`param_${number - 1}`] ?? 0;
  return {
    decenterX: parameter(1) * scale,
    decenterY: parameter(2) * scale,
    decenterZ: 0,
    tiltX: parameter(3),
    tiltY: parameter(4),
    tiltZ: parameter(5),
    order: parameter(6) === 0 ? "decenterThenTilt" : "tiltThenDecenter",
    bend: false,
    returnTo: null,
    returnBase: false,
    globalReference: null,
    tiltOffsetX: 0,
    tiltOffsetY: 0,
    tiltOffsetZ: 0,
  };
}

/** `PARM n` multiplies r^(2n) on an even asphere and r^n on an odd one. */
function zemaxAsphereTerms(surface: ZemaxSurface, type: SurfaceType, scale: number): AsphereTerm[] {
  const terms: AsphereTerm[] = [];
  for (const [key, value] of Object.entries(surface)) {
    const match = /^param_(\d+)$/.exec(key);
    if (!match || typeof value !== "number") continue;
    const parameter = Number(match[1]) + 1;
    const power = type === "evenAsphere" ? 2 * parameter : parameter;
    terms.push(asphereTerm(power, value, `PARM ${parameter}`, scale));
  }
  return terms;
}

export function normalizeZemax(model: ZemaxModel, context: NormalizeContext): NormalizedPrescription {
  const log = new DiagnosticLog(model.diagnostics);
  if (!isZemaxUnit(model.units)) throw new DeclarationError(`Unsupported Zemax length unit: ${model.units}`);
  const scale = ZEMAX_UNITS[model.units];
  checkScale(scale);
  const units: Units = { length: "mm", wavelength: "um", angle: "deg", sourceLength: model.units, scaleToMm: scale };
  noteDefaults(model.declarations, log);

  const aperture = systemAperture({ ...model.aperture }, ZEMAX_APERTURES, scale, log);
  const fields = zemaxFields(model, scale, log);
  const declaredPrimary = model.wavelengths.primary_index;
  const primaryIndex = declaredPrimary !== undefined ? declaredPrimary : model.wavelengths.data.length ? 0 : null;
  const spectrum = wavelengths(model.wavelengths.data, model.wavelengths.weights, primaryIndex, log);
  if ((model.wavelengths.num_wavelengths ?? spectrum.values.length) !== spectrum.values.length) {
    log.warn("wavelength_count_mismatch", "Declared wavelength count differs from the wavelengths defined");
  }
  if (model.records.some((record) => record.text.startsWith("WAVL "))) {
    log.warn(
      "legacy_wavl",
      "WAVL follows upstream legacy token consumption; vector WAVL/WWGT is not fully interpreted",
    );
  }

  const indices = surfaceIndices(model.surfaces);
  const lastIndex = Math.max(0, ...indices);
  const surfaces: NormalizedSurface[] = [];
  for (const index of indices) {
    const native = model.surfaces[index];
    if (!native) continue;
    checkFinite(native, index, ["radius", "thickness"]);
    const known = ZEMAX_SURFACES.get(native.type);
    const type = known?.type ?? "unknown";
    const material = zemaxMaterial(native);
    noteCommonWarnings(type, material, index, log);
    if (type === "coordinateBreak") {
      log.warn("unresolved_coordinates", "Coordinate declarations retained; no global frame is calculated", index);
    }
    const { line, ...parameters } = native;
    const base: SurfaceBase = {
      index,
      line,
      role: surfaceRole(type, index, lastIndex),
      nativeType: known?.native ?? native.type.toUpperCase(),
      radius: (native.radius ?? Infinity) * scale,
      thickness: (native.thickness ?? 0) * scale,
      conic: native.conic,
      stop: native.is_stop,
      material,
      clearAperture: zemaxClearAperture(native, scale),
      semiDiameter: native.diameter === undefined ? null : native.diameter * scale,
      mechanicalSemiDiameter:
        native.mechanical_semi_diameter === undefined ? null : native.mechanical_semi_diameter * scale,
      comment: native.comment ?? null,
      coating: native.coating ?? null,
      coordinates: type === "coordinateBreak" ? zemaxCoordinates(native, scale) : null,
      pickups: [],
      solves: [],
      unresolvedSag: [],
      parameters: toJsonObject(parameters),
    };
    surfaces.push(typedSurface(base, type, zemaxAsphereTerms(native, type, scale)));
  }
  return finish("zemax", context, log, model, {
    designer: null,
    notes: [...model.notes],
    units,
    aperture,
    fields,
    wavelengths: spectrum,
    surfaces,
  });
}

// ---------------------------------------------------------------------------------------------
// OSLO

const OSLO_APERTURES = new Map<string, ValuedAperture["kind"]>([
  // OSLO stores the entrance beam radius; the parser doubles it into an EPD-style diameter.
  ["EPD", "beamRadiusAtSurface1"],
  ["FNO", "imageFNumber"],
  ["NAO", "objectNA"],
  ["NAP", "imageNA"],
  ["PUK", "imageSlope"],
]);
const OSLO_FIELDS = {
  angle: "angle",
  object_height: "objectHeight",
  gaussian_image_height: "gaussianImageHeight",
} as const;
const OSLO_ASPHERES = new Map<string, SurfaceType>([
  ["ADO", "standard"],
  ["ASR", "evenAsphere"],
  ["ARA", "oddAsphere"],
  ["ASX", "polynomial"],
]);
/** `AD`..`AG` are the standard asphere's names for general coefficients 2..5. */
const OSLO_STANDARD_SLOTS = new Map([
  ["AD", 2],
  ["AE", 3],
  ["AF", 4],
  ["AG", 5],
]);
const OSLO_COORDINATES = [
  "DCX",
  "DCY",
  "DCZ",
  "TLA",
  "TLB",
  "TLC",
  "GC",
  "RCO",
  "BEN",
  "BCR",
  "TOX",
  "TOY",
  "TOZ",
] as const;
const OSLO_PICKUPS = new Map<string, Pickup["property"]>([
  ["CV", "curvature"],
  ["CVM", "curvature"],
  ["TH", "thickness"],
  ["THM", "thickness"],
  ["LN", "thickness"],
  ["LNM", "thickness"],
  ["AP", "aperture"],
  ["GLA", "material"],
  ["TD", "coordinates"],
  ["TDM", "coordinates"],
]);
/** Each solve command, what it sets, and whether its target is a length. */
const OSLO_SOLVES: readonly [OsloSolve, Solve["kind"], Solve["target"], boolean][] = [
  ["PY", "axialRayHeight", "thickness", true],
  ["PYC", "chiefRayHeight", "thickness", true],
  ["EC", "edgeContact", "thickness", true],
  ["PU", "axialRayAngle", "curvature", false],
  ["PUC", "chiefRayAngle", "curvature", false],
];
const OSLO_CONSTRAINTS = ["pickups", "PY", "PYC", "PU", "PUC", "EC"];
const OSLO_FEATURES = ["PFL", "PFM", "GSP", "GOR", "TCE"];
/** OSLO writes "infinite" object and image distances as very large finite thicknesses. */
const OSLO_INFINITE_OBJECT = 1e8;
const OSLO_INFINITE_THICKNESS = 9.9e9;

function osloFields(model: OsloModel, scale: number, log: DiagnosticLog): Fields {
  const source = model.fields;
  const kind = OSLO_FIELDS[source.type ?? "angle"];
  if (source.y?.some((value) => !Number.isFinite(value)))
    throw new DeclarationError("Field y must contain finite numbers");
  if (source.points) {
    log.warn(
      "relative_field_table",
      "OSLO field-table coordinates are retained as relative prescription data; no optical conversion is executed",
    );
  }
  const fullField = (source.y?.[0] ?? 0) * (HEIGHT_FIELDS.includes(kind) ? scale : 1);
  const relativePoints = Object.entries(source.points ?? {})
    .map(([index, point]) => ({
      index: Number(index),
      x: point.x,
      y: point.y,
      weight: point.weight,
      vignetteX: point.vx,
      vignetteY: point.vy,
    }))
    .sort((a, b) => a.index - b.index);
  return {
    kind,
    specification: "fullField",
    points: [{ x: 0, y: fullField, weight: 1, vignetting: { ...NO_VIGNETTING } }],
    relativePoints,
    source: toJsonObject(source),
  };
}

/** Classify a surface's `AIR`/`RFL`/`GLA ...` declaration. */
function osloMaterial(surface: OsloSurface): Material {
  const pickup = surface.pickups?.find((entry) => entry.type === "GLA");
  // Without a saved glass there is nothing to report but the pickup itself.
  if (surface.material === undefined && pickup) return { kind: "pickup", reference: pickup.arguments[0] ?? 0 };
  const declaration = surface.material ?? "air";
  if (["AIR", "AIF"].includes(declaration.toUpperCase())) return { kind: "air" };
  if (["MIRROR", "RFL", "RFH"].includes(declaration.toUpperCase())) return { kind: "mirror" };
  let parts = tokenize(declaration);
  if (parts[0] !== "GLA") return { kind: "unknown", raw: declaration };
  parts = parts.slice(1);
  const modeled = parts[0]?.toUpperCase() === "MOD";
  if (modeled) parts = parts.slice(1);
  let name: string | null = null;
  if (parts[0] !== undefined && !isNumberToken(parts[0])) {
    name = decodeText(parts[0]);
    parts = parts.slice(1);
  }
  if (!parts.length) {
    if (modeled || !name) throw new DeclarationError("GLA requires a catalog name or refractive-index data");
    return { kind: "catalog", name, catalogs: [], nd: null, vd: null, resolution: "unresolved" };
  }
  const indices = parts.map((token) => parseNumber(token));
  if (indices.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new DeclarationError("GLA indices must be positive finite numbers");
  }
  const [first, second] = indices;
  if (modeled && indices.length === 2 && first !== undefined && second !== undefined) {
    return { kind: "model", name, nd: first, vd: second, dispersion: "unspecified", resolution: "unresolved" };
  }
  if (first !== undefined && new Set(indices).size === 1) return { kind: "constantIndex", name, index: first };
  const sampled = surface.glass_wavelengths ?? DEFAULT_WAVELENGTHS;
  if (indices.length !== sampled.length) throw new DeclarationError("OSLO glass index/wavelength counts differ");
  return { kind: "sampledIndex", name, wavelengths: [...sampled], indices };
}

function osloSurfaceType(surface: OsloSurface): SurfaceType {
  if (surface.PFL !== undefined) return "paraxial";
  if (surface.CVX !== undefined) return "toroidal";
  const mode = surface.ASP ?? "ADO";
  if (mode !== "ADO") return OSLO_ASPHERES.get(mode) ?? "unknown";
  const standard = [...OSLO_STANDARD_SLOTS].some(([key, slot]) => key in surface || `AS${slot}` in surface);
  return standard ? "evenAsphere" : "standard";
}

/**
 * Sort a surface's sag coefficients into normalized terms and the ones left uninterpreted.
 *
 * Per the OSLO Program Reference, general coefficient `ASn` multiplies r^(2n) on a symmetric
 * general asphere (`ASP ASR`, eq. 3.9) and r^n on an all-orders asphere (`ASP ARA`, eq. 3.17), and
 * `AD`..`AG` are the same coefficients as `AS2`..`AS5`. A standard asphere (no `ASP`) is the 10th
 * order polynomial, so it has only those four: any other `ASn` on it is left unresolved, as is
 * every coefficient of a surface type with no normalized terms.
 */
function osloSag(surface: OsloSurface, type: SurfaceType, scale: number) {
  const mode = surface.ASP ?? "ADO";
  const terms: AsphereTerm[] = [];
  const unresolved: string[] = [];
  for (const [key, value] of Object.entries(surface)) {
    const named = OSLO_STANDARD_SLOTS.get(key);
    const general = /^AS(\d+)$/.exec(key);
    const slot = named ?? (general ? Number(general[1]) : undefined);
    if (slot === undefined || typeof value !== "number") continue;
    let power: number | null = null;
    if (type === "evenAsphere" && (mode === "ASR" || (slot >= 2 && slot <= 5))) power = 2 * slot;
    else if (type === "oddAsphere" && named === undefined) power = slot;
    if (power !== null) terms.push(asphereTerm(power, value, key, scale));
    // A zero coefficient contributes nothing whatever power it would multiply.
    else if (value !== 0) unresolved.push(key);
  }
  return { terms, unresolved };
}

function osloCoordinates(surface: OsloSurface, scale: number): CoordinateDeclaration | null {
  if (surface.DT === undefined && !OSLO_COORDINATES.some((key) => key in surface)) return null;
  return {
    decenterX: (surface.DCX ?? 0) * scale,
    decenterY: (surface.DCY ?? 0) * scale,
    decenterZ: (surface.DCZ ?? 0) * scale,
    tiltX: surface.TLA ?? 0,
    tiltY: surface.TLB ?? 0,
    tiltZ: surface.TLC ?? 0,
    order: surface.DT === -1 ? "tiltThenDecenter" : "decenterThenTilt",
    bend: surface.BEN ?? false,
    returnTo: surface.RCO ?? null,
    returnBase: surface.BCR ?? false,
    globalReference: surface.GC ?? null,
    tiltOffsetX: (surface.TOX ?? 0) * scale,
    tiltOffsetY: (surface.TOY ?? 0) * scale,
    tiltOffsetZ: (surface.TOZ ?? 0) * scale,
  };
}

function osloPickups(surface: OsloSurface): Pickup[] {
  return (surface.pickups ?? []).map((pickup) => ({
    property: OSLO_PICKUPS.get(pickup.type) ?? "curvature",
    native: pickup.type,
    negated: pickup.type.endsWith("M"),
    reference: pickup.arguments[0] ?? 0,
    arguments: pickup.arguments.slice(1),
    line: pickup.line,
  }));
}

function osloSolves(surface: OsloSurface, scale: number): Solve[] {
  const solves: Solve[] = [];
  for (const [native, kind, target, isLength] of OSLO_SOLVES) {
    const value = surface[native];
    if (value === undefined) continue;
    solves.push({
      kind,
      native,
      target,
      value: isLength ? value * scale : value,
      line: surface.solve_lines?.[native] ?? 0,
    });
  }
  return solves.sort((a, b) => a.line - b.line);
}

export function normalizeOslo(model: OsloModel, context: NormalizeContext): NormalizedPrescription {
  const log = new DiagnosticLog(model.diagnostics);
  const scale = model.units;
  checkScale(scale);
  const units: Units = { length: "mm", wavelength: "um", angle: "deg", sourceLength: "lensUnit", scaleToMm: scale };
  noteDefaults(model.declarations, log);

  const aperture = systemAperture({ ...model.aperture }, OSLO_APERTURES, scale, log);
  const fields = osloFields(model, scale, log);
  const spectrum = wavelengths(
    model.wavelengths.values,
    model.wavelengths.weights,
    model.wavelengths.primary_index,
    log,
  );

  const indices = surfaceIndices(model.surfaces);
  const lastIndex = Math.max(0, ...indices);
  const declaresStop = Object.values(model.surfaces).some((surface) => surface.AST);
  const surfaces: NormalizedSurface[] = [];
  for (const index of indices) {
    const native = model.surfaces[index];
    if (!native) continue;
    checkFinite(native, index, ["RD", "TH"]);
    const type = osloSurfaceType(native);
    let thickness = native.TH ?? 0;
    if (Math.abs(thickness) >= (index === 0 ? OSLO_INFINITE_OBJECT : OSLO_INFINITE_THICKNESS)) {
      thickness = thickness < 0 ? -Infinity : Infinity;
    }
    const material = osloMaterial(native);
    noteCommonWarnings(type, material, index, log);
    const declares = (keys: readonly string[]) => keys.some((key) => key in native);
    const sag = osloSag(native, type, scale);
    if (sag.unresolved.length) {
      log.warn(
        "unresolved_geometry",
        `Sag coefficients ${sag.unresolved.join(", ")} retained without a normalized term; the surface is not the shape radius, conic and asphereTerms describe`,
        index,
      );
    }
    if (declares(OSLO_COORDINATES)) {
      log.warn("unresolved_coordinates", "Coordinate declarations retained; no global frame is calculated", index);
    }
    if (declares(OSLO_CONSTRAINTS)) {
      log.warn(
        "unresolved_constraints",
        "Pickup/solve declarations retained; literal values are not a solved snapshot",
        index,
      );
    }
    if (declares(OSLO_FEATURES)) {
      log.warn(
        "unresolved_optical_feature",
        "Perfect-imagery, grating or thermal declarations retained without optical interpretation",
        index,
      );
    }
    if (index === lastIndex && thickness) {
      log.warn(
        "image_focus_declaration",
        "Image TH is OSLO defocus, retained as a declaration rather than applied to the preceding gap",
        index,
      );
    }
    const semiDiameter = native.AP === undefined ? null : native.AP * scale;
    const { line = 0, solve_lines: _lines, ...parameters } = native;
    const base: SurfaceBase = {
      index,
      line,
      role: surfaceRole(type, index, lastIndex),
      nativeType: native.ASP ?? "ADO",
      radius: (native.RD ?? Infinity) * scale,
      thickness: thickness * scale,
      conic: native.CC ?? 0,
      // Without an explicit AST, OSLO takes surface 1 as the stop.
      stop: native.AST ?? (!declaresStop && index === 1),
      material,
      clearAperture:
        semiDiameter === null
          ? null
          : {
              kind: "annulus",
              minRadius: 0,
              maxRadius: semiDiameter,
              offsetX: 0,
              offsetY: 0,
              checked: native.aperture_checked ?? false,
              checkingEnabled: model.settings.aperture_check ?? true,
            },
      semiDiameter,
      mechanicalSemiDiameter: null,
      comment: native.note ?? null,
      coating: null,
      coordinates: osloCoordinates(native, scale),
      pickups: osloPickups(native),
      solves: osloSolves(native, scale),
      unresolvedSag: sag.unresolved,
      parameters: toJsonObject(parameters),
    };
    surfaces.push(typedSurface(base, type, sag.terms));
  }
  if (model.settings.telecentric) {
    log.warn(
      "telecentric_declaration",
      "Telecentric entrance pupil mode is declared; it is not part of the system data",
    );
  }
  if (Object.keys(model.configurations).length > 1) {
    log.warn(
      "configuration_declarations",
      "Base prescription reported; alternative configuration overrides retained in raw.configurations",
    );
  }
  const { DES: designer = null, ...notes } = model.notes;
  return finish("oslo", context, log, model, {
    designer,
    notes: Object.values(notes),
    units,
    aperture,
    fields,
    wavelengths: spectrum,
    surfaces,
  });
}
