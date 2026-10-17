#!/usr/bin/env bash
# Shared setup for the infra scripts: repo root, keys from .env.aws, the aws CLI on Windows, small helpers.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -f .env.aws ]; then
  set -a
  # shellcheck disable=SC1090
  . <(tr -d '\r' < .env.aws | grep -E '^[A-Z_]+=.+')
  set +a
fi
command -v aws >/dev/null 2>&1 || PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
command -v aws >/dev/null 2>&1 || { echo "AWS CLI not found. Install it (winget install Amazon.AWSCLI) and re-run." >&2; exit 1; }
REGION=${REGION:-${AWS_DEFAULT_REGION:-ap-south-1}}
# MSYS_NO_PATHCONV: stop Git Bash rewriting SSM names like /leakdesk/X into C:/Program Files/Git/leakdesk/X
export AWS_DEFAULT_REGION=$REGION AWS_PAGER="" MSYS_NO_PATHCONV=1
STATE=infra/.aws-state
say() { echo "== $*"; }
save_state() { # save_state KEY VALUE (replaces an existing line)
  touch "$STATE"
  grep -v "^$1=" "$STATE" > "$STATE.tmp" || true
  echo "$1=$2" >> "$STATE.tmp"
  mv "$STATE.tmp" "$STATE"
}
load_state() { [ -f "$STATE" ] && . <(tr -d '\r' < "$STATE"); return 0; }
# Scratch files live under infra/ (git-ignored) so both aws.exe and node.exe on Windows can open them by relative path.
mk_tmp() { local d="infra/.tmp-$$"; mkdir -p "$d"; echo "$d"; }
