#!/usr/bin/env bash
set -euo pipefail

KIOSK_URL="${BUPA_KIOSK_URL:-http://127.0.0.1:5000}"
KIOSK_CONTROL_DIR="${BUPA_KIOSK_CONTROL_DIR:-/run/bupa-screen}"
KIOSK_BROWSER_PID_PATH="${KIOSK_CONTROL_DIR}/chromium.pid"
KIOSK_EXIT_REQUEST_PATH="${KIOSK_CONTROL_DIR}/exit-kiosk"
KIOSK_MINIMISE_REQUEST_PATH="${KIOSK_CONTROL_DIR}/minimise-kiosk"
MINIMISE_MONITOR_PID=""

if [[ -x /usr/bin/chromium ]]; then
  CHROMIUM_BIN=/usr/bin/chromium
elif [[ -x /usr/bin/chromium-browser ]]; then
  CHROMIUM_BIN=/usr/bin/chromium-browser
else
  echo "Chromium is not installed." >&2
  exit 1
fi

if [[ ! -d "${KIOSK_CONTROL_DIR}" ]]; then
  echo "Waiting for kiosk control directory: ${KIOSK_CONTROL_DIR}" >&2
fi
while [[ ! -d "${KIOSK_CONTROL_DIR}" ]]; do
  sleep 1
done

cleanup() {
  if [[ -n "${MINIMISE_MONITOR_PID}" ]]; then
    kill "${MINIMISE_MONITOR_PID}" 2>/dev/null || true
  fi
  rm -f "${KIOSK_BROWSER_PID_PATH}" "${KIOSK_MINIMISE_REQUEST_PATH}"
}
trap cleanup EXIT

monitor_minimise_requests() {
  while true; do
    if IFS= read -r request <"${KIOSK_MINIMISE_REQUEST_PATH}"; then
      if [[ "${request}" == "minimise" ]]; then
        if ! /usr/bin/wtype -M logo -k d -m logo; then
          echo "Could not minimise Chromium through Labwc." >&2
        fi
      fi
    fi
  done
}

rm -f "${KIOSK_BROWSER_PID_PATH}" "${KIOSK_EXIT_REQUEST_PATH}" "${KIOSK_MINIMISE_REQUEST_PATH}"
mkfifo "${KIOSK_MINIMISE_REQUEST_PATH}"

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
  monitor_minimise_requests &
  MINIMISE_MONITOR_PID=$!

  set +e
  wait "${CHROMIUM_PID}"
  CHROMIUM_EXIT_CODE=$?
  set -e
  kill "${MINIMISE_MONITOR_PID}" 2>/dev/null || true
  wait "${MINIMISE_MONITOR_PID}" 2>/dev/null || true
  MINIMISE_MONITOR_PID=""
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
