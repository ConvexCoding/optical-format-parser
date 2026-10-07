# Optical Format Import

Standalone Zemax `.zmx` and OSLO `.len` prescription parsers with a shared normalized JSON contract. Python uses only its standard library; TypeScript targets browsers and has no runtime dependencies.

Derived from Optiland **master**, inspected at `4e893f53aee1312f2d091680b93dd2279711e197` on 2026-10-07. See [UPSTREAM.json](UPSTREAM.json), [LICENSE](LICENSE), and the [extraction and port guide](GUIDE.md).

This library parses prescriptions. It preserves catalog names, direct-index samples, coordinate commands, pickups, and solve declarations as data. It does not execute optical solves, resolve glass catalogs, trace rays, or reproduce Optiland's native `Optic.to_dict()` format. Unsupported records are retained with diagnostics.

Implementation and validation instructions are added at each milestone.
