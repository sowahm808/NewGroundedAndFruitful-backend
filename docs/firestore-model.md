# Firestore model

Collections are: `organizations`, `users`, `parentChildLinks`, `participants`, `teams`, `teamMembers`, `quarters`, `characterQualities`, `characterCycles`, `characterAssessments`, `dailyCheckins`, `gratitudeEntries`, `bibleActivities`, `bibleActivityResponses`, `characterObservations`, `familyActivities`, `familyActivityCompletions`, `books`, `readingAssignments`, `readingResponses`, `projects`, `projectMilestones`, `projectUpdates`, `academicSupportRequests`, `academicSessions`, `surveys`, `surveyResponses`, `pointRules`, `pointLedger`, `participantQuarterStats`, `teamQuarterStats`, `teamWeeklyStats`, `notifications`, `consents`, `auditLogs`, and `systemSettings`.

Relationships use document IDs rather than unbounded arrays. Trusted writes use server timestamps. Ledger IDs are idempotency keys. Sensitive free text is exempted from indexing. Historical memberships and finalized submissions are retained rather than deleted.
