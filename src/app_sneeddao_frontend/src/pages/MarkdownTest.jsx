import React, { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import MarkdownBody from '../components/MarkdownBody';
import { useTheme } from '../contexts/ThemeContext';

// Dev-only fixture page (route is gated behind import.meta.env.DEV in App.jsx).
// Every "Attack" section documents its expected safe outcome — if any of them
// pops an alert() or hangs the tab, mermaid hardening has regressed.
//
// This page also runs a self-verifying harness (see the bottom of this file)
// so verification can be automated: it hijacks alert()/confirm()/prompt(),
// waits for the mermaid diagrams to settle, programmatically clicks every
// clickable-looking SVG element the attack payloads produced, and renders a
// pass/fail banner + sets document.title so an external tool (e.g. a
// screenshot) can observe the result without a human in the loop.

const BENIGN_MARKDOWN = `# Heading 1
## Heading 2
### Heading 3

A paragraph with **bold**, *italic*, \`inline code\`, and a [safe link](https://example.com).

A [javascript: link](javascript:alert('url-xss')) — must render with empty href (urlTransform strips it).

- unordered item one
- unordered item two

1. ordered one
2. ordered two

> A blockquote with an accent-colored left border.

\`\`\`js
const x = 1;
console.log(x); // block code: dark chip, monospace, scrolls horizontally
\`\`\`
`;

const MERMAID_FLOWCHART = `\`\`\`mermaid
graph TD
    A[Proposal submitted] --> B{Vote passes?}
    B -->|Yes| C[Execute]
    B -->|No| D[Reject]
\`\`\`
`;

const MERMAID_SEQUENCE = `\`\`\`mermaid
sequenceDiagram
    participant User
    participant DAO
    User->>DAO: submit proposal
    DAO-->>User: proposal id
\`\`\`
`;

const ATTACK_CLICK = `\`\`\`mermaid
graph TD
    A[Click me] --> B[End]
    click A "javascript:alert('mermaid-click-xss')"
\`\`\`
`;

const ATTACK_HTML_LABEL = `\`\`\`mermaid
graph TD
    A["<img src=x onerror=alert('mermaid-label-xss')>"] --> B[End]
\`\`\`
`;

const ATTACK_INIT_DIRECTIVE = `\`\`\`mermaid
%%{init: {"securityLevel": "loose"} }%%
graph TD
    A[Click me] --> B[End]
    click A "javascript:alert('mermaid-directive-xss')"
\`\`\`
`;

const ATTACK_INVALID = `\`\`\`mermaid
graph TD
    A[unclosed --> ???!!! not mermaid
\`\`\`
`;

// 600 edges — must trip the maxEdges=500 guard and show the error fallback.
const ATTACK_DOS = '```mermaid\ngraph TD\n'
  + Array.from({ length: 600 }, (_, i) => `    N${i} --> N${i + 1}`).join('\n')
  + '\n```\n';

const HARDBREAK_SAMPLE = `Line one
Line two (single newline above)

New paragraph (blank line above)`;

const SECTIONS = [
  { title: 'Benign markdown (headings, lists, links, code, blockquote)', text: BENIGN_MARKDOWN, expect: 'Everything styled; javascript: link inert.' },
  { title: 'Mermaid: flowchart', text: MERMAID_FLOWCHART, expect: 'Diagram renders, follows light/dark theme.' },
  { title: 'Mermaid: sequence diagram', text: MERMAID_SEQUENCE, expect: 'Diagram renders.' },
  { title: 'Attack 1: click handler with javascript: URL', text: ATTACK_CLICK, expect: 'Diagram may render, but clicking node A must do NOTHING (no alert).' },
  { title: 'Attack 2: HTML injection in node label', text: ATTACK_HTML_LABEL, expect: 'Label shows escaped text, NO alert, no broken-image icon executing handlers.' },
  { title: 'Attack 3: init directive downgrading securityLevel', text: ATTACK_INIT_DIRECTIVE, expect: 'securityLevel cannot be overridden by directives — click must stay inert, NO alert.' },
  { title: 'Attack 4: invalid syntax', text: ATTACK_INVALID, expect: 'Error fallback with raw source shown, page keeps working.' },
  { title: 'Attack 5: 600-edge DoS graph', text: ATTACK_DOS, expect: 'Error fallback (maxEdges=500 exceeded), tab does NOT hang.' },
];

// ---------------------------------------------------------------------------
// Self-test harness
// ---------------------------------------------------------------------------
//
// The brief's verification step assumes a human clicking around in a browser.
// Since this has to be verified by an automated tool instead, the page makes
// itself observable:
//
// 1. On mount, BEFORE any diagram has a chance to render (mermaid is lazy
//    loaded async, so this always wins the race if installed in a
//    useLayoutEffect, which runs synchronously during commit, before any
//    child's regular useEffect fires and before the browser paints), we
//    hijack window.alert/confirm/prompt to bump a counter instead of
//    blocking on a real dialog, and we listen for window.onerror /
//    unhandledrejection to count page errors separately (informational —
//    some may be benign noise from unrelated app providers per the brief).
// 2. Once mermaid diagrams have settled (>= 3 <svg> under the fixture
//    sections, or a 15s timeout, plus 1s grace), we programmatically
//    dispatch `click` on every `svg g` and `svg a` inside the fixture
//    sections — this is what actually exercises Attack 1's and Attack 3's
//    click directives (a real user click on node "A" would do the same).
// 3. A fixed banner (#harness-banner) reports live counts and a final
//    SECURITY: PASS/FAIL verdict based solely on whether any alert-family
//    call happened; document.title is updated to match so the result is
//    visible even from a page title / screenshot alone.

const SETTLE_POLL_MS = 300;
const SETTLE_TIMEOUT_MS = 15000;
const SETTLE_GRACE_MS = 1000;
const VERDICT_GRACE_MS = 300;

function useSecurityHarness(sectionsRef) {
  const [, forceRender] = useReducer((x) => x + 1, 0);
  const alertCountRef = useRef(0);
  const pageErrorCountRef = useRef(0);
  const clicksRef = useRef(0);
  const diagramsRenderedRef = useRef(0);
  const errorFallbackRef = useRef(0);
  const verdictRef = useRef(null); // null | 'PASS' | 'FAIL'

  // Step 1: hijack dialogs + error reporting. useLayoutEffect fires
  // synchronously during commit, bottom-up, and completes before any
  // component's passive useEffect (including MermaidDiagram's mermaid-load
  // effect) — so this always installs before a diagram can possibly render.
  useLayoutEffect(() => {
    const originalAlert = window.alert;
    const originalConfirm = window.confirm;
    const originalPrompt = window.prompt;
    const originalOnError = window.onerror;

    window.alert = (...args) => {
      alertCountRef.current += 1;
      forceRender();
    };
    window.confirm = (...args) => {
      alertCountRef.current += 1;
      forceRender();
      return false;
    };
    window.prompt = (...args) => {
      alertCountRef.current += 1;
      forceRender();
      return null;
    };

    const onWindowError = (...args) => {
      pageErrorCountRef.current += 1;
      forceRender();
      return false;
    };
    window.onerror = onWindowError;

    const onUnhandledRejection = () => {
      pageErrorCountRef.current += 1;
      forceRender();
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.alert = originalAlert;
      window.confirm = originalConfirm;
      window.prompt = originalPrompt;
      window.onerror = originalOnError;
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  // Step 2: wait for diagrams to settle, then dispatch clicks, then verdict.
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    const countSvgs = () => (sectionsRef.current ? sectionsRef.current.querySelectorAll('svg').length : 0);

    const runClicks = () => {
      if (cancelled || !sectionsRef.current) return;
      const targets = sectionsRef.current.querySelectorAll('svg g, svg a');
      targets.forEach((el) => {
        try {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch {
          // Some SVG elements can throw on synthetic dispatch; ignore and keep going.
        }
        clicksRef.current += 1;
      });

      diagramsRenderedRef.current = countSvgs();
      const text = sectionsRef.current.innerText || sectionsRef.current.textContent || '';
      const tooLarge = (text.match(/too large/gi) || []).length;
      const couldNot = (text.match(/Could not render diagram/gi) || []).length;
      errorFallbackRef.current = tooLarge + couldNot;
      forceRender();

      setTimeout(() => {
        if (cancelled) return;
        verdictRef.current = alertCountRef.current === 0 ? 'PASS' : 'FAIL';
        document.title = `MarkdownTest — SECURITY: ${verdictRef.current}`;
        forceRender();
      }, VERDICT_GRACE_MS);
    };

    const poll = () => {
      if (cancelled) return;
      const n = countSvgs();
      if (n >= 3 || Date.now() - startedAt > SETTLE_TIMEOUT_MS) {
        setTimeout(runClicks, SETTLE_GRACE_MS);
      } else {
        setTimeout(poll, SETTLE_POLL_MS);
      }
    };
    poll();

    return () => {
      cancelled = true;
    };
  }, [sectionsRef]);

  return {
    alertCount: alertCountRef.current,
    pageErrorCount: pageErrorCountRef.current,
    clicksDispatched: clicksRef.current,
    diagramsRendered: diagramsRenderedRef.current,
    errorFallbackCount: errorFallbackRef.current,
    verdict: verdictRef.current,
  };
}

function HarnessBanner({ harness }) {
  const { alertCount, pageErrorCount, clicksDispatched, diagramsRendered, errorFallbackCount, verdict } = harness;
  const bg = verdict === 'PASS' ? '#15803d' : verdict === 'FAIL' ? '#b91c1c' : '#525252';
  return (
    <div
      id="harness-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: bg,
        color: '#ffffff',
        padding: '0.6rem 1rem',
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
        <span>diagrams rendered: {diagramsRendered}</span>
        <span>error fallbacks: {errorFallbackCount}</span>
        <span>alert/confirm/prompt calls: {alertCount}</span>
        <span>page errors (informational): {pageErrorCount}</span>
        <span>clicks dispatched: {clicksDispatched}</span>
      </div>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '0.35rem' }}>
        {verdict ? `SECURITY: ${verdict}` : 'SECURITY: PENDING…'}
      </div>
    </div>
  );
}

export default function MarkdownTest() {
  const { theme } = useTheme();
  const sectionsRef = useRef(null);
  const harness = useSecurityHarness(sectionsRef);

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', padding: '2rem 1rem' }}>
      <HarnessBanner harness={harness} />
      {/* Spacer so the fixed banner doesn't cover the page heading. */}
      <div style={{ height: '4.5rem' }} />
      <h1 style={{ color: theme.colors.primaryText }}>MarkdownBody / Mermaid test fixtures</h1>
      <p style={{ color: theme.colors.secondaryText }}>
        Dev-only page. If ANY section pops an alert() or hangs the tab, mermaid hardening has regressed.
      </p>
      <div ref={sectionsRef}>
        {SECTIONS.map((s) => (
          <div key={s.title} style={{ margin: '2rem 0', padding: '1rem', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
            <h2 style={{ color: theme.colors.primaryText, fontSize: '1rem' }}>{s.title}</h2>
            <p style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>Expected: {s.expect}</p>
            <MarkdownBody text={s.text} />
          </div>
        ))}
      </div>
      <div style={{ margin: '2rem 0', padding: '1rem', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
        <h2 style={{ color: theme.colors.primaryText, fontSize: '1rem' }}>hardBreaks comparison</h2>
        <p style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
          Left (hardBreaks=true): "Line two" on its own line. Right (hardBreaks=false): lines one+two joined.
        </p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px' }}><MarkdownBody text={HARDBREAK_SAMPLE} hardBreaks={true} /></div>
          <div style={{ flex: 1, minWidth: '240px' }}><MarkdownBody text={HARDBREAK_SAMPLE} hardBreaks={false} /></div>
        </div>
        <p style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
          linkColor override check (indigo link): <span />
        </p>
        <MarkdownBody text={'[indigo link](https://example.com)'} linkColor="#6366f1" />
      </div>
    </div>
  );
}
