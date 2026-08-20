import { BusinessRuleError } from "../shared/errors.js";

export const quarterStates = [
  "draft",
  "scheduled",
  "open",
  "checkpoint",
  "closed",
  "recognition",
  "archived",
] as const;
export type QuarterState = (typeof quarterStates)[number];

const transitions: Record<QuarterState, readonly QuarterState[]> = {
  draft: ["scheduled"],
  scheduled: ["draft", "open"],
  open: ["checkpoint"],
  checkpoint: ["open", "closed"],
  closed: ["recognition"],
  recognition: ["archived"],
  archived: [],
};

export const quarterOccupiesCalendar = (state: QuarterState): boolean =>
  state === "scheduled" || state === "open" || state === "checkpoint";

export function assertQuarterTransition(from: QuarterState, to: QuarterState) {
  if (!transitions[from].includes(to))
    throw new BusinessRuleError(
      "ILLEGAL_QUARTER_TRANSITION",
      `A quarter cannot transition from ${from} to ${to}.`,
    );
}

export function assertDateRange(
  startDate: string,
  endDate: string,
  label: string,
) {
  if (startDate > endDate)
    throw new BusinessRuleError(
      "INVALID_DATE_RANGE",
      `${label} startDate must not be after endDate.`,
    );
}

export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
) {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Converts a local calendar midnight to an instant without assuming UTC boundaries. */
export function localMidnight(date: string, timeZone: string): Date {
  const components = date.split("-");
  const year = Number(components[0]);
  const month = Number(components[1]);
  const day = Number(components[2]);
  let candidate = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((p) => [p.type, p.value]),
    );
    const represented = Date.UTC(
      +parts.year!,
      +parts.month! - 1,
      +parts.day!,
      +parts.hour!,
      +parts.minute!,
      +parts.second!,
    );
    const adjustment = Date.UTC(year, month - 1, day) - represented;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate);
}

export function localWeekStart(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const local = [parts.year, parts.month, parts.day].map(String).join("-");
  const noon = new Date(`${local}T12:00:00Z`);
  const mondayOffset = (noon.getUTCDay() + 6) % 7;
  noon.setUTCDate(noon.getUTCDate() - mondayOffset);
  return noon.toISOString().slice(0, 10);
}
