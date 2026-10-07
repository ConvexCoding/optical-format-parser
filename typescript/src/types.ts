export type Format = "zemax" | "oslo";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type OpticalNumber = number | { special: "positiveInfinity" | "negativeInfinity" };
export interface ParseOptions { format: Format; filename?: string; strict?: boolean }
export interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  command?: string;
  line?: number;
  surface?: number;
}
export type MaterialRecord = JsonObject & {
  kind: "air" | "mirror" | "catalog" | "model" | "constantIndex" | "sampledIndex" | "unknown";
};
export interface NormalizedSurface {
  index: number;
  role: "object" | "surface" | "image" | "coordinateBreak";
  type: string;
  radiusMm: OpticalNumber;
  thicknessMm: OpticalNumber;
  conic: number;
  stop: boolean;
  material: MaterialRecord;
  clearAperture: JsonObject | null;
  parameters: JsonObject;
}
export interface NormalizedPrescription {
  schemaVersion: "1.0";
  source: { format: Format; filename: string; encoding: string; upstreamRevision: string };
  name: string | null;
  mode: "sequential";
  units: { length: "mm"; wavelength: "um"; angle: "deg"; sourceLength: string; scaleToMm: number };
  aperture: { kind: string; value: number | null; source: JsonObject };
  fields: { kind: string; points: { x: number; y: number; weight: number; vignetting: JsonObject }[];
    reference: { y: number; coordinates: "prescriptionExtent" } | null; source: JsonObject };
  wavelengths: { valuesUm: number[]; weights: number[]; primaryIndex: number | null };
  surfaces: NormalizedSurface[];
  diagnostics: Diagnostic[];
  raw: JsonObject;
}

/** Internal native operand dictionaries are deliberately format-specific. */
export type NativeRecord = Record<string, any>;
