(() => {
  "use strict";

  const STATUS_POLL_INTERVAL_MS = 500;

  const elements = {
    connection: document.getElementById("connection-state"),
    pressure: document.getElementById("pressure-state"),
    station: document.getElementById("station-state"),
    pressButton: document.getElementById("press-button"),
    releaseButton: document.getElementById("release-button"),
    message: document.getElementById("controller-message"),
  };

  let pollInFlight = false;
  let updateInFlight = false;
  let currentMode = null;

  function setConnection(kind, label) {
    elements.connection.className = `connection-state connection-state--${kind}`;
    elements.connection.textContent = label;
  }

  function renderStatus(status) {
    currentMode = status.mode;
    const pressed = Boolean(status.pressed);
    const mockEnabled = status.mode === "mock";

    setConnection("connected", mockEnabled ? "Connected · mock mode" : "Connected · real GPIO mode");
    elements.pressure.textContent = pressed ? "Pressed" : "Released";
    elements.pressure.classList.toggle("is-pressed", pressed);
    elements.station.textContent = status.selected_station
      ? `Station: ${status.selected_station.toUpperCase()}`
      : "Station: not selected";

    elements.pressButton.disabled = !mockEnabled || updateInFlight;
    elements.releaseButton.disabled = !mockEnabled || updateInFlight;
    elements.pressButton.classList.toggle("is-active", mockEnabled && pressed);
    elements.releaseButton.classList.toggle("is-active", mockEnabled && !pressed);

    elements.message.classList.toggle("is-error", !mockEnabled);
    elements.message.textContent = mockEnabled
      ? "The setting stays latched until you press the other button or restart the server."
      : "This server is using the physical GPIO 17 pressure mat. Mock controls are disabled.";
  }

  async function pollStatus() {
    if (pollInFlight || updateInFlight) {
      return;
    }
    pollInFlight = true;

    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Status request failed with ${response.status}`);
      }
      renderStatus(await response.json());
    } catch (_error) {
      currentMode = null;
      setConnection("error", "Disconnected");
      elements.pressButton.disabled = true;
      elements.releaseButton.disabled = true;
      elements.message.classList.add("is-error");
      elements.message.textContent = "The kiosk server cannot be reached. This page will keep trying to reconnect.";
    } finally {
      pollInFlight = false;
    }
  }

  async function setPressure(pressed) {
    if (updateInFlight || currentMode !== "mock") {
      return;
    }
    updateInFlight = true;
    elements.pressButton.disabled = true;
    elements.releaseButton.disabled = true;

    try {
      const response = await fetch("/api/mock-pressure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pressed }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Pressure request failed with ${response.status}`);
      }
      await pollStatusAfterUpdate();
    } catch (error) {
      setConnection("error", "Update failed");
      elements.message.classList.add("is-error");
      elements.message.textContent = error.message;
    } finally {
      updateInFlight = false;
      pollStatus();
    }
  }

  async function pollStatusAfterUpdate() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Status request failed with ${response.status}`);
      }
      renderStatus(await response.json());
    } catch (error) {
      throw error;
    }
  }

  elements.pressButton.addEventListener("click", () => setPressure(true));
  elements.releaseButton.addEventListener("click", () => setPressure(false));

  pollStatus();
  window.setInterval(pollStatus, STATUS_POLL_INTERVAL_MS);
})();
