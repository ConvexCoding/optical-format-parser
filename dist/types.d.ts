/** A prescription file format this library can read. */
export type Format = "zemax" | "oslo";
/** Any value that survives a JSON round trip. In memory, numbers may also be `±Infinity`. */
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
/** How the input bytes were decoded; `"text"` when an already decoded string was parsed. */
export type SourceEncoding = "text" | "utf-8" | "utf-16-le" | "utf-16-be" | "iso-8859-1" | "cp1252";
export interface ParseOptions {
    /** Which format `text` or `data` is written in. The library never guesses. */
    format: Format;
    /** Return a `strict_violation` error if any warning diagnostic is produced. Defaults to `false`. */
    strict?: boolean;
    /** Attach the format-specific parser model as `raw`. Roughly doubles the output size. Defaults to `false`. */
    includeRaw?: boolean;
}
export type DiagnosticSeverity = "info" | "warning";
export type DiagnosticCode = 
/** A source command was kept in `parameters`/`raw` but has no normalized meaning. It may be optical. */
"uninterpreted_record"
/** A record that cannot change the prescription: version, display, plotting or optimization setup. */
 | "inert_record"
/** OSLO file without wavelengths; the d, F and C lines are assumed. */
 | "default_wavelengths"
/** Fewer wavelength weights than wavelengths; the missing weights are reported as 1. */
 | "padded_wavelength_weights"
/** OSLO prescription that stops without its `END` record. */
 | "missing_end"
/** Sag coefficients are declared that `asphereTerms` does not represent; see `unresolvedSag`. */
 | "unresolved_geometry"
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
/** Refractive indices tabulated at specific wavelengths (micrometers); the two arrays are parallel. */
export interface SampledIndexMaterial {
    kind: "sampledIndex";
    name: string | null;
    wavelengths: number[];
    indices: number[];
}
/**
 * OSLO `PK GLA` with no saved glass: the medium is whatever the referenced surface has. See the
 * surface's `pickups` for the declaration.
 */
export interface PickupMaterial {
    kind: "pickup";
    /** The source surface as the file writes it. */
    reference: number;
}
/** A material declaration that could not be classified; `raw` is the source text. */
export interface UnknownMaterial {
    kind: "unknown";
    raw: string;
}
/** The medium following a surface. Narrow on `kind`. */
export type Material = AirMaterial | MirrorMaterial | CatalogMaterial | ModelMaterial | ConstantIndexMaterial | SampledIndexMaterial | PickupMaterial | UnknownMaterial;
export type MaterialKind = Material["kind"];
export type SurfaceRole = "object" | "surface" | "image" | "coordinateBreak";
/** Circular or annular clear aperture, centered at (`offsetX`, `offsetY`). */
export interface ClearAperture {
    kind: "annulus";
    minRadius: number;
    maxRadius: number;
    offsetX: number;
    offsetY: number;
    /** OSLO: whether this aperture is flagged as checked (`AP CHK`). `null` when the format has no such flag. */
    checked: boolean | null;
    /** OSLO: the lens-wide aperture checking setting (`APCK`). `null` when the format has no such setting. */
    checkingEnabled: boolean | null;
}
/**
 * One polynomial sag term, `coefficient * r^power`, with `r` and sag in millimeters.
 * Coefficients are rescaled from the file's length unit, so they can be used directly with
 * `radius`.
 */
export interface AsphereTerm {
    /** Exponent of the radial coordinate. */
    power: number;
    /** Coefficient in mm^(1 - power). */
    coefficient: number;
    /** The source declaration this term came from, e.g. `"PARM 2"`, `"AD"` or `"AS3"`. */
    native: string;
}
/**
 * How a surface's coordinate system is declared to be placed: the file's own tilt and decenter
 * data, not a computed frame. A Zemax coordinate break and an OSLO surface with tilt/decenter data
 * both report one. Decenters are in millimeters and tilts in degrees.
 *
 * The formats differ in what the numbers mean. Zemax tilts are right-handed rotations about +x, +y
 * and +z, and a coordinate break moves the frame for every later surface. OSLO `TLA` and `TLB`
 * rotate about -x and -y (`TLC` about +z) and apply to the surface they are declared on.
 */
