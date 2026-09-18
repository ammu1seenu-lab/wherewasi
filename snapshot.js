// api/snapshot.js — Vercel serverless function.
// Receives an Activity Bundle, calls Gemini to generate a 4-field mental
// bookmark, retries once on failure, and falls back to a deterministic
// summary built from the Activity Bundle if both attempts fail.
// The user must never see an empty recovery screen.

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const REQUEST_TIMEOUT_MS = 10000;

const SNAPSHOT_FIELDS = ["what_you_were_doing", "key_takeaway", "last_stop", "next"];

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const bundle = req.body;

  if (!isValidBundle(bundle)) {
    res.status(400).json({ error: "Invalid Activity Bundle" });
    return;
  }

  // Never hardcode the key — it must come from the environment.
  const apiKey = process.env.GEMINI_API_KEY;

  let snapshot = null;
  let source = "fallback";

  if (apiKey) {
    snapshot = await generateSnapshotWithRetry(bundle, apiKey);
    if (snapshot) source = "ai";
  } else {
    console.error("GEMINI_API_KEY is not set — returning deterministic fallback.");
  }

  if (!snapshot) {
    snapshot = buildFallbackSnapshot(bundle);
  }

  res.status(200).json({ snapshot, source });
};

// ─── Validation ──────────────────────────────────────────────

function isValidBundle(bundle) {
  return (
    bundle &&
    typeof bundle === "object" &&
    typeof bundle.sessionId === "string" &&
    Array.isArray(bundle.pages)
  );
}

function isValidSnapshot(snapshot) {
  return (
    snapshot &&
    typeof snapshot === "object" &&
    SNAPSHOT_FIELDS.every(
      field => typeof snapshot[field] === "string" && snapshot[field].length > 0
    )
  );
}

// ─── Gemini call + retry-once ───────────────────────────────

async function generateSnapshotWithRetry(bundle, apiKey) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const snapshot = await callGemini(bundle, apiKey);
      if (isValidSnapshot(snapshot)) return snapshot;
      console.error(`Gemini attempt ${attempt} returned a malformed snapshot.`);
    } catch (error) {
      console.error(`Gemini attempt ${attempt} failed:`, error.message);
    }
  }
  return null;
}

async function callGemini(bundle, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(bundle) }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              what_you_were_doing: { type: "STRING" },
              key_takeaway: { type: "STRING" },
              last_stop: { type: "STRING" },
              next: { type: "STRING" }
            },
            required: SNAPSHOT_FIELDS
          }
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Gemini response had no text content");
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildPrompt(bundle) {
  return `You are generating a short "mental bookmark" so a user can resume browser research after an interruption.

Use ONLY the evidence in the Activity Bundle below. Never invent facts, findings, or next steps that aren't supported by the data. If evidence is insufficient or unclear, say so plainly (e.g. "Not clear from your activity.").

Return strict JSON with exactly these four string fields:
- what_you_were_doing: a concise description of what the user was researching
- key_takeaway: the most useful takeaway supported by the pages visited
- last_stop: what the last meaningful page was
- next: a likely next step, only if the evidence supports one; otherwise "No clear next step detected."

Activity Bundle:
${JSON.stringify(bundle, null, 2)}`;
}

// ─── Deterministic fallback ──────────────────────────────────

function buildFallbackSnapshot(bundle) {
  const pages = bundle.pages || [];
  const totalPages = pages.length;

  if (totalPages === 0) {
    const message = "Not enough activity to create a useful snapshot yet.";
    return {
      what_you_were_doing: message,
      key_takeaway: message,
      last_stop: message,
      next: "No clear next step detected."
    };
  }

  const domains = new Set(pages.map(p => p.domain)).size;
  const topPage = pages[0]; // pages are pre-sorted by relevanceScore
  const lastStop = bundle.lastStop || {};
  const lastStopLabel = lastStop.title || lastStop.domain || "an unknown page";

  return {
    what_you_were_doing: `You visited ${totalPages} page${totalPages === 1 ? "" : "s"} across ${domains} domain${domains === 1 ? "" : "s"}.`,
    key_takeaway: topPage
      ? `You returned to ${topPage.title || topPage.domain} ${topPage.visitCount} time${topPage.visitCount === 1 ? "" : "s"}.`
      : "Not clear from your activity.",
    last_stop: `Your last active page was ${lastStopLabel}.`,
    next: "No clear next step detected."
  };
}
