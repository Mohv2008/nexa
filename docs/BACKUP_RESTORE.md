# Backup and restore

## D1

Create a consistent SQL export with Wrangler (replace IDs/names as configured):

```bash
npx wrangler d1 export nexa-db --remote --output backups/nexa-YYYYMMDD.sql
```

Encrypt the export before placing it outside the operator account; it contains private messages and
account email addresses. Do not put backups in the public Git repository.

Restore rehearsal:

```bash
npx wrangler d1 create nexa-restore-test
npx wrangler d1 execute nexa-restore-test --remote --file backups/nexa-YYYYMMDD.sql
npx wrangler d1 execute nexa-restore-test --remote --command "PRAGMA foreign_key_check;"
```

Then compare row counts for users, messages, servers, and uploads. Point a staging Worker at the
restored DB, execute login/feed/message smoke tests, and delete the test DB after recording results.
D1 Time Travel is another recovery mechanism, not a replacement for independently tested exports.

## R2

Use an S3-compatible client such as `rclone sync` to copy the private bucket to an encrypted backup
target. Preserve object keys because D1 references them. Generate a manifest of key/size/hash; after
restore, compare it and sample authorized media reads.

## Order and recovery point

Export D1 immediately after the R2 sync or pause writes for a maintenance snapshot. If objects are
newer than D1 they are harmless orphans; if D1 is newer than R2, attachments are broken. A production
backup job should record both completion times and retain at least one known-good pair.

No remote backup/restore was claimed in the current test report because no Cloudflare account was
provided. Run this rehearsal before public launch and quarterly thereafter.
