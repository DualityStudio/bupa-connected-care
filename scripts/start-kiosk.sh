#!/usr/bin/env bash
set -euo pipefail

KIOSK_URL="${BUPA_KIOSK_URL:-http://127.0.0.1:5000}"

if [[ -x /usr/bin/chromium ]]; then
  CHROMIUM_BIN=/usr/bin/chromium
elif [[ -x /usr/bin/chromium-browser ]]; then
  CHROMIUM_BIN=/usr/bin/chromium-browser
else
  echo "Chromium is not installed." >&2
  exit 1
fi

while true; do
  while ! /usr/bin/curl --silent --fail --max-time 2 "${KIOSK_URL}/health" >/dev/null; do
    sleep 1
  done

  if "${CHROMIUM_BIN}" \
      --kiosk \
      --start-maximized \
      --noerrdialogs \
      --disable-infobars \
      --no-first-run \
      --password-store=basic \
      --disable-session-crashed-bubble \
      --allow-scripts-to-close-windows \
      --disable-pinch \
      --overscroll-history-navigation=0 \
      --autoplay-policy=no-user-gesture-required \
      "${KIOSK_URL}"; then
    echo "Chromium was closed normally. Leaving kiosk mode." >&2
    break
  else
    CHROMIUM_EXIT_CODE=$?
  fi

  echo "Chromium exited with code ${CHROMIUM_EXIT_CODE}. Restarting the kiosk in two seconds…" >&2
  sleep 2
done
