#!/usr/bin/env bash
#
# Deploy to the VPS: ship source, build there, restart, verify.
#
#   ./script/deploy.sh [--skip-check]
#
# ## Why this exists
#
# Deploys were ad-hoc `tar czf - <some files> | ssh ... tar xzf -`, naming
# whichever files had just been edited. That is wrong twice over and both
# failures happened on the same day:
#
#   - A fix spanning two files shipped as one. The dry run afterwards read
#     as "the fix did not work", and the second file was only found by
#     grepping the deployed copy. Had it been applied rather than dry-run,
#     it would have merged 268 event clusters with the wrong survivors.
#   - `app/web/dist` is the built client. It is gitignored, so it only
#     reaches the host when a deploy remembers to include it — and a tar
#     naming individual files does not. Production served a bundle built
#     before the source changed, and the scaffolding vendor's Open Graph
#     tags kept going out after the source had been corrected.
#
# So: everything ships together, the bundle is built from the source that
# just landed, and the deploy fails loudly rather than half-applying.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@217.216.72.28}"
REMOTE="${DEPLOY_PATH:-/root/wheresthefx-next}"
APP="${DEPLOY_APP:-wheresthefx-next}"
HEALTH="${DEPLOY_HEALTH:-https://www.wheresthefx.com/api/health}"

cd "$(dirname "$0")/.."

if [[ "${1:-}" != "--skip-check" ]]; then
  echo "==> npm run check"
  npm run check
fi

echo "==> shipping source to ${HOST}:${REMOTE}"
# .env and data/ hold live credentials and the Instagram session; dist is
# rebuilt on the far side; node_modules is installed there already.
tar czf - \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=.git \
  --exclude=.env \
  --exclude=data \
  app package script package.json package-lock.json eslint.config.js vitest.config.ts \
  | ssh -o ConnectTimeout=25 "$HOST" "cd '$REMOTE' && tar xzf -"

echo "==> building the client on the host"
ssh -o ConnectTimeout=25 "$HOST" "cd '$REMOTE/app/web' && npx vite build" | tail -3

echo "==> restarting ${APP}"
ssh -o ConnectTimeout=25 "$HOST" "pm2 restart '$APP' --update-env >/dev/null 2>&1"

# The restart is asynchronous; give it a moment before asking if it is well.
sleep 6

echo "==> verifying"
code=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH")
if [[ "$code" != "200" ]]; then
  echo "health check returned ${code}, not 200" >&2
  ssh -o ConnectTimeout=25 "$HOST" "pm2 logs '$APP' --lines 20 --nostream" >&2 || true
  exit 1
fi

curl -s "$HEALTH"
echo
echo "==> deployed"
