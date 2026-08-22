import type { Auth } from "firebase-admin/auth";

export class LogoutService {
  constructor(
    private readonly firebaseAuth: Pick<Auth, "revokeRefreshTokens">,
  ) {}

  /** Ordinary bearer logout is client-local; no global Firebase state changes. */
  logout(): void {}

  /** Explicit security action that signs the user out of every device. */
  async logoutAll(uid: string): Promise<void> {
    await this.firebaseAuth.revokeRefreshTokens(uid);
  }
}
