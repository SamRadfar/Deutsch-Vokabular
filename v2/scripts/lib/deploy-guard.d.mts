export declare const ALLOWED_PROJECTS: string[];
export declare const FORBIDDEN_PROJECTS: string[];
export declare function validateDeployArgs(
  args: string[],
  envLocalProjectId: string | null,
): { ok: true; project: string; confirmed: boolean } | { ok: false; reason: string };
export declare function interpretDatabaseProbe(
  status: number,
  errorStatus: string | undefined,
): { exists: true } | { exists: false; reason: string };
