export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_AUTHENTICATION_TOKEN"
  | "EXPIRED_AUTHENTICATION_TOKEN"
  | "REVOKED_AUTHENTICATION_TOKEN"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "BUSINESS_RULE"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL";
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationError extends AppError {
  constructor(message = "Invalid request.", details?: unknown) {
    super(422, "VALIDATION_ERROR", message, details);
  }
}
export class AuthenticationError extends AppError {
  constructor(
    code:
      | "AUTHENTICATION_REQUIRED"
      | "INVALID_AUTHENTICATION_TOKEN"
      | "EXPIRED_AUTHENTICATION_TOKEN"
      | "REVOKED_AUTHENTICATION_TOKEN" = "AUTHENTICATION_REQUIRED",
  ) {
    const messages = {
      AUTHENTICATION_REQUIRED: "Authentication is required.",
      INVALID_AUTHENTICATION_TOKEN: "The authentication token is invalid.",
      EXPIRED_AUTHENTICATION_TOKEN: "The authentication token has expired.",
      REVOKED_AUTHENTICATION_TOKEN: "The authentication token was revoked.",
    } as const;
    super(401, code, messages[code]);
  }
}
export class AuthorizationError extends AppError {
  constructor() {
    super(403, "FORBIDDEN", "You are not permitted to perform this action.");
  }
}
export class NotFoundError extends AppError {
  constructor(message = "Resource not found.") {
    super(404, "NOT_FOUND", message);
  }
}
export class ConflictError extends AppError {
  constructor(message = "The request conflicts with current state.") {
    super(409, "CONFLICT", message);
  }
}
export class RateLimitError extends AppError {
  constructor(public readonly retryAfterSeconds = 60) {
    super(429, "RATE_LIMITED", "Too many attempts. Try again later.");
  }
}
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string) {
    super(422, code, message);
  }
}
export class InternalError extends AppError {
  constructor() {
    super(500, "INTERNAL", "An unexpected error occurred.");
  }
}
export class ServiceUnavailableError extends AppError {
  constructor(message = "This operation is not currently available.") {
    super(503, "DEPENDENCY_UNAVAILABLE", message);
  }
}
