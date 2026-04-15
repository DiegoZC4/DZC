# WeightUp Shared CSV Backend

This folder holds the shared WeightUp CSV and the PHP API that protects it.

## Public behavior

- `diegozc.com/weightup` stays public and shows the UI without shared workout data.
- Signed out: the app uses only browser local storage.
- Signed in with an allowed Google account: the app loads the shared CSV and writes edits back to it.

## Auth model

The old Basic Auth gate is no longer required for the shared log flow.

Instead:

- the frontend uses Google Identity Services
- the frontend sends the Google ID token to [api.php](/Users/diego/Desktop/Ego/public_html/weightup/log/api.php)
- the backend verifies the token with Google
- the backend checks the email against an allowlist in [config.php](/Users/diego/Desktop/Ego/public_html/weightup/log/config.php)
- if allowed, the backend creates a PHP session

## Required server setup

Edit [config.php](/Users/diego/Desktop/Ego/public_html/weightup/log/config.php):

- set `google_client_id`
- add the Gmail addresses that are allowed to see/edit the shared log

## API

All actions are served by [api.php](/Users/diego/Desktop/Ego/public_html/weightup/log/api.php):

- `GET /weightup/log/api.php?action=status`
- `POST /weightup/log/api.php?action=google_login`
- `POST /weightup/log/api.php?action=logout`
- `GET /weightup/log/api.php?action=load`
- `POST /weightup/log/api.php?action=save`
- `GET /weightup/log/api.php?action=download`

## Stored files

- live shared CSV: [`data/weightup.csv`](/Users/diego/Desktop/Ego/public_html/weightup/log/data/weightup.csv)
- save metadata: `data/meta.json`
- monthly backups: `data/backups/weightup-YYYY-MM.csv`

The whole [`data/`](/Users/diego/Desktop/Ego/public_html/weightup/log/data/.htaccess) directory is blocked from direct web access.

## Monthly backups

Before the first overwrite in a given UTC month, the backend snapshots the current live CSV into:

- `data/backups/weightup-YYYY-MM.csv`

That gives you one protected backup snapshot per month in case the main CSV gets accidentally mangled.

## Notes

- [weightup/index.php](/Users/diego/Desktop/Ego/public_html/weightup/index.php) still serves the public app at `/weightup`.
- PHP still needs to be enabled on Hostinger for `/weightup/index.php` and `/weightup/log/api.php`.
