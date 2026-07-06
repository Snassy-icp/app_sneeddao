import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useTheme } from '../contexts/ThemeContext';
import MermaidDiagram from './MermaidDiagram';

// Convert HTML line breaks ("<br>", "<br/>", "<br />") into markdown paragraph
// breaks. Proposal summaries from SNS/NNS APIs sometimes contain them, and
// react-markdown (without rehype-raw) drops raw HTML nodes entirely.
export function convertHtmlBreaks(text) {
  if (!text) return '';
  return text.toString().replace(/<br\s*\/?>/gi, '\n\n');
}

function normalizeMarkdownInput(input, hardBreaks) {
  const text = (input ?? '').toString().replace(/\r\n/g, '\n');
  if (!hardBreaks) return text;

  // Preserve today's behavior (whiteSpace: pre-wrap) where single newlines show up as line breaks.
  // But keep *blank lines* as paragraph breaks.
  //
  // Strategy:
  // - Temporarily replace runs of 2+ newlines with a sentinel
  // - Convert remaining single newlines to hard-break markdown ("  \n")
  // - Restore paragraph breaks
  const PARA = '\u0000__PARA__\u0000';
  const withParas = text.replace(/\n{2,}/g, (m) => PARA.repeat(m.length));
  const withHardBreaks = withParas.replace(/\n/g, '  \n');
  return withHardBreaks.replace(new RegExp(PARA, 'g'), '\n');
}

function safeUrlTransform(url) {
  const u = (url ?? '').toString().trim();
  if (!u) return '';
  // Block JS/data/vbscript URLs.
  if (/^(javascript|data|vbscript):/i.test(u)) return '';
  return u;
}

// If this <pre> wraps a ```mermaid fence, return the diagram source, else null.
function extractMermaidSource(preNode) {
  const codeNode = (preNode?.children || []).find((child) => child.tagName === 'code');
  const classNames = codeNode?.properties?.className;
  const classList = Array.isArray(classNames) ? classNames : classNames ? [classNames] : [];
  if (!classList.includes('language-mermaid')) return null;
  return (codeNode.children || []).map((child) => child.value || '').join('');
}

export default function MarkdownBody({ text, style, linkColor, hardBreaks = true }) {
  const { theme, isDark } = useTheme();
  const content = useMemo(() => normalizeMarkdownInput(text, hardBreaks), [text, hardBreaks]);
  const accent = linkColor || theme.colors.accent;
  const codeBg = isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.08)';

  return (
    <div style={{
      color: theme.colors.primaryText,
      lineHeight: '1.4',
      fontSize: '14px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      ...style
    }}>
      <ReactMarkdown
        urlTransform={safeUrlTransform}
        components={{
          p: (props) => <p style={{ margin: '0 0 8px 0', color: 'inherit' }} {...props} />,
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: accent, textDecoration: 'underline', wordBreak: 'break-word' }}
              {...props}
            >
              {children}
            </a>
          ),
          h1: (props) => <h1 style={{ fontSize: '1.2rem', fontWeight: '700', color: 'inherit', margin: '1rem 0 0.5rem 0' }} {...props} />,
          h2: (props) => <h2 style={{ fontSize: '1.1rem', fontWeight: '600', color: 'inherit', margin: '0.75rem 0 0.5rem 0' }} {...props} />,
          h3: (props) => <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'inherit', margin: '0.5rem 0 0.25rem 0' }} {...props} />,
          ul: (props) => <ul style={{ paddingLeft: '1.5rem', margin: '0.5rem 0' }} {...props} />,
          ol: (props) => <ol style={{ paddingLeft: '1.5rem', margin: '0.5rem 0' }} {...props} />,
          li: (props) => <li style={{ marginBottom: '2px', color: 'inherit' }} {...props} />,
          blockquote: (props) => (
            <blockquote
              style={{
                borderLeft: `3px solid ${accent}`,
                paddingLeft: '1rem',
                margin: '0.75rem 0',
                color: theme.colors.secondaryText
              }}
              {...props}
            />
          ),
          pre: ({ node, children, ...props }) => {
            const mermaidSource = extractMermaidSource(node);
            if (mermaidSource !== null) {
              return <MermaidDiagram code={mermaidSource} />;
            }
            return (
              <pre
                style={{
                  backgroundColor: codeBg,
                  padding: '10px',
                  borderRadius: '6px',
                  overflowX: 'auto',
                  margin: '0 0 8px 0'
                }}
                {...props}
              >
                {children}
              </pre>
            );
          },
          code: ({ className, children, ...props }) => {
            // react-markdown v10 no longer passes an `inline` prop. Fenced/indented
            // code has a language-* class or embedded newlines (and is wrapped in
            // <pre>, which carries the block styling above).
            const isBlock = /\blanguage-/.test(className || '') || String(children).includes('\n');
            return (
              <code
                className={className}
                style={isBlock ? {
                  color: theme.colors.primaryText,
                  fontFamily: 'monospace',
                  fontSize: '0.9em'
                } : {
                  backgroundColor: codeBg,
                  color: theme.colors.primaryText,
                  padding: '1px 4px',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                  fontSize: '0.9em'
                }}
                {...props}
              >
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
