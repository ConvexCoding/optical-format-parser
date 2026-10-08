# Compatibility and limitations

**Parsing a file into JSON does not establish that every feature was interpreted or that its optical behavior matches Zemax or OSLO.** Optiland's original importers implement subsets of both formats. The caveats below describe upstream `master` at revision `4e893f53aee1312f2d091680b93dd2279711e197`; the linked master files may change.

### Original Optiland Zemax importer

- **Sequential systems only:** non-sequential mode raises an error.
- **Limited surface types:** the converter handles standard spherical/conic, even and odd aspheres, paraxial surfaces, coordinate breaks, and toroidal surfaces. Other surface types raise an error. Aspheric/toroidal conversion consumes eight coefficient parameters.
- **Unknown operands are silently ignored:** there is no OSLO-style strict compatibility mode. The parser's dispatch table does not handle `UNIT`, pickup/solve declarations, multi-configuration controls, or coating definitions. These features are not reconstructed, and non-millimeter prescriptions need particular care because `UNIT` is not converted.
- **Legacy wavelength syntax is incomplete:** the parser explicitly defers the actual `WAVL` vector layout and `WWGT` handling. Indexed `WAVM` records are handled.
- **Glass resolution can approximate dispersion:** catalog lookup can fall back to an Abbe/Buchdahl model using the saved refractive index and Abbe number. A successfully resolved material does not establish an exact match to the original catalog definition.
- **Field and coordinate behavior has limits:** vignette decentering emits an unsupported warning. Source inspection also shows that the active coordinate-break accumulation path does not consume the order flag; designs depending on that flag need independent validation. This is a code-level observation, not a documented upstream compatibility guarantee.

Sources: [`optiland/fileio/zemax/reader/parser.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/zemax/reader/parser.py) and [`optiland/fileio/zemax/reader/converter.py`](https://github.com/optiland/optiland/blob/master/optiland/fileio/zemax/reader/converter.py).

### Original Optiland OSLO importer

Upstream documents support for sequential prescriptions, unit conversion, several asphere families, coordinate transforms, static pickups, selected solves, configuration snapshots, and simple ruled gratings, with these restrictions:

- **Strict import checks compatibility, not numerical agreement:** unsupported optical commands and known approximations are rejected with strict mode. Every named glass requires an explicit verified material binding through `material_overrides`; permissive imports warn before database lookup or approximation.
- **Constraints become snapshots:** pickups are static, and forward/self references are rejected. Only selected solves are implemented; general simultaneous constraint solving is not provided. Unsupported or unsatisfied solves restore saved values with warnings in permissive mode and fail in strict mode.
- **Configurations have restrictions:** alternate configurations containing solves, and thickness overrides on pickup-controlled targets, are rejected. The first prescription is imported; supported configurations are selected as individual snapshots.
- **Geometry and aiming are not universally equivalent:** certain low-order aspheres retain real-ray geometry while native paraxial analysis omits their vertex, normal, or power changes. Wide-angle aiming, some telecentric launches/solves, and certain coordinate, pickup, toroidal, and mirror-bend combinations are unsupported or restricted.
- **Some optical effects are omitted:** thermal expansion coefficients are retained without temperature-dependent geometry or thermal studies. Ruled-grating blaze efficiency is not inferred.
- **Programs are not executed:** CCL, include files, optimization programs, and external executables are not run. Upstream explicitly states that its smoke checks do not establish agreement with OSLO ray intercepts.

Source: [`docs/oslo_import.rst`](https://github.com/optiland/optiland/blob/master/docs/oslo_import.rst), which contains the detailed command support matrix and validation caveats.

### This library and its tests

This package captures prescription declarations and produces normalized JSON. Its scope is narrower than Optiland's full optical conversion: it does not evaluate solves or pickups, compose coordinate transforms into a verified optical model, resolve glass catalogs, or trace rays. Retaining a command in `raw` (available with `includeRaw`) or a declaration in a surface record does not mean its optical effect has been implemented. The `asphereTerms` on asphere surfaces restate declared coefficients with explicit powers in millimeter units. The OSLO `ASn` index-to-power mapping follows the OSLO Program Reference: r^(2n) on the symmetric general asphere `ASR` (equation 3.9), r^n on the all-orders asphere `ARA` (equation 3.17), with `AD`..`AG` naming the same coefficients as `AS2`..`AS5`. It has been checked against that document, not against OSLO's ray trace. Coefficients outside those rules are listed in the surface's `unresolvedSag` rather than given a power. Inspect `diagnostics` alongside the data.

Unlike the upstream importers, this library keeps the declared sign of OSLO `PUK` (in `aperture.source`), keeps commas and spacing in unquoted OSLO `NOT`, `DES` and `SNOn` text, keeps Zemax field points in declared order without dropping repeated coordinates, requires Zemax `SURF` indices to count up from 0, and reads `MEMA`, `COMM`, `COAT`, `NOTE` and the OSLO `BCR` record, which OSLO writes but its Program Reference does not define.

### Validation rules and their sources

The validation policy is in the README. The rules below go beyond the upstream importers, which truncate or ignore the same input.

OSLO, from the OSLO Program Reference:

- `wv` and `ww` set the wavelengths and the weights, and `wvi`/`wwi` set one of them (command summary; Chapter 3 lists `wvi` and `wwi` as lens data items).
- "Each wavelength has an associated Weight", and the weight of wavelength 1 must be non-zero (Chapter 3, "Wavelength"). The reference defines no weight without a wavelength, so `WW` with more weights than wavelengths and `WWn` beyond the last wavelength are rejected. Alternative configurations already rejected a `WWn` override of an undefined wavelength.
- Arguments are separated by blanks, or by commas ("Command Syntax" and "Optional parentheses in procedure calls"). Nothing there allows a comma between a command and its first argument, or an empty argument, so both are rejected. The parenthesized form `ww(1,0.5)` is not read: it is reported as an `uninterpreted_record`.

The reference does not say what OSLO itself does with a surplus weight, whether it accepts weights written before the wavelengths they belong to, or what happens to weights when a shorter `wv` list replaces the wavelengths. These rules have not been checked against OSLO or against files it exported; the seven OSLO fixtures all write `WV` before `WW` with matching counts. Rejecting a surplus is this library's reading of the reference, chosen because the alternative is to drop declared values. Dropping weights under a shorter `WV` list is treated as permitted and reported (`dropped_wavelength_weights`).

Zemax has no public format reference, so only records whose handling lost data inside this library were changed: surface records before the first `SURF`, a `WAVM` slot below 1, a negative `PARM` number and a non-integer `FTYP` flag are errors; an unmapped `FNUM` or `OBNA` mode, an unknown field type and a declared wavelength count that differs from the wavelengths defined are warnings. `PARM 0` is accepted because Zemax writes it. Trailing arguments of `CURV`, `DIAM`, `GLAS` and `UNIT`, which may carry solve, pickup or model-glass flags, are still not read; they are zero or constant in every fixture and their meaning has not been verified.

Our `strict` option rejects parser warnings; it is not Optiland OSLO's optical compatibility/material verification mode. Which defaulted declarations to accept is left to the application, which can read them from `declarations`. The 22-fixture comparisons check this library against fixed JSON expectations. Additional synthetic cases use saved regression expectations and independent assertions. Schema checks establish JSON structure. Neither establishes agreement with Optiland's converted optics, Zemax, or OSLO, nor exhaustive support for all file versions and features. Optical equivalence requires independent comparison of materials, surface geometry, transforms, constraint results, and ray behavior against the originating application.
