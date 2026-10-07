# Fixture provenance

The 15 `zemax/*.zmx` files and 7 `oslo/*.len` files were copied unchanged from Optiland master at revision `4e893f53aee1312f2d091680b93dd2279711e197`: `tests/zemax_files/` and `tests/test_fileio/oslo/`. They are test inputs, not a claim that every optical feature they contain is interpreted. Repository MIT notice is retained; review original manufacturer notices in individual files before redistributing them separately.

`golden/` holds fixed normalized JSON expectations for the 22 prescription files. `regressions.json` retains 18 synthetic declaration cases and their expected outputs. These expectations are fixed regression baselines; tests never regenerate them. Independent assertions also check known geometry, units, quoting, diagnostics, and malformed inputs.
