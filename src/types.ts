/** A prescription file format this library can read. */
export type Format = "zemax" | "oslo";

/** Any value that survives a JSON round trip. In memory, numbers may also be `±Infinity`. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** How the input bytes were decoded; `"text"` when an already decoded string was parsed. */
export type SourceEncoding = "text" | "utf-8" | "utf-16-le" | "utf-16-be" | "iso-8859-1" | "cp1252";

export interface ParseOptions {
  /** File format. May be omitted when `filename` ends in `.zmx` or `.len`. */
  format?: Format;
  /** Used in error messages and `source.filename`. Defaults to `"<memory>"`. */
  filename?: string;
  /** Throw a `strict_violation` error if any warning diagnostic is produced. Defaults to `false`. */
  strict?: boolean;
  /** Attach the format-specific parser model as `raw`. Roughly doubles the output size. Defaults to `false`. */
  includeRaw?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Diagnostics

export type DiagnosticSeverity = "info" | "warning";

export type DiagnosticCode =
  /** A source command was kept in `parameters`/`raw` but has no normalized meaning. */
  | "uninterpreted_record"
  /** Zemax file without a `UNIT` record; millimeters assumed. */
  | "assumed_units"
  /** Several system aperture declarations; the first is reported as `aperture`. */
  | "multiple_apertures"
  /** Zemax field columns disagree in length with each other or with the declared count. */
  | "field_count_mismatch"
  /** OSLO field table rows are fractions of the full field and are reported unconverted. */
  | "relative_field_table"
  /** The declared primary wavelength is not one of the active wavelengths. */
  | "missing_primary_wavelength"
  /** Legacy Zemax `WAVL` syntax, which is only partially interpreted. */
  | "legacy_wavl"
  /** Surface type with no normalized geometry; see `nativeType` and `parameters`. */
  | "unresolved_surface_type"
  /** Catalog or model glass: the name is preserved but no refractive index is looked up. */
  | "unresolved_material"
  /** Decenters, tilts or coordinate breaks are declared; no global frame is computed. */
  | "unresolved_coordinates"
  /** Pickups or solves are declared; the literal values are not a solved snapshot. */
  | "unresolved_constraints"
  /** Perfect-lens, grating or thermal declarations with no optical interpretation. */
  | "unresolved_optical_feature"
  /** OSLO image-surface thickness (defocus) is reported as declared, not applied. */
  | "image_focus_declaration"
  /** OSLO alternative configurations exist; only the base prescription is normalized. */
  | "configuration_declarations";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  /** Source command that triggered the diagnostic, when it came from one. */
  command?: string;
  /** 1-based source line. */
  line?: number;
  /** Index into `surfaces`; absent for records outside any surface. */
  surface?: number;
}

// ---------------------------------------------------------------------------------------------
// Materials

export interface AirMaterial {
  kind: "air";
}
export interface MirrorMaterial {
  kind: "mirror";
}
/** A named catalog glass. The name is preserved; no catalog lookup is performed. */
export interface CatalogMaterial {
  kind: "catalog";
  name: string;
  /** Glass catalogs declared by the file (Zemax `GCAT`); empty when none are declared. */
  catalogs: string[];
  /** d-line index saved alongside the glass name, when the file carries one. */
  nd: number | null;
  /** Abbe number saved alongside the glass name, when the file carries one. */
  vd: number | null;
  resolution: "unresolved";
}
/** A model glass given by d-line index and Abbe number; no dispersion formula is fitted. */
export interface ModelMaterial {
  kind: "model";
  name: string | null;
  nd: number;
  vd: number;
  dispersion: "unspecified";
  resolution: "unresolved";
}
/** One refractive index used at every wavelength. */
export interface ConstantIndexMaterial {
  kind: "constantIndex";
  name: string | null;
  index: number;
}
/** Refractive indices tabulated at specific wavelengths; the two arrays are parallel. */
export interface SampledIndexMaterial {
  kind: "sampledIndex";
  name: string | null;
  wavelengthsUm: number[];
  indices: number[];
}
/** A material declaration that could not be classified; `raw` is the source text. */
export interface UnknownMaterial {
  kind: "unknown";
  raw: string;
}

