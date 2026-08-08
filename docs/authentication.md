# Authentication

Adults use Firebase Authentication. Child sign-in is designed around family code, handle, and an Argon2id password hash plus server-held pepper. Implementations must use generic failures, account-based and device/IP-supported throttling, temporary lockout, suspicious-attempt auditing, and mint only Firebase custom tokens. Synthetic credentials are never returned. Activation, disablement, refresh-token revocation, and verified consent are parent/admin-controlled. No child-login endpoint is enabled until its persistent rate-limit and audit repository is deployed.
