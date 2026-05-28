import React, { useState, useRef, useEffect } from 'react';
import { SlidersHorizontal, ChevronDown, Key, X, Check } from 'lucide-react';

export const MODELS = [
  { id: 'google/gemma-4-26b-a4b-it:free',                label: 'Google: Gemma 4 26B',     tag: 'Free'  },
  { id: 'qwen/qwen3-32b',                                label: 'Qwen: Qwen 3 32B',        tag: 'Paid'  },
  { id: 'qwen/qwen3.6-flash',                            label: 'Qwen: Qwen 3.6 Flash',    tag: 'Paid'  },
  { id: '~google/gemini-flash-latest',                   label: 'Google: Gemini Flash',    tag: 'Paid'  },
  { id: 'google/gemini-3.1-flash-lite',                  label: 'Google: Gemini 3.1 Lite', tag: 'Paid'  },
  { id: 'deepseek/deepseek-v4-flash:free',               label: 'DeepSeek: V4 Flash',      tag: 'Free'  },
];

function ModelBar({ selectedModel, onModelChange, apiKey, onApiKeyChange }) {
  const [modelOpen, setModelOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const dropdownRef = useRef(null);
  const keyRef = useRef(null);

  const current = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setModelOpen(false);
      if (keyRef.current && !keyRef.current.contains(e.target)) setKeyOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSaveKey = () => {
    setKeySaved(true);
    setTimeout(() => { setKeySaved(false); setKeyOpen(false); }, 1000);
  };

  return (
    <div className="model-bar">
      {/* Model dropdown trigger */}
      <div className="model-selector-wrap" ref={dropdownRef}>
        <button
          className="model-selector-btn"
          onClick={() => { setModelOpen(o => !o); setKeyOpen(false); }}
        >
          <SlidersHorizontal size={14} />
          <span className="model-selector-label">{current.label}</span>
          <ChevronDown size={13} className={`model-chevron${modelOpen ? ' open' : ''}`} />
        </button>

        {modelOpen && (
          <div className="model-dropdown">
            {MODELS.map(m => (
              <button
                key={m.id}
                className={`model-dropdown-item${m.id === selectedModel ? ' active' : ''}`}
                onClick={() => { onModelChange(m.id); setModelOpen(false); }}
              >
                <span className="model-dropdown-name">{m.label}</span>
                <span className="model-dropdown-tag">{m.tag}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* API Key */}
      <div className="model-key-wrap" ref={keyRef}>
        {keyOpen ? (
          <div className="model-key-row">
            <Key size={12} />
            <input
              type="password"
              className="model-key-input"
              placeholder="Paste your API key…"
              value={apiKey}
              autoFocus
              onChange={e => onApiKeyChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveKey();
                if (e.key === 'Escape') setKeyOpen(false);
              }}
            />
            <button className="model-key-save" onClick={handleSaveKey}>
              {keySaved ? <Check size={12} /> : 'Save'}
            </button>
            {apiKey && (
              <button className="model-key-clear" onClick={() => { onApiKeyChange(''); setKeyOpen(false); }}>
                <X size={12} />
              </button>
            )}
          </div>
        ) : (
          <button
            className={`model-key-btn${apiKey ? ' active' : ''}`}
            onClick={() => { setKeyOpen(true); setModelOpen(false); }}
          >
            <Key size={13} />
            {apiKey ? 'Key set' : 'Your key'}
          </button>
        )}
      </div>
    </div>
  );
}

export default ModelBar;
