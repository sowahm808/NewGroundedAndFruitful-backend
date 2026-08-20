import { verify } from "@node-rs/argon2";
import type { Auth } from "firebase-admin/auth";
import { env } from "../../config/env.js";
import { AuthenticationError } from "../../shared/errors.js";
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
    const hash = credential?.pinHash ?? DUMMY_PASSWORD_HASH;
    const pinValid = await verify(
      hash,
      `${input.pin}${env.CHILD_LOGIN_PEPPER}`,
    );
    const unlocked =
      !credential?.lockedUntil ||
      credential.lockedUntil.toMillis() <= Date.now();
    const valid = credential && !credential.disabled && unlocked && pinValid;
    if (!valid) {
      await this.credentials.recordFailure(input.familyCode, input.handle);
      await this.audit.record("CHILD_LOGIN_FAILED", {
        requestId,
        credentialKey: this.credentials.key(input.familyCode, input.handle),
      });
      throw new AuthenticationError();
    }
    const firebaseUser = await this.firebaseAuth
      .getUser(credential.firebaseUid)
      .catch(() => undefined);
    const [membership, activeContext] = await Promise.all([
      this.credentials.findActiveChildMembership(credential),
      this.credentials.hasActiveContext(credential),
    ]);
    if (
      !firebaseUser ||
      firebaseUser.disabled ||
      !membership ||
      !activeContext
    ) {
      await this.audit.record("CHILD_LOGIN_FAILED", {
        requestId,
        credentialKey: this.credentials.key(input.familyCode, input.handle),
      });
      throw new AuthenticationError();
    }
    // Re-read and clear state transactionally immediately before minting. A
    // concurrent disable or lock therefore cannot race a successful exchange.
    const consumed = await this.credentials.clearFailures(
      input.familyCode,
      input.handle,
    );
    if (!consumed) {
      await this.audit.record("CHILD_LOGIN_FAILED", {
        requestId,
        credentialKey: this.credentials.key(input.familyCode, input.handle),
      });
      throw new AuthenticationError();
    }
    const customToken = await this.firebaseAuth.createCustomToken(
      credential.firebaseUid,
      {
        roles: ["child"],
        participantId: credential.participantId,
        membershipId: membership.id,
        organizationId: membership.organizationId,
        purpose: "child_session_exchange",
      },
    );
    await this.audit.record("CHILD_LOGIN_SUCCEEDED", {
      requestId,
      actorId: credential.firebaseUid,
    });
    return { customToken };
  }
}

// A valid Argon2id value ensures missing accounts perform the same slow hash
// verification path. It is unrelated to any seeded or production credential.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$Xyxx13d1n1RUicFUEGMG3Q$vbLBEM96AsrpTsL4wijF89usgUUArkKDrZNoVm0Jsaw";
