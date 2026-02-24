import React, { useState, useCallback, useRef } from 'react';
import { parseDSL, TokenizerError, ParseError } from '../dsl/parser';
import { serializeBotState } from '../dsl/serializer';
import { resolveOperations, ResolverError } from '../dsl/resolver';
import { generateLLMGuide } from '../dsl/llm-guide';
import { formatTokenRegistry, formatTradeLog, formatBotLog, formatCBLog } from '../dsl/context-formatters';

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

// ---- Clipboard utility ----
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

const BTN_BASE = {
  padding: '8px 16px',
  borderRadius: '6px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: '600',
  transition: 'all 0.15s',
};

// ---- Reusable hook: DSL engine state + handlers ----
export function useDSLEngine(getReadyBotActor) {
  const [editorText, setEditorText] = useState('');
  const [mode, setMode] = useState('editor');
  const [operations, setOperations] = useState([]);
  const [errors, setErrors] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [executionResults, setExecutionResults] = useState([]);
  const [executingIndex, setExecutingIndex] = useState(-1);
  const [enabledOps, setEnabledOps] = useState({});

  const handleExport = useCallback(async () => {
    setExporting(true);
    setParseError(null);
    setErrors([]);
    try {
      const bot = await getReadyBotActor();
      const text = await serializeBotState(bot);
      setEditorText(text);
      setMode('editor');
      copyToClipboard(text);
      return text;
    } catch (e) {
      setParseError(`Export failed: ${e.message}`);
      return null;
    } finally {
      setExporting(false);
    }
  }, [getReadyBotActor]);

  const handleParse = useCallback(async (textOverride) => {
    const text = textOverride ?? editorText;
    setParsing(true);
    setParseError(null);
    setErrors([]);
    setOperations([]);
    try {
      const ast = parseDSL(text);
      const bot = await getReadyBotActor();
      const { operations: ops, errors: errs } = await resolveOperations(ast, bot);
      setOperations(ops);
      setErrors(errs);

      const initialEnabled = {};
      ops.forEach((op, i) => { initialEnabled[i] = op.type === 'call'; });
      setEnabledOps(initialEnabled);
      setMode('review');
      return { ops, errs };
    } catch (e) {
      if (e instanceof TokenizerError || e instanceof ParseError) {
        setParseError(`Parse error: ${e.message}`);
      } else if (e instanceof ResolverError) {
        setParseError(`Resolve error: ${e.message}`);
      } else {
        setParseError(`Error: ${e.message}`);
      }
      return null;
    } finally {
      setParsing(false);
    }
  }, [editorText, getReadyBotActor]);

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

  const handleBackToEditor = useCallback(() => {
    setMode('editor');
    setOperations([]);
    setErrors([]);
    setExecutionResults([]);
    setExecutingIndex(-1);
  }, []);

  const toggleOp = useCallback((idx) => {
    setEnabledOps(prev => ({ ...prev, [idx]: !prev[idx] }));
  }, []);

  const resetAll = useCallback(() => {
    setEditorText('');
    setMode('editor');
    setOperations([]);
    setErrors([]);
    setParseError(null);
    setExecutionResults([]);
    setExecutingIndex(-1);
    setEnabledOps({});
  }, []);

  const enabledCount = Object.values(enabledOps).filter(Boolean).length;
  const callOps = operations.filter(op => op.type === 'call');
  const noopOps = operations.filter(op => op.type === 'no-op');

  return {
    editorText, setEditorText,
    mode, setMode,
    operations, errors, parseError, setParseError,
    exporting, parsing,
    executionResults, executingIndex,
    enabledOps, enabledCount,
    callOps, noopOps,
    handleExport, handleParse, handleExecute,
    handleBackToEditor, toggleOp, resetAll,
  };
}

