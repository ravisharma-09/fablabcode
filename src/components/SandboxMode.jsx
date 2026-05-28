// ============================================================
// SANDBOXMODE.JSX — AI Sandbox page (the main feature)
// File: src/components/SandboxMode.jsx
//
// What this file teaches:
//   • Component composition — how smaller components fit together
//   • useState  — tracks messages, current output, loading, model, api key
//   • useEffect — loads chat history once on mount via loadHistory()
//   • useCallback — memoises loadHistory so its identity stays stable
//   • async/await + fetch — sendMessage() calls the backend AI route
//   • Optimistic UI — user message appears instantly before AI responds
//   • Error handling — try/catch shows errors as toast + chat bubble
//   • Context snapshot pattern — captures state before async operations
//
// State owned here:
//   messages      — the list of chat messages shown in the chat panel
//   currentOutput — the latest AI artifact (code + preview + explanation)
//   isBusy        — true while waiting for the AI to respond
//   selectedModel — which AI model the user picked in the ModelBar
//   apiKey        — optional custom API key from the ModelBar
//
// Data flow:
//   User types → ChatPanel → sendMessage() → api.post('/chat') → AI response
//                                          → setMessages & setCurrentOutput
//   OutputPanel reads currentOutput and displays Plan / Sandbox / Preview tabs.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import ChatPanel   from './ChatPanel';    // left panel: chat messages + input box
import OutputPanel from './OutputPanel';  // right panel: Plan / Sandbox / Preview tabs
import ModelBar    from './ModelBar';     // top bar: model picker + optional API key
import { api }     from '../utils/api';  // fetch wrapper (handles JSON and errors)

// Default AI model used when the app first loads.
// This model is free through the HackClub proxy.
const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';

/**
 * SandboxMode — Container for the AI Sandbox feature.
 * Owns the shared state between the Chat panel and Output panel.
 *
 * @param {Function} showToast - Notification callback from App.jsx.
 */
