import { describe, expect, it } from "vitest";
import {
  AccountDisabledError,
  OrganizationBootstrapError,
} from "../src/shared/errors.js";
import { requireOrganizationBootstrapEligibility } from "../src/onboarding/service.js";
import { organizationBootstrapSchema } from "../src/onboarding/schemas.js";

describe("first-organization bootstrap policy", () => {
  it("allows an enabled roleless registrant without membership or workspace inputs", () => {
    expect(() =>
      requireOrganizationBootstrapEligibility({
        exists: true,
        disabled: false,
        registrationIntent: "organization",
        onboardingStatus: "organization_setup_required",
      }),
    ).not.toThrow();
  });

  it.each([
    [undefined, "organization_setup_required"],
    ["personal", "personal_workspace_required"],
  ])("rejects intent %s", (registrationIntent, onboardingStatus) => {
    expect(() =>
      requireOrganizationBootstrapEligibility({
        exists: true,
        disabled: false,
        registrationIntent,
        onboardingStatus,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<OrganizationBootstrapError>>({
        code: "ORGANIZATION_BOOTSTRAP_NOT_ELIGIBLE",
      }),
    );
  });

  it("returns the stable completed error", () => {
    expect(() =>
      requireOrganizationBootstrapEligibility({
        exists: true,
        disabled: false,
        registrationIntent: "organization",
        onboardingStatus: "complete",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<OrganizationBootstrapError>>({
        code: "ORGANIZATION_BOOTSTRAP_ALREADY_COMPLETED",
      }),
    );
  });

  it("rejects a disabled canonical profile", () => {
    expect(() =>
      requireOrganizationBootstrapEligibility({
        exists: true,
        disabled: true,
        registrationIntent: "organization",
        onboardingStatus: "organization_setup_required",
      }),
    ).toThrow(AccountDisabledError);
  });

  it("rejects every client-supplied authority field", () => {
    const valid = {
      name: "Makrozoia Solutions",
      slug: "makrozoia-solutions",
      timezone: "America/Chicago",
    };
    for (const field of [
      "uid",
      "roles",
      "permissions",
      "organizationId",
      "workspaceId",
      "status",
      "onboardingStatus",
      "auditActor",
      "createdAt",
    ])
      expect(
        organizationBootstrapSchema.safeParse({ ...valid, [field]: "evil" })
          .success,
      ).toBe(false);
  });
});
