#!/bin/bash
# Deploy the OwnTracks endpoint to Hostinger. Requires key access to `hostinger`
# (see ~/.ssh/config). Config and database live outside public_html.
set -euo pipefail
HOST=hostinger
DOC=/home/u506224278/domains/diegozc.com/public_html
PRIV=/home/u506224278/owntracks
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> creating private directory"
ssh "$HOST" "mkdir -p $PRIV && chmod 700 $PRIV"

if [ -f /tmp/ot-config.json ]; then
  echo "==> uploading config (0600, outside docroot)"
  scp -q /tmp/ot-config.json "$HOST:$PRIV/config.json"
  ssh "$HOST" "chmod 600 $PRIV/config.json"
else
  echo "   (no /tmp/ot-config.json; leaving existing config in place)"
fi

echo "==> uploading endpoint"
rsync -az --delete --exclude deploy.sh \
  "$HERE/" "$HOST:$DOC/ot/"

echo "==> verifying"
ssh "$HOST" "php -v | head -1; ls -la $PRIV; ls -la $DOC/ot"
echo "==> unauthenticated POST should be 401:"
curl -s -o /dev/null -w "   %{http_code}\n" -X POST https://diegozc.com/ot/
echo "==> bad nav token should be 404:"
curl -s -o /dev/null -w "   %{http_code}\n" "https://diegozc.com/ot/nav.php?t=nope"
echo "done."
