# Firestore model

Collections are: `organizations`, `users`, `memberships`, `parentChildLinks`, `participants`, `teams`, `teamMembers`, `quarters`, `characterQualities`, `characterCycles`, `characterAssessments`, `dailyCheckins`, `gratitudeEntries`, `bibleActivities`, `bibleActivityResponses`, `characterObservations`, `familyActivities`, `familyActivityCompletions`, `books`, `readingAssignments`, `readingResponses`, `projects`, `projectMilestones`, `projectUpdates`, `supportCategories`, `academicSupportRequests`, `academicSessions`, `surveys`, `surveyResponses`, `pointRules`, `pointLedger`, `participantQuarterStats`, `teamQuarterStats`, `teamWeeklyStats`, `notifications`, `consents`, `auditLogs`, and `systemSettings`.

## Tenancy decision: organizations are programs

The production model uses **Option A**: an organization is the program and `organizationId` is the sole tenant key. There is no `programs` collection and new persisted child records must not contain `programId`. Organization or active-quarter configuration supplies the IANA timezone used for program-local dates.

Child identity is an explicit `participants.firebaseUid` mapping corroborated by one active child `membership`; neither token claims nor participant IDs supplied by clients authorize access. Daily, assessment, Bible, and reading IDs are SHA-256 encodings of length-delimited organization/quarter/resource/participant/date components.

Relationships use document IDs rather than unbounded arrays. Trusted writes use server timestamps. Ledger IDs are idempotency keys. Sensitive free text is exempted from indexing. Historical memberships and finalized submissions are retained rather than deleted.

`memberships/{membershipId}` is the organization-role source of truth. Each server-created document contains `id`, `userId`, `organizationId`, canonical `roles[]`, `status` (`active`, `pending`, or `suspended`), `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, and positive `version`. Query by `userId`; never infer membership from authentication or accept membership fields from a public client. Existing `users/{uid}.roles` remains a global/single-organization compatibility field until records are migrated.

## Parent feature collections

Parent APIs use explicit `parentChildLinks` (`parentUid`, `participantId`, `organizationId`, `status`) and never infer a relationship. Configurable `characterQualities`, `familyActivities`, and `supportCategories` require `organizationId` where tenant-specific and an explicit `status`. `quarters` require `organizationId`, `name`, `status`, `startsAt`, and `endsAt` timestamps. Observations persist participant/parent/organization IDs, constructive description, observed timestamp, moderation status, and server timestamps. Family completions use deterministic `activityId_participantId` IDs. Support requests persist requester/participant/organization/category, safe text, status, version, and server timestamps. `pointLedger` remains append-only and authoritative.
