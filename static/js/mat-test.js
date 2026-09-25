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

  function renderCount(value) {
    count = value;
    elements.pressCount.textContent = String(count);
  }

  async function loadCounter() {
    const response = await fetch("/api/mat-test-counter", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Counter request failed with ${response.status}`);
    }

    const counter = await response.json();
    renderCount(counter.count);
  }

  async function updateCounter(action) {
    const response = await fetch("/api/mat-test-counter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      throw new Error(`Counter update failed with ${response.status}`);
    }

    const counter = await response.json();
    renderCount(counter.count);
  }

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
        ? "Mock input mode · use /mat-controller to control the mat"
        : "Physical input · BCM GPIO 17";

      if (previousPressure === false && pressed) {
        await updateCounter("increment");
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

  elements.resetCount.addEventListener("click", async () => {
    elements.resetCount.disabled = true;
    try {
      await updateCounter("reset");
    } catch (_error) {
      elements.connectionBanner.hidden = false;
    } finally {
      elements.resetCount.disabled = false;
    }
  });

  loadCounter()
    .catch(() => {
      elements.connectionBanner.hidden = false;
    })
    .finally(() => {
      pollStatus();
      window.setInterval(pollStatus, STATUS_POLL_INTERVAL_MS);
    });
})();
