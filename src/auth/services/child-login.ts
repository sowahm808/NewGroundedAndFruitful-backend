import { verify } from "@node-rs/argon2";
import type { Auth } from "firebase-admin/auth";
import { env } from "../../config/env.js";
import { AuthenticationError, RateLimitError } from "../../shared/errors.js";
import { AuditRepository } from "../../audit/repository.js";
import { ChildCredentialRepository } from "../repositories/child-credentials.js";
import type { ChildLogin } from "../schemas/child-login.js";
export class ChildLoginService {
  constructor(
    private credentials: ChildCredentialRepository,
    private audit: AuditRepository,
    private firebaseAuth: Auth,
  ) {}
  async login(input: ChildLogin, requestId: string) {
    const credential = await this.credentials.find(
      input.familyCode,
      input.handle,
    );
    if (
      credential?.lockedUntil &&
      credential.lockedUntil.toMillis() > Date.now()
    )
      throw new RateLimitError();
    const valid =
      credential &&
      !credential.disabled &&
      (await verify(
        credential.passwordHash,
        `${input.password}${env.CHILD_LOGIN_PEPPER}`,
      ));
    if (!valid) {
      await this.credentials.recordFailure(input.familyCode, input.handle);
      await this.audit.record("CHILD_LOGIN_FAILED", {
        requestId,
        credentialKey: this.credentials.key(input.familyCode, input.handle),
      });
      throw new AuthenticationError();
    }
    await this.credentials.clearFailures(input.familyCode, input.handle);
    const customToken = await this.firebaseAuth.createCustomToken(
      credential.firebaseUid,
      { roles: ["child"] },
    );
    await this.audit.record("CHILD_LOGIN_SUCCEEDED", {
      requestId,
      actorId: credential.firebaseUid,
    });
    return { customToken, tokenType: "firebaseCustomToken" as const };
  }
}
