import type { Request, Response } from "express";
import { AuthenticationError } from "../../shared/errors.js";
import type { AuthSessionService } from "../services/session.js";
import { logBearerHeaderFailure } from "../token-verification.js";

export class AuthSessionController {
  constructor(private readonly service: AuthSessionService) {}

  async create(req: Request, res: Response) {
    const token = bearerToken(req.header("authorization"), req.requestId);
    const sessionUser = await this.service.createSession(token, {
      requestId: req.requestId,
      authorizationPresent: true,
    });
    res.json({ data: sessionUser });
  }
}

export function bearerToken(
  header: string | undefined,
  requestId?: string,
): string {
  if (!header) {
    logBearerHeaderFailure(requestId, "missing_authorization", "auth_session");
    throw new AuthenticationError();
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  if (!match?.[1]) {
    logBearerHeaderFailure(
      requestId,
      "malformed_bearer_header",
      "auth_session",
    );
    throw new AuthenticationError("INVALID_AUTHENTICATION_TOKEN");
  }
  return match[1];
}
