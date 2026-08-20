export const notificationChannels = ["email", "sms", "push"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

export const notificationBackoffMs = (attempt: number): number =>
  Math.min(24 * 60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1));

/** Only opaque template data may enter the outbox; free-form child data is forbidden. */
export function redactNotificationData(
  data: Record<string, string | number | boolean>,
  allowedKeys: readonly string[],
) {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => allowedKeys.includes(key)),
  );
}
