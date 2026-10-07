// Derived from Optiland master parser/model/configurations/syntax; see LICENSE.
import { DeclarationError, PrescriptionParseError } from "./errors.js";
import { OSLO_COEFFICIENTS } from "./models.js";
import type { OsloCoefficient, OsloConfiguration, OsloModel, OsloSurface } from "./models.js";
import { LINE_BREAKS, parseInteger, parseNumber, requireLength } from "./numbers.js";

export function tokenize(statement: string): string[] {
  return statement.match(/"(?:\\.|[^"\\])*"|[^\s,]+/g) ?? [];
}
export function decodeText(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
  return value.replace(/\\(["\\])/g, "$1");
}
/** Split a line at unquoted `;`, dropping a trailing `//` comment. */
function statements(line: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quoted) escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted) {
      if (line.slice(i, i + 2) === "//") {
        line = line.slice(0, i);
        break;
      }
      if (char === ";") {
        result.push(line.slice(start, i));
        start = i + 1;
      }
    }
  }
  if (quoted) throw new DeclarationError("unterminated quoted string");
  result.push(line.slice(start));
  return result;
}

/** d, F and C lines: OSLO's default wavelengths, in micrometers. */
export const DEFAULT_WAVELENGTHS = [0.58756, 0.48613, 0.65627];

/** Which quantity each pickup or direct command controls; setting one clears the others. */
const FAMILIES = new Map([
  ["CV", "CV"],
  ["CVM", "CV"],
  ["TH", "TH"],
  ["THM", "TH"],
  ["LN", "TH"],
  ["LNM", "TH"],
  ["AP", "AP"],
  ["GLA", "GLA"],
  ["TD", "TD"],
  ["TDM", "TD"],
]);
const FAMILY_SOLVES = new Map<string, readonly string[]>([
  ["CV", ["PU", "PUC"]],
  ["TH", ["PY", "PYC", "EC"]],
]);
const PICKUP_LENGTHS = new Map([
  ["LN", [4, 5]],
  ["LNM", [4, 5]],
  ["CV", [3, 4]],
  ["CVM", [3, 4]],
  ["TH", [3, 4]],
  ["THM", [3, 4]],
]);
const words = (list: string) => new Set(list.split(" "));
const ONE_ARGUMENT = words(
  "EBR FNO NAO NAP PUK UNI ANG OBH GIH RD RDF CV CVF TH THF CC CVX RDX AD AE AF AG DCX DCY DCZ TLA TLB TLC DT GC " +
    "TOX TOY TOZ APN PFL PFM GSP GOR TCE PY PYC PU PUC EC GTO TELE APCK",
);
const NO_ARGUMENTS = words("AIR AIF RFL RFH AST BEN NXT ATD CXD APD GCD RCD BED PFD TDD CSD TSD");
const DELETIONS = words("ATD CXD APD GCD RCD BED PFD TDD CSD TSD");
const COEFFICIENTS: ReadonlySet<string> = new Set(OSLO_COEFFICIENTS);
const KNOWN = words(
  "LEN EBR OBH ANG GIH UNI AIR RFL RFH AIF GLA GLF RD RDF CV CVF RDX TH THF AP APF APCK ASP AST WV WW NXT GTO END " +
    "PY PYC PU PUC EC PK FNO NAO NAP PUK TELE DES PFL NOT LMO RCO BEN",
);
const DRAWING = words("DRW LDP CBK ELMDF1 ELMDF2 BDI BDD VX PF LMN LME");
const ASPHERE_CODES = new Map([
  ["0", "ADO"],
  ["1", "ASR"],
  ["2", "ASX"],
]);
const DELETED_KEYS = new Map<string, readonly string[]>([
  ["CXD", ["CVX"]],
  ["APD", ["APN"]],
  ["GCD", ["GC"]],
  ["RCD", ["RCO"]],
  ["BED", ["BEN"]],
  ["PFD", ["PFL", "PFM"]],
  ["TDD", ["DCX", "DCY", "DCZ", "TLA", "TLB", "TLC", "DT", "TOX", "TOY", "TOZ", "GC", "RCO", "BEN"]],
]);
const DELETED_FAMILY = new Map([
  ["CSD", "CV"],
  ["TSD", "TH"],
  ["TDD", "TD"],
]);

