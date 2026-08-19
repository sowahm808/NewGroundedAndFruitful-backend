import type { Request, Response } from "express";
import { AuthenticationError } from "../../shared/errors.js";
import type { AuthSessionService } from "../services/session.js";

export class AuthSessionController {
  constructor(private readonly service: AuthSessionService) {}

  async create(req: Request, res: Response) {
    const token = bearerToken(req.header("authorization"));
    const sessionUser = await this.service.createSession(token, {
      requestId: req.requestId,
      authorizationPresent: true,
    });
    res.json({ data: sessionUser });
  }
}

export function bearerToken(header: string | undefined): string {
  if (!header) throw new AuthenticationError();
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  if (!match?.[1])
    throw new AuthenticationError("INVALID_AUTHENTICATION_TOKEN");
  return match[1];
}
