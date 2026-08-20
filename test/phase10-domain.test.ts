import { describe, expect, it } from "vitest";
import {
  notificationBackoffMs,
  redactNotificationData,
} from "../src/notifications/domain.js";
import { enqueueNotificationSchema } from "../src/notifications/schemas.js";
import { reportRequestSchema } from "../src/reports/schemas.js";

describe("phase 10 safety contracts", () => {
  it("redacts fields not allowed by the approved template", () => {
    expect(
      redactNotificationData(
        { firstName: "Sam", privateNote: "secret", count: 2 },
        ["firstName", "count"],
      ),
    ).toEqual({ firstName: "Sam", count: 2 });
  });
  it("uses bounded exponential retry backoff", () => {
    expect(notificationBackoffMs(1)).toBe(30_000);
    expect(notificationBackoffMs(4)).toBe(240_000);
    expect(notificationBackoffMs(99)).toBe(86_400_000);
  });
  it("requires stable idempotency keys for outbox and report jobs", () => {
    expect(
      enqueueNotificationSchema.safeParse({
        organizationId: "o",
        recipientUserId: "u",
        channel: "email",
        templateKey: "welcome",
        templateVersion: "1",
        data: {},
        idempotencyKey: "too-short",
      }).success,
    ).toBe(true);
    expect(
      enqueueNotificationSchema.safeParse({
        organizationId: "o",
        recipientUserId: "u",
        channel: "email",
        templateKey: "welcome",
        templateVersion: "1",
        data: {},
        idempotencyKey: "short",
      }).success,
    ).toBe(false);
    expect(
      reportRequestSchema.safeParse({
        organizationId: "o",
        participantId: "p",
        reportType: "progress",
        policyVersion: "1",
        idempotencyKey: "request_01",
      }).success,
    ).toBe(true);
  });
});
