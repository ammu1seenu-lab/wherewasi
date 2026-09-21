// background.js — runs as a Manifest V3 service worker.
// Listens for tab switches even when the popup is closed.
// Records activity only while an active WhereWasI session exists.
// No page content, history API, or AI.

const SESSION_KEY = "activeSession";
const EVENT_CAP = 500;
// Session auto-expires after 24 hours of inactivity — UI handles staleness gracefully before this point via resume-check-view.
const SESSION_MAX_HOURS = 24;
const INACTIVITY_TIMEOUT_MINUTES = 60;

// Clears the session if it has exceeded the max age AND been inactive for too long.
// Returns true if the session was cleared, false otherwise.
async function checkSessionTimeout() {
  const result = await chrome.storage.local.get(SESSION_KEY);
  const session = result[SESSION_KEY];
  if (!session) return false;

  const now = Date.now();
  const sessionAgeMinutes = (now - session.startTime) / 60000;
  const events = session.activityEvents || [];
  const lastEventTime = events.length > 0
    ? events[events.length - 1].timestamp
    : session.startTime;
  const inactiveMinutes = (now - lastEventTime) / 60000;

  if (
    sessionAgeMinutes >= SESSION_MAX_HOURS * 60 &&
    inactiveMinutes >= INACTIVITY_TIMEOUT_MINUTES
  ) {
    await chrome.storage.local.remove(SESSION_KEY);
    console.log(
      `WhereWasI: session auto-expired — age ${Math.round(sessionAgeMinutes)} min, inactive ${Math.round(inactiveMinutes)} min`
    );
    return true;
  }
  return false;
}

function isSameTab(previous, next) {
  return (
    previous &&
    previous.tabId === next.tabId &&
    previous.windowId === next.windowId
  );
}

async function recordTabActivation(tabId, windowId) {
  const expired = await checkSessionTimeout();
  if (expired) return;

  const result = await chrome.storage.local.get(SESSION_KEY);
  const session = result[SESSION_KEY];

  // No session → ignore. Tracking must not run between sessions.
  if (!session) return;

  const events = session.activityEvents || [];
  const lastEvent = events[events.length - 1];

  // Skip repeats of the already-active tab (focus noise, not a real switch).
  if (isSameTab(lastEvent, { tabId, windowId })) return;

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    // Tab may have closed before we could read it.
    return;
  }

  const event = {
    timestamp: Date.now(),
    tabId,
    windowId,
    url: tab.url || "",
    title: tab.title || ""
  };

  if (events.length >= EVENT_CAP) {
    // Cap reached — update existing record instead of adding a new event.
    // Prevents chrome.storage.local from silently hitting its 5MB limit.
    const existing = events.find(e => e.url === event.url);
    if (existing) {
      existing.lastSeenAt = event.timestamp;
    } else {
      // New URL and no room left — evict the oldest event rather than
      // silently dropping this one.
      events.shift();
      events.push(event);
    }
  } else {
    events.push(event);
  }

  session.activityEvents = events;
  session.currentTab = event;

  await chrome.storage.local.set({ [SESSION_KEY]: session });
  console.log("WhereWasI recorded tab:", event.title || event.url);
}

// Chrome can wake this worker when the selected tab in a window changes.
chrome.tabs.onActivated.addListener((activeInfo) => {
  recordTabActivation(activeInfo.tabId, activeInfo.windowId);
});

// Periodic alarm catches inactivity even when the user isn't switching tabs.
chrome.alarms.get("sessionTimeout", alarm => {
  if (!alarm) chrome.alarms.create("sessionTimeout", { periodInMinutes: 15 });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "sessionTimeout") checkSessionTimeout();
});

async function activateTab(tabId, windowId, url) {
  try {
    // Tab still exists — activate it and bring its window forward.
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
  } catch (error) {
    // Tab was closed — reopen the saved URL instead.
    await chrome.tabs.create({ url });
  }
}

// summary.html (and any other extension page) requests tab activation
// through this message rather than calling chrome.tabs directly.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "activateTab") return;

  activateTab(message.tabId, message.windowId, message.url).then(() =>
    sendResponse({ ok: true })
  );

  return true; // keep the message channel open for the async sendResponse
});
