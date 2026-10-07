// Derived from Optiland master parser/model; see LICENSE.
import { DeclarationError, PrescriptionParseError } from "./errors.js";
import type { NativeAnnulus, ZemaxFieldColumn, ZemaxModel, ZemaxSurface } from "./models.js";
import { LINE_BREAKS, parseInteger, parseNumber } from "./numbers.js";

const FIELD_TYPES = ["angle", "object_height", "paraxial_image_height", "real_image_height", "theodolite_angle"];
const FIELD_COMMANDS = new Map<string, ZemaxFieldColumn>([
  ["XFLD", "x"],
  ["XFLN", "x"],
  ["YFLD", "y"],
  ["YFLN", "y"],
  ["FWGN", "weights"],
  ["VDXN", "vignette_decenter_x"],
  ["VDYN", "vignette_decenter_y"],
  ["VCXN", "vignette_compress_x"],
  ["VCYN", "vignette_compress_y"],
  ["VANN", "vignette_tangent_angle"],
]);
const SURFACE_TYPES = new Map([
  ["STANDARD", "standard"],
  ["EVENASPH", "even_asphere"],
  ["ODDASPHE", "odd_asphere"],
  ["COORDBRK", "coordinate_break"],
  ["TOROIDAL", "toroidal"],
]);
/** Records that carry no prescription data; reported as inert rather than as warnings. */
const INERT = new Set(["VERS", "PFIL", "LANG", "ZRD", "ZPK", "MNUM"]);
const AXES = ["x", "y"] as const;

function newSurface(line: number): ZemaxSurface {
  return { line, type: "standard", is_stop: false, conic: 0, material: "air", aperture: null };
}
/** Free text after a command: one pair of enclosing double quotes is a delimiter, not content. */
function decodeText(text: string): string {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
}

