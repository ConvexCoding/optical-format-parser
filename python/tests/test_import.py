from pathlib import Path
import ast
import json
import math
import subprocess
import sys
import tempfile
import unittest

from optical_import import dumps, parse_bytes, parse_file, parse_text
from optical_import.oslo.configurations import select_configuration
from optical_import.oslo.parser import OsloDataParser
from optical_import.zemax.parser import ZemaxDataParser

ROOT = Path(__file__).resolve().parents[2]
ZMX = "NAME simple\nUNIT MM\nENPD 4\nWAVM 1 0.55 1\nPWAV 1\nSURF 0\nCURV 0\nDISZ INFINITY\nSURF 1\nCURV 0.05\nDISZ 2\nSTOP\nSURF 2\nCURV -0.05\nDISZ 20\nSURF 3\nCURV 0\nDISZ 0\n"
LEN = 'LEN NEW "simple" 50 3\nEBR 2\nANG 0\nWV 0.55\nTH 1e20; NXT\nRD 20; TH 2; AST; NXT\nRD -20; TH 20; NXT\nRD 0; END 3\n'


class ImportTests(unittest.TestCase):
    def test_corpus_and_golden(self):
        count = 0
        for folder in ("zemax", "oslo"):
            for path in sorted((ROOT / "fixtures" / folder).iterdir()):
                with self.subTest(path=path.name):
                    data = parse_file(path)
                    encoded = dumps(data)
                    self.assertEqual(data, json.loads(encoded))
                    self.assertGreater(len(data["surfaces"]), 1)
                    self.assertEqual(data["source"]["format"], folder)
                    self.assertEqual(data["schemaVersion"], "1.0")
                    golden = ROOT / "fixtures/golden" / (path.name + ".json")
                    self.assertEqual(data, json.loads(golden.read_text()))
                    count += 1
        self.assertEqual(count, 22)

    def test_independent_common_geometry(self):
        zemax = parse_text(ZMX, "zemax")
        oslo = parse_text(LEN, "oslo")
        for result in (zemax, oslo):
            self.assertEqual([s["radiusMm"] for s in result["surfaces"]], [{"special": "positiveInfinity"}, 20, -20, {"special": "positiveInfinity"}])
            self.assertEqual([s["thicknessMm"] for s in result["surfaces"]], [{"special": "positiveInfinity"}, 2, 20, 0])
            self.assertEqual(result["wavelengths"], {"valuesUm": [0.55], "weights": [1.0], "primaryIndex": 0})
            self.assertTrue(result["surfaces"][1]["stop"])
        self.assertEqual(zemax["aperture"]["kind"], "entrancePupilDiameter")
        self.assertEqual(oslo["aperture"]["kind"], "beamRadiusAtSurface1")

    def test_encoding_variants(self):
        expected = parse_text(ZMX, "zemax")
        for encoding, bom in (("utf-8", b""), ("utf-8", b"\xef\xbb\xbf"), ("utf-16-le", b"\xff\xfe"), ("utf-16-be", b"\xfe\xff"), ("utf-16-le", b""), ("utf-16-be", b"")):
            result = parse_bytes(bom + ZMX.encode(encoding), "zemax")
            result["source"]["encoding"] = "text"
            self.assertEqual(result, expected)
        latin = parse_bytes(ZMX.replace("simple", "café").encode("iso-8859-1"), "zemax")
        self.assertEqual(latin["name"], "café")
        cp = parse_bytes(LEN.replace("simple", "smart “quotes”").encode("cp1252"), "oslo")
        self.assertEqual(cp["name"], "smart “quotes”")

    def test_units_are_normalized(self):
        z = parse_text(ZMX.replace("UNIT MM", "UNIT IN"), "zemax")
        o = parse_text(LEN.replace("EBR 2", "EBR 2\nUNI 25.4"), "oslo")
        self.assertAlmostEqual(z["surfaces"][1]["radiusMm"], 508)
        self.assertAlmostEqual(o["surfaces"][1]["thicknessMm"], 50.8)
        with self.assertRaisesRegex(ValueError, "unit"):
            parse_text(ZMX.replace("UNIT MM", "UNIT BOGUS"), "zemax")

    def test_apertures_offsets_and_material_records(self):
        z = parse_text(ZMX.replace("STOP", "GLAS N-BK7 0 0 1.5168 64.17\nOBDC 1 2\nCLAP 0 3\nOBDC 4 5\nSTOP"), "zemax")
        s = z["surfaces"][1]
        self.assertEqual(s["clearAperture"]["offset_y"], 5)
        self.assertEqual(s["material"]["name"], "N-BK7")
        self.assertEqual(s["material"]["nd"], 1.5168)
        o = parse_text(LEN.replace("RD 20", "GLA 1.5; AP CHK 3; RD 20"), "oslo")
        self.assertEqual(o["surfaces"][1]["material"]["index"], 1.5)
        self.assertTrue(o["surfaces"][1]["clearAperture"]["checked"])

    def test_oslo_quoted_semicolons_and_comments(self):
        source = LEN.replace('"simple"', '"a; // b \\"c\\""') + '// ignored comment\n'
        self.assertEqual(parse_text(source, "oslo")["name"], 'a; // b "c"')

    def test_strict_and_partial(self):
        for fmt, text in (("zemax", ZMX), ("oslo", LEN)):
            self.assertEqual(parse_text(text, fmt, strict=True)["diagnostics"], [])
            modified = text.replace("SURF 0" if fmt == "zemax" else "TH 1e20", "BOGUS 2\n" + ("SURF 0" if fmt == "zemax" else "TH 1e20"))
            partial = parse_text(modified, fmt)
            self.assertTrue(any(d.get("command") == "BOGUS" for d in partial["diagnostics"]))
            self.assertTrue(any(r["text"] == "BOGUS 2" for r in partial["raw"]["records"]))
            with self.assertRaises(ValueError):
                parse_text(modified, fmt, strict=True)

    def test_invalid_and_nonfinite(self):
        for fmt, text in (("zemax", ZMX.replace("CURV 0.05", "CURV nope")), ("zemax", ZMX.replace("CURV 0.05", "CURV NaN")), ("oslo", LEN.replace("RD 20", "RD NaN")), ("oslo", LEN.replace("END 3", "END 2")), ("oslo", LEN.replace('"simple"', '"broken')), ("zemax", "SURF 0\nCURV 0"), ("oslo", "NXT\nEND 1")):
            with self.subTest(format=fmt, text=text), self.assertRaises(ValueError):
                parse_text(text, fmt)
        with self.assertRaisesRegex(ValueError, "NaN"):
            dumps({"x": math.nan})
        self.assertEqual(json.loads(dumps({"x": -math.inf}))["x"], {"special": "negativeInfinity"})

    def test_fields_and_wavelength_slots(self):
        z = parse_text(ZMX.replace("WAVM 1 0.55 1\nPWAV 1", "FTYP 0 0 2 2\nXFLD 0 0 99\nYFLD 0 10 99\nWAVM 2 0.6 2\nWAVM 1 0.5 1\nWAVM 3 0.9 1\nPWAV 2"), "zemax")
        self.assertEqual([p["y"] for p in z["fields"]["points"]], [0, 10])
        self.assertEqual(z["wavelengths"]["valuesUm"], [0.5, 0.6])
        self.assertEqual(z["wavelengths"]["primaryIndex"], 1)

    def test_oslo_configs_and_unresolved_solves(self):
        source = LEN + "CFG NEW\nTH 1 2 8\nWV1 2 0.6\nEND\n"
        result = parse_text(source, "oslo")
        self.assertEqual(result["surfaces"][1]["thicknessMm"], 2)
        self.assertEqual(result["raw"]["configurations"]["2"]["thicknesses"]["1"], 8)
        parser = OsloDataParser("memory")
        model = parser.parse(source)
        self.assertEqual(select_configuration(model, 2).surfaces[1]["TH"], 8)
        self.assertEqual(model.surfaces[1]["TH"], 2)
        constrained = parse_text(LEN.replace("TH 20", "PY 0; TH 20; PY 0"), "oslo")
        self.assertTrue(any(d["code"] == "unresolved_constraints" for d in constrained["diagnostics"]))

    def test_reusing_parser_has_fresh_state(self):
        for cls, source in ((ZemaxDataParser, ZMX), (OsloDataParser, LEN)):
            parser = cls("memory")
            self.assertEqual(parser.parse(source).to_dict(), parser.parse(source).to_dict())

    def test_runtime_dependency_boundary(self):
        self.assertFalse(any(n == "optiland" or n.startswith("optiland.") for n in sys.modules))
        for path in (ROOT / "python/src").rglob("*.py"):
            for node in ast.walk(ast.parse(path.read_text())):
                if isinstance(node, ast.Import):
                    self.assertTrue(all(not alias.name.startswith("optiland") for alias in node.names))
                if isinstance(node, ast.ImportFrom):
                    self.assertFalse((node.module or "").startswith("optiland"))

    def test_cli(self):
        command = [sys.executable, "-m", "optical_import", str(ROOT / "fixtures/zemax/lens1.zmx")]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["source"]["format"], "zemax")
        failed = subprocess.run([sys.executable, "-m", "optical_import", "missing.zmx"], capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(failed.stdout, "")


if __name__ == "__main__":
    unittest.main()
