'use strict';

// ============================================================
// HACKCLUB-SERVICE.JS — HackClub AI provider
// ============================================================
// HackClub runs a free OpenAI-compatible proxy that gives
// access to many AI models (Qwen, Gemini, DeepSeek, etc.)
// with no cost using a shared community key.
//
// API endpoint: https://ai.hackclub.com/proxy/v1/chat/completions
// Format: same as OpenAI chat completions (/v1/chat/completions)
//
// What this file does:
//   1. Builds the message array (system prompt + history + user message)
//   2. Sends a POST request to the HackClub proxy
//   3. Extracts the text from the response
//   4. Parses the JSON that the AI returned
//   5. Normalises it into the standard output shape
// ============================================================

const { createHttpError } = require('./errors');  // HTTP error helper
const { getConfig }       = require('./config');   // reads env vars
const { normalizeOutput } = require('./ai-output'); // normalises AI response shape

// ── SYSTEM PROMPT ────────────────────────────────────────
// Tells the AI exactly what to generate and how to format it.
// The more specific this is, the better the preview quality.
const SYSTEM_PROMPT = `You are FAB-LabCode AI, an expert software engineer inside a browser-based coding tool.
You MUST return ONLY a single valid JSON object — no markdown, no code fences, no extra text.

══════════════════════════════════════════════
CRITICAL — READ THIS FIRST
══════════════════════════════════════════════
The LAST user message is ALWAYS the true intent. Previous messages are context only.
If the previous topic was a UI calculator and the current message says "teach me merge sort",
you MUST respond with merge sort — NOT a calculator. Never let history override the current request.
Do not continue a previous theme, style, or product type unless the current message explicitly asks for it.

══════════════════════════════════════════════
RULE 1 — DSA / ALGORITHM / DATA STRUCTURE requests
══════════════════════════════════════════════
Trigger: user asks to explain, teach, implement, or show a DSA topic
(sorting, searching, linked list, tree, graph, stack, queue, hash map, recursion, dynamic programming, etc.)

DO:
- Return EXACTLY ONE code file — the algorithm in the language the user requested (default JavaScript).
  If they say "in Python" → Python file. "in C++" → C++ file. "in Java" → Java file.
- Write COMPLETE, runnable code with a working example at the bottom (print/console.log the result).
- Set preview.mode = "note" — NO HTML, NO CSS, NO DOM code for pure algorithms.
- Fill trace[] with 4-6 concrete execution steps showing real variable values, e.g.:
    "left=0 right=6 mid=3 → arr[3]=7 === target → FOUND at index 3"
- Fill keyInsight with the single most important idea in one punchy sentence.
- Fill inputExample and outputExample with concrete values.
- Fill concepts[] with 4-6 relevant CS concept names.
- Fill features[] with 4-5 properties of this specific implementation.

DO NOT:
- Generate HTML, CSS, or browser-DOM code for DSA topics.
- Return multiple files (HTML + CSS + JS) for an algorithm.
- Add a visualizer UI unless the user explicitly asks for one.

══════════════════════════════════════════════
RULE 2 — UI / APP requests
══════════════════════════════════════════════
Trigger: user asks to build an app, tool, game, calculator, website, form, dashboard, etc.

DO:
- Set preview.mode = "live"
- preview.markup = complete body HTML
- preview.styles = comprehensive, beautiful CSS (gradients, shadows, rounded corners, hover effects)
- preview.script = complete working JavaScript
- Make it look PROFESSIONAL — consistent color palette, proper spacing, readable fonts
- Return multiple files: index.html, styles.css, main.js (primary: true on JS)

══════════════════════════════════════════════
JSON SHAPE (always return exactly this structure):
══════════════════════════════════════════════
{
  "reply": "short 1-2 sentence chat message",
  "output": {
    "title": "string",
    "summary": "string",
    "code": "primary file content (the algorithm or main JS)",
    "files": [{"filename":"algo.py","language":"Python","content":"...","primary":true}],
    "explanation": "2-3 sentences on how it works",
    "keyInsight": "the ONE core idea in a single punchy sentence — fill this for DSA",
    "steps": ["implementation step 1", "step 2"],
    "tips": ["best practice 1", "tip 2"],
    "complexity": {"level":"Low|Medium|High","time":"O(...)","space":"O(...)","pattern":"string","paradigm":"string"},
    "trace": ["step showing real variable values — fill for DSA, leave [] for UI apps"],
    "inputExample": "concrete example input — e.g. arr=[1,3,5,7], target=7",
    "outputExample": "concrete example output — e.g. index 3",
    "concepts": ["concept1","concept2"],
    "features": ["feature1","feature2"],
    "userFlow": ["user action → system response — fill for UI apps, leave [] for DSA"],
    "preview": {
      "mode": "live OR note",
      "title": "string",
      "body": "description string",
      "markup": "HTML body (empty string for DSA)",
      "styles": "CSS (empty string for DSA)",
      "script": "JS (empty string for DSA)"
    }
  }
}`;

