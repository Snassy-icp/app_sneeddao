import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import SwapWidget from './SwapWidget';

/**
 * SwapModal — Renders the SwapWidget in a portal overlay.
 *
 * Props:
 *   isOpen              - boolean
 *   onClose             - () => void
 *   initialInput        - optional initial input token canister ID
 *   initialOutput       - optional initial output token canister ID
 *   initialOutputAmount - optional target output amount (human-readable string)
 */
export default function SwapModal({ isOpen, onClose, initialInput, initialOutput, initialOutputAmount, onSwapComplete }) {
  // Lock body scroll while modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10500,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        background: 'var(--color-modalBg)',
        backdropFilter: 'blur(4px)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          margin: 'auto 0',
          animation: 'fadeInScale 0.2s ease-out',
        }}
      >
        <SwapWidget
          initialInput={initialInput}
          initialOutput={initialOutput}
          initialOutputAmount={initialOutputAmount}
          onClose={onClose}
          onSwapComplete={onSwapComplete}
        />
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>,
    document.body
  );
}
