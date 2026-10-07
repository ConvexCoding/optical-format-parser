import { DeclarationError, PrescriptionParseError } from "./errors.js";
import { toJsonObject } from "./json.js";
import { isNumberToken, parseNumber } from "./numbers.js";
import { DEFAULT_WAVELENGTHS, decodeText, tokenize } from "./oslo.js";
const UPSTREAM_REVISION = "4e893f53aee1312f2d091680b93dd2279711e197";
// ---------------------------------------------------------------------------------------------
// Shared pieces
class DiagnosticLog {
    items;
    constructor(native) {
        this.items = native.map((entry) => ({
            severity: entry.severity ?? "warning",
            code: "uninterpreted_record",
            message: entry.message,
            command: entry.command,
            line: entry.line,
            ...(entry.surface >= 0 ? { surface: entry.surface } : {}),
        }));
    }
    info(code, message) {
        this.items.push({ severity: "info", code, message });
    }
    warn(code, message, surface) {
        this.items.push({ severity: "warning", code, message, ...(surface === undefined ? {} : { surface }) });
    }
}
const NO_VIGNETTING = { decenterX: 0, decenterY: 0, compressX: 0, compressY: 0, tangentAngle: 0 };
const HEIGHT_FIELDS = [
    "objectHeight",
    "paraxialImageHeight",
    "realImageHeight",
    "gaussianImageHeight",
];
function checkScale(scale) {
    if (!Number.isFinite(scale) || scale <= 0)
        throw new DeclarationError("Length scale must be a positive finite number");
}
/** The first declared aperture becomes the system aperture; the rest stay in `source`. */
function systemAperture(declarations, kinds, scale, log) {
    const entries = Object.entries(declarations);
    if (entries.some(([, value]) => typeof value !== "boolean" && (!Number.isFinite(value) || value < 0))) {
        throw new DeclarationError("Aperture values must be finite and nonnegative");
    }
    if (entries.length > 1) {
        log.warn("multiple_apertures", "Multiple aperture declarations retained; first is reported as the common aperture");
    }
    const source = toJsonObject(declarations);
    const first = entries[0];
    if (!first)
        return { kind: "unspecified", value: null, source };
    const [key, value] = first;
    const kind = kinds.get(key);
    if (typeof value === "boolean")
        return { kind: "floatingStop", value: null, source };
    if (kind === undefined)
        return { kind: "unspecified", value: null, source };
    if (kind === "entrancePupilDiameter")
        return { kind, value: value * scale, source };
    if (kind === "beamRadiusAtSurface1")
        return { kind, value: (value * scale) / 2, source };
    return { kind, value, source };
}
function wavelengths(values, weights, primaryIndex, log) {
    const valid = values.length === weights.length &&
        values.every((value) => Number.isFinite(value) && value > 0) &&
        weights.every((weight) => Number.isFinite(weight) && weight >= 0);
    if (!valid)
        throw new DeclarationError("Wavelength values/weights must align and be finite, positive/nonnegative");
    if (primaryIndex !== null && (!Number.isInteger(primaryIndex) || primaryIndex < 0 || primaryIndex >= values.length)) {
        throw new DeclarationError("Primary wavelength index is outside active wavelengths");
    }
    if (values.length && primaryIndex === null) {
        log.warn("missing_primary_wavelength", "Declared primary wavelength is not in the active slots");
    }
    return { values: [...values], weights: [...weights], primaryIndex };
}
function surfaceIndices(surfaces) {
    return Object.keys(surfaces)
        .map(Number)
        .sort((a, b) => a - b);
}
function surfaceRole(type, index, lastIndex) {
    if (type === "coordinateBreak")
        return "coordinateBreak";
    if (index === 0)
        return "object";
    return index === lastIndex ? "image" : "surface";
}
/** Radius and thickness may be infinite; no other declared number may be. */
function checkFinite(surface, index, unbounded) {
    for (const [key, value] of Object.entries(surface)) {
        if (!unbounded.includes(key) && typeof value === "number" && !Number.isFinite(value)) {
            throw new DeclarationError(`Surface ${index} ${key} must be finite`);
        }
    }
}
function typedSurface(base, type, terms) {
    if (type === "evenAsphere" || type === "oddAsphere") {
        return { ...base, type, asphereTerms: terms().sort((a, b) => a.power - b.power) };
    }
    return { ...base, type };
}
/** A sag coefficient for `r^power` in source length units, re-expressed for `r` in millimeters. */
function asphereTerm(power, coefficient, native, scale) {
    return { power, coefficient: coefficient * scale ** (1 - power), native };
}
function noteCommonWarnings(type, material, index, log) {
    if (type === "unknown") {
        log.warn("unresolved_surface_type", "Surface type retained without a common geometry interpretation", index);
    }
    if (material.kind === "catalog" || material.kind === "model") {
        log.warn("unresolved_material", "Material identity preserved; catalog lookup and dispersion fitting are not executed", index);
    }
}
function finish(format, context, log, model, parts) {
    if (!parts.surfaces.length)
        throw new DeclarationError("No optical surfaces parsed");
    const warnings = log.items.filter((entry) => entry.severity === "warning");
    if (context.strict && warnings[0]) {
        throw new PrescriptionParseError("strict_violation", `Strict import rejected ${warnings.length} warning(s); first: ${warnings[0].code}: ${warnings[0].message}`, { diagnostics: log.items });
    }
    const prescription = {
        schemaVersion: "2.0",
        source: { format, encoding: context.encoding, upstreamRevision: UPSTREAM_REVISION },
        name: model.name,
        mode: "sequential",
        ...parts,
        diagnostics: log.items,
    };
    if (context.includeRaw)
        prescription.raw = toJsonObject(model);
    return prescription;
}
// ---------------------------------------------------------------------------------------------
// Zemax
const ZEMAX_UNITS = { MM: 1, CM: 10, M: 1000, IN: 25.4, INCH: 25.4 };
const isZemaxUnit = (unit) => Object.hasOwn(ZEMAX_UNITS, unit);
const ZEMAX_APERTURES = new Map([
    ["EPD", "entrancePupilDiameter"],
    ["imageFNO", "imageFNumber"],
    ["paraxialImageFNO", "paraxialImageFNumber"],
    ["objectNA", "objectNA"],
    ["object_cone_angle", "objectConeAngle"],
]);
const ZEMAX_FIELDS = new Map([
    ["angle", "angle"],
    ["object_height", "objectHeight"],
    ["paraxial_image_height", "paraxialImageHeight"],
    ["real_image_height", "realImageHeight"],
    ["theodolite_angle", "theodoliteAngle"],
]);
/** Parser type name to normalized type and the type name as Zemax writes it. */
const ZEMAX_SURFACES = new Map([
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
];
function zemaxFields(model, scale, log) {
    const source = model.fields;
    const kind = ZEMAX_FIELDS.get(source.type ?? "angle") ?? "unknown";
    for (const [key, column] of Object.entries(source)) {
        if (Array.isArray(column) && column.some((value) => !Number.isFinite(value))) {
            throw new DeclarationError(`Field ${key} must contain finite numbers`);
        }
    }
    if (source.weights?.some((weight) => weight < 0))
        throw new DeclarationError("Field weights must be nonnegative");
    const xs = source.x ?? [];
    const ys = source.y ?? [];
    const extras = [source.weights, ...ZEMAX_VIGNETTING.map(([, column]) => source[column])];
    if (xs.length !== ys.length ||
        extras.some((column) => column !== undefined && column.length !== xs.length) ||
        (source.num_fields ?? xs.length) !== xs.length) {
        log.warn("field_count_mismatch", "Declared and parsed field columns differ; raw columns retained");
    }
    const fieldScale = HEIGHT_FIELDS.includes(kind) ? scale : 1;
    const points = [];
    for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
        const vignetting = { ...NO_VIGNETTING };
        for (const [name, column] of ZEMAX_VIGNETTING)
            vignetting[name] = source[column]?.[i] ?? 0;
        points.push({
            x: (xs[i] ?? 0) * fieldScale,
            y: (ys[i] ?? 0) * fieldScale,
            weight: source.weights?.[i] ?? 1,
            vignetting,
        });
    }
    return { kind, specification: "pointList", points, relativePoints: [], source: toJsonObject(source) };
}
function zemaxMaterial(surface) {
    const native = surface.material;
    if (native === "air")
        return { kind: "air" };
    if (native.kind === "mirror")
        return { kind: "mirror" };
    return { ...native, catalogs: [...native.catalogs] };
}
function zemaxClearAperture(surface, scale) {
    const native = surface.aperture;
    if (!native)
        return null;
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
/** `PARM n` multiplies r^(2n) on an even asphere and r^n on an odd one. */
function zemaxAsphereTerms(surface, type, scale) {
    const terms = [];
    for (const [key, value] of Object.entries(surface)) {
        const match = /^param_(\d+)$/.exec(key);
        if (!match || typeof value !== "number")
            continue;
        const parameter = Number(match[1]) + 1;
        const power = type === "evenAsphere" ? 2 * parameter : parameter;
        terms.push(asphereTerm(power, value, `PARM ${parameter}`, scale));
    }
    return terms;
}
export function normalizeZemax(model, context) {
    const log = new DiagnosticLog(model.diagnostics);
    if (!isZemaxUnit(model.units))
        throw new DeclarationError(`Unsupported Zemax length unit: ${model.units}`);
    const scale = ZEMAX_UNITS[model.units];
    checkScale(scale);
    const units = { length: "mm", wavelength: "um", angle: "deg", sourceLength: model.units, scaleToMm: scale };
    if (!model.records.some((record) => record.text.startsWith("UNIT "))) {
        log.info("assumed_units", "No UNIT record; assuming millimeters");
    }
    const aperture = systemAperture({ ...model.aperture }, ZEMAX_APERTURES, scale, log);
    const fields = zemaxFields(model, scale, log);
    const declaredPrimary = model.wavelengths.primary_index;
    const primaryIndex = declaredPrimary !== undefined ? declaredPrimary : model.wavelengths.data.length ? 0 : null;
    const spectrum = wavelengths(model.wavelengths.data, model.wavelengths.weights, primaryIndex, log);
    if (model.records.some((record) => record.text.startsWith("WAVL "))) {
        log.warn("legacy_wavl", "WAVL follows upstream legacy token consumption; vector WAVL/WWGT is not fully interpreted");
    }
    const indices = surfaceIndices(model.surfaces);
    const lastIndex = Math.max(0, ...indices);
    const surfaces = [];
    for (const index of indices) {
        const native = model.surfaces[index];
        if (!native)
            continue;
        checkFinite(native, index, ["radius", "thickness"]);
        const known = ZEMAX_SURFACES.get(native.type);
        const type = known?.type ?? "unknown";
        const material = zemaxMaterial(native);
        noteCommonWarnings(type, material, index, log);
        if (type === "coordinateBreak") {
            log.warn("unresolved_coordinates", "Coordinate declarations retained; no global frame is calculated", index);
        }
        const base = {
            index,
            role: surfaceRole(type, index, lastIndex),
            nativeType: known?.native ?? native.type.toUpperCase(),
            radius: (native.radius ?? Infinity) * scale,
            thickness: (native.thickness ?? 0) * scale,
            conic: native.conic,
            stop: native.is_stop,
            material,
            clearAperture: zemaxClearAperture(native, scale),
            semiDiameter: native.diameter === undefined ? null : native.diameter * scale,
            parameters: toJsonObject(native),
        };
        surfaces.push(typedSurface(base, type, () => zemaxAsphereTerms(native, type, scale)));
    }
    return finish("zemax", context, log, model, { units, aperture, fields, wavelengths: spectrum, surfaces });
}
// ---------------------------------------------------------------------------------------------
// OSLO
const OSLO_APERTURES = new Map([
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
};
const OSLO_ASPHERES = new Map([
    ["ADO", "standard"],
    ["ASR", "evenAsphere"],
    ["ARA", "oddAsphere"],
    ["ASX", "polynomial"],
]);
/** The fixed-order conic asphere coefficients and the power of r each multiplies. */
const OSLO_EVEN_TERMS = [
    ["AD", 4],
    ["AE", 6],
    ["AF", 8],
    ["AG", 10],
];
const OSLO_COORDINATES = ["DCX", "DCY", "DCZ", "TLA", "TLB", "TLC", "GC", "RCO", "BEN", "TOX", "TOY", "TOZ"];
const OSLO_CONSTRAINTS = ["pickups", "PY", "PYC", "PU", "PUC", "EC"];
const OSLO_FEATURES = ["PFL", "PFM", "GSP", "GOR", "TCE"];
/** OSLO writes "infinite" object and image distances as very large finite thicknesses. */
const OSLO_INFINITE_OBJECT = 1e8;
const OSLO_INFINITE_THICKNESS = 9.9e9;
function osloFields(model, scale, log) {
    const source = model.fields;
    const kind = OSLO_FIELDS[source.type ?? "angle"];
    if (source.y?.some((value) => !Number.isFinite(value)))
        throw new DeclarationError("Field y must contain finite numbers");
    if (source.points) {
        log.warn("relative_field_table", "OSLO field-table coordinates are retained as relative prescription data; no optical conversion is executed");
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
function osloMaterial(surface) {
    const declaration = surface.material ?? "air";
    if (["AIR", "AIF"].includes(declaration.toUpperCase()))
        return { kind: "air" };
    if (["MIRROR", "RFL", "RFH"].includes(declaration.toUpperCase()))
        return { kind: "mirror" };
    let parts = tokenize(declaration);
    if (parts[0] !== "GLA")
        return { kind: "unknown", raw: declaration };
    parts = parts.slice(1);
    const modeled = parts[0]?.toUpperCase() === "MOD";
    if (modeled)
        parts = parts.slice(1);
    let name = null;
    if (parts[0] !== undefined && !isNumberToken(parts[0])) {
        name = decodeText(parts[0]);
        parts = parts.slice(1);
    }
    if (!parts.length) {
        if (modeled || !name)
            throw new DeclarationError("GLA requires a catalog name or refractive-index data");
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
    if (first !== undefined && new Set(indices).size === 1)
        return { kind: "constantIndex", name, index: first };
    const sampled = surface.glass_wavelengths ?? DEFAULT_WAVELENGTHS;
    if (indices.length !== sampled.length)
        throw new DeclarationError("OSLO glass index/wavelength counts differ");
    return { kind: "sampledIndex", name, wavelengths: [...sampled], indices };
}
function osloSurfaceType(surface) {
    if (surface.PFL !== undefined)
        return "paraxial";
    if (surface.CVX !== undefined)
        return "toroidal";
    if (OSLO_EVEN_TERMS.some(([key]) => surface[key] !== undefined))
        return "evenAsphere";
    return OSLO_ASPHERES.get(surface.ASP ?? "ADO") ?? "unknown";
}
/**
 * `AD`..`AG` multiply r^4..r^10. General coefficients `ASn` multiply r^(2n) under `ASP ASR`
 * (even powers) and r^n under `ASP ARA` (all powers).
 */
function osloAsphereTerms(surface, scale) {
    const terms = [];
    for (const [key, power] of OSLO_EVEN_TERMS) {
        const value = surface[key];
        if (value !== undefined)
            terms.push(asphereTerm(power, value, key, scale));
    }
    const step = surface.ASP === "ASR" ? 2 : surface.ASP === "ARA" ? 1 : null;
    if (step === null)
        return terms;
    for (const [key, value] of Object.entries(surface)) {
        const match = /^AS(\d+)$/.exec(key);
        if (match && typeof value === "number")
            terms.push(asphereTerm(step * Number(match[1]), value, key, scale));
    }
    return terms;
}
export function normalizeOslo(model, context) {
    const log = new DiagnosticLog(model.diagnostics);
    const scale = model.units;
    checkScale(scale);
    const units = { length: "mm", wavelength: "um", angle: "deg", sourceLength: "lensUnit", scaleToMm: scale };
    const aperture = systemAperture({ ...model.aperture }, OSLO_APERTURES, scale, log);
    const fields = osloFields(model, scale, log);
    const spectrum = wavelengths(model.wavelengths.values, model.wavelengths.weights, model.wavelengths.primary_index, log);
    const indices = surfaceIndices(model.surfaces);
    const lastIndex = Math.max(0, ...indices);
    const declaresStop = Object.values(model.surfaces).some((surface) => surface.AST);
    const surfaces = [];
    for (const index of indices) {
        const native = model.surfaces[index];
        if (!native)
            continue;
        checkFinite(native, index, ["RD", "TH"]);
        const type = osloSurfaceType(native);
        let thickness = native.TH ?? 0;
        if (Math.abs(thickness) >= (index === 0 ? OSLO_INFINITE_OBJECT : OSLO_INFINITE_THICKNESS)) {
            thickness = thickness < 0 ? -Infinity : Infinity;
        }
        const material = osloMaterial(native);
        noteCommonWarnings(type, material, index, log);
        const declares = (keys) => keys.some((key) => key in native);
        if (declares(OSLO_COORDINATES)) {
            log.warn("unresolved_coordinates", "Coordinate declarations retained; no global frame is calculated", index);
        }
        if (declares(OSLO_CONSTRAINTS)) {
            log.warn("unresolved_constraints", "Pickup/solve declarations retained; literal values are not a solved snapshot", index);
        }
        if (declares(OSLO_FEATURES)) {
            log.warn("unresolved_optical_feature", "Perfect-imagery, grating or thermal declarations retained without optical interpretation", index);
        }
        if (index === lastIndex && thickness) {
            log.warn("image_focus_declaration", "Image TH is OSLO defocus, retained as a declaration rather than applied to the preceding gap", index);
        }
        const semiDiameter = native.AP === undefined ? null : native.AP * scale;
        const base = {
            index,
            role: surfaceRole(type, index, lastIndex),
            nativeType: native.ASP ?? "ADO",
            radius: (native.RD ?? Infinity) * scale,
            thickness: thickness * scale,
            conic: native.CC ?? 0,
            // Without an explicit AST, OSLO takes surface 1 as the stop.
            stop: native.AST ?? (!declaresStop && index === 1),
            material,
            clearAperture: semiDiameter === null
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
            parameters: toJsonObject(native),
        };
        surfaces.push(typedSurface(base, type, () => osloAsphereTerms(native, scale)));
    }
    if (Object.keys(model.configurations).length > 1) {
        log.warn("configuration_declarations", "Base prescription reported; alternative configuration overrides retained in raw.configurations");
    }
    return finish("oslo", context, log, model, { units, aperture, fields, wavelengths: spectrum, surfaces });
}
//# sourceMappingURL=normalize.js.map