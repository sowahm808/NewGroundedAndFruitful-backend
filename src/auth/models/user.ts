import type { Timestamp } from "firebase-admin/firestore";
import type { Role } from "../authorization.js";

export type UserStatus = "active" | "disabled";

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string;
  roles: Role[];
  status: UserStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string;
  roles: Role[];
  disabled: boolean;
}
