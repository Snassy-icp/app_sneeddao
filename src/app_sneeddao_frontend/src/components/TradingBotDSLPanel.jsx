import React, { useState, useCallback, useRef, useEffect } from 'react';
import { parseDSL, TokenizerError, ParseError } from '../dsl/parser';
import { serializeBotState } from '../dsl/serializer';
import { resolveOperations, ResolverError } from '../dsl/resolver';
import { generateLLMGuide } from '../dsl/llm-guide';

const CATEGORY_LABELS = {
  tokens: 'Token Registry',
  dex: 'DEX Settings',
  settings: 'Global Settings',
  chores: 'Chore Management',
  actions: 'Trade / Move-Funds Actions',
  rebalance: 'Rebalance Configuration',
  distributions: 'Distribution Lists',
  circuit_breaker: 'Circuit Breakers',
  purses: 'Purse Management',
  events: 'Event System',
  logging: 'Logging',
  trades: 'Quick Trades / Transfers',
};

const CATEGORY_ORDER = [
  'tokens', 'dex', 'settings', 'chores', 'actions', 'rebalance',
  'distributions', 'circuit_breaker', 'purses', 'events', 'logging', 'trades',
];

export default function TradingBotDSLPanel({ canisterId, getReadyBotActor, theme, accentColor }) {
  const [editorText, setEditorText] = useState('');
  const [mode, setMode] = useState('editor'); // 'editor' | 'review' | 'executing'
  const [operations, setOperations] = useState([]);
  const [errors, setErrors] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [executionResults, setExecutionResults] = useState([]);
  const [executingIndex, setExecutingIndex] = useState(-1);
  const [enabledOps, setEnabledOps] = useState({});
  const [guideCopied, setGuideCopied] = useState(false);
  const textareaRef = useRef(null);

  const cardStyle = {
    background: theme.colors.cardBg,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '12px',
  };

  const buttonStyle = {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: '600',
    transition: 'all 0.15s',
  };

  // ---- Copy LLM Guide ----
  const handleCopyGuide = useCallback(() => {
    const guide = generateLLMGuide();
    navigator.clipboard.writeText(guide).then(() => {
      setGuideCopied(true);
      setTimeout(() => setGuideCopied(false), 2000);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = guide;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setGuideCopied(true);
      setTimeout(() => setGuideCopied(false), 2000);
    });
  }, []);

  // ---- Export ----
  const handleExport = useCallback(async () => {
    setExporting(true);
    setParseError(null);
    setErrors([]);
    try {
      const bot = await getReadyBotActor();
      const text = await serializeBotState(bot);
      setEditorText(text);
      setMode('editor');
    } catch (e) {
      setParseError(`Export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }, [getReadyBotActor]);

  // ---- Parse & Resolve ----
  const handleParse = useCallback(async () => {
    setParsing(true);
    setParseError(null);
    setErrors([]);
    setOperations([]);
    try {
      const ast = parseDSL(editorText);
      const bot = await getReadyBotActor();
      const { operations: ops, errors: errs } = await resolveOperations(ast, bot);
      setOperations(ops);
      setErrors(errs);

      const initialEnabled = {};
      ops.forEach((op, i) => { initialEnabled[i] = op.type === 'call'; });
      setEnabledOps(initialEnabled);
      setMode('review');
    } catch (e) {
      if (e instanceof TokenizerError || e instanceof ParseError) {
        setParseError(`Parse error: ${e.message}`);
      } else if (e instanceof ResolverError) {
        setParseError(`Resolve error: ${e.message}`);
      } else {
        setParseError(`Error: ${e.message}`);
      }
    } finally {
      setParsing(false);
    }
  }, [editorText, getReadyBotActor]);

  // ---- Execute ----
  const handleExecute = useCallback(async () => {
    setMode('executing');
    const results = [];
    const toExecute = operations.filter((op, i) => enabledOps[i] && op.type === 'call');

    for (let i = 0; i < toExecute.length; i++) {
      const op = toExecute[i];
      const globalIdx = operations.indexOf(op);
      setExecutingIndex(globalIdx);
      try {
        const bot = await getReadyBotActor();
        const method = bot[op.method];
        if (!method) throw new Error(`Unknown method: ${op.method}`);
        const result = await method(...op.args);
        results.push({ index: globalIdx, success: true, result: String(result ?? 'OK') });
      } catch (e) {
        results.push({ index: globalIdx, success: false, error: e.message });
      }
      setExecutionResults([...results]);
    }
    setExecutingIndex(-1);
  }, [operations, enabledOps, getReadyBotActor]);

  const handleBackToEditor = () => {
    setMode('editor');
    setOperations([]);
    setErrors([]);
    setExecutionResults([]);
    setExecutingIndex(-1);
  };

  const toggleOp = (idx) => {
    setEnabledOps(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const enabledCount = Object.values(enabledOps).filter(Boolean).length;
  const callOps = operations.filter(op => op.type === 'call');
  const noopOps = operations.filter(op => op.type === 'no-op');

  // Group operations by category
  const grouped = {};
  operations.forEach((op, idx) => {
    const cat = op.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ op, idx });
  });

  return (
    <div style={{ marginTop: '12px' }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div>
            <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '1rem', fontWeight: '600' }}>
              SneedScript DSL
            </h3>
            <p style={{ color: theme.colors.secondaryText, fontSize: '0.8rem', margin: '4px 0 0 0' }}>
              Export bot state, write configuration programs, and apply changes.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {mode === 'editor' && (
              <>
                <button
                  onClick={handleCopyGuide}
                  style={{
                    ...buttonStyle,
                    background: guideCopied ? '#f0fdf4' : `${theme.colors.border}20`,
                    color: guideCopied ? '#16a34a' : theme.colors.secondaryText,
                    border: `1px solid ${guideCopied ? '#86efac' : theme.colors.border}`,
                  }}
                >
                  {guideCopied ? 'Copied!' : 'Copy LLM Guide'}
                </button>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  style={{
                    ...buttonStyle,
                    background: `${accentColor}15`,
                    color: accentColor,
                    border: `1px solid ${accentColor}30`,
                    opacity: exporting ? 0.6 : 1,
                  }}
                >
                  {exporting ? 'Exporting...' : 'Export State'}
                </button>
                <button
                  onClick={handleParse}
                  disabled={parsing || !editorText.trim()}
                  style={{
                    ...buttonStyle,
                    background: accentColor,
                    color: '#fff',
                    opacity: (parsing || !editorText.trim()) ? 0.5 : 1,
                  }}
                >
                  {parsing ? 'Parsing...' : 'Parse & Resolve'}
                </button>
              </>
            )}
            {(mode === 'review' || mode === 'executing') && (
              <button
                onClick={handleBackToEditor}
                style={{
                  ...buttonStyle,
                  background: `${accentColor}15`,
                  color: accentColor,
                  border: `1px solid ${accentColor}30`,
                }}
              >
                Back to Editor
              </button>
            )}
          </div>
        </div>

        {parseError && (
          <div style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: '6px',
            padding: '10px 14px',
            marginBottom: '12px',
            color: '#dc2626',
            fontSize: '0.85rem',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
          }}>
            {parseError}
          </div>
        )}

        {/* Editor */}
        {mode === 'editor' && (
          <div style={{ position: 'relative' }}>
            <textarea
              ref={textareaRef}
              value={editorText}
              onChange={(e) => setEditorText(e.target.value)}
              placeholder={`# Paste exported bot state or write DSL commands here\n# Example:\n\nensure token ICP {\n  ledger: "ryjl3-tyaaa-aaaaa-aaaba-cai"\n  symbol: "ICP"\n  decimals: 8\n  fee: 0.0001 ICP\n}\n\nset chore "trade-1" status: running`}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: '400px',
                maxHeight: '700px',
                resize: 'vertical',
                background: theme.colors.bg,
                color: theme.colors.primaryText,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: '6px',
                padding: '12px',
                fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
                fontSize: '0.82rem',
                lineHeight: '1.6',
                tabSize: 2,
                boxSizing: 'border-box',
                outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const start = e.target.selectionStart;
                  const end = e.target.selectionEnd;
                  const val = e.target.value;
                  setEditorText(val.substring(0, start) + '  ' + val.substring(end));
                  setTimeout(() => {
                    e.target.selectionStart = e.target.selectionEnd = start + 2;
                  }, 0);
                }
              }}
            />
            <div style={{
              position: 'absolute',
              bottom: '8px',
              right: '12px',
              color: theme.colors.secondaryText,
              fontSize: '0.75rem',
              opacity: 0.6,
            }}>
              {editorText.split('\n').length} lines
            </div>
          </div>
        )}

        {/* Operation Review */}
        {(mode === 'review' || mode === 'executing') && (
          <div>
            {errors.length > 0 && (
              <div style={{
                background: '#fef3c7',
                border: '1px solid #fbbf24',
                borderRadius: '6px',
                padding: '10px 14px',
                marginBottom: '12px',
              }}>
                <div style={{ fontWeight: '600', color: '#92400e', fontSize: '0.85rem', marginBottom: '4px' }}>
                  Resolver Warnings ({errors.length})
                </div>
                {errors.map((err, i) => (
                  <div key={i} style={{ color: '#92400e', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                    Line {err.line}: {err.message}
                  </div>
                ))}
              </div>
            )}

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: '12px', padding: '8px 12px',
              background: `${accentColor}08`, borderRadius: '6px',
              border: `1px solid ${accentColor}20`,
            }}>
              <div style={{ color: theme.colors.primaryText, fontSize: '0.85rem' }}>
                <strong>{callOps.length}</strong> operation{callOps.length !== 1 ? 's' : ''} to execute
                {noopOps.length > 0 && <span style={{ color: theme.colors.secondaryText }}> ({noopOps.length} already up to date)</span>}
              </div>
              {mode === 'review' && callOps.length > 0 && (
                <button
                  onClick={handleExecute}
                  style={{
                    ...buttonStyle,
                    background: accentColor,
                    color: '#fff',
                  }}
                >
                  Execute {enabledCount} Operation{enabledCount !== 1 ? 's' : ''}
                </button>
              )}
            </div>

            {CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => (
              <div key={cat} style={{ marginBottom: '16px' }}>
                <div style={{
                  fontSize: '0.8rem', fontWeight: '600',
                  color: accentColor, textTransform: 'uppercase',
                  letterSpacing: '0.05em', marginBottom: '6px', paddingLeft: '2px',
                }}>
                  {CATEGORY_LABELS[cat] || cat}
                </div>
                {grouped[cat].map(({ op, idx }) => {
                  const isCall = op.type === 'call';
                  const isEnabled = enabledOps[idx];
                  const execResult = executionResults.find(r => r.index === idx);
                  const isExecuting = executingIndex === idx;

                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '8px 12px', marginBottom: '4px',
                        background: isCall
                          ? (execResult ? (execResult.success ? '#f0fdf4' : '#fef2f2') : theme.colors.bg)
                          : `${theme.colors.bg}80`,
                        border: `1px solid ${isCall
                          ? (execResult ? (execResult.success ? '#86efac' : '#fca5a5') : theme.colors.border)
                          : `${theme.colors.border}60`}`,
                        borderRadius: '6px',
                        opacity: isCall ? 1 : 0.6,
                      }}
                    >
                      {isCall && mode === 'review' && (
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => toggleOp(idx)}
                          style={{ accentColor, width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                      )}
                      {isExecuting && <span style={{ fontSize: '0.85rem' }}>&#x23F3;</span>}
                      {execResult && (
                        <span style={{ fontSize: '0.85rem' }}>
                          {execResult.success ? '\u2705' : '\u274C'}
                        </span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          color: theme.colors.primaryText,
                          fontSize: '0.85rem',
                          fontWeight: isCall ? '500' : '400',
                        }}>
                          {op.description}
                        </div>
                        {isCall && (
                          <div style={{
                            color: theme.colors.secondaryText,
                            fontSize: '0.75rem',
                            fontFamily: 'monospace',
                            marginTop: '2px',
                          }}>
                            {op.method}({op.args.length > 0 ? '...' : ''})
                          </div>
                        )}
                        {execResult && !execResult.success && (
                          <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: '4px', fontFamily: 'monospace' }}>
                            {execResult.error}
                          </div>
                        )}
                      </div>
                      {!isCall && (
                        <span style={{
                          fontSize: '0.75rem',
                          color: theme.colors.secondaryText,
                          padding: '2px 8px',
                          background: `${theme.colors.border}40`,
                          borderRadius: '4px',
                        }}>
                          no-op
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {mode === 'executing' && executingIndex === -1 && executionResults.length > 0 && (
              <div style={{
                padding: '12px 16px',
                background: executionResults.every(r => r.success) ? '#f0fdf4' : '#fef3c7',
                border: `1px solid ${executionResults.every(r => r.success) ? '#86efac' : '#fbbf24'}`,
                borderRadius: '6px',
                marginTop: '12px',
              }}>
                <div style={{ fontWeight: '600', fontSize: '0.9rem', color: theme.colors.primaryText }}>
                  Execution Complete
                </div>
                <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, marginTop: '4px' }}>
                  {executionResults.filter(r => r.success).length} succeeded,{' '}
                  {executionResults.filter(r => !r.success).length} failed
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
