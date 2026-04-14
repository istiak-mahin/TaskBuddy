<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f091c68c-be29-4b3c-972e-8d32ea4f3c60

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## GitHub Pages deployment

This repository is configured to deploy automatically to GitHub Pages using GitHub Actions.

### What is configured

- Workflow file: `/home/runner/work/Study-Tracker/Study-Tracker/.github/workflows/static.yml`
- Trigger: push to `main` (and manual `workflow_dispatch`)
- Build: `npm ci` then `npm run build` with `VITE_BASE_PATH=/<repository-name>/`
- Deploy: uploads `dist` and deploys via `actions/deploy-pages`

### One-time repository settings

1. Go to **Settings → Pages** in this repository.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Ensure the default branch is `main`.
