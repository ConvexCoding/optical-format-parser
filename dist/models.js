// The format-specific models the two parsers build. Key names follow the upstream Optiland
// importers (hence the snake_case and OSLO mnemonics); these records are what `raw` and each
// surface's `parameters` expose.
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
];
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
];
//# sourceMappingURL=models.js.map