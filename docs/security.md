# Security

Firestore and Storage are deny-by-default. Clients cannot write users/claims, membership, point ledger, aggregates, audit records, approvals, or configuration. Participant reads require self, a parent link, or an elevated role. App Check is enforced unless explicitly disabled in emulator development. Responses are bounded, errors are safe, logs exclude tokens, PINs, notes and reflections. Future client-readable feature collections require narrowly scoped rule tests before access is added.