export interface CoordinateDeclaration {
    decenterX: number;
    decenterY: number;
    decenterZ: number;
    /** Zemax `PARM 3`, OSLO `TLA`. */
    tiltX: number;
    /** Zemax `PARM 4`, OSLO `TLB`. */
    tiltY: number;
    /** Zemax `PARM 5`, OSLO `TLC`. */
    tiltZ: number;
    /**
     * `"decenterThenTilt"` tilts about x, y, then z. `"tiltThenDecenter"` tilts about z, y, then x.
     * Zemax `PARM 6` (0 or nonzero), OSLO `DT` (1 or -1).
     */
    order: "decenterThenTilt" | "tiltThenDecenter";
    /** OSLO `BEN`: the tilt is applied again after reflection, so the axis follows the folded beam. */
    bend: boolean;
    /** OSLO `RCO`: the surface whose coordinates are returned to before this surface's thickness. */
    returnTo: number | null;
    /** OSLO `BCR` is declared. OSLO writes it on fold mirrors, but the Program Reference does not define it. */
    returnBase: boolean;
    /** OSLO `GC`: the surface whose coordinates the tilts and decenters are measured in. */
    globalReference: number | null;
    /** OSLO `TOX`, `TOY`, `TOZ`: offset of the tilt vertex. */
    tiltOffsetX: number;
    tiltOffsetY: number;
    tiltOffsetZ: number;
}
/**
 * A declared pickup: the property is tied to a preceding surface. Pickups are not executed, so the
 * property's normalized value is whatever the file saved, or its empty value if nothing was saved.
 */
