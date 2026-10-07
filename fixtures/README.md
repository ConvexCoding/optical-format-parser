# Fixture provenance

The 15 `zemax/*.zmx` files and 7 `oslo/*.len` files were copied unchanged from Optiland master at the revision in `UPSTREAM.json`: `tests/zemax_files/` and `tests/test_fileio/oslo/`. They are test inputs, not a claim that every optical feature they contain is interpreted. Repository MIT notice is retained; review original manufacturer notices in individual files before redistributing them separately.

`golden/` holds normalized Python outputs used for TypeScript parity. Synthetic fixtures exercise cases with independently known values.
