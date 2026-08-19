import type { RequestHandler } from "express";

/** Prevent browsers and shared proxies from retaining user-specific API data. */
export const privateResponse: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  next();
};
