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
  type: string;
  is_stop: boolean;
  conic: number;
  material: ZemaxMaterial;
  aperture: NativeAnnulus | null;
  radius?: number;
  thickness?: number;
  diameter?: number;
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

export type OsloSurface = { [K in OsloCoefficient | OsloSolve | "RD" | "TH" | "AP" | "PFL" | "RCO"]?: number } & {
  material?: string;
  glass_wavelengths?: number[];
  aperture_checked?: boolean;
  ASP?: string;
  AST?: true;
  BEN?: true;
  note?: string;
  pickups?: string[][];
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
  notes: Record<string, string>;
  diagnostics: NativeDiagnostic[];
  settings: { aperture_check?: boolean; telecentric?: boolean };
  configurations: Record<number, OsloConfiguration>;
}
