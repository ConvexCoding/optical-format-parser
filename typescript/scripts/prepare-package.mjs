import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schema = new URL("../schema/", import.meta.url);
mkdirSync(fileURLToPath(schema), { recursive: true });
copyFileSync(new URL("../../schema/prescription.schema.json", import.meta.url), new URL("prescription.schema.json", schema));
