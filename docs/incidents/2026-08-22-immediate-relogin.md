# Immediate logout → login authentication incident

Request `21f15289-41c2-49da-8cf5-ce1340d037fb` returned
`AUTHENTICATION_REQUIRED`. In the backend session boundary that code is produced
when the `Authorization` header is missing; malformed and provider-rejected
tokens produce a token-specific 401 code. The failed request therefore contained
no bearer token, rather than a previous-user, newly issued, or revoked token.
There were consequently no token claims (`uid/sub`, `aud`, `iss`, `iat`, `exp`,
or `auth_time`) to compare. The full reload allowing login is consistent with the
frontend rebuilding its request authorization state.

Production log access was not available in the remediation environment, so the
historical `http_request.authorizationPresent` event could not be independently
retrieved. This limitation is recorded rather than inventing provider output.
The response classification above is deterministic from the server boundary.

The backend had no ordinary logout endpoint and did not revoke refresh tokens on
ordinary logout. Existing `revokeRefreshTokens` calls are security boundaries for
account/membership deactivation and child credential rotation/disablement. There
is no Firebase session-cookie implementation, token denylist, or authentication
verification cache. Custom claims are updated as an authorization projection;
Firebase user disabled state is checked. The new ordinary `/auth/logout` endpoint
is deliberately client-local and does not revoke. `/auth/logout-all` is the
explicit global revocation operation.

Verification remains Firebase Admin `verifyIdToken(token, true)`. Structured
events now distinguish missing/malformed headers and expired, revoked, disabled,
wrong-project, invalid-signature, and invalid tokens. They include request ID, a
short SHA-256 fingerprint, and only the safe decoded claims. Raw bearer tokens are
never logged. Verification has no result/failure cache, so one token cannot poison
a subsequent token.
