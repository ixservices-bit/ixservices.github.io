# ICQA Resources Admin Panel Dashboard

This is a static, mobile-first dashboard for the ICQA Resources admin data.

## What it uses

- `HTML`
- `CSS`
- `JavaScript`
- Live CSV files from GitHub raw links

## Data sources

The dashboard reads directly from the same GitHub-hosted CSV and version files used by the VB.NET app:

- `FeatureUsage.csv`
- `UserUsage.csv`
- `usersettings/customization_usage.csv`
- `quicklinks.csv`
- `feedback.csv`
- `managers.csv`
- `ActiveUsers.csv`
- `icqa_version.txt`
- `rdc_version.txt`

## Behavior

- Mobile-first dark dashboard
- Manual `Refresh` button
- Loading skeletons
- CSV fetch error handling
- Missing-file fallback messages
- No backend
- No database
- No JSON data files

## Notes

- Open `index.html` in a browser that can reach GitHub raw URLs.
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
