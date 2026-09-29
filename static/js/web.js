(async () => {
  "use strict";

  const OUTCOME_DURATION_MS = 16000;
  let content;
  try {
    const response = await fetch("/content.json", { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Content request failed with ${response.status}`);
    }
    content = await response.json();
  } catch (_error) {
    const banner = document.getElementById("connection-banner");
    banner.textContent = "The experience content could not be loaded. Please refresh the page.";
    banner.hidden = false;
    return;
  }
  const icons = {
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
    app: document.getElementById("web-app"),
    connectionBanner: document.getElementById("connection-banner"),
    personaScreen: document.getElementById("web-persona-screen"),
    experienceScreen: document.getElementById("web-experience-screen"),
    personaButtons: document.getElementById("web-persona-buttons"),
    changePersona: document.getElementById("web-change-persona"),
    start: document.getElementById("web-start"),
    startLabel: document.getElementById("web-start-label"),
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
    touchHint: document.getElementById("touch-hint"),
    touchHintText: document.getElementById("touch-hint-text"),
    completionOverlay: document.getElementById("completion-overlay"),
    finalText: document.getElementById("final-text"),
  };

  let stationId = null;
  let state = "choose-persona";
  let experienceStarted = false;
  let watchedVideoIds = new Set();
  let activeVideoId = null;
  let playbackGeneration = 0;
  let placeholderTimer = null;
  let completionTimer = null;

  function station() {
    return stationId ? content.stations[stationId] : null;
  }

  function storyName(selectedStation) {
    const name = selectedStation.name.toLocaleLowerCase();
    return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)}`;
  }

  function setStationDisplay() {
    const selectedStation = station();
    if (!selectedStation) {
      return;
    }

    elements.app.style.setProperty("--station-accent", selectedStation.accent);
    elements.finalText.textContent = selectedStation.finalText;
    elements.startLabel.textContent = `Begin ${storyName(selectedStation)}'s story`;
    elements.touchHintText.textContent = `Tap the buttons to hear ${storyName(selectedStation)}'s story`;
  }

  function renderPersonaButtons() {
    elements.personaButtons.replaceChildren();
    Object.entries(content.stations).forEach(([selectedStationId, selectedStation]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "station-button";
      button.dataset.webStation = selectedStationId;
      button.textContent = selectedStation.name;
      button.addEventListener("click", () => selectPersona(selectedStationId));
      elements.personaButtons.append(button);
    });
  }

  function updateLocation() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (stationId) {
      url.searchParams.set("persona", stationId);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function showPersonaPicker() {
    stopMedia();
    clearCompletionTimer();
    stationId = null;
    state = "choose-persona";
    experienceStarted = false;
    watchedVideoIds.clear();
    activeVideoId = null;
    elements.personaScreen.hidden = false;
    elements.experienceScreen.hidden = true;
    elements.connectionBanner.hidden = true;
    updateLocation();
  }

  function selectPersona(selectedStationId) {
    if (!content.stations[selectedStationId]) {
      return;
    }

    stationId = selectedStationId;
    state = "awaiting-start";
    experienceStarted = false;
    watchedVideoIds.clear();
    activeVideoId = null;
    clearCompletionTimer();
    hideCompletion();
    setStationDisplay();
    elements.personaScreen.hidden = true;
    elements.experienceScreen.hidden = false;
    elements.start.classList.remove("is-hidden");
    elements.start.setAttribute("aria-hidden", "false");
    updateLocation();
    renderVideoChoices();
    playIdle({ muted: true });
  }

  function startExperience() {
    if (state !== "awaiting-start") {
      return;
    }

    experienceStarted = true;
    elements.start.classList.add("is-hidden");
    elements.start.setAttribute("aria-hidden", "true");
    startWelcome();
  }

  function startWelcome() {
    const selectedStation = station();
    if (!selectedStation) {
      return;
    }

    state = "welcome";
    activeVideoId = null;
    renderVideoChoices();
    playMedia(selectedStation.welcomeVideo, {
      onEnded: finishWelcome,
    });
  }

  function finishWelcome() {
    state = "ready";
    activeVideoId = null;
    playIdle();
    renderVideoChoices();
  }

  function playIdle({ muted = false } = {}) {
    const selectedStation = station();
    if (!selectedStation) {
      return;
    }

    activeVideoId = null;
    playMedia(selectedStation.idleVideo, {
      loop: true,
      muted,
    });
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
    svg.innerHTML = icons[iconName] || icons.guide;
    icon.append(svg);
    return icon;
  }

  function renderVideoChoices() {
    const selectedStation = station();
    if (!selectedStation) {
      return;
    }

    const enabled = experienceStarted && state !== "complete";
    const showTouchHint = enabled && state === "ready";
    elements.choicePanel.classList.toggle("is-lit", enabled);
    elements.touchHint.classList.toggle("is-visible", showTouchHint);
    elements.touchHint.setAttribute("aria-hidden", String(!showTouchHint));

    if (elements.videoChoices.dataset.stationId !== stationId) {
      elements.videoChoices.replaceChildren();
      elements.videoChoices.dataset.stationId = stationId;

      selectedStation.videos.forEach((video) => {
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

    selectedStation.videos.forEach((video, index) => {
      const button = elements.videoChoices.children[index];
      const playing = activeVideoId === video.id;
      button.classList.toggle("is-watched", watchedVideoIds.has(video.id));
      button.classList.toggle("is-playing", playing);
      button.disabled = !enabled || playing;
    });
  }

  function startSelectedVideo(video) {
    if (!experienceStarted || state === "complete" || activeVideoId === video.id) {
      return;
    }

    state = "playing";
    activeVideoId = video.id;
    renderVideoChoices();
    playMedia(video, {
      onEnded: () => finishSelectedVideo(video.id),
    });
  }

  function finishSelectedVideo(videoId) {
    watchedVideoIds.add(videoId);
    activeVideoId = null;

    const selectedStation = station();
    if (selectedStation && watchedVideoIds.size >= selectedStation.videos.length) {
      showCompletion();
      return;
    }

    state = "ready";
    playIdle();
    renderVideoChoices();
  }

  function showCompletion() {
    state = "complete";
    playIdle();
    renderVideoChoices();
    elements.completionOverlay.classList.add("is-visible");
    elements.completionOverlay.setAttribute("aria-hidden", "false");
    elements.choicePanel.classList.add("is-outcome");
    startPlaceholderProgress(OUTCOME_DURATION_MS / 1000);
    completionTimer = window.setTimeout(resetSelectedPersona, OUTCOME_DURATION_MS);
  }

  function clearCompletionTimer() {
    if (completionTimer !== null) {
      window.clearTimeout(completionTimer);
      completionTimer = null;
    }
  }

  function hideCompletion() {
    clearCompletionTimer();
    elements.completionOverlay.classList.remove("is-visible");
    elements.completionOverlay.setAttribute("aria-hidden", "true");
    elements.choicePanel.classList.remove("is-outcome");
  }

  function resetSelectedPersona() {
    if (!stationId) {
      return;
    }

    hideCompletion();
    state = "awaiting-start";
    experienceStarted = false;
    watchedVideoIds.clear();
    activeVideoId = null;
    elements.start.classList.remove("is-hidden");
    elements.start.setAttribute("aria-hidden", "false");
    renderVideoChoices();
    playIdle({ muted: true });
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
    elements.placeholderLabel.textContent = media.label || "Video placeholder";
    elements.placeholderPlayer.style.setProperty("--placeholder-duration", `${durationSeconds}s`);
    elements.placeholderPlayer.classList.remove("is-timed", "is-looping");
    elements.placeholderPlayer.hidden = false;
    void elements.placeholderPlayer.offsetWidth;
    elements.placeholderPlayer.classList.add(options.loop ? "is-looping" : "is-timed");

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

    if (!media.src) {
      startPlaceholder(media, options, generation);
      return;
    }

    const video = elements.videoPlayer;
    video.hidden = false;
    video.loop = Boolean(options.loop);
    video.muted = Boolean(options.muted);
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
        `Could not load “${media.label}”. Running its placeholder instead.`,
      );
    };

    const playback = video.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(() => {
        if (generation === playbackGeneration && !video.error && !options.muted) {
          elements.autoplayPrompt.hidden = false;
        }
      });
    }
  }

  async function retryPlaybackAfterTap() {
    try {
      elements.videoPlayer.muted = false;
      await elements.videoPlayer.play();
      elements.autoplayPrompt.hidden = true;
    } catch (_error) {
      elements.autoplayPrompt.textContent = "Could not start playback — tap to retry";
    }
  }

  elements.changePersona.addEventListener("click", showPersonaPicker);
  elements.start.addEventListener("click", startExperience);
  elements.completionOverlay.addEventListener("click", resetSelectedPersona);
  elements.autoplayPrompt.addEventListener("click", retryPlaybackAfterTap);

  renderPersonaButtons();
  const requestedPersona = new URLSearchParams(window.location.search).get("persona");
  if (requestedPersona && content.stations[requestedPersona]) {
    selectPersona(requestedPersona);
  } else {
    showPersonaPicker();
  }
})();
