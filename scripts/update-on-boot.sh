#!/usr/bin/env bash

# Update once per boot without ever preventing the kiosk from starting.
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
UPDATE_MARKER="/run/bupa-screen/update-attempted"

if [[ -e "${UPDATE_MARKER}" ]]; then
  exit 0
fi

if ! touch "${UPDATE_MARKER}"; then
  echo "Automatic update: could not create the once-per-boot marker; skipping." >&2
  exit 0
fi

if ! command -v git >/dev/null 2>&1 || ! command -v timeout >/dev/null 2>&1; then
  echo "Automatic update: git or timeout is unavailable; skipping." >&2
  exit 0
fi

if ! cd "${APP_DIR}" || [[ ! -d .git ]]; then
  echo "Automatic update: ${APP_DIR} is not a Git checkout; skipping." >&2
  exit 0
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Automatic update: no origin remote is configured; skipping." >&2
  exit 0
fi

export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}"

# Checking the actual Git remote verifies both internet access and credentials.
if ! timeout 15s git ls-remote --exit-code origin HEAD >/dev/null 2>&1; then
  echo "Automatic update: Git remote is not reachable; starting the installed version." >&2
  exit 0
fi

echo "Automatic update: remote is reachable; checking for updates."
if timeout 5m git pull --ff-only; then
  echo "Automatic update: update check completed successfully."
else
  echo "Automatic update: pull failed or timed out; starting the installed version." >&2
fi

exit 0
