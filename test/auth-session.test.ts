import { describe, expect, it, vi } from "vitest";
import { bearerToken } from "../src/auth/controllers/session.js";
import { AuthSessionService } from "../src/auth/services/session.js";
import { AuthorizationError } from "../src/shared/errors.js";

const activeProfile = {
  uid: "uid-1",
  email: "parent@example.com",
  displayName: "Parent User",
  roles: ["parent"],
  status: "active",
};

function service(profile = activeProfile, overrides = {}) {
  const firebaseAuth = {
    verifyIdToken: vi.fn().mockResolvedValue({ uid: "uid-1" }),
    getUser: vi.fn().mockResolvedValue({
      uid: "uid-1",
      email: "parent@example.com",
      displayName: "Parent User",
      disabled: false,
      customClaims: {},
      ...overrides,
    }),
    setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
  };
  const users = {
    provisionUserProfile: vi.fn().mockResolvedValue(profile),
  };
  return {
    firebaseAuth,
    users,
    subject: new AuthSessionService(firebaseAuth as never, users as never),
  };
}

describe("auth session provisioning", () => {
  it("requires a Bearer authorization header", () => {
    expect(() => bearerToken(undefined)).toThrow();
    expect(() => bearerToken("Basic abc")).toThrow();
    expect(bearerToken("Bearer token-1")).toBe("token-1");
  });

  it("verifies the Firebase token and returns an existing Firestore profile", async () => {
    const { subject, firebaseAuth, users } = service();
    await expect(subject.createSession("token-1")).resolves.toEqual({
      uid: "uid-1",
      email: "parent@example.com",
      displayName: "Parent User",
      roles: ["parent"],
      disabled: false,
    });
    expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith("token-1", true);
    expect(users.provisionUserProfile).toHaveBeenCalledWith({
      uid: "uid-1",
      email: "parent@example.com",
      displayName: "Parent User",
      roles: ["parent"],
    });
  });

  it("preserves existing administrator roles from Firestore", async () => {
    const { subject } = service({
      ...activeProfile,
      roles: ["admin", "super_admin"],
    });
    await expect(subject.createSession("token-1")).resolves.toMatchObject({
      roles: ["admin", "super_admin"],
    });
  });

  it("does not let client-provided admin claims provision privileged roles", async () => {
    const firebaseAuth = {
      verifyIdToken: vi
        .fn()
        .mockResolvedValue({ uid: "uid-1", roles: ["admin"] }),
      getUser: vi.fn().mockResolvedValue({
        uid: "uid-1",
        email: "parent@example.com",
        displayName: "Parent User",
        disabled: false,
        customClaims: {},
      }),
      setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
    };
    const users = {
      provisionUserProfile: vi.fn().mockResolvedValue(activeProfile),
    };
    await new AuthSessionService(
      firebaseAuth as never,
      users as never,
    ).createSession("token-1");
    expect(users.provisionUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ["parent"] }),
    );
  });

  it("rejects disabled Firebase and Firestore users", async () => {
    await expect(
      service(activeProfile, { disabled: true }).subject.createSession(
        "token-1",
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      service({ ...activeProfile, status: "disabled" }).subject.createSession(
        "token-1",
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("propagates invalid token and Firestore failures as safe errors upstream", async () => {
    const { subject, firebaseAuth } = service();
    firebaseAuth.verifyIdToken.mockRejectedValueOnce(new Error("bad token"));
    await expect(subject.createSession("bad")).rejects.toThrow(
      "Authentication is required.",
    );

    const { subject: failing, users } = service();
    users.provisionUserProfile.mockRejectedValueOnce(
      new Error("firestore unavailable"),
    );
    await expect(failing.createSession("token-1")).rejects.toThrow(
      "firestore unavailable",
    );
  });
});
