import type { NextFunction, Request, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { auth, db } from "../config/firebase.js";
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

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && roles.has(value as Role);
}

export async function resolvePrincipalRole(
  firestore: Firestore,
  token: DecodedIdToken,
): Promise<Role> {
  if (isRole(token.role)) return token.role;
  if (Array.isArray(token.roles) && isRole(token.roles[0]))
    return token.roles[0];

  const user = await firestore.doc(`users/${token.uid}`).get();
  const roles = user.get("roles");
  if (Array.isArray(roles) && isRole(roles[0])) return roles[0];
  const role = user.get("role");
  if (isRole(role)) return role;

  throw new AuthorizationError();
}

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
    const role = await resolvePrincipalRole(db, token);
    req.principal = { uid: token.uid, role, token };
    next();
  } catch (error) {
    next(
      error instanceof AuthorizationError ? error : new AuthenticationError(),
    );
  }
}
