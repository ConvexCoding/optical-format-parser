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

This package captures prescription declarations and produces normalized JSON. Its scope is narrower than Optiland's full optical conversion: it does not evaluate solves or pickups, compose coordinate transforms into a verified optical model, resolve glass catalogs, or trace rays. Retaining a command in `raw` (available with `includeRaw`) or a declaration in a surface record does not mean its optical effect has been implemented. The `asphereTerms` on asphere surfaces restate declared coefficients with explicit powers in millimeter units; the OSLO `ASn` index-to-power mapping follows Optiland's documentation (even powers under `ASR`, all powers under `ARA`) and has not been checked against OSLO. Inspect `diagnostics` alongside the data.

Our `strict` option rejects parser warnings; it is not Optiland OSLO's optical compatibility/material verification mode. The 22-fixture comparisons check this library against fixed JSON expectations. Additional synthetic cases use saved regression expectations and independent assertions. Schema checks establish JSON structure. Neither establishes agreement with Optiland's converted optics, Zemax, or OSLO, nor exhaustive support for all file versions and features. Optical equivalence requires independent comparison of materials, surface geometry, transforms, constraint results, and ray behavior against the originating application.
