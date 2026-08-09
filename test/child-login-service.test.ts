import { describe, expect, it, vi } from "vitest";

vi.mock("@node-rs/argon2", () => ({
  verify: vi.fn().mockResolvedValue(true),
}));

const { ChildLoginService } =
  await import("../src/auth/services/child-login.js");

describe("ChildLoginService", () => {
  it("marks child-login tokens as Firebase custom tokens", async () => {
    const credentials = {
      find: vi.fn().mockResolvedValue({
        disabled: false,
        familyCode: "family-1",
        firebaseUid: "child-1",
        handle: "sprout",
        participantId: "participant-1",
        passwordHash: "hash",
      }),
      clearFailures: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
      key: vi.fn(
        (familyCode: string, handle: string) => `${familyCode}_${handle}`,
      ),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const firebaseAuth = {
      createCustomToken: vi.fn().mockResolvedValue("custom-token"),
    };
    const service = new ChildLoginService(
      credentials as never,
      audit as never,
      firebaseAuth as never,
    );

    await expect(
      service.login(
        {
          familyCode: "family-1",
          handle: "sprout",
          password: "correct-horse",
        },
        "request-1",
      ),
    ).resolves.toEqual({
      customToken: "custom-token",
      tokenType: "firebaseCustomToken",
    });
    expect(firebaseAuth.createCustomToken).toHaveBeenCalledWith("child-1", {
      role: "child",
      participantId: "participant-1",
    });
  });
});
