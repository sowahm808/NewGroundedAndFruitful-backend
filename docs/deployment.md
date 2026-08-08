# Deployment

Firebase aliases isolate development, staging, and production. Run all validation before deployment. `deploy:staging` targets staging. `deploy:production` refuses branches other than the protected `production` branch and production should additionally require a reviewed CI environment approval. Configure secrets outside source control and set App Check enforcement true.
