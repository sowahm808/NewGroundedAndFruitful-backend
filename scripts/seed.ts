import { hash } from "@node-rs/argon2";
import { Timestamp } from "firebase-admin/firestore";
import { credentialLookupDigest } from "../src/auth/repositories/child-credentials.js";
import { env } from "../src/config/env.js";
import { auth, db } from "../src/config/firebase.js";

if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Seed only runs with Auth and Firestore emulators.");

const organizationId = "org-fixture";
const secondOrganizationId = "org-neighbor";
const quarterId = "q-active";
const now = new Date();
const today = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
);
const daysFromToday = (days: number) =>
  Timestamp.fromMillis(today.getTime() + days * 86_400_000);
const isoDate = (days: number) =>
  new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
const timestamp = Timestamp.fromDate(today);

type Fixture = readonly [path: string, data: Record<string, unknown>];
const fixtures: Fixture[] = [
  [
    `organizations/${organizationId}`,
    {
      id: organizationId,
      name: "Grounded & Fruitful Demo Program",
      status: "active",
      timezone: "UTC",
      consentVersion: "demo-2026-01",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  [
    `organizations/${secondOrganizationId}`,
    {
      id: secondOrganizationId,
      name: "Neighbor Program (cross-tenant fixture)",
      status: "active",
      timezone: "America/New_York",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  [
    `workspaces/${organizationId}`,
    {
      id: organizationId,
      name: "Grounded & Fruitful Demo Program",
      type: "organization",
    },
  ],
  [
    `workspaces/${secondOrganizationId}`,
    {
      id: secondOrganizationId,
      name: "Neighbor Program",
      type: "organization",
    },
  ],
  [
    `quarters/${quarterId}`,
    {
      id: quarterId,
      organizationId,
      name: "Current Growth Quarter",
      description: "Twelve-week emulator workflow fixture",
      startDate: isoDate(-28),
      endDate: isoDate(55),
      startsAt: daysFromToday(-28),
      endsAt: daysFromToday(56),
      timezone: "UTC",
      durationWeeks: 12,
      targetPoints: 5000,
      teamPointTarget: 5000,
      targetWeek: 8,
      status: "open",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: "admin-1",
      updatedBy: "admin-1",
    },
  ],
  [
    "quarters/q-draft",
    {
      organizationId,
      name: "Next Quarter Draft",
      startDate: isoDate(70),
      endDate: isoDate(153),
      startsAt: daysFromToday(70),
      endsAt: daysFromToday(154),
      timezone: "UTC",
      status: "draft",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: "admin-1",
      updatedBy: "admin-1",
    },
  ],
  [
    "quarters/q-archived",
    {
      organizationId,
      name: "Archived Growth Quarter",
      startDate: isoDate(-196),
      endDate: isoDate(-113),
      startsAt: daysFromToday(-196),
      endsAt: daysFromToday(-112),
      timezone: "UTC",
      status: "archived",
      version: 4,
      createdAt: daysFromToday(-210),
      updatedAt: daysFromToday(-112),
      createdBy: "admin-1",
      updatedBy: "admin-1",
    },
  ],
  [
    "teams/team-a",
    {
      organizationId,
      approvedDisplayName: "Growing Oaks",
      name: "Growing Oaks",
      status: "active",
      archived: false,
      capacity: 5,
    },
  ],
  [
    "teams/team-b",
    {
      organizationId,
      approvedDisplayName: "Brave Cedars",
      name: "Brave Cedars",
      status: "active",
      archived: false,
      capacity: 5,
    },
  ],
  [
    "teams/team-neighbor",
    {
      organizationId: secondOrganizationId,
      approvedDisplayName: "Neighbor Team",
      status: "active",
      archived: false,
    },
  ],
  [
    "participants/child-1",
    {
      firebaseUid: "child-1",
      organizationId,
      approvedDisplayName: "Avery",
      displayName: "Avery",
      activeTeamId: "team-a",
      status: "active",
      timezone: "UTC",
    },
  ],
  [
    "participants/child-2",
    {
      firebaseUid: "child-2",
      organizationId,
      approvedDisplayName: "Jordan",
      displayName: "Jordan",
      activeTeamId: "team-a",
      status: "active",
      timezone: "UTC",
    },
  ],
  [
    "participants/suspended-child-1",
    {
      firebaseUid: "suspended-child-1",
      organizationId,
      approvedDisplayName: "Suspended Child",
      status: "active",
      timezone: "UTC",
    },
  ],
  [
    "participants/neighbor-child-1",
    {
      firebaseUid: "neighbor-child-1",
      organizationId: secondOrganizationId,
      approvedDisplayName: "Neighbor Child",
      activeTeamId: "team-neighbor",
      status: "active",
      timezone: "America/New_York",
    },
  ],
  [
    "teamMembers/team-a_child-1",
    {
      organizationId,
      teamId: "team-a",
      participantId: "child-1",
      status: "active",
      effectiveAt: daysFromToday(-28),
    },
  ],
  [
    "teamMembers/team-a_child-2",
    {
      organizationId,
      teamId: "team-a",
      participantId: "child-2",
      status: "active",
      effectiveAt: daysFromToday(-28),
    },
  ],
  [
    "teamMembers/team-neighbor_neighbor-child-1",
    {
      organizationId: secondOrganizationId,
      teamId: "team-neighbor",
      participantId: "neighbor-child-1",
      status: "active",
      effectiveAt: daysFromToday(-28),
    },
  ],
  [
    "parentChildLinks/parent-1_child-1",
    {
      organizationId,
      parentUid: "parent-1",
      participantId: "child-1",
      status: "active",
      relationship: "guardian",
      createdAt: timestamp,
    },
  ],
  [
    "mentorAssignments/mentor-1_team-a",
    {
      organizationId,
      mentorUserId: "mentor-1",
      teamId: "team-a",
      status: "active",
      effectiveAt: daysFromToday(-28),
      expiresAt: daysFromToday(56),
    },
  ],
  [
    "observerGrants/observer-1_child-1",
    {
      organizationId,
      userId: "observer-1",
      participantId: "child-1",
      subjectIds: ["character", "service"],
      status: "active",
      effectiveAt: daysFromToday(-28),
      expiresAt: daysFromToday(56),
    },
  ],
  [
    "consents/parent-1_child-1_demo-2026-01",
    {
      organizationId,
      parentUid: "parent-1",
      participantId: "child-1",
      version: "demo-2026-01",
      status: "accepted",
      acceptedAt: timestamp,
    },
  ],
  [
    "characterQualities/quality-kindness",
    {
      organizationId,
      name: "Kindness",
      description: "Choose helpful and caring actions.",
      status: "active",
    },
  ],
  [
    "characterQualities/quality-courage",
    {
      organizationId,
      name: "Courage",
      description: "Take a healthy next step even when it is hard.",
      status: "active",
    },
  ],
  [
    "characterQualities/quality-patience",
    {
      organizationId,
      name: "Patience",
      description: "Make room for time and other people.",
      status: "active",
    },
  ],
  [
    "characterQualities/quality-honesty",
    {
      organizationId,
      name: "Honesty",
      description: "Be truthful with care.",
      status: "active",
    },
  ],
  [
    "characterQualities/quality-service",
    {
      organizationId,
      name: "Service",
      description: "Use your gifts to help.",
      status: "active",
    },
  ],
  [
    "characterCycles/cycle-active",
    {
      organizationId,
      quarterId,
      name: "Five Qualities Cycle",
      qualityIds: [
        "quality-kindness",
        "quality-courage",
        "quality-patience",
        "quality-honesty",
        "quality-service",
      ],
      status: "active",
      startsAt: daysFromToday(-28),
      endsAt: daysFromToday(28),
    },
  ],
  [
    "bibleActivities/bible-today",
    {
      organizationId,
      quarterId,
      title: "Daily Scripture Reflection",
      scriptureReference: "Galatians 5:22-23",
      activityType: "reflection",
      prompt: "What fruit would you like to practice today?",
      status: "active",
      availableFrom: daysFromToday(-1),
      availableUntil: daysFromToday(1),
      version: 1,
    },
  ],
  [
    "books/book-1",
    {
      organizationId,
      title: "The Growth Journey",
      author: "Demo Author",
      quarterId,
      status: "active",
    },
  ],
  [
    "readingAssignments/reading-week-current",
    {
      organizationId,
      quarterId,
      bookId: "book-1",
      title: "Weekly reading reflection",
      instructions: "Share one idea that stayed with you.",
      responseType: "reading_reflection",
      status: "active",
      availableFrom: daysFromToday(-7),
      availableUntil: daysFromToday(7),
    },
  ],
  [
    "projects/project-1",
    {
      organizationId,
      quarterId,
      participantId: "child-1",
      title: "Neighborhood Pollinator Garden",
      description: "Plan a small garden for local pollinators.",
      status: "progress",
      version: 5,
      nextMilestone: "Choose three native plants",
      createdAt: daysFromToday(-20),
      updatedAt: timestamp,
    },
  ],
  [
    "projectMilestones/milestone-1",
    {
      organizationId,
      projectId: "project-1",
      participantId: "child-1",
      title: "Choose three native plants",
      status: "pending",
      createdAt: daysFromToday(-7),
      updatedAt: timestamp,
    },
  ],
  [
    "projectUpdates/update-1",
    {
      organizationId,
      projectId: "project-1",
      participantId: "child-1",
      text: "I measured the garden space.",
      createdAt: daysFromToday(-2),
    },
  ],
  [
    "familyActivities/family-meal",
    {
      organizationId,
      title: "Gratitude meal",
      instructions: "Share one gratitude at a family meal.",
      status: "active",
      pointsEligible: true,
    },
  ],
  [
    "supportCategories/category-study",
    { organizationId, name: "Study planning", status: "active" },
  ],
  [
    "surveys/survey-1",
    {
      organizationId,
      quarterId,
      title: "Pre-quarter check-in",
      type: "pre_quarter",
      privacyNotice:
        "Responses are private and reported only in approved aggregates.",
      version: 1,
      status: "active",
    },
  ],
  [
    "pointRules/rule-daily-checkin",
    {
      organizationId,
      quarterId,
      activityType: "daily_checkin",
      points: 10,
      enabled: true,
      effectiveFrom: daysFromToday(-28),
      effectiveUntil: daysFromToday(56),
      version: 1,
    },
  ],
  [
    "pointRules/rule-character",
    {
      organizationId,
      quarterId,
      activityType: "character_assessment",
      points: 10,
      enabled: true,
      effectiveFrom: daysFromToday(-28),
      effectiveUntil: daysFromToday(56),
      version: 1,
    },
  ],
  [
    "pointRules/rule-bible",
    {
      organizationId,
      quarterId,
      activityType: "bible_activity",
      points: 10,
      enabled: true,
      effectiveFrom: daysFromToday(-28),
      effectiveUntil: daysFromToday(56),
      version: 1,
    },
  ],
  [
    "pointRules/rule-reading",
    {
      organizationId,
      quarterId,
      activityType: "reading",
      points: 10,
      enabled: true,
      effectiveFrom: daysFromToday(-28),
      effectiveUntil: daysFromToday(56),
      version: 1,
    },
  ],
  [
    "pointRules/rule-project-milestone",
    {
      organizationId,
      quarterId,
      activityType: "project_milestone",
      points: 20,
      enabled: true,
      effectiveFrom: daysFromToday(-28),
      effectiveUntil: daysFromToday(56),
      version: 1,
    },
  ],
  [
    "participantQuarterStats/q-active_child-1",
    {
      organizationId,
      participantId: "child-1",
      quarterId,
      totalPoints: 120,
      updatedAt: timestamp,
    },
  ],
  [
    "participantQuarterStats/q-active_child-2",
    {
      organizationId,
      participantId: "child-2",
      quarterId,
      totalPoints: 80,
      updatedAt: timestamp,
    },
  ],
  [
    "teamQuarterStats/q-active_team-a",
    {
      organizationId,
      teamId: "team-a",
      quarterId,
      totalPoints: 200,
      updatedAt: timestamp,
    },
  ],
  [
    "teamWeeklyStats/q-active_team-a_current",
    {
      organizationId,
      teamId: "team-a",
      quarterId,
      week: isoDate(-7),
      totalPoints: 50,
      updatedAt: timestamp,
    },
  ],
  [
    "characterObservations/observation-approved",
    {
      organizationId,
      participantId: "child-1",
      parentUid: "parent-1",
      description: "Avery included someone who was new to the group.",
      observedAt: daysFromToday(-2),
      status: "approved",
      createdAt: daysFromToday(-2),
      moderatedAt: daysFromToday(-1),
    },
  ],
  [
    "observerObservations/observer-observation-pending",
    {
      organizationId,
      participantId: "child-1",
      observerUserId: "observer-1",
      subjectId: "service",
      description: "Avery volunteered to put supplies away.",
      observedAt: daysFromToday(-1),
      status: "pending",
      createdAt: timestamp,
    },
  ],
  [
    "notifications/parent-welcome",
    {
      organizationId,
      userId: "parent-1",
      type: "welcome",
      title: "Welcome to the current quarter",
      status: "unread",
      createdAt: timestamp,
    },
  ],
  [
    "reportPolicies/participation-summary_v1",
    {
      organizationId,
      reportType: "participation-summary",
      version: "v1",
      status: "approved",
      redactionProfile: "guardian-summary",
      storageExpirySeconds: 3600,
      createdAt: timestamp,
    },
  ],
  // These private canaries make accidental disclosure obvious in UI/API tests.
  [
    "dailyCheckins/private-canary-child-2",
    {
      organizationId,
      participantId: "child-2",
      quarterId,
      localDate: isoDate(-1),
      timezone: "UTC",
      feeling: "PRIVATE_CANARY_FEELING",
      note: "PRIVATE_CANARY_CHECKIN_NOTE",
      gratitudeResponse: "PRIVATE_CANARY_GRATITUDE",
      characterResponses: [],
      status: "completed",
      completedAt: daysFromToday(-1),
      version: 1,
    },
  ],
  [
    "surveyResponses/private-canary-child-2",
    {
      organizationId,
      participantId: "child-2",
      surveyId: "survey-1",
      answers: ["PRIVATE_CANARY_SURVEY_ANSWER"],
      status: "completed",
      completedAt: daysFromToday(-1),
    },
  ],
];

await Promise.all(fixtures.map(([path, data]) => db.doc(path).set(data)));

const identities = [
  {
    uid: "parent-1",
    role: "parent",
    organizationId,
    displayName: "Demo Parent",
  },
  {
    uid: "parent-empty-1",
    role: "parent",
    organizationId,
    displayName: "Demo Parent (no linked children)",
  },
  { uid: "child-1", role: "child", organizationId, displayName: "Avery" },
  { uid: "child-2", role: "child", organizationId, displayName: "Jordan" },
  {
    uid: "mentor-1",
    role: "mentor",
    organizationId,
    displayName: "Demo Mentor",
  },
  { uid: "admin-1", role: "admin", organizationId, displayName: "Demo Admin" },
  {
    uid: "super-admin-1",
    role: "super_admin",
    organizationId,
    displayName: "Demo Super Admin",
  },
  {
    uid: "observer-1",
    role: "observer",
    organizationId,
    displayName: "Demo Observer",
  },
  {
    uid: "neighbor-admin-1",
    role: "admin",
    organizationId: secondOrganizationId,
    displayName: "Neighbor Admin",
  },
  {
    uid: "neighbor-child-1",
    role: "child",
    organizationId: secondOrganizationId,
    displayName: "Neighbor Child",
  },
] as const;

for (const identity of identities) {
  const email = `${identity.uid}@example.test`;
  await auth
    .createUser({
      uid: identity.uid,
      email,
      password: "Grounded1!",
      displayName: identity.displayName,
    })
    .catch((error: unknown) => {
      if ((error as { code?: string }).code !== "auth/uid-already-exists")
        throw error;
    });
  await auth.setCustomUserClaims(identity.uid, {
    roles: [identity.role],
    role: identity.role,
  });
  await db.doc(`users/${identity.uid}`).set({
    uid: identity.uid,
    email,
    displayName: identity.displayName,
    roles: [],
    status: "active",
  });
  await db.doc(`memberships/${identity.organizationId}_${identity.uid}`).set({
    id: `${identity.organizationId}_${identity.uid}`,
    userId: identity.uid,
    organizationId: identity.organizationId,
    workspaceId: identity.organizationId,
    roles: [identity.role],
    status: "active",
    timezone:
      identity.organizationId === organizationId ? "UTC" : "America/New_York",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: "seed",
    updatedBy: "seed",
  });
}

await auth
  .createUser({ uid: "suspended-child-1", displayName: "Suspended Child" })
  .catch((error: unknown) => {
    if ((error as { code?: string }).code !== "auth/uid-already-exists")
      throw error;
  });
await auth.setCustomUserClaims("suspended-child-1", {
  roles: ["child"],
  role: "child",
});
await db.doc("users/suspended-child-1").set({
  uid: "suspended-child-1",
  displayName: "Suspended Child",
  roles: [],
  status: "active",
});
await db.doc(`memberships/${organizationId}_suspended-child-1`).set({
  userId: "suspended-child-1",
  participantId: "suspended-child-1",
  organizationId,
  roles: ["child"],
  status: "suspended",
  version: 1,
});

for (const credential of [
  { familyCode: "FAMILY1", handle: "sprout", uid: "child-1", organizationId },
  {
    familyCode: "FAMILY1",
    handle: "suspended",
    uid: "suspended-child-1",
    organizationId,
  },
  {
    familyCode: "NEIGHBOR",
    handle: "seedling",
    uid: "neighbor-child-1",
    organizationId: secondOrganizationId,
  },
]) {
  const key = credentialLookupDigest(credential.familyCode, credential.handle);
  await db.doc(`childCredentials/${key}`).set({
    firebaseUid: credential.uid,
    participantId: credential.uid,
    organizationId: credential.organizationId,
    pinHash: await hash(`2468${env.CHILD_LOGIN_PEPPER}`),
    failedAttempts: 0,
    disabled: false,
  });
}

console.log(
  `Seeded ${String(fixtures.length)} workflow fixtures and ${String(identities.length + 1)} emulator identities.`,
);
