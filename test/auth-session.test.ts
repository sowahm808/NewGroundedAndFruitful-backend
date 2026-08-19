import { describe, expect, it, vi } from "vitest";
import { bearerToken } from "../src/auth/controllers/session.js";
import { AuthSessionService } from "../src/auth/services/session.js";

const activeProfile = {
  uid: "uid-1",
  email: "parent@example.com",
  displayName: "Parent User",
  roles: [],
  status: "active",
};

function service(
  options: {
    profile?: Record<string, unknown> | null;
    memberships?: Record<string, unknown>[];
    auth?: Record<string, unknown>;
    token?: Record<string, unknown>;
  } = {},
) {
  const profile =
    options.profile === undefined ? activeProfile : options.profile;
  const firebaseAuth = {
    verifyIdToken: vi
      .fn()
      .mockResolvedValue({ uid: "uid-1", ...options.token }),
    getUser: vi
      .fn()
      .mockResolvedValue({
        uid: "uid-1",
        email: "parent@example.com",
        displayName: "Parent User",
        disabled: false,
        customClaims: {},
        ...options.auth,
      }),
    setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
  };
  const users = {
    getUserByUid: vi.fn().mockResolvedValue(profile),
    provisionUserProfile: vi.fn().mockResolvedValue(profile ?? activeProfile),
  };
  const memberships = {
    listForUser: vi.fn().mockResolvedValue(options.memberships ?? []),
  };
  return {
    firebaseAuth,
    users,
    memberships,
    subject: new AuthSessionService(
      firebaseAuth as never,
      users as never,
      memberships as never,
    ),
  };
}

const membership = (
  role: string,
  status = "active",
  organizationId = "org-1",
) => ({ userId: "uid-1", organizationId, roles: [role], status });

describe("auth session bootstrap", () => {
  it("requires a Bearer authorization header", () => {
    expect(() => bearerToken(undefined)).toThrow();
    expect(() => bearerToken("Basic abc")).toThrow();
    expect(bearerToken("Bearer token-1")).toBe("token-1");
  });

  it.each(["child", "parent", "mentor", "observer", "admin", "super_admin"])(
    "returns canonical %s membership role",
    async (role) => {
      const { subject } = service({ memberships: [membership(role)] });
      await expect(subject.createSession("token-1")).resolves.toMatchObject({
        roles: [role],
        disabled: false,
        onboardingStatus: "complete",
        memberships: [
          { organizationId: "org-1", roles: [role], status: "active" },
        ],
      });
    },
  );

  it("creates a missing profile without assigning a default role", async () => {
    const { subject, users } = service({ profile: null });
    await expect(subject.createSession("token-1")).resolves.toMatchObject({
      roles: [],
      onboardingStatus: "role_required",
    });
    expect(users.provisionUserProfile).toHaveBeenCalledWith(
      expect.not.objectContaining({ roles: expect.anything() }),
    );
  });

  it("returns pending, disabled, and suspended state explicitly", async () => {
    await expect(
      service({
        memberships: [membership("parent", "pending")],
      }).subject.createSession("t"),
    ).resolves.toMatchObject({
      roles: [],
      onboardingStatus: "pending_approval",
    });
    await expect(
      service({
        auth: { disabled: true },
        memberships: [membership("parent")],
      }).subject.createSession("t"),
    ).resolves.toMatchObject({ disabled: true });
    await expect(
      service({
        memberships: [membership("parent", "suspended")],
      }).subject.createSession("t"),
    ).resolves.toMatchObject({
      roles: [],
      memberships: [{ status: "suspended" }],
    });
  });

  it("uses Firestore when token claims differ and repairs claims", async () => {
    const { subject, firebaseAuth } = service({
      token: { roles: ["admin"] },
      memberships: [membership("parent")],
    });
    await expect(subject.createSession("t")).resolves.toMatchObject({
      roles: ["parent"],
    });
    expect(firebaseAuth.setCustomUserClaims).toHaveBeenCalledWith(
      "uid-1",
      expect.objectContaining({ roles: ["parent"] }),
    );
  });

  it("does not expose another user's membership", async () => {
    const { subject } = service({
      memberships: [
        { ...membership("admin", "active", "other-org"), userId: "other" },
        membership("parent"),
      ],
    });
    await expect(subject.createSession("t")).resolves.toMatchObject({
      roles: ["parent"],
      memberships: [expect.objectContaining({ organizationId: "org-1" })],
    });
  });

  it("maps invalid tokens to a stable authentication failure", async () => {
    const { subject, firebaseAuth } = service();
    firebaseAuth.verifyIdToken.mockRejectedValueOnce(
      new Error("expired/revoked/invalid"),
    );
    await expect(subject.createSession("bad")).rejects.toThrow(
      "Authentication is required.",
    );
  });
});
