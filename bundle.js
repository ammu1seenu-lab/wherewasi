// bundle.js — transforms raw activityEvents into a structured Activity Bundle.
// Called from popup.js when the user clicks Back To It.
// Pure functions only. No Chrome APIs. No AI.

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Strip utm_ and other tracking params that create false duplicates
    const cleaned = new URLSearchParams();
    for (const [key, val] of u.searchParams) {
      if (!key.startsWith("utm_")) cleaned.set(key, val);
    }
    u.search = cleaned.toString();
    // Remove trailing slash for consistency
    return u.origin + u.pathname.replace(/\/$/, "") + u.search;
  } catch {
    return url;
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function buildPageMap(events) {
  // Group events by normalised URL, calculate per-page metrics
  const pages = new Map();

  events.forEach((event, index) => {
    const key = normalizeUrl(event.url);
    const nextEvent = events[index + 1];
    // Duration = time until next tab switch. Last event duration is unknown.
    const activeSeconds = nextEvent
      ? Math.round((nextEvent.timestamp - event.timestamp) / 1000)
      : 0;

    if (!pages.has(key)) {
      pages.set(key, {
        url: key,
        title: event.title,
        domain: extractDomain(event.url),
        firstVisitedAt: event.timestamp,
        lastVisitedAt: event.timestamp,
        visitCount: 1,
        activations: 1,
        totalActiveSeconds: activeSeconds,
        tabId: event.tabId,
        windowId: event.windowId
      });
    } else {
      const page = pages.get(key);
      page.visitCount += 1;
      page.activations += 1;
      page.totalActiveSeconds += activeSeconds;
      page.lastVisitedAt = event.timestamp;
      // Keep the most descriptive title seen for this page
      if (event.title && event.title.length > page.title.length) {
        page.title = event.title;
      }
    }
  });

  return Array.from(pages.values());
}

function scoreTab(page, sessionDurationSeconds, mostRecentTimestamp) {
  const maxSeconds = sessionDurationSeconds || 1;

  // How much of the session was spent here (0–1)
  const timeScore = Math.min(page.totalActiveSeconds / maxSeconds, 1);

  // How often the user returned (capped at 10 activations = 1.0)
  const activationScore = Math.min(page.activations / 10, 1);

  // How recently was it visited (1 = most recent, 0 = first visited)
  const recencyScore =
    mostRecentTimestamp > 0
      ? 1 - (mostRecentTimestamp - page.lastVisitedAt) / (maxSeconds * 1000)
      : 0;

  // How many times did the user revisit (beyond the first visit)
  const revisitScore = Math.min((page.visitCount - 1) / 5, 1);

  return (
    timeScore * 0.4 +
    activationScore * 0.3 +
    recencyScore * 0.2 +
    revisitScore * 0.1
  );
}

function buildActivityBundle(session) {
  const events = session.activityEvents || [];
  if (events.length === 0) return null;

  const startTime = session.startTime;
  const endTime = Date.now();
  const durationSeconds = Math.round((endTime - startTime) / 1000);
  const durationMinutes = Math.round(durationSeconds / 60);
  const mostRecentTimestamp = events[events.length - 1].timestamp;

  const pages = buildPageMap(events);

  // Score every page deterministically — not by AI
  const scored = pages.map(page => ({
    ...page,
    relevanceScore: parseFloat(
      scoreTab(page, durationSeconds, mostRecentTimestamp).toFixed(2)
    )
  }));

  // Sort highest relevance first
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Last Stop = the literal final tab the user had active
  const lastEvent = events[events.length - 1];
  const lastStop = {
    url: normalizeUrl(lastEvent.url),
    title: lastEvent.title,
    domain: extractDomain(lastEvent.url),
    tabId: lastEvent.tabId,
    windowId: lastEvent.windowId
  };

  // Suggested Continue = highest relevance score
  const top = scored[0];
  const second = scored[1];

  // Ambiguous if top two scores are within 10% of each other
  const isAmbiguous =
    second && top.relevanceScore - second.relevanceScore < 0.1;

  const suggestedContinue = {
    url: top.url,
    title: top.title,
    domain: top.domain,
    tabId: top.tabId,
    windowId: top.windowId,
    relevanceScore: top.relevanceScore,
    confidenceLevel: isAmbiguous ? "ambiguous" : "high"
  };

  const candidateContinueTabs = isAmbiguous
    ? [
        suggestedContinue,
        {
          url: second.url,
          title: second.title,
          domain: second.domain,
          tabId: second.tabId,
          windowId: second.windowId,
          relevanceScore: second.relevanceScore,
          confidenceLevel: "ambiguous"
        }
      ]
    : [suggestedContinue];

  return {
    sessionId: session.sessionId,
    startTime,
    endTime,
    durationMinutes,
    pages: scored,
    lastStop,
    suggestedContinue,
    candidateContinueTabs,
    totalEvents: events.length
  };
}
