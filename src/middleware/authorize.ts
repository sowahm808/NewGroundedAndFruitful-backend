import type { RequestHandler } from "express";
import {
  requireAnyRole as assertAny,
  requireAuthenticated as assertAuthenticated,
  type Role,
} from "../auth/authorization.js";
export const requireAuthenticated: RequestHandler = (req, _res, next) => {
  try {
    assertAuthenticated(req.principal);
    next();
  } catch (e) {
    next(e);
  }
};
export const requireAnyRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    try {
      assertAny(req.principal, roles);
      next();
    } catch (e) {
      next(e);
    }
  };
export const requireRole = (role: Role) => requireAnyRole(role);
export const requireAdmin = requireAnyRole("admin", "super_admin");
export const requireSuperAdmin = requireRole("super_admin");
