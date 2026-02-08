import React from 'react';
import { createPortal } from 'react-dom';
import SwapWidget from './SwapWidget';

/**
 * SwapModal — Renders the SwapWidget in a portal overlay.
 *
 * Props:
 *   isOpen        - boolean
 *   onClose       - () => void
 *   initialInput  - optional initial input token canister ID
 *   initialOutput - optional initial output token canister ID
 */
export default function SwapModal({ isOpen, onClose, initialInput, initialOutput }) {
  if (!isOpen) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-modalBg)',
        backdropFilter: 'blur(4px)',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          animation: 'fadeInScale 0.2s ease-out',
        }}
      >
        <SwapWidget
          initialInput={initialInput}
          initialOutput={initialOutput}
          onClose={onClose}
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
