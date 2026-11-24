/**
 * Typed authorization failures. Guards throw these; pages turn them into a
 * redirect or 404, Server Actions into a typed error result. The message never
 * reaches the user — only the code does.
 */
export type AuthErrorCode =
  | "unauthenticated" // no valid session
  | "forbidden" // signed in, but not allowed here
  | "clinic_suspended"; // allowed, but the clinic's commercial status blocks writes

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
  }
}