function SandboxMode({ showToast }) {

  // ── STATE ─────────────────────────────────────────────────

  // messages: array of { role, content, createdAt, artifact?, isFallback? }
  // Displayed as chat bubbles in ChatPanel; last 10 are sent as context to the AI.
  const [messages,      setMessages]      = useState([]);

  // currentOutput: the structured artifact returned by the AI:
  //   { title, summary, files, explanation, steps, preview, complexity, ... }
  // Displayed in OutputPanel's Plan/Sandbox/Preview tabs.
  // null until the first successful AI response.
  const [currentOutput, setCurrentOutput] = useState(null);

  // isBusy: true while a /api/chat request is pending.
  // ChatPanel uses this to show a typing indicator.
  const [isBusy,        setIsBusy]        = useState(false);

  // selectedModel: the model ID string from the ModelBar dropdown.
  // Sent to the backend as `model` so the HackClub proxy uses the right model.
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);

  // apiKey: optional user-provided API key from the ModelBar.
  // If non-empty, it overrides the server's built-in key.
  const [apiKey,        setApiKey]        = useState('');

  // ── loadHistory ───────────────────────────────────────────
  // Fetches previously saved messages from the backend on mount.
  // Also restores the latest AI artifact so the Output panel isn't empty on return.
  //
  // useCallback memoises this function — it only recreates when its deps change.
  // Because deps = [], loadHistory is created ONCE and its identity is stable.
  // This matters for the useEffect below: a stable dep means the effect
  // doesn't re-run on every render.
  const loadHistory = useCallback(async () => {
    try {
      const result = await api.get('/chat/history'); // GET /api/chat/history
      const msgs   = Array.isArray(result.messages) ? result.messages : [];
      setMessages(msgs); // restore chat bubbles from the database

      // Walk the messages in reverse order to find the most recent AI artifact.
      // [...msgs].reverse() creates a reversed copy without mutating the original.
      // .find() returns the first match (which is the latest in reverse order).
      const latestArtifact = [...msgs].reverse().find(
        m => m.role === 'assistant' && m.artifact
      );

      // If we found a saved artifact, restore it in the Output panel
      if (latestArtifact?.artifact) {
        setCurrentOutput(latestArtifact.artifact);
      }
    } catch (error) {
      // Don't show a toast here — silently fail on initial load
      // (backend might not be running yet)
      console.error('Failed to load history:', error);
    }
  }, []); // no deps — runs once on mount, never again

  // Run loadHistory once when SandboxMode first renders (mounts).
  // The [] tells React "this effect has no deps, run it only once".
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ── sendMessage(text) ─────────────────────────────────────
  // Called when the user presses Enter or the Send button in ChatPanel.
  // Sends the message to the backend AI, gets a reply, updates state.
  //
  // Pattern: Optimistic UI — the user's message is added to the list
  // IMMEDIATELY before the AI request finishes, so the UI feels instant.
  const sendMessage = async (text) => {
    if (!text.trim()) return; // ignore empty/whitespace-only messages

    // Build the user message object that will appear as a chat bubble
    const userMsg = {
      role:      'user',
      content:   text,
      createdAt: new Date().toISOString(),
    };

    // ── Context snapshot pattern ───────────────────────────
    // We need to capture the current messages array BEFORE adding the new
    // user message, so we can send the conversation history to the AI.
    //
    // Problem: setMessages is async — state isn't updated synchronously.
    // Solution: use the functional form of setMessages, which receives the
    // LATEST state as `prev`. We grab `prev` before we return the new array.
    let contextSnapshot = [];
    setMessages(prev => {
      contextSnapshot = prev; // capture previous messages for the API call
      return [...prev, userMsg]; // add user message to chat (optimistic update)
    });

    setIsBusy(true); // show the typing indicator in ChatPanel

    try {
      // Build the request body for POST /api/chat
      const body = {
        message: text,
        model:   selectedModel, // e.g. 'qwen/qwen3-32b'
        // Send the last 10 messages as explicit context.
        // This is the conversation the AI uses to understand follow-up messages.
        // When the user clicks Clear, contextSnapshot is [] → AI gets a fresh start.
        history: contextSnapshot.slice(-10).map(m => ({
          role:    m.role,
          content: m.content,
        })),
      };

      // If the user provided their own API key, include it
      if (apiKey.trim()) body.apiKey = apiKey.trim();

      // async/await: pause here until the AI responds (may take several seconds)
      const payload = await api.post('/chat', body);

      // If the AI timed out and the server fell back to templates, warn the user
      if (payload.meta?.provider === 'fallback' && payload.meta?.fallbackReason) {
        showToast(`⚠️ AI fallback: ${payload.meta.fallbackReason}`);
      }

      // Add the AI's reply as a chat bubble
      setMessages(prev => [...prev, {
        role:      'assistant',
        content:   payload.reply,
        createdAt: payload.meta?.generatedAt || new Date().toISOString(),
        // Mark bubble as fallback so ChatPanel can show a warning label
        isFallback: payload.meta?.provider === 'fallback' && !!payload.meta?.fallbackReason,
        fallbackReason: payload.meta?.fallbackReason,
      }]);

      // If the AI returned a code artifact, update the Output panel
      if (payload.output) {
        setCurrentOutput(payload.output);
      }

    } catch (error) {
      // Network or server error — show it as both a toast and a chat bubble
      console.error('Chat error:', error);
      showToast(error.message); // floating notification at bottom

      // Add an error message as an AI chat bubble so the conversation isn't broken
      setMessages(prev => [...prev, {
        role:      'assistant',
        content:   'The backend request failed. Please check your configuration.',
        createdAt: new Date().toISOString(),
      }]);

    } finally {
      // `finally` always runs — hide the loading spinner whether success or failure
      setIsBusy(false);
    }
  };

  // ── clearChat ─────────────────────────────────────────────
  // Clears the CURRENT SESSION's chat UI and AI context.
  // The persistent history in the database is NOT deleted — the History
  // page will still show everything. But the AI will start fresh because
  // the next sendMessage() will send an empty history array.
  const clearChat = () => {
    setMessages([]);        // remove all chat bubbles from the screen
    setCurrentOutput(null); // clear the Output panel
    showToast('New conversation started — history is preserved');
  };

  // ── RENDER ────────────────────────────────────────────────
  return (
    <section className="mode-section" id="mode-sandbox">

      {/* Model bar — sits above both panels.
          User picks a model from the dropdown and optionally pastes their own API key.
          Changes propagate down via selectedModel / apiKey state. */}
      <ModelBar
        selectedModel={selectedModel}
        onModelChange={setSelectedModel} // fires when user picks a model from the list
        apiKey={apiKey}
        onApiKeyChange={setApiKey}       // fires when user types in the API key field
      />

      {/* Two-column layout: Chat on left, Output on right */}
      <div className="sandbox-layout">

        {/* LEFT — Chat panel (message bubbles + text input + Clear button).
            sendMessage and clearChat are passed as callbacks.
            isBusy controls the typing indicator. */}
        <ChatPanel
          messages={messages}
          sendMessage={sendMessage}
          clearChat={clearChat}
          isBusy={isBusy}
        />

        {/* RIGHT — Output panel (Plan / Sandbox / Preview tabs).
            output prop is null until the first AI response,
            which shows an empty state placeholder. */}
        <OutputPanel output={currentOutput} />

      </div>
    </section>
  );
}

export default SandboxMode;