/** The medium following a surface. Narrow on `kind`. */
export type Material =
  | AirMaterial
  | MirrorMaterial
  | CatalogMaterial
  | ModelMaterial
  | ConstantIndexMaterial
  | SampledIndexMaterial
  | UnknownMaterial;
export type MaterialKind = Material["kind"];

// ---------------------------------------------------------------------------------------------
// Surfaces

export type SurfaceRole = "object" | "surface" | "image" | "coordinateBreak";

/** Circular or annular clear aperture, centered at (`offsetXMm`, `offsetYMm`). */
export interface ClearAperture {
  kind: "annulus";
  minRadiusMm: number;
  maxRadiusMm: number;
  offsetXMm: number;
  offsetYMm: number;
  /** OSLO: whether this aperture is flagged as checked (`AP CHK`). `null` when the format has no such flag. */
  checked: boolean | null;
  /** OSLO: the lens-wide aperture checking setting (`APCK`). `null` when the format has no such setting. */
  checkingEnabled: boolean | null;
}

/**
 * One polynomial sag term, `coefficient * r^power`, with `r` and sag in millimeters.
 * Coefficients are rescaled from the file's length unit, so they can be used directly with
 * `radiusMm`.
 */
export interface AsphereTerm {
  /** Exponent of the radial coordinate. */
  power: number;
  /** Coefficient in mm^(1 - power). */
  coefficient: number;
  /** The source declaration this term came from, e.g. `"PARM 2"`, `"AD"` or `"AS3"`. */
  native: string;
}

interface SurfaceCommon {
  /** Position in the sequential prescription; `0` is the object surface. */
  index: number;
  role: SurfaceRole;
  /** The format's own surface type name, e.g. Zemax `"EVENASPH"` (upper-cased) or OSLO `"ASR"`. */
  nativeType: string;
  /** Vertex radius of curvature in millimeters. `Infinity` means flat. */
  radiusMm: number;
  /** Distance to the next surface in millimeters. `±Infinity` for an object at infinity. */
  thicknessMm: number;
  conic: number;
  /** Whether this surface is the aperture stop. */
  stop: boolean;
  /** The medium after this surface. */
  material: Material;
  /** Declared clear aperture, or `null` when none is declared. */
  clearAperture: ClearAperture | null;
  /** Declared semi-diameter (Zemax `DIAM`, OSLO `AP`) in millimeters, or `null`. */
  semiDiameterMm: number | null;
  /** Every declaration on this surface as the format spells it, in the file's own units. */
  parameters: JsonObject;
}
interface SurfaceVariant<T extends string> extends SurfaceCommon {
  type: T;
}

export type StandardSurface = SurfaceVariant<"standard">;
/** Conic base plus polynomial terms; see `asphereTerms` for the explicit powers. */
export interface EvenAsphereSurface extends SurfaceVariant<"evenAsphere"> {
  /** Declared polynomial terms in ascending power, including zero-valued ones. */
  asphereTerms: AsphereTerm[];
}
export interface OddAsphereSurface extends SurfaceVariant<"oddAsphere"> {
  /** Declared polynomial terms in ascending power, including zero-valued ones. */
  asphereTerms: AsphereTerm[];
}
/** Toroidal surface; the second-axis data is in `parameters`. */
export type ToroidalSurface = SurfaceVariant<"toroidal">;
/** Coordinate break; decenters and tilts are in `parameters`. */
export type CoordinateBreakSurface = SurfaceVariant<"coordinateBreak">;
/** Ideal thin lens; the focal length is in `parameters`. */
export type ParaxialSurface = SurfaceVariant<"paraxial">;
/** XY polynomial surface; the coefficients are in `parameters`. */
export type PolynomialSurface = SurfaceVariant<"polynomial">;
/** A surface type this library does not normalize; see `nativeType` and `parameters`. */
export type UnknownSurface = SurfaceVariant<"unknown">;

/** One surface of the prescription. Narrow on `type`. */
export type NormalizedSurface =
  | StandardSurface
  | EvenAsphereSurface
  | OddAsphereSurface
  | ToroidalSurface
  | CoordinateBreakSurface
  | ParaxialSurface
  | PolynomialSurface
  | UnknownSurface;
export type SurfaceType = NormalizedSurface["type"];

// ---------------------------------------------------------------------------------------------
// System data

