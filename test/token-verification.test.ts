import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyBearerToken } from "../src/auth/token-verification.js";
import { LogoutService } from "../src/auth/services/logout.js";

const claims = (uid: string) => ({
  uid,
  sub: uid,
  aud: "project",
  iss: "https://securetoken.google.com/project",
  iat: 100,
  exp: 3700,
  auth_time: 100,
});
const jwt = (payload: object) =>
  `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;

afterEach(() => vi.restoreAllMocks());

describe("bearer logout and verification boundaries", () => {
  it("ordinary logout does not revoke refresh tokens", () => {
    const revokeRefreshTokens = vi.fn();
    new LogoutService({ revokeRefreshTokens }).logout();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("explicit logout-all revokes previous tokens", async () => {
    const revokeRefreshTokens = vi.fn().mockResolvedValue(undefined);
    await new LogoutService({ revokeRefreshTokens }).logoutAll(
      "user-a",
    );
    expect(revokeRefreshTokens).toHaveBeenCalledWith("user-a");
  });

  it.each([["same-user"], ["different-user"]])(
    "immediate %s login verifies a newly issued token independently",
    async (uid) => {
      const verifyIdToken = vi.fn().mockResolvedValue(claims(uid));
      await expect(
        verifyBearerToken({ verifyIdToken }, jwt(claims(uid)), {
          requestId: "request-new",
          policy: "test",
        }),
      ).resolves.toMatchObject({ uid });
      expect(verifyIdToken).toHaveBeenCalledWith(expect.any(String), true);
    },
  );

  it("rejects revoked tokens and accepts a fresh token after reauthentication", async () => {
    const verifyIdToken = vi
      .fn()
      .mockRejectedValueOnce({ code: "auth/id-token-revoked" })
      .mockResolvedValueOnce(claims("user-a"));
    await expect(
      verifyBearerToken({ verifyIdToken }, jwt(claims("user-a")), {
        requestId: "revoked",
        policy: "test",
      }),
    ).rejects.toMatchObject({ code: "REVOKED_AUTHENTICATION_TOKEN" });
    await expect(
      verifyBearerToken(
        { verifyIdToken },
        jwt({ ...claims("user-a"), iat: 101 }),
        {
          requestId: "fresh",
          policy: "test",
        },
      ),
    ).resolves.toMatchObject({ uid: "user-a" });
  });

  it("does not cache a failed verification or poison a subsequent token", async () => {
    const verifyIdToken = vi
      .fn()
      .mockRejectedValueOnce({ code: "auth/argument-error" })
      .mockResolvedValueOnce(claims("user-b"));
    await expect(
      verifyBearerToken({ verifyIdToken }, "bad", { policy: "test" }),
    ).rejects.toBeTruthy();
    await expect(
      verifyBearerToken({ verifyIdToken }, jwt(claims("user-b")), {
        policy: "test",
      }),
    ).resolves.toMatchObject({ uid: "user-b" });
    expect(verifyIdToken).toHaveBeenCalledTimes(2);
  });

  it("logs only safe Firebase details, claims, fingerprint, and request ID", async () => {
    const raw = jwt(claims("user-a"));
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((value: string) => {
      writes.push(value);
      return true;
    }) as never);
    await expect(
      verifyBearerToken(
        {
          verifyIdToken: vi
            .fn()
            .mockRejectedValue({ code: "auth/id-token-revoked" }),
        },
        raw,
        {
          requestId: "request-safe",
          policy: "test",
        },
      ),
    ).rejects.toBeTruthy();
    const output = writes.join("");
    expect(output).toContain('"firebaseErrorCode":"auth/id-token-revoked"');
    expect(output).toContain('"requestId":"request-safe"');
    expect(output).toContain('"uid":"user-a"');
    expect(output).not.toContain(raw);
  });
});
