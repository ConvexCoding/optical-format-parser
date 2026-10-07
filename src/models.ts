// The format-specific models the two parsers build. Key names follow the upstream Optiland
// importers (hence the snake_case and OSLO mnemonics); these records are what `raw` and each
// surface's `parameters` expose.

export interface SourceRecord {
  line: number;
  text: string;
}
export interface NativeDiagnostic {
  command: string;
  line: number;
  surface: number;
  message: string;
  severity?: "info" | "warning";
}
/**
 * How a piece of system data came to have its value. `explicit`: the file declares it.
 * `defaulted`: the file is silent and the format's default applies. `padded`: the file declares
 * only part of it and the rest was filled in. `inferred`: the format has no declaration for it and
 * fixes it by convention. `absent`: the file is silent and nothing stands in.
 */
export type DeclarationStatus = "explicit" | "defaulted" | "padded" | "inferred" | "absent" | "notApplicable";
export interface NativeDeclarations {
  units: DeclarationStatus;
  wavelengths: DeclarationStatus;
  wavelengthWeights: DeclarationStatus;
  primaryWavelength: DeclarationStatus;
  aperture: DeclarationStatus;
  fields: DeclarationStatus;
  terminator: DeclarationStatus;
}
export interface NativeAnnulus {
  kind: "annulus";
  r_min: number;
  r_max: number;
  offset_x: number;
  offset_y: number;
}

// ---------------------------------------------------------------------------------------------
// Zemax

export const ZEMAX_FIELD_COLUMNS = [
  "x",
  "y",
  "weights",
  "vignette_decenter_x",
  "vignette_decenter_y",
  "vignette_compress_x",
  "vignette_compress_y",
  "vignette_tangent_angle",
] as const;
export type ZemaxFieldColumn = (typeof ZEMAX_FIELD_COLUMNS)[number];

export type ZemaxFields = { [K in ZemaxFieldColumn]?: number[] } & {
  type?: string;
  object_space_telecentric?: boolean;
  afocal_image_space?: boolean;
  num_fields?: number;
};

export type ZemaxMaterial =
  | "air"
  | { kind: "mirror" }
  | {
      kind: "catalog";
      name: string;
      catalogs: string[];
      nd: number | null;
      vd: number | null;
      resolution: "unresolved";
    };

export interface ZemaxSurface {
  /** Line of the `SURF` record. */
  line: number;
  type: string;
  is_stop: boolean;
  conic: number;
  material: ZemaxMaterial;
  aperture: NativeAnnulus | null;
  radius?: number;
  thickness?: number;
  diameter?: number;
  mechanical_semi_diameter?: number;
  comment?: string;
  coating?: string;
  index?: number | null;
  abbe?: number | null;
  [parameter: `param_${number}`]: number;
}

export interface ZemaxAperture {
  EPD?: number;
  imageFNO?: number;
  paraxialImageFNO?: number;
  objectNA?: number;
  object_cone_angle?: number;
  floating_stop?: true;
}

export interface ZemaxModel {
  mode: "Sequential";
  units: string;
  records: SourceRecord[];
  diagnostics: NativeDiagnostic[];
  name: string | null;
  notes: string[];
  declarations: NativeDeclarations;
  aperture: ZemaxAperture;
  fields: ZemaxFields;
  wavelengths: { data: number[]; weights: number[]; num_wavelengths?: number; primary_index?: number | null };
  surfaces: Record<number, ZemaxSurface>;
  glass_catalogs?: string[];
}

// ---------------------------------------------------------------------------------------------
// OSLO

/** Surface commands that take one number and are stored under their own name. */
export const OSLO_COEFFICIENTS = [
  "CC",
  "CVX",
  "AD",
  "AE",
  "AF",
  "AG",
  "DCX",
  "DCY",
  "DCZ",
  "TLA",
  "TLB",
  "TLC",
  "DT",
  "GC",
  "TOX",
  "TOY",
  "TOZ",
  "APN",
  "PFM",
  "GSP",
  "GOR",
  "TCE",
] as const;
export type OsloCoefficient = (typeof OSLO_COEFFICIENTS)[number];
export type OsloSolve = "PY" | "PYC" | "PU" | "PUC" | "EC";
export interface OsloPickup {
  /** Pickup type as written, upper-cased: `CV`, `THM`, `GLA`, ... */
  type: string;
  /** The remaining arguments: the source surface, then any second surface or constant. */
  arguments: number[];
  line: number;
}

export type OsloSurface = { [K in OsloCoefficient | OsloSolve | "RD" | "TH" | "AP" | "PFL" | "RCO"]?: number } & {
  material?: string;
  glass_wavelengths?: number[];
  aperture_checked?: boolean;
  ASP?: string;
  AST?: true;
  BEN?: true;
  BCR?: true;
  note?: string;
  pickups?: OsloPickup[];
  /** Line of the record that opens the surface (`LEN` or its `NXT`). */
  line?: number;
  /** Line of the active declaration of each solve. */
  solve_lines?: { [K in OsloSolve]?: number };
  [generalCoefficient: `AS${number}`]: number;
};

export interface OsloFieldPoint {
  y: number;
  x: number;
  weight: number;
  vy: number;
  vx: number;
}
export interface OsloFields {
  type?: "angle" | "object_height" | "gaussian_image_height";
  y?: number[];
  points?: Record<number, OsloFieldPoint>;
}

export interface OsloConfiguration {
  thicknesses: Record<number, number>;
  wavelengths: Record<number, number>;
  wavelength_weights: Record<number, number>;
  weight: number;
  active: boolean;
}

export interface OsloAperture {
  EPD?: number;
  FNO?: number;
  NAO?: number;
  NAP?: number;
  PUK?: number;
}

export interface OsloModel {
  name: string | null;
  scaling: number;
  num_surfaces: number;
  aperture: OsloAperture;
  fields: OsloFields;
  wavelengths: { values: number[]; weights: number[]; primary_index: number };
  surfaces: Record<number, OsloSurface>;
  /** Millimeters per lens unit. */
  units: number;
  records: SourceRecord[];
  /** `SNOn` system notes keyed by command, and the `DES` designer name. */
  notes: Record<string, string>;
  declarations: NativeDeclarations;
  diagnostics: NativeDiagnostic[];
  settings: { aperture_check?: boolean; telecentric?: boolean };
  configurations: Record<number, OsloConfiguration>;
}
