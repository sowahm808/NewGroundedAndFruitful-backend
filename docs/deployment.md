# Deployment

Firebase aliases isolate development, staging, and production. Run all validation before deployment. `deploy:staging` targets staging. `deploy:production` refuses branches other than the protected `production` branch and production should additionally require a reviewed CI environment approval. Configure secrets outside source control and set App Check enforcement true.

## Production API hostname

The Render Blueprint assigns `api.groundedandfruitful.org` to the
`grounded-fruitful-api` service. The hostname also has to exist in public DNS;
declaring it in `render.yaml` cannot change records at the domain registrar.

At the authoritative DNS provider for `groundedandfruitful.org`:

1. Create a `CNAME` record with host/name `api` and target
   `grounded-fruitful-api.onrender.com`.
2. Remove any conflicting `A`, `AAAA`, or other `CNAME` records for `api`.
3. Apply the Blueprint (or confirm the custom domain in the Render dashboard)
   and wait until Render reports that its certificate is issued.

Verify DNS before debugging the application or CORS:

```sh
dig +short api.groundedandfruitful.org CNAME
curl --fail --show-error https://api.groundedandfruitful.org/health
```

The first command must return the Render hostname, and the health request must
return a successful response. Browser errors containing `ERR_NAME_NOT_RESOLVED`
mean DNS has not been created or propagated; the request has not reached this
Express service yet.

Service-account JSON must be injected as a Render secret file and referenced
by `GOOGLE_APPLICATION_CREDENTIALS`. Never commit private keys to an env example
or any other repository file. If a key has ever been committed, disable/delete
it in Google Cloud IAM, create a replacement, and update the Render secret.
