// popup.js — manages popup UI state and user actions.
// Tab-switch tracking runs in background.js, not here.
// bundle.js handles Activity Bundle generation.
// Session + activityEvents live in chrome.storage.local.

const SESSION_KEY = "activeSession";
const BUNDLE_KEY = "activityBundle";
const AI_SNAPSHOT_KEY = "aiSnapshot";
const SNAPSHOT_ENDPOINT = "https://wherewasi-beta.vercel.app/api/snapshot";
const SNAPSHOT_TIMEOUT_MS = 15000;

const LOADING_STEPS = [
  "📖 Reading your research trail...",
  "🔍 Identifying key pages...",
  "🧠 Building your mental bookmark...",
  "✨ Almost there..."
];
const LOADING_STEP_INTERVAL_MS = 800;
const LOADING_MIN_DISPLAY_MS = 2000;

// ─── Utilities ───────────────────────────────────────────────

function createSessionId() {
  return crypto.randomUUID();
}

function minutesAgoLabel(startTime) {
  const minutes = Math.max(0, Math.floor((Date.now() - startTime) / 60000));
  return `Started ${minutes} min ago`;
}

async function getActiveTabSnapshot() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  return {
    tabId: tab ? tab.id : null,
    windowId: tab ? tab.windowId : null,
    url: tab && tab.url ? tab.url : "",
    title: tab && tab.title ? tab.title : "",
    timestamp: Date.now()
  };
}

async function loadActiveSession() {
  const result = await chrome.storage.local.get(SESSION_KEY);
  return result[SESSION_KEY] || null;
}