export function parseZemax(text: string): ZemaxModel {
  const model: ZemaxModel = {
    mode: "Sequential",
    units: "MM",
    records: [],
    diagnostics: [],
    name: null,
    notes: [],
    declarations: {
      units: "defaulted",
      wavelengths: "absent",
      wavelengthWeights: "absent",
      primaryWavelength: "absent",
      aperture: "explicit",
      fields: "defaulted",
      terminator: "notApplicable",
    },
    aperture: {},
    fields: {},
    wavelengths: { data: [], weights: [] },
    surfaces: {},
  };
  const fields = model.fields;
  let surface = -1;
  let current = newSurface(0);
  let offset: [number, number] = [0, 0];
  let fieldCount: number | null = null;
  let wavelengthCount: number | null = null;
  let primarySlot: number | null = null;
  const declaredColumns = new Map<ZemaxFieldColumn, number[]>();
  const slots = new Map<number, { value: number; weight: number; weighted: boolean }>();

  const syncFields = () => {
    for (const [column, values] of declaredColumns) {
      fields[column] = fieldCount === null ? [...values] : values.slice(0, fieldCount);
    }
    const declaredAxes = AXES.filter((axis) => declaredColumns.has(axis));
    // Upstream's max(..., default=1) does not force 1 for explicit empty axes.
    let count = declaredAxes.length ? Math.max(...declaredAxes.map((axis) => fields[axis]?.length ?? 0)) : 1;
    if (fieldCount !== null) count = Math.min(count, fieldCount);
    for (const axis of AXES) if (!declaredColumns.has(axis)) fields[axis] = Array<number>(count).fill(0);
    fields.num_fields = fieldCount ?? count;
  };
  const syncWavelengths = () => {
    const active = [...slots.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([slot]) => wavelengthCount === null || slot <= wavelengthCount);
    model.wavelengths.data = active.map(([, entry]) => entry.value);
    model.wavelengths.weights = active.map(([, entry]) => entry.weight);
    model.wavelengths.num_wavelengths = wavelengthCount ?? active.length;
    const weighted = active.filter(([, entry]) => entry.weighted).length;
    model.declarations.wavelengths = active.length ? "explicit" : "absent";
    model.declarations.wavelengthWeights = !active.length
      ? "absent"
      : weighted === active.length
        ? "explicit"
        : weighted
          ? "padded"
          : "defaulted";
    if (active.length) model.declarations.primaryWavelength = primarySlot === null ? "defaulted" : "explicit";
    if (primarySlot !== null) {
      const index = active.findIndex(([slot]) => slot === primarySlot);
      model.wavelengths.primary_index = index >= 0 ? index : null;
    }
  };
  const configure = (tokens: readonly string[]) => {
    const flag = (index: number, fallback = 0) => {
      try {
        return parseInteger(tokens[index]);
      } catch {
        return fallback;
      }
    };
    const declaredFields = flag(3, -1);
    const declaredWavelengths = flag(4, -1);
    fieldCount = declaredFields >= 0 ? declaredFields : null;
    wavelengthCount = declaredWavelengths >= 0 ? declaredWavelengths : null;
    fields.type = FIELD_TYPES[flag(1)] ?? "unsupported";
    fields.object_space_telecentric = flag(2) === 1;
    fields.afocal_image_space = flag(7) === 1;
    syncFields();
    syncWavelengths();
  };
  const annulus = (min: number, max: number): NativeAnnulus => ({
    kind: "annulus",
    r_min: min,
    r_max: max,
    offset_x: offset[0],
    offset_y: offset[1],
  });

  configure(["FTYP"]);
  for (const [lineIndex, rawLine] of text.split(LINE_BREAKS).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const lineNumber = lineIndex + 1;
    const tokens = line.split(/\s+/);
    const command = tokens[0] ?? "";
    const num = (index = 1) => parseNumber(tokens[index]);
    const rest = line.slice(command.length).trim();
    model.records.push({ line: lineNumber, text: line });
    try {
      const column = FIELD_COMMANDS.get(command);
      if (column) {
        declaredColumns.set(
          column,
          tokens.slice(1).map((token) => parseNumber(token)),
        );
        if (column === "x" || column === "y") model.declarations.fields = "explicit";
        syncFields();
        continue;
      }
      switch (command) {
        case "UNIT":
          if (!tokens[1]) throw new DeclarationError("UNIT requires a unit");
          model.units = tokens[1].toUpperCase();
          model.declarations.units = "explicit";
          break;
        case "NAME":
          model.name = decodeText(rest);
          break;
        case "NOTE": {
          // `NOTE n text`: the leading number is a line index, not content.
          const note = decodeText(rest.replace(/^[+-]?\d+(?:\s+|$)/, ""));
          if (note) model.notes.push(note);
          break;
        }
        case "FNUM": {
          const mode = parseInteger(tokens[2]);
          if (mode === 0) model.aperture.imageFNO = num();
          else if (mode === 1) model.aperture.paraxialImageFNO = num();
          break;
        }
        case "ENPD":
          model.aperture.EPD = num();
          break;
        case "OBNA": {
          const mode = parseInteger(tokens[2]);
          if (mode === 0) model.aperture.objectNA = num();
          else if (mode === 1) model.aperture.object_cone_angle = num();
          break;
        }
        case "FLOA":
          model.aperture.floating_stop = true;
          break;
        case "FTYP":
          configure(tokens);
          break;
        case "WAVL":
        case "WAVM": {
          const slot = command === "WAVL" ? Math.max(0, ...slots.keys()) + 1 : parseInteger(tokens[1]);
          if (slot >= 1) {
            const weighted = tokens.length > 3;
            slots.set(slot, { value: num(2), weight: weighted ? num(3) : 1, weighted });
            syncWavelengths();
          }
          break;
        }
        case "PWAV":
          primarySlot = parseInteger(tokens[1]);
          syncWavelengths();
          break;
        case "SURF": {
          // The literal index is the surface's identity: surfaces are numbered from 0 without gaps.
          if (tokens.length !== 2) throw new DeclarationError("SURF requires exactly one surface index");
          const declared = parseInteger(tokens[1]);
          if (declared !== surface + 1) {
            throw new DeclarationError(`index ${declared} is out of sequence; expected ${surface + 1}`);
          }
          if (surface >= 0) model.surfaces[surface] = current;
          surface++;
          offset = [0, 0];
          current = newSurface(lineNumber);
          break;
        }
        case "TYPE": {
          const name = tokens[1];
          if (name === undefined) throw new DeclarationError("TYPE requires a type");
          current.type = SURFACE_TYPES.get(name) ?? name.toLowerCase();
          break;
        }
        case "PARM":
          current[`param_${parseInteger(tokens[1]) - 1}`] = num(2);
          break;
        case "CURV": {
          const curvature = num();
          current.radius = curvature === 0 ? Infinity : 1 / curvature;
          break;
        }
        case "DISZ":
          current.thickness = tokens[1] === "INFINITY" ? Infinity : num();
          break;
        case "CONI":
          current.conic = num();
          break;
        case "GLAS": {
          const name = tokens[1];
          if (!name) throw new DeclarationError("GLAS requires a name");
          if (name.toUpperCase() === "MIRROR") {
            current.material = { kind: "mirror" };
            break;
          }
          // Files saved under a comma-decimal locale write "1,5168".
          const nd = tokens[4] !== undefined ? parseNumber(tokens[4].replaceAll(",", ".")) : null;
          const vd = tokens[5] !== undefined ? parseNumber(tokens[5].replaceAll(",", ".")) : null;
          current.index = nd;
          current.abbe = vd;
          current.material = {
            kind: "catalog",
            name,
            catalogs: [...(model.glass_catalogs ?? [])],
            nd,
            vd,
            resolution: "unresolved",
          };
          break;
        }
        case "STOP":
          current.is_stop = true;
          break;
        case "DIAM":
          current.diameter = num();
          break;
        case "MEMA":
          current.mechanical_semi_diameter = num();
          if (!Number.isFinite(current.mechanical_semi_diameter) || current.mechanical_semi_diameter < 0) {
            throw new DeclarationError("MEMA must be finite and nonnegative");
          }
          break;
        case "COMM":
          if (rest) current.comment = decodeText(rest);
          else delete current.comment;
          break;
        case "COAT":
          if (tokens[1]) current.coating = decodeText(tokens[1]);
          else delete current.coating;
          break;
        case "MODE":
          if (tokens[1] !== "SEQ") throw new DeclarationError("Only sequential mode is supported");
          break;
        case "GCAT":
          model.glass_catalogs = tokens.slice(1);
          break;
        case "CLAP":
          current.aperture = annulus(num(), num(2));
          break;
        case "OBDC":
          offset = [num(), num(2)];
          if (current.aperture) current.aperture = annulus(current.aperture.r_min, current.aperture.r_max);
          break;
        default:
          model.diagnostics.push({
            command,
            line: lineNumber,
            surface,
            severity: INERT.has(command) ? "info" : "warning",
            message: "Record retained but not interpreted",
          });
      }
    } catch (error) {
      if (!(error instanceof DeclarationError)) throw error;
      throw new PrescriptionParseError("invalid_prescription", `line ${lineNumber}: ${command}: ${error.message}`, {
        line: lineNumber,
        command,
        cause: error,
      });
    }
  }
  if (!Object.keys(model.aperture).length) throw new DeclarationError("Zemax file requires aperture data");

  if (fieldCount === null) fields.num_fields = fields.x?.length ?? 0;
  if (surface >= 0) model.surfaces[surface] = current;
  return model;
}
