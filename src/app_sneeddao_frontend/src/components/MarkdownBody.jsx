import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useTheme } from '../contexts/ThemeContext';

function normalizeMarkdownInput(input) {
  const text = (input ?? '').toString().replace(/\r\n/g, '\n');

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

export default function MarkdownBody({ text, style }) {
  const { theme } = useTheme();
  const content = useMemo(() => normalizeMarkdownInput(text), [text]);

  return (
    <div style={{ color: theme.colors.primaryText, lineHeight: '1.5', ...style }}>
      <ReactMarkdown
        urlTransform={safeUrlTransform}
        components={{
          p: (props) => <p style={{ margin: '0 0 10px 0' }} {...props} />,
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: theme.colors.accent, textDecoration: 'underline' }}
              {...props}
            >
              {children}
            </a>
          ),
          code: ({ inline, children, ...props }) => (
            <code
              style={{
                backgroundColor: 'rgba(0,0,0,0.25)',
                padding: inline ? '1px 4px' : '10px',
                borderRadius: '6px',
                display: inline ? 'inline' : 'block',
                overflowX: 'auto'
              }}
              {...props}
            >
              {children}
            </code>
          ),
          li: (props) => <li style={{ marginBottom: '4px' }} {...props} />
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