// ── buildMessages ─────────────────────────────────────────
// Builds the messages array that the AI API expects.
// Format: [{ role: 'system', content: '...' }, { role: 'user', content: '...' }, ...]
//
// We include the last 10 messages from history so the AI
// has context about the recent conversation.
function buildMessages(history, message) {
  const recentHistory = Array.isArray(history) ? history.slice(-10) : [];

  // Start with the system prompt (role instructions for the AI)
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  // Add recent conversation history
  // The AI uses this to understand context ("what were we talking about?")
  for (const entry of recentHistory) {
    const content = String(entry.content || '').trim();
    if (content) {
      messages.push({
        // OpenAI format uses 'assistant' not 'ai'
        role:    entry.role === 'assistant' ? 'assistant' : 'user',
        content,
      });
    }
  }

  // Add the current user message at the end
  messages.push({ role: 'user', content: String(message || '').trim() });

  return messages;
}

// ── extractJsonText ───────────────────────────────────────
// The AI should return pure JSON, but sometimes it wraps it
// in a markdown code block (```json ... ```). This function
// handles both cases and extracts just the JSON part.
function extractJsonText(text) {
  const trimmed = String(text || '').trim();

  // Happy path: response starts with '{' — it's already plain JSON
  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  // Try to find JSON inside a markdown code block: ```json { ... } ```
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    return match[1].trim();
  }

  // Last resort: find the first '{' and last '}' and extract between them
  const braceStart = trimmed.indexOf('{');
  const braceEnd   = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return trimmed.slice(braceStart, braceEnd + 1);
  }

  // Nothing usable found — throw so we can fall back to templates
  throw createHttpError(502, 'HackClub AI response did not contain parseable JSON');
}

// ── extractChoice ─────────────────────────────────────────
// Pulls the text content out of the standard OpenAI response format.
// OpenAI response shape: { choices: [{ message: { content: '...' } }] }
function extractChoice(payload) {
  const choice  = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = choice?.message?.content;

  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }

  throw createHttpError(502, 'HackClub AI response did not include text output');
}

// ── generateHackClubAssistantReply ────────────────────────
// Main export — called by chat-service.js.
// Sends the user's message to the HackClub proxy and
// returns a structured reply.
async function generateHackClubAssistantReply({ message, history, modelOverride, apiKeyOverride }) {
  const { hackClubApiKey, hackClubModel, hackClubEndpoint, aiRequestTimeoutMs } = getConfig();

  // Use the user's own API key if provided, otherwise use the built-in one
  const apiKey = (typeof apiKeyOverride === 'string' && apiKeyOverride.trim())
    ? apiKeyOverride.trim()
    : hackClubApiKey;

  // Use the user's chosen model or the default from config
  const model = (typeof modelOverride === 'string' && modelOverride.trim())
    ? modelOverride.trim()
    : hackClubModel;

  // No key = can't make the request
  if (!apiKey) {
    throw createHttpError(503, 'HACKCLUB_API_KEY is not configured');
  }

  let response;

  try {
    // Send the POST request to HackClub's AI proxy
    // AbortSignal.timeout() cancels the request if it takes too long
    response = await fetch(hackClubEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`, // API key in the Authorization header
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model,                                          // which AI model to use
        messages:        buildMessages(history, message), // conversation history + new message
        response_format: { type: 'json_object' },  // force JSON output
        max_tokens:      10000,                    // enough for full HTML+CSS+JS
        temperature:     0.2,                      // low = consistent, reliable output
      }),
      signal: AbortSignal.timeout(aiRequestTimeoutMs), // auto-cancel if too slow
    });

  } catch (error) {
    // Network errors or timeouts come here
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw createHttpError(504, `HackClub AI request timed out after ${aiRequestTimeoutMs} ms`);
    }
    throw error;
  }

  // Parse the HTTP response body as text first to handle non-JSON errors gracefully
  const rawBody = await response.text();
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    if (!response.ok) {
      throw createHttpError(response.status, `HackClub API Error: ${rawBody.trim().substring(0, 150)}`);
    }
    throw createHttpError(502, `HackClub API returned invalid JSON: ${rawBody.trim().substring(0, 150)}`);
  }

  // If the AI API returned an error status (4xx/5xx), throw
  if (!response.ok) {
    throw createHttpError(
      response.status,
      payload?.error?.message || `HackClub AI request failed (${response.status})`,
    );
  }

  // Extract the text content, parse the JSON, and normalise the shape
  const rawText  = extractChoice(payload);
  const jsonText = extractJsonText(rawText);
  const parsed   = JSON.parse(jsonText);

  // normalizeOutput validates and fills in any missing fields
  return normalizeOutput(parsed, 'HackClub AI');
}

module.exports = { generateHackClubAssistantReply };
