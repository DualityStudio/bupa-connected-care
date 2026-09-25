(() => {
  "use strict";

  const content = JSON.parse(document.getElementById("content-config").textContent);
  const ACTIVE_SESSION_STATES = new Set(["welcome", "ready", "playing", "complete"]);
  const RESET_DELAY_MS = 5000;
  const OUTCOME_DURATION_MS = 16000;
  const STATUS_POLL_INTERVAL_MS = 500;
  const resetRequested = new URLSearchParams(window.location.search).get("reset") === "1";
  const BUTTON_ICONS = {
    wellness: '<path d="M5 12h4l2-6 3 12 2-6h3"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4-4"></path>',
    guide: '<circle cx="12" cy="8" r="3.2"></circle><path d="M5 21c0-3.5 3-5 7-5s7 1.5 7 5"></path>',
    calendar: '<rect x="4" y="5" width="16" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M4 11h16"></path>',
    urgent: '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16v.4"></path>',
    rehab: '<path d="M4 18h16M7 18V9M17 18V9M12 18V6"></path>',
    agewell: '<path d="M12 21s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 12c0 4.6-7 9-7 9z"></path>',
    home: '<path d="M4 11l8-6 8 6M6 10v9h12v-9"></path>',
  };

  const elements = {
    app: document.getElementById("app"),
    connectionBanner: document.getElementById("connection-banner"),
    setupScreen: document.getElementById("setup-screen"),
    setupTitle: document.getElementById("setup-title"),
    setupCopy: document.getElementById("setup-copy"),
    matIndicator: document.getElementById("mat-indicator"),
    matIndicatorText: document.getElementById("mat-indicator-text"),
    stationPicker: document.getElementById("station-picker"),
    stationButtons: [...document.querySelectorAll("[data-station]")],
    experienceScreen: document.getElementById("experience-screen"),
    mediaFrame: document.getElementById("media-frame"),
    videoPlayer: document.getElementById("video-player"),
    placeholderPlayer: document.getElementById("placeholder-player"),
    placeholderLabel: document.getElementById("placeholder-label"),
    mediaProgress: document.getElementById("media-progress"),
    mediaProgressFill: document.querySelector("#media-progress span"),
    mediaError: document.getElementById("media-error"),
    autoplayPrompt: document.getElementById("autoplay-prompt"),
    choicePanel: document.getElementById("choice-panel"),
    videoChoices: document.getElementById("video-choices"),
    matPrompt: document.getElementById("mat-prompt"),
    touchHint: document.getElementById("touch-hint"),
    touchHintText: document.getElementById("touch-hint-text"),
    completionOverlay: document.getElementById("completion-overlay"),
    finalText: document.getElementById("final-text"),
    countdown: document.getElementById("countdown"),
    countdownNumber: document.getElementById("countdown-number"),
    secretChoosePersona: document.getElementById("secret-choose-persona"),
    secretPersonaPicker: document.getElementById("secret-persona-picker"),
    secretPersonaButtons: [...document.querySelectorAll("[data-secret-station]")],
    secretMenuError: document.getElementById("secret-menu-error"),
  };

  let state = "booting";
  let selectedStationId = null;
  let pressureIsPressed = null;
  let watchedVideoIds = new Set();
  let activeVideoId = null;
  let sequenceCompleted = false;
  let pollInFlight = false;
  let playbackGeneration = 0;
  let placeholderTimer = null;
  let completionTimer = null;
  let countdownInterval = null;
  let countdownDeadline = null;

  function selectedStation() {
    return selectedStationId ? content.stations[selectedStationId] : null;
  }

  function setAccent(colour) {
    elements.app.style.setProperty("--station-accent", colour || "#8ce2d0");
  }

  function setConnected(connected) {
    elements.connectionBanner.hidden = connected;
  }

  function recordStatEvent(type, details = {}) {
    if (!selectedStationId) {
      return;
    }

    fetch("/api/stats/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        station: selectedStationId,
        ...details,
      }),
      keepalive: true,
    }).catch((error) => {
      console.warn("Could not save statistics event", error);
    });
  }

  function showOnly(screen) {
    elements.setupScreen.hidden = screen !== "setup";
    elements.experienceScreen.hidden = screen !== "experience";
  }

  function setMatIndicator(complete, label) {
    elements.matIndicator.classList.toggle("is-complete", complete);
    elements.matIndicatorText.textContent = label;
  }

  function showMatSetup() {
    stopMedia();
    cancelResetCountdown();
    state = "setup-mat";
    selectedStationId = null;
    watchedVideoIds.clear();
    activeVideoId = null;
    sequenceCompleted = false;
    showOnly("setup");
    setAccent("#8ce2d0");
    elements.setupTitle.textContent = "Test the Pressure Mat";
    elements.setupCopy.textContent = "Stand on the mat to confirm it is connected and responding.";
    setMatIndicator(false, "Waiting for pressure");
    elements.stationPicker.hidden = true;
  }

  function showStationSetup() {
    state = "setup-station";
    showOnly("setup");
    elements.setupTitle.textContent = "Pressure Mat Connected";
    elements.setupCopy.textContent = "The mat responded correctly. Now choose which story this screen will show.";
    setMatIndicator(true, "Pressure detected — test complete");
    elements.stationPicker.hidden = false;
  }

  function showWaitForRelease() {
    cancelResetCountdown();
    state = "wait-release";
    watchedVideoIds.clear();
    activeVideoId = null;
    sequenceCompleted = false;
    playIdle();
    showExperience();
  }

  function setStationDisplay() {
    const station = selectedStation();
    if (!station) {
      return;
    }

    setAccent(station.accent);
    elements.finalText.textContent = station.finalText;
  }

  function showExperience() {
    showOnly("experience");
    setStationDisplay();
    renderVideoChoices();
  }

  function hideCompletion() {
    if (completionTimer !== null) {
      window.clearTimeout(completionTimer);
      completionTimer = null;
    }

    elements.completionOverlay.classList.remove("is-visible");
    elements.completionOverlay.setAttribute("aria-hidden", "true");
    elements.choicePanel.classList.remove("is-outcome");
  }

  function revealCompletion() {
    elements.completionOverlay.classList.add("is-visible");
    elements.completionOverlay.setAttribute("aria-hidden", "false");
    elements.choicePanel.classList.add("is-outcome");
    startPlaceholderProgress(OUTCOME_DURATION_MS / 1000);
    completionTimer = window.setTimeout(finishCompletion, OUTCOME_DURATION_MS);
  }

  function finishCompletion() {
    if (state !== "complete") {
      return;
    }

    completionTimer = null;
    watchedVideoIds.clear();
    activeVideoId = null;
    sequenceCompleted = false;
    state = pressureIsPressed ? "wait-release" : "idle";
    hideCompletion();
    playIdle();
    showExperience();
  }

  function dismissCompletion() {
    if (state !== "complete") {
      return;
    }

    state = "ready";
    hideCompletion();
    playIdle();
    showExperience();
  }

  function playIdle() {
    const station = selectedStation();
    if (!station) {
      return;
    }

    activeVideoId = null;
    playMedia(station.idleVideo, { loop: true, analyticsId: "idle" });
  }

  function startFreshIdle({ restartVideo = true } = {}) {
    cancelResetCountdown();
    watchedVideoIds.clear();
    activeVideoId = null;
    sequenceCompleted = false;
    state = "idle";
    hideCompletion();
    if (restartVideo) {
      playIdle();
    }
    showExperience();
  }

  function startWelcome({ recordTrigger = true } = {}) {
    const station = selectedStation();
    if (!station) {
      showMatSetup();
      return;
    }

    if (recordTrigger) {
      recordStatEvent("pressure_trigger");
    }
    state = "welcome";
    activeVideoId = null;
    hideCompletion();
    showExperience();
    playMedia(station.welcomeVideo, {
      analyticsId: "welcome",
      onEnded: finishWelcome,
    });
  }

  function finishWelcome() {
    state = "ready";
    activeVideoId = null;
    playIdle();
    showExperience();
  }

  function canChooseVideo() {
    return Boolean(
      pressureIsPressed
      && ["welcome", "ready", "playing", "complete"].includes(state),
    );
  }

  function storyName(station) {
    const name = station.name.toLocaleLowerCase();
    return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)}`;
  }

  function createVideoIcon(iconName) {
    const icon = document.createElement("span");
    icon.className = "video-choice__icon";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = BUTTON_ICONS[iconName] || BUTTON_ICONS.guide;
    icon.append(svg);
    return icon;
  }

  function renderVideoChoices() {
    const station = selectedStation();
    if (!station) {
      return;
    }

    const enabled = canChooseVideo();
    const showTouchHint = enabled && state === "ready";
    elements.choicePanel.classList.toggle("is-lit", enabled);
    const showMatPrompt = pressureIsPressed === false || state === "wait-release";
    elements.matPrompt.classList.toggle("is-visible", showMatPrompt);
    elements.matPrompt.setAttribute("aria-hidden", String(!showMatPrompt));
    elements.touchHint.classList.toggle("is-visible", showTouchHint);
    elements.touchHint.setAttribute("aria-hidden", String(!showTouchHint));
    elements.touchHintText.textContent = `Tap the buttons to hear ${storyName(station)}'s story`;

    if (elements.videoChoices.dataset.stationId !== selectedStationId) {
      elements.videoChoices.replaceChildren();
      elements.videoChoices.dataset.stationId = selectedStationId;

      station.videos.forEach((video) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "video-choice";
        button.dataset.videoId = video.id;
        button.append(createVideoIcon(video.icon));

        const label = document.createElement("span");
        label.className = "video-choice__label";
        label.textContent = video.label;
        button.append(label);

        button.addEventListener("click", () => startSelectedVideo(video));
        elements.videoChoices.append(button);
      });
    }

    station.videos.forEach((video, index) => {
      const watched = watchedVideoIds.has(video.id);
      const playing = activeVideoId === video.id;
      const button = elements.videoChoices.children[index];
      button.classList.toggle("is-watched", watched);
      button.classList.toggle("is-playing", playing);
      button.disabled = !enabled || playing;
    });
  }

  function startSelectedVideo(video) {
    if (!canChooseVideo() || activeVideoId === video.id) {
      return;
    }

    state = "playing";
    activeVideoId = video.id;
    hideCompletion();
    showExperience();
    playMedia(video, {
      analyticsId: video.id,
      onEnded: () => finishSelectedVideo(video.id),
    });
  }

  function finishSelectedVideo(videoId) {
    watchedVideoIds.add(videoId);
    activeVideoId = null;

    const station = selectedStation();
    if (station && watchedVideoIds.size >= station.videos.length) {
      if (!sequenceCompleted) {
        sequenceCompleted = true;
        recordStatEvent("sequence_complete");
      }
      showCompletion();
      return;
    }

    state = "ready";
    playIdle();
    showExperience();
  }

  function showCompletion() {
    state = "complete";
    playIdle();
    showExperience();
    revealCompletion();
  }

  function animateMediaEntrance() {
    elements.mediaFrame.classList.remove("media-enter");
    void elements.mediaFrame.offsetWidth;
    elements.mediaFrame.classList.add("media-enter");
  }

  function resetVideoElement() {
    const video = elements.videoPlayer;
    video.onended = null;
    video.onerror = null;
    video.onloadedmetadata = null;
    video.ontimeupdate = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.hidden = true;
  }

  function hideMediaProgress() {
    elements.mediaProgress.hidden = true;
    elements.mediaProgress.classList.remove("is-timed", "is-video");
    elements.mediaProgressFill.style.removeProperty("transform");
    elements.mediaProgress.style.removeProperty("--media-duration");
  }

  function startPlaceholderProgress(durationSeconds) {
    hideMediaProgress();
    elements.mediaProgress.style.setProperty("--media-duration", `${durationSeconds}s`);
    elements.mediaProgress.hidden = false;
    void elements.mediaProgress.offsetWidth;
    elements.mediaProgress.classList.add("is-timed");
  }

  function startVideoProgress(generation) {
    hideMediaProgress();
    elements.mediaProgress.hidden = false;
    elements.mediaProgress.classList.add("is-video");

    const update = () => {
      if (generation !== playbackGeneration) {
        return;
      }

      const duration = elements.videoPlayer.duration;
      const progress = Number.isFinite(duration) && duration > 0
        ? Math.min(1, Math.max(0, elements.videoPlayer.currentTime / duration))
        : 0;
      elements.mediaProgressFill.style.transform = `scaleX(${progress})`;
    };

    elements.videoPlayer.onloadedmetadata = update;
    elements.videoPlayer.ontimeupdate = update;
  }

  function stopMedia() {
    playbackGeneration += 1;
    if (placeholderTimer !== null) {
      window.clearTimeout(placeholderTimer);
      placeholderTimer = null;
    }

    resetVideoElement();
    hideMediaProgress();
    elements.placeholderPlayer.hidden = true;
    elements.placeholderPlayer.classList.remove("is-timed", "is-looping");
    elements.mediaError.hidden = true;
    elements.autoplayPrompt.hidden = true;
    hideCompletion();
  }

  function startPlaceholder(media, options, generation, errorMessage = "") {
    if (generation !== playbackGeneration) {
      return;
    }

    resetVideoElement();
    if (placeholderTimer !== null) {
      window.clearTimeout(placeholderTimer);
    }

    const durationSeconds = Math.max(1, Number(media.placeholderDuration) || 6);
    const placeholder = elements.placeholderPlayer;
    elements.placeholderLabel.textContent = media.label || "Video placeholder";
    placeholder.style.setProperty("--placeholder-duration", `${durationSeconds}s`);
    placeholder.classList.remove("is-timed", "is-looping");
    placeholder.hidden = false;
    void placeholder.offsetWidth;
    placeholder.classList.add(options.loop ? "is-looping" : "is-timed");
    if (options.loop) {
      hideMediaProgress();
    } else {
      startPlaceholderProgress(durationSeconds);
    }

    if (errorMessage) {
      elements.mediaError.textContent = errorMessage;
      elements.mediaError.hidden = false;
    }

    if (!options.loop && typeof options.onEnded === "function") {
      placeholderTimer = window.setTimeout(() => {
        if (generation === playbackGeneration) {
          placeholderTimer = null;
          options.onEnded();
        }
      }, durationSeconds * 1000);
    }
  }

  function playMedia(media, options = {}) {
    stopMedia();
    const generation = playbackGeneration;
    animateMediaEntrance();

    if (options.analyticsId) {
      recordStatEvent("video_play", { video_id: options.analyticsId });
    }

    if (!media.src) {
      startPlaceholder(media, options, generation);
      return;
    }

    const video = elements.videoPlayer;
    video.hidden = false;
    video.loop = Boolean(options.loop);
    video.muted = false;
    video.volume = 1;
    video.src = media.src;
    video.currentTime = 0;
    if (options.loop) {
      hideMediaProgress();
    } else {
      startVideoProgress(generation);
    }

    video.onended = () => {
      if (generation === playbackGeneration && typeof options.onEnded === "function") {
        options.onEnded();
      }
    };

    video.onerror = () => {
      startPlaceholder(
        media,
        options,
        generation,
        `Could not load “${media.label}”. Running its testing placeholder instead.`,
      );
    };

    const playback = video.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(() => {
        if (generation === playbackGeneration && !video.error) {
          elements.autoplayPrompt.hidden = false;
        }
      });
    }
  }

  async function retryPlaybackAfterTap() {
    try {
      await elements.videoPlayer.play();
      elements.autoplayPrompt.hidden = true;
    } catch (_error) {
      elements.autoplayPrompt.textContent = "Could not start playback — tap to retry";
    }
  }

  function startResetCountdown() {
    if (countdownInterval !== null) {
      return;
    }

    countdownDeadline = Date.now() + RESET_DELAY_MS;
    elements.countdown.hidden = false;

    const updateCountdown = () => {
      const remaining = Math.max(0, countdownDeadline - Date.now());
      elements.countdownNumber.textContent = String(Math.max(1, Math.ceil(remaining / 1000)));
      if (remaining <= 0) {
        expireVisitorSession();
      }
    };

    updateCountdown();
    countdownInterval = window.setInterval(updateCountdown, 100);
  }

  function cancelResetCountdown() {
    if (countdownInterval !== null) {
      window.clearInterval(countdownInterval);
      countdownInterval = null;
    }
    countdownDeadline = null;
    elements.countdown.hidden = true;
    elements.countdownNumber.textContent = "5";
  }

  function resetVisitorSession() {
    cancelResetCountdown();
    watchedVideoIds.clear();
    activeVideoId = null;
    sequenceCompleted = false;

    if (!selectedStationId) {
      showMatSetup();
    } else if (pressureIsPressed) {
      showWaitForRelease();
    } else {
      startFreshIdle();
    }
  }

  function expireVisitorSession() {
    startFreshIdle();
  }

  function beginStepAway() {
    showExperience();
    startResetCountdown();
  }

  function resumeVisitorSession() {
    cancelResetCountdown();
    showExperience();
  }

  function processPressure(previousPressure, currentPressure) {
    if (state === "setup-mat" && currentPressure) {
      showStationSetup();
      return;
    }

    if (state === "wait-release" && !currentPressure) {
      state = "idle";
      showExperience();
      return;
    }

    if (ACTIVE_SESSION_STATES.has(state) && previousPressure && !currentPressure) {
      beginStepAway();
      return;
    }

    if (countdownInterval !== null && currentPressure && previousPressure === false) {
      resumeVisitorSession();
      return;
    }

    if (state === "idle" && currentPressure && previousPressure === false) {
      startWelcome();
    }
  }

  function initialiseFromStatus(status) {
    selectedStationId = status.selected_station;
    pressureIsPressed = Boolean(status.pressed);
    if (resetRequested) {
      resetVisitorSession();
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    if (!selectedStationId) {
      showMatSetup();
      if (pressureIsPressed) {
        showStationSetup();
      }
      return;
    }

    setStationDisplay();
    if (pressureIsPressed) {
      startWelcome({ recordTrigger: false });
    } else {
      startFreshIdle();
    }
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
      setConnected(true);
      if (state === "booting") {
        initialiseFromStatus(status);
        return;
      }

      if (status.selected_station !== selectedStationId) {
        stopMedia();
        cancelResetCountdown();
        selectedStationId = status.selected_station;
        pressureIsPressed = Boolean(status.pressed);
        watchedVideoIds.clear();
        activeVideoId = null;
        sequenceCompleted = false;

        if (!selectedStationId) {
          showMatSetup();
        } else if (pressureIsPressed) {
          setStationDisplay();
          startWelcome({ recordTrigger: false });
        } else {
          setStationDisplay();
          startFreshIdle();
        }
        return;
      }

      const previousPressure = pressureIsPressed;
      pressureIsPressed = Boolean(status.pressed);
      processPressure(previousPressure, pressureIsPressed);
    } catch (_error) {
      setConnected(false);
    } finally {
      pollInFlight = false;
    }
  }

  async function selectStation(
    stationId,
    { recordTrigger = true, closeMenuOnSuccess = false } = {},
  ) {
    const stationSelectionButtons = [
      ...elements.stationButtons,
      ...elements.secretPersonaButtons,
    ];

    stationSelectionButtons.forEach((button) => {
      button.disabled = true;
    });

    try {
      const response = await fetch("/api/station", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ station: stationId }),
      });
      if (!response.ok) {
        throw new Error(`Station request failed with ${response.status}`);
      }

      const result = await response.json();
      stopMedia();
      cancelResetCountdown();
      selectedStationId = result.selected_station;
      watchedVideoIds.clear();
      activeVideoId = null;
      sequenceCompleted = false;
      setStationDisplay();
      if (pressureIsPressed) {
        startWelcome({ recordTrigger });
      } else {
        startFreshIdle();
      }
      if (closeMenuOnSuccess) {
        window.bupaSystemControls?.close();
      }
    } catch (_error) {
      elements.setupCopy.textContent = "The station could not be saved. Check the server connection and try again.";
      elements.secretMenuError.textContent = "The persona could not be saved. Check the server connection and try again.";
      elements.secretMenuError.hidden = false;
      setConnected(false);
    } finally {
      stationSelectionButtons.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  elements.stationButtons.forEach((button) => {
    button.addEventListener("click", () => selectStation(button.dataset.station));
  });
  elements.secretPersonaButtons.forEach((button) => {
    button.addEventListener("click", () => selectStation(
      button.dataset.secretStation,
      { recordTrigger: false, closeMenuOnSuccess: true },
    ));
  });
  elements.secretChoosePersona.addEventListener("click", () => {
    elements.secretPersonaPicker.hidden = !elements.secretPersonaPicker.hidden;
    elements.secretMenuError.hidden = true;
  });
  elements.completionOverlay.addEventListener("click", dismissCompletion);
  elements.autoplayPrompt.addEventListener("click", retryPlaybackAfterTap);

  pollStatus();
  window.setInterval(pollStatus, STATUS_POLL_INTERVAL_MS);
})();