// ---- Reusable: Script editor textarea ----
export function DSLScriptEditor({ editorText, setEditorText, theme, minHeight = '400px', placeholder }) {
  const textareaRef = useRef(null);
  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={textareaRef}
        value={editorText}
        onChange={(e) => setEditorText(e.target.value)}
        placeholder={placeholder || `# Paste exported bot state or write DSL commands here\n# Example:\n\nensure token ICP {\n  ledger: "ryjl3-tyaaa-aaaaa-aaaba-cai"\n  symbol: "ICP"\n  decimals: 8\n  fee: 0.0001 ICP\n}\n\nset chore "trade-1" status: running`}
        spellCheck={false}
        style={{
          width: '100%',
          minHeight,
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
  );
}

// ---- Reusable: Operation review/execute list ----
export function DSLOperationReview({
  operations, errors, enabledOps, toggleOp,
  executionResults, executingIndex,
  mode, handleExecute, enabledCount,
  callOps, noopOps,
  theme, accentColor,
}) {
  const grouped = {};
  operations.forEach((op, idx) => {
    const cat = op.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ op, idx });
  });

  return (
    <div>
      {errors.length > 0 && (
        <div style={{
          background: '#f59e0b15',
          border: '1px solid #f59e0b40',
          borderRadius: '6px',
          padding: '10px 14px',
          marginBottom: '12px',
        }}>
          <div style={{ fontWeight: '600', color: '#fbbf24', fontSize: '0.85rem', marginBottom: '4px' }}>
            Resolver Warnings ({errors.length})
          </div>
          {errors.map((err, i) => (
            <div key={i} style={{ color: '#fbbf24', fontSize: '0.8rem', fontFamily: 'monospace' }}>
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
              ...BTN_BASE,
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

            const successBg = `${accentColor}15`;
            const successBorder = `${accentColor}40`;
            const failBg = '#dc262615';
            const failBorder = '#dc262640';

            return (
              <div
                key={idx}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 12px', marginBottom: '4px',
                  background: isCall
                    ? (execResult ? (execResult.success ? successBg : failBg) : theme.colors.bg)
                    : `${theme.colors.bg}80`,
                  border: `1px solid ${isCall
                    ? (execResult ? (execResult.success ? successBorder : failBorder) : theme.colors.border)
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
                    <div style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '4px', fontFamily: 'monospace' }}>
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
          background: executionResults.every(r => r.success) ? `${accentColor}15` : '#f59e0b15',
          border: `1px solid ${executionResults.every(r => r.success) ? `${accentColor}40` : '#f59e0b40'}`,
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
  );
}

// ---- Reusable: LLM Context copy bar ----
export function DSLContextBar({ getReadyBotActor, theme, accentColor, setParseError }) {
  const [contextOpen, setContextOpen] = useState(false);
  const [contextStatus, setContextStatus] = useState({});

  const handleCopyContext = useCallback(async (key, fetchFn) => {
    setContextStatus(prev => ({ ...prev, [key]: 'copying' }));
    try {
      const bot = await getReadyBotActor();
      const text = await fetchFn(bot);
      copyToClipboard(text);
      setContextStatus(prev => ({ ...prev, [key]: 'copied' }));
      setTimeout(() => setContextStatus(prev => ({ ...prev, [key]: null })), 2000);
    } catch (e) {
      setContextStatus(prev => ({ ...prev, [key]: null }));
      if (setParseError) setParseError(`Copy failed: ${e.message}`);
    }
  }, [getReadyBotActor, setParseError]);

  return (
    <div style={{ marginBottom: '12px' }}>
      <button
        onClick={() => setContextOpen(prev => !prev)}
        style={{
          ...BTN_BASE,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: `${accentColor}08`,
          color: theme.colors.secondaryText,
          border: `1px solid ${theme.colors.border}`,
          padding: '8px 14px',
          fontSize: '0.8rem',
          fontWeight: '500',
        }}
      >
        <span>LLM Context — copy supplementary data for your AI</span>
        <span style={{ fontSize: '0.7rem' }}>{contextOpen ? '\u25B2' : '\u25BC'}</span>
      </button>
      {contextOpen && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '8px',
          padding: '10px 14px',
          background: theme.colors.bg,
          border: `1px solid ${theme.colors.border}`,
          borderTop: 'none',
          borderRadius: '0 0 6px 6px',
        }}>
          {[
            { key: 'tokens', label: 'All Tokens', fn: formatTokenRegistry },
            { key: 'tradeLog', label: 'Trade Log (50)', fn: (bot) => formatTradeLog(bot, 50) },
            { key: 'botLog', label: 'Bot Log (50)', fn: (bot) => formatBotLog(bot, 50) },
            { key: 'cbLog', label: 'CB Log (20)', fn: (bot) => formatCBLog(bot, 20) },
          ].map(({ key, label, fn }) => {
            const status = contextStatus[key];
            return (
              <button
                key={key}
                onClick={() => handleCopyContext(key, fn)}
                disabled={status === 'copying'}
                style={{
                  ...BTN_BASE,
                  padding: '6px 12px',
                  fontSize: '0.78rem',
                  fontWeight: '500',
                  background: status === 'copied' ? `${accentColor}25` : `${accentColor}10`,
                  color: status === 'copied' ? accentColor : theme.colors.secondaryText,
                  border: `1px solid ${status === 'copied' ? accentColor : theme.colors.border}`,
                  opacity: status === 'copying' ? 0.6 : 1,
                }}
              >
                {status === 'copying' ? 'Copying...' : status === 'copied' ? 'Copied!' : `Copy ${label}`}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Reusable: Copy LLM Guide button ----
export function DSLCopyGuideButton({ theme, accentColor }) {
  const [guideCopied, setGuideCopied] = useState(false);
  const handleCopyGuide = useCallback(() => {
    copyToClipboard(generateLLMGuide());
    setGuideCopied(true);
    setTimeout(() => setGuideCopied(false), 2000);
  }, []);

  return (
    <button
      onClick={handleCopyGuide}
      style={{
        ...BTN_BASE,
        background: guideCopied ? `${accentColor}25` : `${accentColor}10`,
        color: guideCopied ? accentColor : theme.colors.secondaryText,
        border: `1px solid ${guideCopied ? accentColor : theme.colors.border}`,
      }}
    >
      {guideCopied ? 'Copied!' : 'Copy LLM Guide'}
    </button>
  );
}

// ---- Reusable: Export State button ----
export function DSLExportButton({ onExport, exporting, theme, accentColor, label }) {
  return (
    <button
      onClick={onExport}
      disabled={exporting}
      style={{
        ...BTN_BASE,
        background: `${accentColor}15`,
        color: accentColor,
        border: `1px solid ${accentColor}30`,
        opacity: exporting ? 0.6 : 1,
      }}
    >
      {exporting ? 'Exporting...' : (label || 'Export State')}
    </button>
  );
}

// ---- Full DSL Panel (Script tab) ----
export default function TradingBotDSLPanel({ canisterId, getReadyBotActor, theme, accentColor }) {
  const engine = useDSLEngine(getReadyBotActor);
  const [guideCopied, setGuideCopied] = useState(false);

  const handleCopyGuide = useCallback(() => {
    copyToClipboard(generateLLMGuide());
    setGuideCopied(true);
    setTimeout(() => setGuideCopied(false), 2000);
  }, []);

  const cardStyle = {
    background: theme.colors.cardBg,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '12px',
  };

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
            {engine.mode === 'editor' && (
              <>
                <button
                  onClick={handleCopyGuide}
                  style={{
                    ...BTN_BASE,
                    background: guideCopied ? `${accentColor}25` : `${accentColor}10`,
                    color: guideCopied ? accentColor : theme.colors.secondaryText,
                    border: `1px solid ${guideCopied ? accentColor : theme.colors.border}`,
                  }}
                >
                  {guideCopied ? 'Copied!' : 'Copy LLM Guide'}
                </button>
                <DSLExportButton onExport={engine.handleExport} exporting={engine.exporting} theme={theme} accentColor={accentColor} />
                <button
                  onClick={() => engine.handleParse()}
                  disabled={engine.parsing || !engine.editorText.trim()}
                  style={{
                    ...BTN_BASE,
                    background: accentColor,
                    color: '#fff',
                    opacity: (engine.parsing || !engine.editorText.trim()) ? 0.5 : 1,
                  }}
                >
                  {engine.parsing ? 'Parsing...' : 'Parse & Resolve'}
                </button>
              </>
            )}
            {(engine.mode === 'review' || engine.mode === 'executing') && (
              <button
                onClick={engine.handleBackToEditor}
                style={{
                  ...BTN_BASE,
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

        {engine.parseError && (
          <div style={{
            background: '#dc262615',
            border: '1px solid #dc262640',
            borderRadius: '6px',
            padding: '10px 14px',
            marginBottom: '12px',
            color: '#f87171',
            fontSize: '0.85rem',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
          }}>
            {engine.parseError}
          </div>
        )}

        {engine.mode === 'editor' && (
          <>
            <DSLContextBar getReadyBotActor={getReadyBotActor} theme={theme} accentColor={accentColor} setParseError={engine.setParseError} />
            <DSLScriptEditor editorText={engine.editorText} setEditorText={engine.setEditorText} theme={theme} />
          </>
        )}

        {(engine.mode === 'review' || engine.mode === 'executing') && (
          <DSLOperationReview
            operations={engine.operations}
            errors={engine.errors}
            enabledOps={engine.enabledOps}
            toggleOp={engine.toggleOp}
            executionResults={engine.executionResults}
            executingIndex={engine.executingIndex}
            mode={engine.mode}
            handleExecute={engine.handleExecute}
            enabledCount={engine.enabledCount}
            callOps={engine.callOps}
            noopOps={engine.noopOps}
            theme={theme}
            accentColor={accentColor}
          />
        )}
      </div>
    </div>
  );
}
