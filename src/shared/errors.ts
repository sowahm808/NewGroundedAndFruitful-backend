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
export class AccountDisabledError extends AppError {
  constructor() {
    super(403, "ACCOUNT_DISABLED", "The account is disabled.");
  }
}
export class OrganizationBootstrapError extends AppError {
  constructor(
    code:
      | "ORGANIZATION_BOOTSTRAP_NOT_ELIGIBLE"
      | "ORGANIZATION_BOOTSTRAP_ALREADY_COMPLETED"
      | "ORGANIZATION_BOOTSTRAP_CONFLICT"
      | "ORGANIZATION_NAME_CONFLICT"
      | "ORGANIZATION_SLUG_CONFLICT"
      | "ORGANIZATION_TIMEZONE_INVALID"
      | "ORGANIZATION_BOOTSTRAP_FAILED",
  ) {
    const status =
      code === "ORGANIZATION_BOOTSTRAP_NOT_ELIGIBLE"
        ? 403
        : code === "ORGANIZATION_TIMEZONE_INVALID"
          ? 422
          : code === "ORGANIZATION_BOOTSTRAP_FAILED"
            ? 500
            : 409;
    super(status, code, organizationBootstrapMessages[code]);
  }
}

export class PersonalWorkspaceBootstrapError extends AppError {
  constructor(
    code:
      | "PERSONAL_WORKSPACE_NOT_ELIGIBLE"
      | "PERSONAL_WORKSPACE_ALREADY_EXISTS"
      | "PERSONAL_WORKSPACE_BOOTSTRAP_CONFLICT"
      | "PERSONAL_WORKSPACE_TIMEZONE_INVALID"
      | "PERSONAL_WORKSPACE_BOOTSTRAP_FAILED",
  ) {
    const status =
      code === "PERSONAL_WORKSPACE_NOT_ELIGIBLE"
        ? 403
        : code === "PERSONAL_WORKSPACE_TIMEZONE_INVALID"
          ? 422
          : code === "PERSONAL_WORKSPACE_BOOTSTRAP_FAILED"
            ? 500
            : 409;
    super(status, code, personalWorkspaceBootstrapMessages[code]);
  }
}

const personalWorkspaceBootstrapMessages = {
  PERSONAL_WORKSPACE_NOT_ELIGIBLE:
    "This account is not eligible to create a personal workspace.",
  PERSONAL_WORKSPACE_ALREADY_EXISTS:
    "A personal workspace already exists for this account.",
  PERSONAL_WORKSPACE_BOOTSTRAP_CONFLICT:
    "Personal workspace onboarding conflicts with the current state.",
  PERSONAL_WORKSPACE_TIMEZONE_INVALID:
    "The personal workspace timezone is invalid.",
  PERSONAL_WORKSPACE_BOOTSTRAP_FAILED:
    "Personal workspace onboarding could not be completed.",
} as const;

const organizationBootstrapMessages = {
  ORGANIZATION_BOOTSTRAP_NOT_ELIGIBLE:
    "This account is not eligible to create its first organization.",
  ORGANIZATION_BOOTSTRAP_ALREADY_COMPLETED:
    "Organization onboarding is already complete.",
  ORGANIZATION_BOOTSTRAP_CONFLICT:
    "Organization onboarding conflicts with the completed request.",
  ORGANIZATION_NAME_CONFLICT: "An organization with this name already exists.",
  ORGANIZATION_SLUG_CONFLICT: "This organization slug is already in use.",
  ORGANIZATION_TIMEZONE_INVALID: "The organization timezone is invalid.",
  ORGANIZATION_BOOTSTRAP_FAILED:
    "Organization onboarding could not be completed.",
} as const;
export class RegistrationIntentConflictError extends AppError {
  constructor(
    code:
      | "REGISTRATION_INTENT_CONFLICT"
      | "REGISTRATION_ALREADY_COMPLETED" = "REGISTRATION_INTENT_CONFLICT",
  ) {
    super(
      409,
      code,
      code === "REGISTRATION_ALREADY_COMPLETED"
        ? "Registration onboarding is already complete."
        : "Registration intent conflicts with the current onboarding state.",
    );
  }
}
export class RegistrationIntentInvalidError extends AppError {
  constructor(details?: unknown) {
    super(
      422,
      "REGISTRATION_INTENT_INVALID",
      "Registration intent must be personal or organization.",
      details,
    );
  }
}
export class RegistrationIntentSaveError extends AppError {
  constructor() {
    super(
      500,
      "REGISTRATION_INTENT_SAVE_FAILED",
      "Registration intent could not be saved.",
    );
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
