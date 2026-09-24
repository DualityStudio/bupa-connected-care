(() => {
  "use strict";

  const TAP_COUNT = 10;
  const TAP_WINDOW_MS = 4000;
  const menu = document.getElementById("secret-menu");
  const closeButton = document.getElementById("secret-menu-close");
  const updateButton = document.getElementById("system-update");
  let tapTimes = [];
  let updateInFlight = false;

  if (!menu || !closeButton || !updateButton) {
    return;
  }

  function setUpdateState(label, enabled) {
    updateButton.textContent = label;
    updateButton.disabled = !enabled || updateInFlight;
  }

  async function checkUpdateAvailability() {
    setUpdateState("Checking Network…", false);

    try {
      const response = await fetch("/api/update-status", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Update check failed");
      }

      const result = await response.json();
      if (result.available) {
        setUpdateState("Check for Update", true);
      } else {
        setUpdateState("Update Unavailable", false);
      }
    } catch (_error) {
      setUpdateState("Update Unavailable", false);
    }
  }

  function openMenu() {
    tapTimes = [];
    const personaPicker = document.getElementById("secret-persona-picker");
    const menuError = document.getElementById("secret-menu-error");
    if (personaPicker) {
      personaPicker.hidden = true;
    }
    if (menuError) {
      menuError.textContent = "";
      menuError.hidden = true;
    }
    menu.hidden = false;
    closeButton.focus();
    checkUpdateAvailability();
  }

  function closeMenu() {
    menu.hidden = true;
    tapTimes = [];
  }

  function registerTap(event) {
    if (!menu.hidden || event.target.closest("button, a, input, select, textarea, label")) {
      return;
    }

    const now = Date.now();
    tapTimes = tapTimes.filter((tapTime) => now - tapTime <= TAP_WINDOW_MS);
    tapTimes.push(now);
    if (tapTimes.length >= TAP_COUNT) {
      openMenu();
    }
  }

  async function waitForRestart() {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch("/health", { cache: "no-store" });
        if (response.ok) {
          window.location.reload();
          return;
        }
      } catch (_error) {
        // The server is expected to be briefly unavailable while restarting.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }

    updateInFlight = false;
    setUpdateState("Reboot Pi To Finish", false);
  }

  async function runUpdate() {
    if (updateInFlight || updateButton.disabled) {
      return;
    }

    updateInFlight = true;
    setUpdateState("Updating…", false);

    try {
      const response = await fetch("/api/update", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "The update could not be completed.");
      }

      if (!result.updated) {
        updateInFlight = false;
        setUpdateState("Already Up To Date", false);
        return;
      }

      if (result.restart_scheduled) {
        updateButton.textContent = "Restarting…";
        waitForRestart();
      } else {
        updateInFlight = false;
        setUpdateState("Restart Server To Finish", false);
      }
    } catch (_error) {
      updateInFlight = false;
      setUpdateState("Update Failed", false);
    }
  }

  document.addEventListener("pointerup", registerTap);
  closeButton.addEventListener("click", closeMenu);
  updateButton.addEventListener("click", runUpdate);

  window.bupaSystemControls = { close: closeMenu };
})();
