import { createHash, timingSafeEqual } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import { AppError } from "../../shared/errors.js";
import { ParticipantChildLoginRepository } from "../repositories/participant-child-login.js";
import type { ParticipantChildLogin } from "../schemas/child-login.js";

export class ParticipantChildLoginService {
  constructor(
    private readonly participants: ParticipantChildLoginRepository,
    private readonly auth: Auth,
  ) {}

  async login(input: ParticipantChildLogin) {
    const participant = await this.participants.find(
      input.familyCode,
      input.handle,
    );
    if (!participant) throw invalid("Invalid family code or credentials");
    const expected = participant.pinHash;
    const actual = participant.pinSalt
      ? createHash("sha256")
          .update(`${participant.pinSalt}:${input.pin}`)
          .digest("hex")
      : undefined;
    const matchesHash = Boolean(
      expected && actual && safeEqual(expected, actual),
    );
    const matchesPlaintext = Boolean(
      participant.pin && safeEqual(participant.pin, input.pin),
    );
    if (
      (!matchesHash && !matchesPlaintext) ||
      !participant.firebaseUid ||
      !participant.organizationId
    )
      throw invalid("Invalid credentials");

    const token = await this.auth.createCustomToken(participant.firebaseUid, {
      roles: ["child"],
      persona: "child",
      participantId: participant.id,
      organizationId: participant.organizationId,
      purpose: "child_session_exchange",
    });
    return {
      token,
      participant: {
        id: participant.id,
        displayName: participant.displayName,
        teamId: participant.teamId,
        quarterId: participant.quarterId,
      },
    };
  }
}

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const invalid = (message: string) =>
  new AppError(401, "AUTHENTICATION_REQUIRED", message);
