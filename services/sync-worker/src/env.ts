export interface Env {
  DB: D1Database;
  USER_DO: DurableObjectNamespace;
  JWT_SECRET: string;
  /** "1" during local dev: login codes are returned in the API response. */
  DEV_RETURN_CODE?: string;
}