async function saveActiveSession(session) {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

async function clearSession() {
  await chrome.storage.local.remove([SESSION_KEY, BUNDLE_KEY, AI_SNAPSHOT_KEY]);
}

// ─── AI snapshot ────────────────────────────────────────────

async function requestAISnapshot(bundle) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);

  try {
    const response = await fetch(SNAPSHOT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle),
      signal: controller.signal
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data && data.snapshot ? data.snapshot : null;
  } catch (error) {
    // Network failure, timeout, or malformed response — caller falls back.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── View transitions ─────────────────────────────────────────

function hideAll() {
  document.getElementById("start-view").hidden = true;
  document.getElementById("recording-view").hidden = true;
  document.getElementById("loading-view").hidden = true;
  document.getElementById("backtoit-view").hidden = true;
}

function showStartView() {
  hideAll();
  document.getElementById("start-view").hidden = false;
}

function showRecordingView(session) {
  hideAll();
  document.getElementById("recording-view").hidden = false;
  document.getElementById("started-ago").textContent = minutesAgoLabel(
    session.startTime
  );
}

function showLoadingView() {
  hideAll();
  document.getElementById("loading-view").hidden = false;

  const container = document.getElementById("loading-steps");
  container.innerHTML = "";

  let index = 0;

  function appendStep() {
    if (index >= LOADING_STEPS.length) return;
    const step = document.createElement("p");
    step.className = "copy loading-step";
    step.textContent = LOADING_STEPS[index];
    container.appendChild(step);
    index += 1;
  }

  appendStep(); // show the first step immediately, not after the first interval tick
  const intervalId = setInterval(appendStep, LOADING_STEP_INTERVAL_MS);

  return () => clearInterval(intervalId);
}

async function showBackToItView(bundle) {
  hideAll();
  document.getElementById("backtoit-view").hidden = false;

  const { aiSnapshot } = await chrome.storage.local.get(AI_SNAPSHOT_KEY);

  const candidates = bundle.candidateContinueTabs;
  const container = document.getElementById("bit-candidates");
  container.innerHTML = "";

  if (candidates.length === 1) {
    // High confidence — one clear tab to continue from
    const c = candidates[0];
    document.getElementById("bit-heading").textContent = "BACK TO IT";

    // Prefer the AI's description of the session over the bare tab title
    const subtitle =
      aiSnapshot && aiSnapshot.what_you_were_doing
        ? aiSnapshot.what_you_were_doing
        : c.title || c.domain;

    container.innerHTML = `
      <p class="copy"><strong>${subtitle}</strong></p>
      <p class="copy" style="font-size: 11px; color: rgba(255, 255, 255, 0.5);">
        High confidence &middot; ${c.domain}
      </p>`;

    const btn = document.getElementById("continue-btn");
    btn.hidden = false;
    btn.dataset.url = c.url;
    btn.dataset.tabId = c.tabId;
    btn.dataset.windowId = c.windowId;
  } else {
    // Ambiguous — show two candidates, let user decide
    document.getElementById("bit-heading").textContent = "WHERE YOU LEFT OFF";
    document.getElementById("continue-btn").hidden = true;

    candidates.forEach(c => {
      const btn = document.createElement("button");
      btn.textContent = c.title || c.domain;
      btn.style.marginBottom = "8px";
      btn.dataset.url = c.url;
      btn.dataset.tabId = c.tabId;
      btn.dataset.windowId = c.windowId;
      btn.addEventListener("click", () => resumeTab(btn.dataset));
      container.appendChild(btn);
    });
  }

  // Show Last Stop only when it differs from Suggested Continue
  const lastStopEl = document.getElementById("bit-laststop");
  if (bundle.lastStop.url !== bundle.suggestedContinue.url) {
    lastStopEl.textContent = `Last tab: ${bundle.lastStop.title || bundle.lastStop.domain}`;
  } else {
    lastStopEl.textContent = "";
  }
}

// ─── Resume ──────────────────────────────────────────────────

async function resumeTab(data) {
  const tabId = parseInt(data.tabId);
  try {
    // Tab still exists — activate it
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    // Tab was closed — reopen the saved URL
    await chrome.tabs.create({ url: data.url });
  }
  window.close();
}

// ─── Actions ─────────────────────────────────────────────────

async function startWork() {
  const startTime = Date.now();
  const currentTab = await getActiveTabSnapshot();

  const session = {
    sessionId: createSessionId(),
    startTime,
    currentTab,
    activityEvents: [currentTab] // first event is the tab active at Start
  };

  await saveActiveSession(session);
  showRecordingView(session);
}

async function handleBackToIt() {
  const stopLoadingAnimation = showLoadingView();

  const session = await loadActiveSession();
  if (!session) {
    stopLoadingAnimation();
    showStartView();
    return;
  }

  const bundle = buildActivityBundle(session); // from bundle.js
  if (!bundle) {
    stopLoadingAnimation();
    showRecordingView(session);
    document.getElementById("started-ago").textContent =
      "Not enough activity yet.";
    return;
  }

  // Save bundle locally for debugging and future AI use
  await chrome.storage.local.set({ [BUNDLE_KEY]: bundle });
  console.log("WhereWasI — Activity Bundle:", bundle);

  // Run the AI request alongside the step animation, but never transition
  // faster than LOADING_MIN_DISPLAY_MS so the loading state doesn't just flash.
  const minimumWait = new Promise(resolve =>
    setTimeout(resolve, LOADING_MIN_DISPLAY_MS)
  );
  const [snapshot] = await Promise.all([requestAISnapshot(bundle), minimumWait]);

  if (snapshot) {
    await chrome.storage.local.set({ [AI_SNAPSHOT_KEY]: snapshot });
  } else {
    // No snapshot this time — clear out any stale one from a prior session.
    await chrome.storage.local.remove(AI_SNAPSHOT_KEY);
  }

  stopLoadingAnimation();
  await showBackToItView(bundle);
}

async function handleNewWork() {
  await clearSession();
  showStartView();
}

// ─── Init ─────────────────────────────────────────────────────

async function initPopup() {
  const session = await loadActiveSession();
  if (session) {
    showRecordingView(session);
  } else {
    showStartView();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("start-work").addEventListener("click", startWork);
  document.getElementById("back-to-it").addEventListener("click", handleBackToIt);
  document.getElementById("continue-btn").addEventListener("click", e => {
    resumeTab(e.currentTarget.dataset);
  });
  document.getElementById("new-work-btn").addEventListener("click", handleNewWork);
  document.getElementById("view-summary-link").addEventListener("click", e => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("summary.html") });
    window.close();
  });
  initPopup();
});
