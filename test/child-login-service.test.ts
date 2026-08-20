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
        organizationId: "organization-1",
        pinHash: "hash",
      }),
      clearFailures: vi.fn().mockResolvedValue(true),
      recordFailure: vi.fn().mockResolvedValue(undefined),
      findActiveChildMembership: vi.fn().mockResolvedValue({
        id: "membership-1",
        organizationId: "organization-1",
      }),
      hasActiveContext: vi.fn().mockResolvedValue(true),
      key: vi.fn(
        (familyCode: string, handle: string) => `${familyCode}_${handle}`,
      ),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const firebaseAuth = {
      getUser: vi.fn().mockResolvedValue({ disabled: false }),
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
          pin: "123456",
        },
        "request-1",
      ),
    ).resolves.toEqual({
      customToken: "custom-token",
    });
    expect(firebaseAuth.createCustomToken).toHaveBeenCalledWith("child-1", {
      roles: ["child"],
      participantId: "participant-1",
      membershipId: "membership-1",
      organizationId: "organization-1",
      purpose: "child_session_exchange",
    });
  });

  it("does not mint when the transactional credential recheck loses a disable race", async () => {
    const credentials = {
      find: vi.fn().mockResolvedValue({
        disabled: false,
        firebaseUid: "child-1",
        participantId: "participant-1",
        organizationId: "organization-1",
        pinHash: "hash",
      }),
      clearFailures: vi.fn().mockResolvedValue(false),
      recordFailure: vi.fn(),
      findActiveChildMembership: vi
        .fn()
        .mockResolvedValue({
          id: "membership-1",
          organizationId: "organization-1",
        }),
      hasActiveContext: vi.fn().mockResolvedValue(true),
      key: vi.fn().mockReturnValue("redacted-digest"),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const firebaseAuth = {
      getUser: vi.fn().mockResolvedValue({ disabled: false }),
      createCustomToken: vi.fn(),
    };
    const service = new ChildLoginService(
      credentials as never,
      audit as never,
      firebaseAuth as never,
    );

    await expect(
      service.login(
        { familyCode: "family-1", handle: "sprout", pin: "123456" },
        "request-1",
      ),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(firebaseAuth.createCustomToken).not.toHaveBeenCalled();
  });
});
