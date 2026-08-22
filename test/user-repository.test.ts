import { describe, expect, it, vi } from "vitest";
import { UserRepository } from "../src/auth/repositories/users.js";

describe("UserRepository legacy profile compatibility", () => {
  it("normalizes malformed legacy fields without trusting an embedded uid", async () => {
    const firestore = {
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            uid: "different-user",
            email: "not-an-email",
            displayName: null,
            roles: ["unknown-role"],
            status: "enabled",
            onboardingStatus: "new_authenticated_user",
            registrationIntent: "unknown",
          }),
        }),
      }),
    };

    await expect(
      new UserRepository(firestore as never).getUserByUid("requested-user"),
    ).resolves.toEqual({
      uid: "requested-user",
      email: null,
      displayName: "",
      roles: [],
      status: "disabled",
    });
  });

  it("preserves valid fields while ignoring only malformed optional fields", async () => {
    const firestore = {
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            uid: "user-1",
            email: "user@example.com",
            displayName: "User",
            roles: ["parent"],
            status: "disabled",
            activeWorkspaceId: "workspace-1",
            onboardingStatus: "complete",
            registrationIntent: "personal",
          }),
        }),
      }),
    };

    await expect(
      new UserRepository(firestore as never).getUserByUid("user-1"),
    ).resolves.toMatchObject({
      uid: "user-1",
      email: "user@example.com",
      displayName: "User",
      roles: ["parent"],
      status: "disabled",
      activeWorkspaceId: "workspace-1",
      onboardingStatus: "complete",
      registrationIntent: "personal",
    });
  });
});
