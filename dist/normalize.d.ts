import type { OsloModel, ZemaxModel } from "./models.js";
import type { NormalizedPrescription, SourceEncoding } from "./types.js";
export interface NormalizeContext {
    encoding: SourceEncoding;
    strict: boolean;
    includeRaw: boolean;
}
export declare function normalizeZemax(model: ZemaxModel, context: NormalizeContext): NormalizedPrescription;
export declare function normalizeOslo(model: OsloModel, context: NormalizeContext): NormalizedPrescription;
//# sourceMappingURL=normalize.d.ts.map