// popup.js — manages popup UI state and user actions.
// Tab-switch tracking runs in background.js, not here.
// bundle.js handles Activity Bundle generation.
// Session + activityEvents live in chrome.storage.local.

const SESSION_KEY = "activeSession";
const BUNDLE_KEY = "activityBundle";

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
  await chrome.storage.local.remove([SESSION_KEY, BUNDLE_KEY]);
}

// ─── View transitions ─────────────────────────────────────────

function hideAll() {
  document.getElementById("start-view").hidden = true;
  document.getElementById("recording-view").hidden = true;
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

function showBackToItView(bundle) {
  hideAll();
  document.getElementById("backtoit-view").hidden = false;

  const candidates = bundle.candidateContinueTabs;
  const container = document.getElementById("bit-candidates");
  container.innerHTML = "";

  if (candidates.length === 1) {
    // High confidence — one clear tab to continue from
    const c = candidates[0];
    document.getElementById("bit-heading").textContent = "BACK TO IT";
    container.innerHTML = `
      <p class="copy"><strong>${c.title || c.domain}</strong></p>
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
  const session = await loadActiveSession();
  if (!session) {
    showStartView();
    return;
  }

  const bundle = buildActivityBundle(session); // from bundle.js
  if (!bundle) {
    document.getElementById("started-ago").textContent =
      "Not enough activity yet.";
    return;
  }

  // Save bundle locally for debugging and future AI use
  await chrome.storage.local.set({ [BUNDLE_KEY]: bundle });
  console.log("WhereWasI — Activity Bundle:", bundle);

  showBackToItView(bundle);
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
  initPopup();
});
