#!/usr/bin/env bash
set -euo pipefail

KIOSK_URL="${BUPA_KIOSK_URL:-http://127.0.0.1:5000}"
KIOSK_CONTROL_DIR="${BUPA_KIOSK_CONTROL_DIR:-/run/bupa-screen}"
KIOSK_BROWSER_PID_PATH="${KIOSK_CONTROL_DIR}/chromium.pid"
KIOSK_EXIT_REQUEST_PATH="${KIOSK_CONTROL_DIR}/exit-kiosk"

if [[ -x /usr/bin/chromium ]]; then
  CHROMIUM_BIN=/usr/bin/chromium
elif [[ -x /usr/bin/chromium-browser ]]; then
  CHROMIUM_BIN=/usr/bin/chromium-browser
else
  echo "Chromium is not installed." >&2
  exit 1
fi

if [[ ! -d "${KIOSK_CONTROL_DIR}" ]]; then
  echo "Kiosk control directory is unavailable: ${KIOSK_CONTROL_DIR}" >&2
  exit 1
fi

rm -f "${KIOSK_BROWSER_PID_PATH}" "${KIOSK_EXIT_REQUEST_PATH}"
trap 'rm -f "${KIOSK_BROWSER_PID_PATH}"' EXIT

while true; do
  while ! /usr/bin/curl --silent --fail --max-time 2 "${KIOSK_URL}/health" >/dev/null; do
    sleep 1
  done

  "${CHROMIUM_BIN}" \
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
      "${KIOSK_URL}" &
  CHROMIUM_PID=$!
  printf '%s\n' "${CHROMIUM_PID}" >"${KIOSK_BROWSER_PID_PATH}"

  set +e
  wait "${CHROMIUM_PID}"
  CHROMIUM_EXIT_CODE=$?
  set -e
  rm -f "${KIOSK_BROWSER_PID_PATH}"

  if [[ -f "${KIOSK_EXIT_REQUEST_PATH}" ]]; then
    rm -f "${KIOSK_EXIT_REQUEST_PATH}"
    echo "Kiosk exit was requested. Leaving Chromium closed." >&2
    break
  fi

  if [[ "${CHROMIUM_EXIT_CODE}" -eq 0 ]]; then
    echo "Chromium was closed normally. Leaving kiosk mode." >&2
    break
  fi

  echo "Chromium exited with code ${CHROMIUM_EXIT_CODE}. Restarting the kiosk in two seconds…" >&2
  sleep 2
done
