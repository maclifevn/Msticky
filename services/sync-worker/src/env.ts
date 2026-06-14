export interface Env {
  DB: D1Database;
  USER_DO: DurableObjectNamespace;
  /** Secret used to sign/verify our own session JWTs. */
  JWT_SECRET: string;
  /** Google OAuth client (Desktop type). client_id is public; secret stays here. */
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}