interface ApertureCommon {
  /** The file's own aperture declarations, keyed as the parser names them, in file units. */
  source: JsonObject;
}
/** An aperture given as a number. Lengths are in millimeters, `objectConeAngle` in degrees. */
export interface ValuedAperture extends ApertureCommon {
  kind:
    | "entrancePupilDiameter"
    | "beamRadiusAtSurface1"
    | "imageFNumber"
    | "paraxialImageFNumber"
    | "objectNA"
    | "imageNA"
    | "objectConeAngle"
    | "imageSlope";
  value: number;
}
/** The aperture is set by the size of the stop surface rather than by a number. */
export interface FloatingStopAperture extends ApertureCommon {
  kind: "floatingStop";
  value: null;
}
/** The file declares no system aperture. */
export interface UnspecifiedAperture extends ApertureCommon {
  kind: "unspecified";
  value: null;
}
/** The system aperture. Narrow on `kind`; `value` is `null` only for the two unvalued kinds. */
export type SystemAperture = ValuedAperture | FloatingStopAperture | UnspecifiedAperture;
export type ApertureKind = SystemAperture["kind"];

/** What field coordinates measure. Heights are in millimeters, angles in degrees. */
export type FieldKind =
  | "angle"
  | "theodoliteAngle"
  | "objectHeight"
  | "paraxialImageHeight"
  | "realImageHeight"
  | "gaussianImageHeight"
  | "unknown";

/** Zemax per-field vignetting factors; all zero when the file declares none. */
export interface Vignetting {
  decenterX: number;
  decenterY: number;
  compressX: number;
  compressY: number;
  tangentAngle: number;
}
export interface FieldPoint {
  x: number;
  y: number;
  weight: number;
  vignetting: Vignetting;
}
/** A row of an OSLO field table: a position as a fraction of the full field. */
export interface RelativeFieldPoint {
  /** The row number given in the file. */
  index: number;
  x: number;
  y: number;
  weight: number;
  /** Symmetric pupil vignetting, `1 - upper pupil bound`. */
  vignetteX: number;
  vignetteY: number;
}
export interface Fields {
  kind: FieldKind;
  /**
   * How to read `points`. `"pointList"`: the file lists its field points (Zemax). `"fullField"`:
   * the file declares only the maximum field, so `points` holds that single point (OSLO).
   */
  specification: "pointList" | "fullField";
  /** Field points in degrees or millimeters according to `kind`. Never empty. */
  points: FieldPoint[];
  /** OSLO field-table rows in ascending `index`; empty when the file has no field table. */
  relativePoints: RelativeFieldPoint[];
  /** The file's own field declarations, in file units. */
  source: JsonObject;
}

/** Active wavelengths; `valuesUm` and `weights` are parallel arrays. */
export interface Wavelengths {
  valuesUm: number[];
  weights: number[];
  /** Index into `valuesUm`, or `null` when no active wavelength is the primary. */
  primaryIndex: number | null;
}

export interface Units {
  length: "mm";
  wavelength: "um";
  angle: "deg";
  /** The length unit the file was written in; OSLO files use an arbitrary `"lensUnit"`. */
  sourceLength: "MM" | "CM" | "M" | "IN" | "INCH" | "lensUnit";
  /** Millimeters per source length unit; already applied to every `...Mm` value. */
  scaleToMm: number;
}

export interface PrescriptionSource {
  format: Format;
  filename: string;
  encoding: SourceEncoding;
  /** Revision of the Optiland importers this parser was derived from. */
  upstreamRevision: string;
}

/**
 * A sequential lens prescription in common units. This is what the file declares, not a solved or
 * ray-traced model: check `diagnostics` for anything that was kept without being interpreted.
 */
export interface NormalizedPrescription {
  schemaVersion: "2.0";
  source: PrescriptionSource;
  name: string | null;
  mode: "sequential";
  units: Units;
  aperture: SystemAperture;
  fields: Fields;
  wavelengths: Wavelengths;
  /** Surfaces in order, object first and image last. Never empty. */
  surfaces: NormalizedSurface[];
  diagnostics: Diagnostic[];
  /** The format-specific parser model. Present only with `includeRaw: true`. */
  raw?: JsonObject;
}
