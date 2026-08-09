import type { NextFunction, Request, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import { auth } from "../config/firebase.js";
import { AuthenticationError, AuthorizationError } from "../shared/errors.js";
import { type Role } from "../auth/authorization.js";
const roles = new Set<Role>([
  "child",
  "parent",
  "mentor",
  "observer",
  "admin",
  "super_admin",
]);
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const header = req.header("authorization");
    if (!header) return next();
    const match = /^Bearer ([^ ]+)$/.exec(header);
    if (!match?.[1]) throw new AuthenticationError();
    const token: DecodedIdToken = await auth.verifyIdToken(match[1], true);
    const role = token.role;
    if (typeof role !== "string" || !roles.has(role as Role))
      throw new AuthorizationError();
    req.principal = { uid: token.uid, role: role as Role, token };
    next();
  } catch (error) {
    next(
      error instanceof AuthorizationError ? error : new AuthenticationError(),
    );
  }
}
