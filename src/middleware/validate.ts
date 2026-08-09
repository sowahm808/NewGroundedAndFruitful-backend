import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../shared/errors.js";
export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return next(
        new ValidationError(
          "Request validation failed.",
          parsed.error.flatten(),
        ),
      );
    req.body = parsed.data;
    next();
  };