const isCoefficient = (command: string): command is OsloCoefficient => COEFFICIENTS.has(command);
const isGeneralCoefficient = (command: string): command is `AS${number}` => /^AS\d+$/.test(command);
const isSpectrumSlot = (command: string) => /^W[VW][1-9]\d*$/.test(command);
const newConfiguration = (): OsloConfiguration => ({
  thicknesses: {},
  wavelengths: {},
  wavelength_weights: {},
  weight: 1,
  active: true,
});

function configuration(model: OsloModel, token: string | undefined, minimum = 1): OsloConfiguration {
  const index = parseInteger(token);
  if (index < minimum || index > 1000) {
    throw new DeclarationError(`configuration index must be between ${minimum} and 1000`);
  }
  for (let i = 1; i < index; i++) model.configurations[i] ??= newConfiguration();
  return (model.configurations[index] ??= newConfiguration());
}

/** Read one configuration override; returns false when the command is not one. */
function readConfiguration(model: OsloModel, tokens: readonly string[]): boolean {
  const command = tokens[0] ?? "";
  let target: Record<number, number>;
  let key: number;
  if (command === "TH") {
    requireLength(tokens, 4, "configuration TH requires surface, configuration, value");
    key = parseInteger(tokens[1]);
    if (key < 0 || key > model.num_surfaces) {
      throw new DeclarationError("configuration TH surface is outside the declared lens");
    }
    target = configuration(model, tokens[2], 2).thicknesses;
  } else if (isSpectrumSlot(command)) {
    requireLength(tokens, 3, `configuration ${command} requires configuration and value`);
    const config = configuration(model, tokens[1], 2);
    key = parseInteger(command.slice(2));
    if (key > 1001) throw new DeclarationError("configuration wavelength index exceeds 1001");
    target = command.startsWith("WV") ? config.wavelengths : config.wavelength_weights;
  } else if (command === "CFWT" || command === "CFAC") {
    requireLength(tokens, 3);
    const config = configuration(model, tokens[1]);
    const argument = tokens[2] ?? "";
    if (command === "CFAC") {
      if (!["YES", "NO"].includes(argument.toUpperCase())) throw new DeclarationError("CFAC expects YES or NO");
      config.active = argument.toUpperCase() === "YES";
    } else {
      const value = parseNumber(argument);
      if (!Number.isFinite(value) || value < 0) {
        throw new DeclarationError("CFWT weight must be finite and nonnegative");
      }
      config.weight = value;
    }
    return true;
  } else return false;
  const value = parseNumber(tokens.at(-1));
  if (!Number.isFinite(value)) throw new DeclarationError(`configuration ${command} requires a finite value`);
  if (command.startsWith("WV") && value <= 0) {
    throw new DeclarationError("configuration wavelengths must be positive");
  }
  if (command.startsWith("WW") && value < 0) {
    throw new DeclarationError("configuration wavelength weights must be nonnegative");
  }
  target[key] = value;
  return true;
}

/** Check that a configuration's wavelength overrides leave a usable spectrum. */
function checkSpectrum(model: OsloModel, config: OsloConfiguration): void {
  const values = [...model.wavelengths.values];
  const weights = [...model.wavelengths.weights];
  const bySlot = (entries: Record<number, number>) =>
    Object.entries(entries).map(([slot, value]) => [Number(slot), value] as const);
  for (const [slot, value] of bySlot(config.wavelengths).sort(([a], [b]) => a - b)) {
    if (slot > values.length + 1) throw new DeclarationError("configuration leaves undefined wavelength slots");
    if (slot === values.length + 1) {
      values.push(value);
      weights.push(1);
    } else values[slot - 1] = value;
  }
  for (const [slot, weight] of bySlot(config.wavelength_weights)) {
    if (slot > values.length) throw new DeclarationError("configuration weight references an undefined wavelength");
    weights[slot - 1] = weight;
  }
  if (!weights[0]) throw new DeclarationError("configuration primary wavelength weight must be positive");
}

