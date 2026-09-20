// summary.js — populates the full-tab Detailed Summary / Back To It page
// from chrome.storage.local. Reads only; writes only on Start New Work.

const SESSION_KEY = "activeSession";
const BUNDLE_KEY = "activityBundle";
const AI_SNAPSHOT_KEY = "aiSnapshot";

function truncateTitle(title, maxLength = 30) {
  if (!title) return "";
  return title.length > maxLength ? `${title.slice(0, maxLength)}…` : title;
}

function buildTopPageItem(page) {
  const tr = document.createElement("tr");

  const pageCell = document.createElement("td");
  pageCell.textContent = truncateTitle(page.title || page.domain);

  const domainCell = document.createElement("td");
  domainCell.className = "col-domain";
  domainCell.textContent = page.domain;

  const visitsCell = document.createElement("td");
  visitsCell.className = "col-visits";
  visitsCell.textContent = `${page.visitCount}×`;

  tr.appendChild(pageCell);
  tr.appendChild(domainCell);
  tr.appendChild(visitsCell);
  return tr;
}

function toggleBreakdown() {
  const toggle = document.getElementById("breakdown-toggle");
  const content = document.getElementById("breakdown-content");
  const arrow = document.getElementById("breakdown-arrow");

  const isOpen = !content.hidden;
  content.hidden = isOpen;
  arrow.textContent = isOpen ? "↓" : "↑";
  toggle.setAttribute("aria-expanded", String(!isOpen));
}

function renderSummary(bundle, aiSnapshot) {
  console.log("WhereWasI — activityBundle:", bundle);
  console.log("WhereWasI — aiSnapshot:", aiSnapshot);

  document.getElementById("no-session-view").hidden = true;
  document.getElementById("summary-content").hidden = false;

  const pages = bundle.pages || [];
  const domainCount = new Set(pages.map(p => p.domain)).size;

  const exploring =
    (aiSnapshot && aiSnapshot.what_you_were_doing) ||
    (pages[0] && pages[0].domain) ||
    "Not clear from your activity.";

  document.getElementById("summary-exploring").textContent = exploring;

  document.getElementById("summary-discovered").textContent =
    (aiSnapshot && aiSnapshot.key_takeaway) || "Not clear from your activity.";

  document.getElementById("summary-laststop").textContent =
    (aiSnapshot && aiSnapshot.last_stop) ||
    (bundle.lastStop && (bundle.lastStop.title || bundle.lastStop.domain)) ||
    "Not clear from your activity.";

  document.getElementById("summary-next").textContent =
    (aiSnapshot && aiSnapshot.next) || "No clear next step detected.";

  document.getElementById("summary-stats").textContent =
    `${pages.length} page${pages.length === 1 ? "" : "s"} · ` +
    `${domainCount} domain${domainCount === 1 ? "" : "s"} · ` +
    `${bundle.durationMinutes} min`;

  const topPagesEl = document.getElementById("summary-top-pages");
  topPagesEl.innerHTML = "";
  pages.slice(0, 3).forEach(page => {
    topPagesEl.appendChild(buildTopPageItem(page));
  });

  const continueBtn = document.getElementById("continue-btn");
  const target = bundle.suggestedContinue;

  if (target) {
    continueBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: "activateTab",
        tabId: target.tabId,
        windowId: target.windowId,
        url: target.url
      });
      window.close();
    });
  } else {
    continueBtn.disabled = true;
  }
}

function showNoSessionMessage() {
  document.getElementById("no-session-view").hidden = false;
  document.getElementById("summary-content").hidden = true;
}

async function handleStartNewWork() {
  await chrome.storage.local.remove([SESSION_KEY, BUNDLE_KEY, AI_SNAPSHOT_KEY]);
  window.close();
}

async function init() {
  const result = await chrome.storage.local.get([BUNDLE_KEY, AI_SNAPSHOT_KEY]);
  const bundle = result[BUNDLE_KEY];
  const aiSnapshot = result[AI_SNAPSHOT_KEY];

  if (!bundle) {
    showNoSessionMessage();
    return;
  }

  renderSummary(bundle, aiSnapshot);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("new-work-btn").addEventListener("click", handleStartNewWork);
  document.getElementById("breakdown-toggle").addEventListener("click", toggleBreakdown);
  init();
});
