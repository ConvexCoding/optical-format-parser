// Derived from Optiland master parser/model/configurations/syntax; see UPSTREAM.json and LICENSE.
import { integer, number, requireLength } from "./numbers.js";
import type { NativeRecord } from "./types.js";

export function tokenize(statement: string): string[] {
  return statement.match(/"(?:\\.|[^"\\])*"|[^\s,]+/g) ?? [];
}
export function decodeText(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
  return value.replace(/\\(["\\])/g, "$1");
}
function statements(line: string): string[] {
  const result = []; let start = 0, quoted = false, escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quoted) escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted) {
      if (line.slice(i, i + 2) === "//") { line = line.slice(0, i); break; }
      if (char === ";") { result.push(line.slice(start, i)); start = i + 1; }
    }
  }
  if (quoted) throw new Error("unterminated quoted string");
  result.push(line.slice(start)); return result;
}
const families: Record<string, string> = { CV: "CV", CVM: "CV", TH: "TH", THM: "TH", LN: "TH", LNM: "TH", AP: "AP", GLA: "GLA", TD: "TD", TDM: "TD" };
const defaults = [0.58756, 0.48613, 0.65627];
const configDefaults = () => ({ thicknesses: {}, wavelengths: {}, wavelength_weights: {}, weight: 1, active: true });

function configuration(model: NativeRecord, token: string, minimum = 1): NativeRecord {
  const index = integer(token);
  if (index < minimum || index > 1000) throw new Error(`configuration index must be between ${minimum} and 1000`);
  for (let i = 1; i <= index; i++) model.configurations[i] ??= configDefaults();
  return model.configurations[index];
}
function readConfiguration(model: NativeRecord, tokens: string[]): boolean {
  const cmd = tokens[0]; let target: NativeRecord, key: number;
  if (cmd === "TH") {
    requireLength(tokens, 4, "configuration TH requires surface, configuration, value");
    key = integer(tokens[1]);
    if (key < 0 || key > model.num_surfaces) throw new Error("configuration TH surface is outside the declared lens");
    target = configuration(model, tokens[2], 2).thicknesses;
  } else if (/^W[VW][1-9]\d*$/.test(cmd)) {
    requireLength(tokens, 3, `configuration ${cmd} requires configuration and value`);
    const cfg = configuration(model, tokens[1], 2); key = integer(cmd.slice(2));
    if (key > 1001) throw new Error("configuration wavelength index exceeds 1001");
    target = cmd.startsWith("WV") ? cfg.wavelengths : cfg.wavelength_weights;
  } else if (cmd === "CFWT" || cmd === "CFAC") {
    requireLength(tokens, 3);
    const cfg = configuration(model, tokens[1]);
    if (cmd === "CFAC") {
      if (!["YES", "NO"].includes(tokens[2].toUpperCase())) throw new Error("CFAC expects YES or NO");
      cfg.active = tokens[2].toUpperCase() === "YES";
    } else {
      const value = number(tokens[2]);
      if (!Number.isFinite(value) || value < 0) throw new Error("CFWT weight must be finite and nonnegative");
      cfg.weight = value;
    }
    return true;
  } else return false;
  const value = number(tokens[tokens.length - 1]);
  if (!Number.isFinite(value)) throw new Error(`configuration ${cmd} requires a finite value`);
  if (cmd.startsWith("WV") && value <= 0) throw new Error("configuration wavelengths must be positive");
  if (cmd.startsWith("WW") && value < 0) throw new Error("configuration wavelength weights must be nonnegative");
  target[key] = value; return true;
}
function checkSpectrum(model: NativeRecord, cfg: NativeRecord): void {
  const values = [...model.wavelengths.values], weights = [...model.wavelengths.weights];
  for (const [slot, value] of Object.entries(cfg.wavelengths).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const index = Number(slot);
    if (index > values.length + 1) throw new Error("configuration leaves undefined wavelength slots");
    if (index === values.length + 1) { values.push(value); weights.push(1); } else values[index - 1] = value;
  }
  for (const [slot, weight] of Object.entries(cfg.wavelength_weights)) {
    const index = Number(slot);
    if (index > values.length) throw new Error("configuration weight references an undefined wavelength");
    weights[index - 1] = weight;
  }
  if (!weights[0]) throw new Error("configuration primary wavelength weight must be positive");
}

