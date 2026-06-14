export interface Env {
  DB: D1Database;
  USER_DO: DurableObjectNamespace;
  /** Secret used to sign/verify JWTs. */
  JWT_SECRET: string;
  /** Shared account passphrase that gates sign-in (a Worker secret). */
  ACCOUNT_PASSPHRASE: string;
}
