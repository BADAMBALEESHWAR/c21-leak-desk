#!/bin/bash
# Hourly: dump the leakdesk MongoDB database (gzip) to S3 under backups/. Keeps everything; S3 is cheap.
set -euo pipefail
TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
C=$(docker ps -qf name=mongo)
docker exec "$C" mongodump --db leakdesk --archive --gzip > /tmp/leakdesk-$TS.archive.gz
aws s3 cp /tmp/leakdesk-$TS.archive.gz s3://${UPLOADS_BUCKET}/backups/leakdesk-$TS.archive.gz --only-show-errors
rm -f /tmp/leakdesk-$TS.archive.gz
echo "backup $TS done"
