import type { Principal } from "../auth/authorization.js";
declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
      requestId: string;
    }
  }
}
export {};