export interface Pickup {
    property: "curvature" | "thickness" | "aperture" | "material" | "coordinates";
    /** The OSLO pickup type: `CV`, `CVM`, `TH`, `THM`, `LN`, `LNM`, `AP`, `GLA`, `TD` or `TDM`. */
    native: string;
    /** Whether the picked-up value is negated (the `M` types). */
    negated: boolean;
    /** The source surface as the file writes it. */
    reference: number;
    /** Arguments after the source surface, in file units: a constant, or for `LN` a second surface then a constant. */
    arguments: number[];
    /** 1-based source line. */
    line: number;
}
/** A declared solve: the property is to be computed from a paraxial ray. Solves are not executed. */
export interface Solve {
    kind: "axialRayHeight" | "chiefRayHeight" | "axialRayAngle" | "chiefRayAngle" | "edgeContact";
    /** The OSLO command: `PY`, `PYC`, `PU`, `PUC` or `EC`. */
    native: string;
    /** The property the solve sets. */
    target: "thickness" | "curvature";
    /** The solve's target: a height or edge thickness in millimeters, or a ray slope. */
    value: number;
    /** 1-based source line. */
    line: number;
}
interface SurfaceCommon {
    /** Position in the sequential prescription; `0` is the object surface. */
    index: number;
    /** 1-based line of the record that opens the surface: Zemax `SURF`, OSLO `LEN` or `NXT`. */
    line: number;
    role: SurfaceRole;
    /** The format's own surface type name, e.g. Zemax `"EVENASPH"` (upper-cased) or OSLO `"ASR"`. */
    nativeType: string;
    /** Vertex radius of curvature. `Infinity` means flat. */
    radius: number;
    /** Distance to the next surface. `±Infinity` for an object at infinity. */
    thickness: number;
    conic: number;
    /** Whether this surface is the aperture stop. */
    stop: boolean;
    /** The medium after this surface. */
    material: Material;
    /** Declared clear aperture, or `null` when none is declared. */
    clearAperture: ClearAperture | null;
    /** Declared semi-diameter (Zemax `DIAM`, OSLO `AP`), or `null`. */
    semiDiameter: number | null;
    /** Declared mechanical semi-diameter, the physical edge of the part (Zemax `MEMA`), or `null`. */
    mechanicalSemiDiameter: number | null;
    /** Surface comment or note (Zemax `COMM`, OSLO `NOT`), or `null`. */
    comment: string | null;
    /** Coating name (Zemax `COAT`), or `null`. An identifier only; no coating is modeled. */
    coating: string | null;
    /** Tilt and decenter declarations, or `null` when the surface has none. */
    coordinates: CoordinateDeclaration | null;
    /** Active pickup declarations (OSLO `PK`), in source order. */
    pickups: Pickup[];
    /** Active solve declarations (OSLO `PY`, `PYC`, `PU`, `PUC`, `EC`). */
    solves: Solve[];
    /**
     * OSLO sag coefficients (`AD`..`AG`, `ASn`) that are declared but not represented in
     * `asphereTerms`, by name. Empty means `radius`, `conic` and `asphereTerms` are the whole declared
     * sag; otherwise the surface is not the shape those describe.
     */
    unresolvedSag: string[];
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
export type NormalizedSurface = StandardSurface | EvenAsphereSurface | OddAsphereSurface | ToroidalSurface | CoordinateBreakSurface | ParaxialSurface | PolynomialSurface | UnknownSurface;
export type SurfaceType = NormalizedSurface["type"];
interface ApertureCommon {
    /** The file's own aperture declarations, keyed as the parser names them, in file units. */
    source: JsonObject;
}
/** An aperture given as a number. The two length kinds are in millimeters, `objectConeAngle` in degrees. */
export interface ValuedAperture extends ApertureCommon {
    kind: "entrancePupilDiameter" | "beamRadiusAtSurface1" | "imageFNumber" | "paraxialImageFNumber" | "objectNA" | "imageNA" | "objectConeAngle" | "imageSlope";
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
export type FieldKind = "angle" | "theodoliteAngle" | "objectHeight" | "paraxialImageHeight" | "realImageHeight" | "gaussianImageHeight" | "unknown";
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
    /**
     * Field points in degrees or millimeters according to `kind`, in the order the file declares
     * them. Repeated coordinates are kept: they can differ in weight or vignetting. Never empty.
     */
    points: FieldPoint[];
    /** OSLO field-table rows in ascending `index`; empty when the file has no field table. */
    relativePoints: RelativeFieldPoint[];
    /** The file's own field declarations, in file units. */
    source: JsonObject;
}
/**
 * How a piece of system data came to have its value. `"explicit"`: the file declares it.
 * `"defaulted"`: the file is silent and the format's default was used. `"padded"`: the file declares
 * part of it and the rest was filled in. `"inferred"`: the format has no record for it and fixes it
 * by convention. `"absent"`: the file is silent and there is no value. `"notApplicable"`: the format
 * has no such thing.
 */
export type DeclarationStatus = "explicit" | "defaulted" | "padded" | "inferred" | "absent" | "notApplicable";
/** Which system data the file declares itself, so defaults are not mistaken for declarations. */
export interface Declarations {
    /** Length unit: Zemax `UNIT`, OSLO `UNI`. Millimeters when defaulted. */
    units: DeclarationStatus;
    /** Wavelength values. OSLO defaults to the d, F and C lines. */
    wavelengths: DeclarationStatus;
    /** Wavelength weights. `"padded"` when some wavelengths have a weight and others were given 1. */
    wavelengthWeights: DeclarationStatus;
    /** Primary wavelength: Zemax `PWAV`. OSLO has no record; its first wavelength is the primary. */
    primaryWavelength: DeclarationStatus;
    /** System aperture. */
    aperture: DeclarationStatus;
    /** Field: Zemax field columns, OSLO `ANG`, `OBH` or `GIH`. On-axis when defaulted. */
    fields: DeclarationStatus;
    /** OSLO `END` closing the prescription. `"notApplicable"` for Zemax. */
    terminator: DeclarationStatus;
}
/** Active wavelengths in micrometers; `values` and `weights` are parallel arrays. */
export interface Wavelengths {
    values: number[];
    weights: number[];
    /** Index into `values`, or `null` when no active wavelength is the primary. */
    primaryIndex: number | null;
}
export interface Units {
    length: "mm";
    wavelength: "um";
    angle: "deg";
    /** The length unit the file was written in; OSLO files use an arbitrary `"lensUnit"`. */
    sourceLength: "MM" | "CM" | "M" | "IN" | "INCH" | "lensUnit";
    /** Millimeters per source length unit; already applied to every normalized length. */
    scaleToMm: number;
}
export interface PrescriptionSource {
    format: Format;
    encoding: SourceEncoding;
    /** Revision of the Optiland importers this parser was derived from. */
    upstreamRevision: string;
}
/**
 * A sequential lens prescription. This is what the file declares, not a solved or ray-traced
 * model: check `diagnostics` for anything that was kept without being interpreted.
 *
 * Units: every length is in millimeters and every wavelength in micrometers, whatever the file
 * used, so property names carry no unit. A name includes a unit only where it departs from that
 * rule (`scaleToMm`). Angles are in degrees. The pass-through records (`parameters`, `source`,
 * `raw`) are the exception: they keep the file's own units.
 */
export interface NormalizedPrescription {
    schemaVersion: "1.0";
    source: PrescriptionSource;
    name: string | null;
    /** OSLO `DES`, the designer's name, or `null`. */
    designer: string | null;
    /** Design notes in source order: Zemax `NOTE` text, OSLO `SNOn` system notes. */
    notes: string[];
    declarations: Declarations;
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
export {};
//# sourceMappingURL=types.d.ts.map