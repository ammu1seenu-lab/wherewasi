// background.js — runs as a Manifest V3 service worker.
// Listens for tab switches even when the popup is closed.
// Records activity only while an active WhereWasI session exists.
// No page content, history API, or AI.

const SESSION_KEY = "activeSession";
const EVENT_CAP = 500;

function isSameTab(previous, next) {
  return (
    previous &&
    previous.tabId === next.tabId &&
    previous.windowId === next.windowId
  );
}

async function recordTabActivation(tabId, windowId) {
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