export function parseOslo(text: string): OsloModel {
  const model: OsloModel = {
    name: null,
    scaling: 1,
    num_surfaces: 0,
    aperture: {},
    fields: {},
    wavelengths: { values: [], weights: [], primary_index: 0 },
    surfaces: {},
    units: 1,
    records: [],
    notes: {},
    diagnostics: [],
    settings: {},
    configurations: { 1: newConfiguration() },
  };
  let surface = 0;
  let current: OsloSurface = {};
  let values = [...DEFAULT_WAVELENGTHS];
  let weights: number[] = [];
  let lineNumber = 0;
  let ended = false;
  let fieldTable = false;
  let ignoreFooter = false;
  let seenLen = false;
  let configTable = false;
  let seenConfig = false;
  const coefficientLines = new Map<string, number>();

  const unsupported = (command: string, message = "unsupported command", line = lineNumber) => {
    model.diagnostics.push({ command, line, surface, message });
  };
  const remove = (keys: readonly string[]) => {
    const record: Record<string, unknown> = current;
    for (const key of keys) delete record[key];
  };
  const clearConstraint = (kind: string) => {
    const family = FAMILIES.get(kind);
    if (current.pickups) {
      current.pickups = current.pickups.filter((pickup) => FAMILIES.get((pickup[0] ?? "").toUpperCase()) !== family);
    }
    remove(FAMILY_SOLVES.get(family ?? "") ?? []);
  };
  const requireFiniteNumbers = (tokens: readonly string[]) => {
    for (const token of tokens.slice(1)) {
      let value: number;
      try {
        value = parseNumber(token);
      } catch {
        continue;
      }
      if (!Number.isFinite(value)) throw new DeclarationError(`${tokens[0]} requires finite numeric input`);
    }
  };
  const validateCommand = (tokens: readonly string[]) => {
    const command = tokens[0] ?? "";
    if (ONE_ARGUMENT.has(command)) requireLength(tokens, 2, `${command} requires exactly one argument`);
    if (NO_ARGUMENTS.has(command)) requireLength(tokens, 1, `${command} does not take arguments`);
    if (command === "RCO" && ![1, 2].includes(tokens.length)) {
      throw new DeclarationError("RCO takes at most one surface reference");
    }
    if (command === "ASP") {
      if (![2, 3].includes(tokens.length)) {
        throw new DeclarationError("ASP expects a type and optional coefficient count");
      }
      if (tokens.length === 3 && (parseInteger(tokens[2]) < 0 || parseInteger(tokens[2]) > 256)) {
        throw new DeclarationError("ASP coefficient count must be between 0 and 256");
      }
    }
    if (["EBR", "FNO", "NAO", "NAP"].includes(command) && parseNumber(tokens[1]) <= 0) {
      throw new DeclarationError(`${command} must be positive`);
    }
    if (command === "DT" && ![-1, 1].includes(parseNumber(tokens[1]))) {
      throw new DeclarationError("DT must be -1 or 1");
    }
    if (["GC", "GOR"].includes(command) && !Number.isInteger(parseNumber(tokens[1]))) {
      throw new DeclarationError(`${command} requires an integer`);
    }
    if (["GLA", "GLF"].includes(command)) {
      if (tokens.length < 2 || (tokens[1]?.toUpperCase() === "MOD" && tokens.length < 3)) {
        throw new DeclarationError("GLA requires a glass name or index data");
      }
    }
  };
  const readSpectrum = (tokens: readonly string[]) => {
    const command = tokens[0] ?? "";
    const numbers = tokens.slice(1).map((token) => parseNumber(token));
    const wavelength = command.startsWith("WV");
    if (!numbers.length || numbers.some((value) => (wavelength ? value <= 0 : value < 0))) {
      throw new DeclarationError(`${command} requires positive wavelengths/nonnegative weights`);
    }
    if (command.length === 2) {
      if (wavelength) values = numbers;
      else weights = numbers;
      return;
    }
    const index = parseInteger(command.slice(2)) - 1;
    const [value] = numbers;
    if (index > 1000 || numbers.length !== 1 || value === undefined) {
      throw new DeclarationError(`${command} requires one value and a bounded wavelength index`);
    }
    const target = wavelength ? values : weights;
    if (wavelength && index > target.length) throw new DeclarationError(`${command} leaves undefined wavelength slots`);
    while (target.length <= index) target.push(1);
    target[index] = value;
  };
  const readEnd = (tokens: readonly string[]) => {
    if (tokens.length > 2 || (tokens.length === 2 && parseInteger(tokens[1]) !== model.num_surfaces)) {
      throw new DeclarationError("END surface count differs from LEN");
    }
    model.surfaces[surface] = current;
    ended = true;
  };
  const readFieldRow = (tokens: readonly string[]) => {
    requireFiniteNumbers(tokens);
    if (![12, 14].includes(tokens.length)) {
      throw new DeclarationError("F requires an index and ten field-table values");
    }
    const index = parseInteger(tokens[1]);
    const numbers = tokens.slice(2).map((token) => parseNumber(token));
    const [y = 0, x = 0, , , , yMin = 0, yMax = 0, xMin = 0, xMax = 0, weight = 0] = numbers;
    if (index < 1 || weight < 0) throw new DeclarationError("F requires a positive index and nonnegative weight");
    if (numbers.slice(2, 5).some(Boolean) || numbers.slice(10).some(Boolean)) {
      unsupported("F", "field depth, reference-ray aiming or extended flags are not mapped");
    }
    if (!(yMin < yMax && xMin < xMax)) throw new DeclarationError("F pupil bounds must be increasing");
    let vy = 1 - yMax;
    let vx = 1 - xMax;
    if (yMin !== -yMax || xMin !== -xMax) {
      unsupported("F", "asymmetric field pupil bounds are not mapped");
      vy = vx = 0;
    }
    (model.fields.points ??= {})[index] = { y, x, weight, vy, vx };
  };
  /** Everything after the prescription's END: configurations, field tables and operating data. */
  const readFooter = (tokens: readonly string[]) => {
    const command = tokens[0] ?? "";
    if (ignoreFooter) {
      unsupported(command, "remaining footer block retained but not interpreted");
      return;
    }
    if (configTable) {
      if (command === "CFG") throw new DeclarationError("nested CFG table");
      if (command === "END") {
        requireLength(tokens, 1, "configuration END takes no arguments");
        configTable = false;
      } else if (!readConfiguration(model, tokens)) unsupported(command, "configuration override is not mapped");
      return;
    }
    if (command === "CFG") {
      if (tokens.map((token) => token.toUpperCase()).join(" ") !== "CFG NEW") {
        ignoreFooter = true;
        unsupported(command, "only declarative CFG NEW is imported");
        return;
      }
      if (seenConfig) throw new DeclarationError("multiple CFG tables are not supported");
      seenConfig = configTable = true;
      fieldTable = false;
    } else if (command === "CFWT" || command === "CFAC") readConfiguration(model, tokens);
    else if (command === "LEN") {
      ignoreFooter = true;
      unsupported(command, "additional configurations are not imported");
    } else if (command === "RST") {
      fieldTable = tokens.length === 2 && tokens[1]?.toUpperCase() === "NEW";
      if (fieldTable) model.fields.points = {};
    } else if (command === "END") fieldTable = false;
    else if (command === "F" && fieldTable) readFieldRow(tokens);
    else unsupported(command, "footer command retained but not interpreted");
  };
  const readSurfaceCommand = (command: string, tokens: readonly string[]) => {
    const num = (index = 1) => parseNumber(tokens[index]);
    const argument = (tokens[1] ?? "").toUpperCase();
    switch (command) {
      case "LEN":
        if (seenLen || tokens.length !== 5 || argument !== "NEW") {
          throw new DeclarationError('LEN expects NEW "name" scaling surface-count');
        }
        seenLen = true;
        model.name = decodeText(tokens[2] ?? "");
        model.scaling = num(3);
        model.num_surfaces = parseInteger(tokens[4]);
        if (model.num_surfaces < 1 || model.num_surfaces > 10000) {
          throw new DeclarationError("LEN surface count must be between 1 and 10000");
        }
        break;
      case "EBR":
        model.aperture = { EPD: 2 * num() };
        break;
      case "FNO":
        model.aperture = { FNO: num() };
        break;
      case "NAO":
        model.aperture = { NAO: num() };
        break;
      case "NAP":
        model.aperture = { NAP: num() };
        break;
      case "PUK":
        model.aperture = { PUK: Math.abs(num()) };
        break;
      case "ANG":
        model.fields = { type: "angle", y: [num()] };
        break;
      case "OBH":
        model.fields = { type: "object_height", y: [num()] };
        break;
      case "GIH":
        model.fields = { type: "gaussian_image_height", y: [num()] };
        break;
      case "UNI":
        model.units = num();
        if (model.units <= 0) throw new DeclarationError("UNI must be positive (millimeters per lens unit)");
        break;
      case "AIR":
      case "AIF":
        clearConstraint("GLA");
        current.material = "AIR";
        break;
      case "RFL":
      case "RFH":
        clearConstraint("GLA");
        current.material = "RFL";
        break;
      case "GLA":
      case "GLF":
        clearConstraint("GLA");
        current.material = "GLA " + tokens.slice(1).join(" ");
        current.glass_wavelengths = [...values];
        break;
      case "RD":
      case "RDF":
        clearConstraint("CV");
        current.RD = num() || Infinity;
        break;
      case "CV":
      case "CVF":
        clearConstraint("CV");
        current.RD = num() ? 1 / num() : Infinity;
        break;
      case "RDX":
        current.CVX = num() ? 1 / num() : 0;
        break;
      case "ASP":
        current.ASP = ASPHERE_CODES.get(argument) ?? argument;
        if (!["ADO", "ASR", "ASX", "ARA"].includes(current.ASP)) {
          unsupported("ASP", `asphere type ${current.ASP} is not mapped`);
        }
        break;
      case "TH":
      case "THF":
        clearConstraint("TH");
        current.TH = num();
        break;
      case "AP":
      case "APF": {
        clearConstraint("AP");
        const index = ["CHK", "UNC"].includes(argument) ? 2 : 1;
        requireLength(tokens, index + 1, "AP expects an optional CHK/UNC flag and one radius");
        if (num(index) < 0) throw new DeclarationError("AP radius must be nonnegative");
        current.AP = num(index);
        current.aperture_checked = argument === "CHK";
        break;
      }
      case "APCK":
      case "TELE":
        if (!["ON", "OFF", "1", "0"].includes(argument)) throw new DeclarationError(`${command} expects ON or OFF`);
        model.settings[command === "APCK" ? "aperture_check" : "telecentric"] = ["ON", "1"].includes(argument);
        break;
      case "AST":
        for (const other of Object.values(model.surfaces)) delete other.AST;
        current.AST = true;
        break;
      case "PFL":
        current.PFL = num();
        break;
      case "NOT":
        current.note = decodeText(tokens.slice(1).join(" "));
        break;
      case "LMO":
        if (!["EGR", "ELE"].includes(argument)) unsupported("LMO", "non-sequential groups are not mapped");
        break;
      case "RCO":
        current.RCO = tokens.length > 1 ? parseInteger(tokens[1]) || surface : surface;
        break;
      case "BEN":
        current.BEN = true;
        break;
      case "WV":
      case "WW":
        readSpectrum(tokens);
        break;
      case "NXT":
        model.surfaces[surface] = current;
        surface++;
        if (surface > model.num_surfaces) throw new DeclarationError("NXT exceeds LEN surface count");
        current = model.surfaces[surface] ?? {};
        break;
      case "GTO":
        model.surfaces[surface] = current;
        surface = parseInteger(tokens[1]);
        if (surface < 0 || surface > model.num_surfaces) {
          throw new DeclarationError("GTO surface is outside the declared lens");
        }
        current = model.surfaces[surface] ?? {};
        break;
      case "END":
        readEnd(tokens);
        break;
      case "PU":
      case "PUC":
        clearConstraint("CV");
        current[command] = num();
        break;
      case "PY":
      case "PYC":
      case "EC":
        clearConstraint("TH");
        current[command] = num();
        break;
      case "PK": {
        if (tokens.length < 3) throw new DeclarationError("PK requires a pickup type and preceding source");
        if (!FAMILIES.has(argument)) {
          unsupported("PK", `pickup type ${tokens[1]} is not mapped`);
          break;
        }
        if (!(PICKUP_LENGTHS.get(argument) ?? [3]).includes(tokens.length)) {
          throw new DeclarationError(`PK ${argument} has an invalid number of arguments`);
        }
        parseInteger(tokens[2]);
        if (["LN", "LNM"].includes(argument)) parseInteger(tokens[3]);
        clearConstraint(argument);
        (current.pickups ??= []).push(tokens.slice(1));
        break;
      }
    }
  };
  const readStatement = (statement: string) => {
    const tokens = tokenize(statement);
    if (!tokens[0]) return;
    model.records.push({ line: lineNumber, text: statement.trim() });
    const command = tokens[0].toUpperCase();
    tokens[0] = command;
    if (ended) return readFooter(tokens);
    if (/^SNO\d+$/.test(command) || command === "DES") {
      model.notes[command] = decodeText(tokens.slice(1).join(" "));
      return;
    }
    if (isSpectrumSlot(command)) {
      requireFiniteNumbers(tokens);
      readSpectrum(tokens);
      return;
    }
    if (isGeneralCoefficient(command)) {
      requireFiniteNumbers(tokens);
      requireLength(tokens, 2);
      current[command] = parseNumber(tokens[1]);
      coefficientLines.set(`${surface}:${command}`, lineNumber);
      return;
    }
    if (DRAWING.has(command)) return;
    if (!KNOWN.has(command) && !DELETIONS.has(command) && !isCoefficient(command)) return unsupported(command);
    requireFiniteNumbers(tokens);
    validateCommand(tokens);
    if (isCoefficient(command)) {
      requireLength(tokens, 2);
      current[command] = parseNumber(tokens[1]);
      return;
    }
    if (DELETIONS.has(command)) {
      if (command === "ATD") {
        const asphere = ["CC", "AD", "AE", "AF", "AG", "ASP"];
        remove(Object.keys(current).filter((key) => asphere.includes(key) || isGeneralCoefficient(key)));
      } else remove(DELETED_KEYS.get(command) ?? []);
      const family = DELETED_FAMILY.get(command);
      if (family) clearConstraint(family);
      return;
    }
    readSurfaceCommand(command, tokens);
  };

  for (const [lineIndex, line] of text.split(LINE_BREAKS).entries()) {
    lineNumber = lineIndex + 1;
    try {
      for (const statement of statements(line)) readStatement(statement);
    } catch (error) {
      if (!(error instanceof DeclarationError)) throw error;
      throw new PrescriptionParseError("invalid_prescription", `line ${lineNumber}: ${error.message}`, {
        line: lineNumber,
        cause: error,
      });
    }
  }
  if (configTable) throw new DeclarationError("unterminated CFG table");
  if (!ended) readEnd(["END"]);
  if (!seenLen) throw new DeclarationError("missing LEN NEW prescription");
  const indices = Object.keys(model.surfaces)
    .map(Number)
    .sort((a, b) => a - b);
  if (indices.length !== model.num_surfaces + 1 || indices.some((value, i) => value !== i)) {
    throw new DeclarationError("surface records do not match LEN count");
  }
  for (const index of indices) {
    const data = model.surfaces[index] ?? {};
    const coefficient = Object.keys(data).find(isGeneralCoefficient);
    if ((data.ASP ?? "ADO") === "ADO" && coefficient !== undefined) {
      surface = index;
      const line = coefficientLines.get(`${index}:${coefficient}`) ?? lineNumber;
      unsupported("ASn", "general coefficients require ASP ASR/ARA/ASX", line);
    }
  }
  model.wavelengths.values = values;
  model.wavelengths.weights = [...weights, ...Array<number>(values.length).fill(1)].slice(0, values.length);
  if (!model.wavelengths.weights.some(Boolean)) {
    throw new DeclarationError("wavelength weights cannot all be zero");
  }
  if ((weights[0] ?? 1) === 0) throw new DeclarationError("OSLO primary wavelength weight must be positive");
  for (const config of Object.values(model.configurations)) checkSpectrum(model, config);
  return model;
}
