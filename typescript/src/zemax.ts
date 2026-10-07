// Derived from Optiland master parser/model; see ../UPSTREAM.json and LICENSE.
import { integer, number } from "./numbers.js";
import type { NativeRecord } from "./types.js";

export function parseZemax(text: string, filename: string): NativeRecord {
  const model: NativeRecord = { mode: "Sequential", units: "MM", records: [], diagnostics: [], name: null,
    aperture: {}, fields: {}, wavelengths: { data: [], weights: [] }, surfaces: {} };
  let surface = -1, current: NativeRecord = {}, offset = [0, 0];
  let fieldCount: number | null = null, wavelengthCount: number | null = null, primarySlot: number | null = null;
  const rawFields: Record<string, number[]> = {}, slots = new Map<number, [number, number]>();

  const syncFields = () => {
    const fields = model.fields;
    for (const [key, values] of Object.entries(rawFields)) fields[key] = fieldCount === null ? [...values] : values.slice(0, fieldCount);
    let count = Math.max(1, ...["x", "y"].filter(a => a in rawFields).map(a => fields[a].length));
    // Upstream's max(..., default=1) does not force 1 for explicit empty axes.
    const present = ["x", "y"].filter(a => a in rawFields);
    if (present.length) count = Math.max(...present.map(a => fields[a].length));
    if (fieldCount !== null) count = Math.min(count, fieldCount);
    for (const axis of ["x", "y"]) if (!(axis in rawFields)) fields[axis] = Array(count).fill(0);
    fields.num_fields = fieldCount ?? count;
  };
  const syncWaves = () => {
    const active = [...slots.keys()].sort((a, b) => a - b).filter(s => wavelengthCount === null || s <= wavelengthCount);
    model.wavelengths.data = active.map(s => slots.get(s)![0]);
    model.wavelengths.weights = active.map(s => slots.get(s)![1]);
    model.wavelengths.num_wavelengths = wavelengthCount ?? active.length;
    if (primarySlot !== null) model.wavelengths.primary_index = active.includes(primarySlot) ? active.indexOf(primarySlot) : null;
  };
  const config = (tokens: string[]) => {
    const safe = (i: number, fallback = 0) => { try { return integer(tokens[i]); } catch { return fallback; } };
    const f = safe(3, -1), w = safe(4, -1);
    fieldCount = f >= 0 ? f : null; wavelengthCount = w >= 0 ? w : null;
    model.fields.type = ["angle", "object_height", "paraxial_image_height", "real_image_height", "theodolite_angle"][safe(1)] ?? "unsupported";
    model.fields.object_space_telecentric = safe(2) === 1;
    model.fields.afocal_image_space = safe(7) === 1;
    syncFields(); syncWaves();
  };
  config(["FTYP"]);
  const column: Record<string, string> = { XFLD: "x", XFLN: "x", YFLD: "y", YFLN: "y", FWGN: "weights",
    VDXN: "vignette_decenter_x", VDYN: "vignette_decenter_y", VCXN: "vignette_compress_x", VCYN: "vignette_compress_y", VANN: "vignette_tangent_angle" };
  const annulus = (min: number, max: number) => ({ kind: "annulus", r_min: min, r_max: max, offset_x: offset[0], offset_y: offset[1] });
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  lines.forEach((line, i) => {
    const tokens = line.trim().split(/\s+/);
    if (!line.trim()) return;
    const command = tokens[0], n = (index = 1) => number(tokens[index]);
    model.records.push({ line: i + 1, text: line.trim() });
    try {
      if (Object.hasOwn(column, command)) { rawFields[column[command]] = tokens.slice(1).map(number); syncFields(); return; }
      switch (command) {
        case "UNIT": if (!tokens[1]) throw new Error("UNIT requires a unit"); model.units = tokens[1].toUpperCase(); break;
        case "NAME": model.name = tokens.slice(1).join(" "); break;
        case "FNUM": if ([0, 1].includes(integer(tokens[2]))) model.aperture[integer(tokens[2]) === 0 ? "imageFNO" : "paraxialImageFNO"] = n(); break;
        case "ENPD": model.aperture.EPD = n(); break;
        case "OBNA": if ([0, 1].includes(integer(tokens[2]))) model.aperture[integer(tokens[2]) === 0 ? "objectNA" : "object_cone_angle"] = n(); break;
        case "FLOA": model.aperture.floating_stop = true; break;
        case "FTYP": config(tokens); break;
        case "WAVL": case "WAVM": {
          const slot = command === "WAVL" ? Math.max(0, ...slots.keys()) + 1 : integer(tokens[1]);
          if (slot >= 1) { slots.set(slot, [n(2), tokens.length > 3 ? n(3) : 1]); syncWaves(); } break;
        }
        case "PWAV": primarySlot = integer(tokens[1]); syncWaves(); break;
        case "SURF":
          if (surface >= 0) model.surfaces[surface] = current;
          surface++; offset = [0, 0]; current = { type: "standard", is_stop: false, conic: 0, material: "air", aperture: null }; break;
        case "TYPE": {
          const types: Record<string, string> = { STANDARD: "standard", EVENASPH: "even_asphere", ODDASPHE: "odd_asphere", COORDBRK: "coordinate_break", TOROIDAL: "toroidal" };
          current.type = Object.hasOwn(types, tokens[1]) ? types[tokens[1]] : tokens[1]?.toLowerCase();
          if (current.type === undefined) throw new Error("TYPE requires a type"); break;
        }
        case "PARM": current[`param_${integer(tokens[1]) - 1}`] = n(2); break;
        case "CURV": { const c = n(); current.radius = c === 0 ? Infinity : 1 / c; break; }
        case "DISZ": current.thickness = tokens[1] === "INFINITY" ? Infinity : n(); break;
        case "CONI": current.conic = n(); break;
        case "GLAS": {
          const name = tokens[1]; if (!name) throw new Error("GLAS requires a name");
          if (name.toUpperCase() === "MIRROR") { current.material = { kind: "mirror" }; break; }
          const nd = tokens.length > 4 ? number(tokens[4].replaceAll(",", ".")) : null;
          const vd = tokens.length > 5 ? number(tokens[5].replaceAll(",", ".")) : null;
          current.index = nd; current.abbe = vd;
          current.material = { kind: "catalog", name, catalogs: [...(model.glass_catalogs ?? [])], nd, vd, resolution: "unresolved" }; break;
        }
        case "STOP": current.is_stop = true; break;
        case "DIAM": current.diameter = n(); break;
        case "MODE": if (tokens[1] !== "SEQ") throw new Error("Only sequential mode is supported"); break;
        case "GCAT": model.glass_catalogs = tokens.slice(1); break;
        case "CLAP": current.aperture = annulus(n(), n(2)); break;
        case "OBDC": offset = [n(), n(2)]; if (current.aperture) current.aperture = annulus(current.aperture.r_min, current.aperture.r_max); break;
        default: model.diagnostics.push({ command, line: i + 1, surface, severity: ["VERS", "NAME", "NOTE", "PFIL", "LANG", "ZRD", "ZPK", "MNUM"].includes(command) ? "info" : "warning", message: "Record retained but not interpreted" });
      }
    } catch (error) { throw new Error(`${filename}:${i + 1}: ${command}: ${(error as Error).message}`); }
  });
  if (!Object.keys(model.aperture).length) throw new Error("Zemax file requires aperture data");
  const fields = model.fields;
  const keys = ["x", "y", ...["weights", "vignette_decenter_x", "vignette_decenter_y", "vignette_compress_x", "vignette_compress_y", "vignette_tangent_angle"].filter(k => k in fields)];
  const count = Math.min(...keys.map(k => fields[k].length)), seen = new Set<string>(), rows: number[][] = [];
  for (let i = 0; i < count; i++) {
    const row = keys.map(k => fields[k][i]);
    const key = JSON.stringify(row.slice(0, 2));
    if (!seen.has(key)) { rows.push(row); seen.add(key); }
  }
  rows.sort((a, b) => a[1] - b[1]);
  if (rows.length) keys.forEach((k, i) => { fields[k] = rows.map(row => row[i]); });
  if (fieldCount === null) fields.num_fields = fields.x.length;
  if (surface >= 0) model.surfaces[surface] = current;
  return model;
}
