# Phase 10 policy gates

The infrastructure in this phase does not approve policy. Consent capture validates an exact, organization-scoped `consentPolicies/{policyKey}_{policyVersion}` record whose status is `approved` and whose immutable legal-text reference matches the request. Acceptance and withdrawal append `consentEvents`; the separate `activeConsents` projection is replaceable.

- [!] Age thresholds are not enforced because no approved threshold or jurisdiction rule is present.
- [!] Withdrawal records the effective time but triggers no deletion, disablement, or retrospective effect because those effects are not approved.
- [!] Consent and report retention are not enforced because no approved retention schedule is present. Consent history and audit records must not be deleted by application workflows.

Notification enqueueing requires an approved, organization-scoped template and retains only its allowlisted template variables. The provider-neutral worker contract records attempts, bounded exponential backoff, delivered/failed/dead-letter states and provider-safe error codes. Monitoring returns state counts and never message payloads.

Report jobs require an approved, organization-scoped report policy that specifies a redaction profile and positive storage-expiry duration. Generation is asynchronous, objects are private, download links are short-lived and bounded by storage expiry, and each signed download is audited. The renderer is responsible for implementing the approved redaction profile.

Safeguarding incident storage is deliberately absent. Do not introduce an incident collection, payload, endpoint, or notification until the restricted model, access audit, escalation procedure, notification policy, and retention policy receive separate review.
