export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "BUSINESS_RULE"
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
    super(400, "VALIDATION_ERROR", message, details);
  }
}
export class AuthenticationError extends AppError {
  constructor() {
    super(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
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
  constructor() {
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