export function parseOslo(text: string, filename: string, strict: boolean): NativeRecord {
  const model: NativeRecord = { name: null, scaling: 1, num_surfaces: 0, aperture: {}, fields: {},
    wavelengths: { values: [], weights: [], primary_index: 0 }, surfaces: {}, units: 1, records: [], notes: {},
    diagnostics: [], settings: {}, configurations: { 1: configDefaults() } };
  let surface = 0, current: NativeRecord = {}, values = [...defaults], weights: number[] = [];
  let lineNumber = 0, ended = false, fieldTable = false, ignoreFooter = false, seenLen = false, configTable = false, seenCfg = false;
  const coefficientLines = new Map<string, number>();
  const unsupported = (command: string, message = "unsupported command", line = lineNumber) => {
    model.diagnostics.push({ command, line, surface, message });
    if (strict) throw new Error(`OSLO ${command} at surface ${surface}: ${message}; import may be incomplete`);
  };
  const clearConstraint = (kind: string) => {
    const family = families[kind];
    if (current.pickups) current.pickups = current.pickups.filter((p: string[]) => families[p[0].toUpperCase()] !== family);
    for (const key of ({ CV: ["PU", "PUC"], TH: ["PY", "PYC", "EC"] } as Record<string, string[]>)[family] ?? []) delete current[key];
  };
  const validateNumbers = (tokens: string[]) => {
    for (const token of tokens.slice(1)) {
      let value; try { value = number(token); } catch { continue; }
      if (!Number.isFinite(value)) throw new Error(`${tokens[0]} requires finite numeric input`);
    }
  };
  const scalar = new Set("EBR FNO NAO NAP PUK UNI ANG OBH GIH RD RDF CV CVF TH THF CC CVX RDX AD AE AF AG DCX DCY DCZ TLA TLB TLC DT GC TOX TOY TOZ APN PFL PFM GSP GOR TCE PY PYC PU PUC EC GTO TELE APCK".split(" "));
  const noArgs = new Set("AIR AIF RFL RFH AST BEN NXT ATD CXD APD GCD RCD BED PFD TDD CSD TSD".split(" "));
  const validateCommand = (tokens: string[]) => {
    const cmd = tokens[0];
    if (scalar.has(cmd)) requireLength(tokens, 2, `${cmd} requires exactly one argument`);
    if (noArgs.has(cmd)) requireLength(tokens, 1, `${cmd} does not take arguments`);
    if (cmd === "RCO" && ![1, 2].includes(tokens.length)) throw new Error("RCO takes at most one surface reference");
    if (cmd === "ASP") {
      if (![2, 3].includes(tokens.length)) throw new Error("ASP expects a type and optional coefficient count");
      if (tokens.length === 3 && (integer(tokens[2]) < 0 || integer(tokens[2]) > 256)) throw new Error("ASP coefficient count must be between 0 and 256");
    }
    if (["EBR", "FNO", "NAO", "NAP"].includes(cmd) && number(tokens[1]) <= 0) throw new Error(`${cmd} must be positive`);
    if (cmd === "DT" && ![-1, 1].includes(number(tokens[1]))) throw new Error("DT must be -1 or 1");
    if (["GC", "GOR"].includes(cmd) && !Number.isInteger(number(tokens[1]))) throw new Error(`${cmd} requires an integer`);
    if (["GLA", "GLF"].includes(cmd) && (tokens.length < 2 || (tokens[1].toUpperCase() === "MOD" && tokens.length < 3))) throw new Error("GLA requires a glass name or index data");
  };
  const spectrum = (tokens: string[]) => {
    const cmd = tokens[0], nums = tokens.slice(1).map(number), wavelength = cmd.startsWith("WV");
    if (!nums.length || nums.some(v => wavelength ? v <= 0 : v < 0)) throw new Error(`${cmd} requires positive wavelengths/nonnegative weights`);
    if (cmd.length === 2) { if (wavelength) values = nums; else weights = nums; return; }
    const index = integer(cmd.slice(2)) - 1;
    if (index > 1000 || nums.length !== 1) throw new Error(`${cmd} requires one value and a bounded wavelength index`);
    const target = wavelength ? values : weights;
    if (wavelength && index > target.length) throw new Error(`${cmd} leaves undefined wavelength slots`);
    while (target.length <= index) target.push(1);
    target[index] = nums[0];
  };
  const readEnd = (tokens: string[]) => {
    if (tokens.length > 2 || (tokens.length === 2 && integer(tokens[1]) !== model.num_surfaces)) throw new Error("END surface count differs from LEN");
    model.surfaces[surface] = current; ended = true;
  };
  const footer = (tokens: string[]) => {
    const cmd = tokens[0];
    if (ignoreFooter) { unsupported(cmd, "remaining footer block retained but not interpreted"); return; }
    if (configTable) {
      if (cmd === "CFG") throw new Error("nested CFG table");
      if (cmd === "END") { requireLength(tokens, 1, "configuration END takes no arguments"); configTable = false; }
      else if (!readConfiguration(model, tokens)) unsupported(cmd, "configuration override is not mapped");
      return;
    }
    if (cmd === "CFG") {
      if (tokens.map(t => t.toUpperCase()).join(" ") !== "CFG NEW") { ignoreFooter = true; unsupported(cmd, "only declarative CFG NEW is imported"); return; }
      if (seenCfg) throw new Error("multiple CFG tables are not supported");
      seenCfg = configTable = true; fieldTable = false;
    } else if (["CFWT", "CFAC"].includes(cmd)) readConfiguration(model, tokens);
    else if (cmd === "LEN") { ignoreFooter = true; unsupported(cmd, "additional configurations are not imported"); }
    else if (cmd === "RST") { fieldTable = tokens.length === 2 && tokens[1].toUpperCase() === "NEW"; if (fieldTable) model.fields.points = {}; }
    else if (cmd === "END") fieldTable = false;
    else if (cmd === "F" && fieldTable) {
      validateNumbers(tokens);
      if (![12, 14].includes(tokens.length)) throw new Error("F requires an index and ten field-table values");
      const index = integer(tokens[1]), nums = tokens.slice(2).map(number);
      if (index < 1 || nums[9] < 0) throw new Error("F requires a positive index and nonnegative weight");
      if (nums.slice(2, 5).some(Boolean) || nums.slice(10).some(Boolean)) unsupported("F", "field depth, reference-ray aiming or extended flags are not mapped");
      let [ymin, ymax, xmin, xmax] = nums.slice(5, 9);
      if (!(ymin < ymax && xmin < xmax)) throw new Error("F pupil bounds must be increasing");
      if (ymin !== -ymax || xmin !== -xmax) { unsupported("F", "asymmetric field pupil bounds are not mapped"); ymin = xmin = -1; ymax = xmax = 1; }
      model.fields.points[index] = { y: nums[0], x: nums[1], weight: nums[9], vy: 1 - ymax, vx: 1 - xmax };
    } else unsupported(cmd, "footer command retained but not interpreted");
  };
  const deletes = new Set("ATD CXD APD GCD RCD BED PFD TDD CSD TSD".split(" "));
  const coeffs = new Set("CC CVX AD AE AF AG DCX DCY DCZ TLA TLB TLC DT GC TOX TOY TOZ APN PFM GSP GOR TCE".split(" "));
  const known = new Set("LEN EBR OBH ANG GIH UNI AIR RFL RFH AIF GLA GLF RD RDF CV CVF RDX TH THF AP APF APCK ASP AST WV WW NXT GTO END PY PYC PU PUC EC PK FNO NAO NAP PUK TELE DES PFL NOT LMO RCO BEN".split(" "));
  const drawing = new Set("DRW LDP CBK ELMDF1 ELMDF2 BDI BDD VX PF LMN LME".split(" "));
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  lines.forEach((line, lineIndex) => {
    lineNumber = lineIndex + 1;
    try {
      for (const statement of statements(line)) {
        const tokens = tokenize(statement); if (!tokens.length) continue;
        model.records.push({ line: lineNumber, text: statement.trim() });
        const cmd = tokens[0].toUpperCase(); tokens[0] = cmd;
        if (ended) { footer(tokens); continue; }
        if (/^SNO\d+$/.test(cmd) || cmd === "DES") { model.notes[cmd] = decodeText(tokens.slice(1).join(" ")); continue; }
        if (/^W[VW][1-9]\d*$/.test(cmd)) { validateNumbers(tokens); spectrum(tokens); continue; }
        if (/^AS\d+$/.test(cmd)) { validateNumbers(tokens); requireLength(tokens, 2); current[cmd] = number(tokens[1]); coefficientLines.set(`${surface}:${cmd}`, lineNumber); continue; }
        if (drawing.has(cmd)) continue;
        if (!known.has(cmd) && !deletes.has(cmd) && !coeffs.has(cmd)) { unsupported(cmd); continue; }
        validateNumbers(tokens); validateCommand(tokens);
        const n = (i = 1) => number(tokens[i]);
        if (coeffs.has(cmd)) { requireLength(tokens, 2); current[cmd] = n(); continue; }
        if (deletes.has(cmd)) {
          const keys: Record<string, string[]> = {
            ATD: Object.keys(current).filter(k => ["CC", "AD", "AE", "AF", "AG", "ASP"].includes(k) || /^AS\d+$/.test(k)),
            CXD: ["CVX"], APD: ["APN", "special_apertures", "aperture_pickups"], GCD: ["GC"], RCD: ["RCO"], BED: ["BEN"], PFD: ["PFL", "PFM"],
            TDD: ["DCX", "DCY", "DCZ", "TLA", "TLB", "TLC", "DT", "TOX", "TOY", "TOZ", "GC", "RCO", "BEN"], CSD: [], TSD: [],
          };
          for (const key of keys[cmd]) delete current[key];
          const family = ({ CSD: "CV", TSD: "TH", TDD: "TD" } as Record<string, string>)[cmd]; if (family) clearConstraint(family);
          continue;
        }
        switch (cmd) {
          case "LEN":
            if (seenLen || tokens.length !== 5 || tokens[1].toUpperCase() !== "NEW") throw new Error('LEN expects NEW "name" scaling surface-count');
            seenLen = true; model.name = decodeText(tokens[2]); model.scaling = n(3); model.num_surfaces = integer(tokens[4]);
            if (model.num_surfaces < 1 || model.num_surfaces > 10000) throw new Error("LEN surface count must be between 1 and 10000"); break;
          case "EBR": case "FNO": case "NAO": case "NAP": case "PUK": model.aperture = { [cmd === "EBR" ? "EPD" : cmd]: cmd === "EBR" ? 2 * n() : cmd === "PUK" ? Math.abs(n()) : n() }; break;
          case "ANG": case "OBH": case "GIH": model.fields = { type: ({ ANG: "angle", OBH: "object_height", GIH: "gaussian_image_height" } as Record<string, string>)[cmd], y: [n()] }; break;
          case "UNI": model.units = n(); if (model.units <= 0) throw new Error("UNI must be positive (millimeters per lens unit)"); break;
          case "AIR": case "AIF": case "RFL": case "RFH": clearConstraint("GLA"); current.material = ({ AIF: "AIR", RFH: "RFL" } as Record<string, string>)[cmd] ?? cmd; break;
          case "GLA": case "GLF": clearConstraint("GLA"); current.material = "GLA " + tokens.slice(1).join(" "); current.glass_wavelengths = [...values]; break;
          case "RD": case "RDF": clearConstraint("CV"); current.RD = n() || Infinity; break;
          case "CV": case "CVF": clearConstraint("CV"); current.RD = n() ? 1 / n() : Infinity; break;
          case "RDX": current.CVX = n() ? 1 / n() : 0; break;
          case "ASP": current.ASP = ({ "0": "ADO", "1": "ASR", "2": "ASX" } as Record<string, string>)[tokens[1]] ?? tokens[1].toUpperCase(); if (!["ADO", "ASR", "ASX", "ARA"].includes(current.ASP)) unsupported("ASP", `asphere type ${current.ASP} is not mapped`); break;
          case "TH": case "THF": clearConstraint("TH"); current.TH = n(); break;
          case "AP": case "APF": {
            clearConstraint("AP"); const index = ["CHK", "UNC"].includes(tokens[1]?.toUpperCase()) ? 2 : 1;
            requireLength(tokens, index + 1, "AP expects an optional CHK/UNC flag and one radius");
            if (n(index) < 0) throw new Error("AP radius must be nonnegative"); current.AP = n(index); current.aperture_checked = tokens[1].toUpperCase() === "CHK"; break;
          }
          case "APCK": case "TELE":
            if (!(cmd === "APCK" ? ["ON", "OFF", "1", "0"] : ["ON", "OFF", "0", "1"]).includes(tokens[1].toUpperCase())) throw new Error(`${cmd} expects ON or OFF`);
            model.settings[cmd === "APCK" ? "aperture_check" : "telecentric"] = ["ON", "1"].includes(tokens[1].toUpperCase()); break;
          case "AST": for (const s of Object.values(model.surfaces) as NativeRecord[]) delete s.AST; current.AST = true; break;
          case "PFL": current.PFL = n(); break;
          case "NOT": current.note = decodeText(tokens.slice(1).join(" ")); break;
          case "LMO": if (!["EGR", "ELE"].includes(tokens[1]?.toUpperCase())) unsupported("LMO", "non-sequential groups are not mapped"); break;
          case "RCO": current.RCO = tokens.length > 1 ? integer(tokens[1]) || surface : surface; break;
          case "BEN": current.BEN = true; break;
          case "WV": case "WW": spectrum(tokens); break;
          case "NXT": model.surfaces[surface] = current; surface++; if (surface > model.num_surfaces) throw new Error("NXT exceeds LEN surface count"); current = model.surfaces[surface] ?? {}; break;
          case "GTO": model.surfaces[surface] = current; surface = integer(tokens[1]); if (surface < 0 || surface > model.num_surfaces) throw new Error("GTO surface is outside the declared lens"); current = model.surfaces[surface] ?? {}; break;
          case "END": readEnd(tokens); break;
          case "PY": case "PYC": case "PU": case "PUC": case "EC": clearConstraint(["PU", "PUC"].includes(cmd) ? "CV" : "TH"); current[cmd] = n(); break;
          case "PK": {
            if (tokens.length < 3) throw new Error("PK requires a pickup type and preceding source");
            const kind = tokens[1].toUpperCase();
            if (!(kind in families)) { unsupported("PK", `pickup type ${tokens[1]} is not mapped`); break; }
            const expected = ({ LN: [4, 5], LNM: [4, 5], CV: [3, 4], CVM: [3, 4], TH: [3, 4], THM: [3, 4] } as Record<string, number[]>)[kind] ?? [3];
            if (!expected.includes(tokens.length)) throw new Error(`PK ${kind} has an invalid number of arguments`);
            integer(tokens[2]); if (["LN", "LNM"].includes(kind)) integer(tokens[3]); clearConstraint(kind);
            current.pickups ??= []; current.pickups.push(tokens.slice(1)); break;
          }
        }
      }
    } catch (error) { throw new Error(`${filename}:${lineNumber}: ${(error as Error).message}`); }
  });
  if (configTable) throw new Error(`${filename}: unterminated CFG table`);
  if (!ended) readEnd(["END"]);
  if (!seenLen) throw new Error(`${filename}: missing LEN NEW prescription`);
  const indices = Object.keys(model.surfaces).map(Number).sort((a, b) => a - b);
  if (indices.length !== model.num_surfaces + 1 || indices.some((v, i) => v !== i)) throw new Error(`${filename}: surface records do not match LEN count`);
  for (const index of indices) {
    const data = model.surfaces[index], coefficient = Object.keys(data).find(k => /^AS\d+$/.test(k));
    if ((data.ASP ?? "ADO") === "ADO" && coefficient !== undefined) {
      surface = index; unsupported("ASn", "general coefficients require ASP ASR/ARA/ASX", coefficientLines.get(`${index}:${coefficient}`));
    }
  }
  model.wavelengths.values = values;
  model.wavelengths.weights = [...weights, ...Array(values.length).fill(1)].slice(0, values.length);
  if (!model.wavelengths.weights.some(Boolean)) throw new Error(`${filename}: wavelength weights cannot all be zero`);
  if ((weights[0] ?? 1) === 0) throw new Error(`${filename}: OSLO primary wavelength weight must be positive`);
  for (const cfg of Object.values(model.configurations) as NativeRecord[]) checkSpectrum(model, cfg);
  return model;
}
