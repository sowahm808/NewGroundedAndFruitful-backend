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
    getUser: vi.fn().mockResolvedValue({
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
    hasActiveChildContext: vi.fn().mockResolvedValue(true),
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
    expect(bearerToken("bearer token-2")).toBe("token-2");
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

  it("does not mark a child without participant context complete", async () => {
    const fixture = service({ memberships: [membership("child")] });
    fixture.memberships.hasActiveChildContext.mockResolvedValue(false);
    await expect(fixture.subject.createSession("token")).resolves.toMatchObject({
      onboardingStatus: "provisioning_required",
    });
  });

  it("keeps multiple membership roles and never trusts profile roles during repeated login", async () => {
    const profile = { ...activeProfile, roles: ["admin", "super_admin"] };
    const { subject, users } = service({ profile, memberships: [{ ...membership("admin"), roles: ["admin", "super_admin"] }] });
    await expect(
      subject.createSession("email-or-google-token"),
    ).resolves.toMatchObject({
      roles: ["admin", "super_admin"],
      onboardingStatus: "complete",
    });
    expect(users.provisionUserProfile).toHaveBeenCalledWith(
      expect.not.objectContaining({ roles: expect.anything() }),
    );
  });

  it("returns pending state, forbids disabled accounts, and ignores suspended scope", async () => {
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
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(
      service({
        memberships: [membership("parent", "suspended")],
      }).subject.createSession("t"),
    ).resolves.toMatchObject({ roles: [], onboardingStatus: "role_required" });
  });

  it("uses Firestore when token claims differ and repairs claims", async () => {
    const { subject, firebaseAuth } = service({
      token: { roles: ["admin"] },
      memberships: [membership("parent")],
    });
    await expect(subject.createSession("t")).resolves.toMatchObject({
      roles: ["parent"],
      claimSynchronization: {
        status: "refresh_required",
        tokenRefreshRequired: true,
      },
    });
    expect(firebaseAuth.setCustomUserClaims).toHaveBeenCalledWith(
      "uid-1",
      expect.objectContaining({ roles: ["parent"] }),
    );
  });

  it("returns a safe retry status when claim synchronization fails", async () => {
    const { subject, firebaseAuth } = service({
      memberships: [membership("parent")],
    });
    firebaseAuth.setCustomUserClaims.mockRejectedValueOnce(new Error("secret"));
    await expect(subject.createSession("t")).resolves.toMatchObject({
      roles: ["parent"],
      claimSynchronization: {
        status: "retry_required",
        tokenRefreshRequired: false,
      },
    });
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
    firebaseAuth.verifyIdToken.mockRejectedValueOnce(new Error("invalid"));
    await expect(subject.createSession("bad")).rejects.toMatchObject({
      code: "INVALID_AUTHENTICATION_TOKEN",
    });
  });

  it.each([
    ["auth/id-token-expired", "EXPIRED_AUTHENTICATION_TOKEN"],
    ["auth/id-token-revoked", "REVOKED_AUTHENTICATION_TOKEN"],
    ["auth/argument-error", "INVALID_AUTHENTICATION_TOKEN"],
  ])("sanitizes Firebase token failure %s", async (firebaseCode, code) => {
    const { subject, firebaseAuth } = service();
    firebaseAuth.verifyIdToken.mockRejectedValueOnce({ code: firebaseCode });
    await expect(subject.createSession("secret-token")).rejects.toMatchObject({
      status: 401,
      code,
    });
  });
});
