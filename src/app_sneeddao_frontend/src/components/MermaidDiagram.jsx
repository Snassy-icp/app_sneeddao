import React, { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

// Renders a ```mermaid fenced block from user-authored markdown.
//
// SECURITY: proposal/forum content is attacker-authored (anyone can submit an
// SNS/NNS proposal or forum post). Everything here assumes hostile input:
// - securityLevel 'strict' disables click handlers, escapes HTML in labels,
//   and mermaid DOMPurify-sanitizes its own SVG output. Never change this to
//   'loose' or 'antiscript' for user content.
// - bindFunctions from mermaid.render() is deliberately NOT called — it would
//   attach interaction handlers.
// - maxTextSize/maxEdges plus the source-length gate below bound layout work
//   so a pathological graph can't hang the main thread.
// - The site CSP (script-src without 'unsafe-inline') is the backstop if a
//   malicious SVG ever slipped through mermaid's sanitizer.
const MAX_SOURCE_CHARS = 50000;
const MAX_EDGES = 500;

let mermaidPromise = null;
function loadMermaid() {
  // Lazy singleton: mermaid is a ~0.5MB+ dependency; fetch it only when a
  // diagram is actually rendered, and only once per page lifetime.
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default);
  }
  return mermaidPromise;
}

export default function MermaidDiagram({ code }) {
  const { theme, isDark } = useTheme();
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  // useId is stable per instance; strip non-alphanumerics (useId contains
  // colons) because mermaid uses this id inside CSS selectors.
  const idBase = 'mmd' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const runSeq = useRef(0);

  // MarkdownBody's hard-break normalization appends trailing "  " to lines
  // inside fenced blocks too; strip it so it never reaches the parser.
  const source = (code ?? '').replace(/[ \t]+$/gm, '').trim();

  useEffect(() => {
    if (containerRef.current) containerRef.current.innerHTML = '';
    if (!source) return undefined;
    if (source.length > MAX_SOURCE_CHARS) {
      setError('Diagram source too large to render');
      return undefined;
    }
    let cancelled = false;
    // Unique per render run (not just per instance): if source/isDark change
    // while a previous mermaid.render() is still in flight, the two runs must
    // not share a temp-element id, or one run's cleanup can delete the other
    // run's in-flight scratch element.
    const renderId = idBase + (runSeq.current += 1);
    setError(null);
    loadMermaid()
      .then((mermaid) => {
        // initialize() writes global config; safe because every caller uses identical
        // security/caps and isDark is page-global.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'default',
          maxTextSize: MAX_SOURCE_CHARS,
          maxEdges: MAX_EDGES,
        });
        return mermaid.render(renderId, source);
      })
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch(() => {
        // mermaid can leave its temporary render element behind on parse errors
        document.getElementById('d' + renderId)?.remove();
        if (!cancelled) setError('Could not render diagram');
      });
    return () => { cancelled = true; };
  }, [source, isDark, idBase]);

  return (
    <div style={{ margin: '0 0 8px 0' }}>
      {error && (
        <div>
          <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '4px' }}>
            {error}
          </div>
          <pre style={{
            backgroundColor: isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.08)',
            color: theme.colors.primaryText,
            padding: '10px',
            borderRadius: '6px',
            overflowX: 'auto',
            margin: 0,
            fontFamily: 'monospace',
            fontSize: '0.9em'
          }}>{source}</pre>
        </div>
      )}
      <div ref={containerRef} style={{ overflowX: 'auto' }} />
    </div>
  );
}
