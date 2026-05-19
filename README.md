# ICQA Resources Admin Panel Dashboard

This is a static, mobile-first dashboard for the ICQA Resources admin data.

## What it uses

- `HTML`
- `CSS`
- `JavaScript`
- CSV files served by GitHub Pages from the `data/` folder
- GitHub Actions sync from private source repos

## Data sources

The dashboard reads local static files from the `data/` folder:

- `FeatureUsage.csv`
- `UserUsage.csv`
- `customization_usage.csv`
- `quicklinks.csv`
- `feedback.csv`
- `managers.csv`
- `ActiveUsers.csv`
- `icqa_version.txt`
- `rdc_version.txt`

The `.github/workflows/sync-dashboard-data.yml` workflow refreshes those files from:

- `ixservices-bit/data`
- `ixservices-bit/update`

## Behavior

- Mobile-first dark dashboard
- Manual `Refresh` button
- Loading skeletons
- CSV fetch error handling
- Missing-file fallback messages
- No backend
- No database
- No JSON data files

## Private Data Sync

Create repository secrets in the `ixservices-bit/ixservices.github.io` repo.

Required:

- `ICQA_DATA_SYNC_TOKEN`: token with read access to `ixservices-bit/data`

Optional, but recommended if the update repo uses a separate token:

- `ICQA_UPDATE_SYNC_TOKEN`: token with read access to `ixservices-bit/update`

If `ICQA_UPDATE_SYNC_TOKEN` is missing, the workflow tries `ICQA_DATA_SYNC_TOKEN` for both repos.

The workflow reads:

- `ixservices-bit/data`
- `ixservices-bit/update`

After the secret exists, run `Actions` > `Sync dashboard data` > `Run workflow`. The workflow also runs every 30 minutes.

## Notes

- Open `index.html` in a browser that can reach GitHub Pages.
- The dashboard only reads data. It does not write back to GitHub or modify the VB.NET app.

## GitHub Pages

This project is ready to publish on GitHub Pages as a static site.

Recommended setup:

1. Push these files to your repository.
2. In GitHub, open `Settings` > `Pages`.
3. Choose the branch and folder that contains `index.html`:
   - `main` branch, `/ (root)` if these files live at the repo root
   - or `main` branch, `/docs` if you later move the site there
4. Save and wait for GitHub Pages to build the site.

If you host from the repository root, the site will load directly from `index.html` with no build step.
