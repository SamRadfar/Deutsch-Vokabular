export declare const PRODUCTION_PROJECT: string;
export declare const NON_PRODUCTION_PROJECTS: string[];
export declare function parseEnv(text: string): Record<string, string>;
export declare function validateProductionEnv(env: Record<string, string>): string[];
export declare function scanBundle(files: Array<{ file: string; text: string }>): string[];
export declare function validateProductionDeployArgs(args: string[]):
  | { ok: true; project: string; confirmed: boolean }
  | { ok: false; reason: string };
export declare function contentMarkers(vocabulary: { categories: Array<{ subtabs: Array<{ groups: Array<{ entries: Array<{ example: string; exampleFa: string }> }> }> }> }): string[];
export declare function findContent(files: Array<{ file: string; text: string }>, markers: string[]): string[];
