(() => {
  "use strict";

  const STATUS_POLL_INTERVAL_MS = 500;
  const elements = {
    connectionBanner: document.getElementById("connection-banner"),
    matIndicator: document.getElementById("mat-indicator"),
    matIndicatorText: document.getElementById("mat-indicator-text"),
    pressCount: document.getElementById("press-count"),
    resetCount: document.getElementById("reset-count"),
    modeLabel: document.getElementById("mode-label"),
  };

  let count = 0;
  let previousPressure = null;
  let pollInFlight = false;

  function renderPressure(pressed) {
    elements.matIndicator.classList.toggle("is-complete", pressed);
    elements.matIndicatorText.textContent = pressed ? "Mat pressed" : "Mat released";
  }

  async function pollStatus() {
    if (pollInFlight) {
      return;
    }
    pollInFlight = true;

    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Status request failed with ${response.status}`);
      }

      const status = await response.json();
      const pressed = Boolean(status.pressed);

      elements.connectionBanner.hidden = true;
      elements.modeLabel.textContent = status.mode === "mock"
        ? "Mock input mode · use /mock to control the mat"
        : "Physical input · BCM GPIO 17";

      if (previousPressure === false && pressed) {
        count += 1;
        elements.pressCount.textContent = String(count);
      }

      previousPressure = pressed;
      renderPressure(pressed);
    } catch (_error) {
      previousPressure = null;
      elements.connectionBanner.hidden = false;
      elements.matIndicator.classList.remove("is-complete");
      elements.matIndicatorText.textContent = "Waiting for connection";
      elements.modeLabel.textContent = "The pressure mat cannot be reached";
    } finally {
      pollInFlight = false;
    }
  }

  elements.resetCount.addEventListener("click", () => {
    count = 0;
    elements.pressCount.textContent = "0";
  });

  pollStatus();
  window.setInterval(pollStatus, STATUS_POLL_INTERVAL_MS);
})();
