import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import SwapWidget from '../components/SwapWidget';

/**
 * /swap page — Full-page swap interface.
 *
 * Supports URL params:  ?input=<canisterId>&output=<canisterId>
 */
export default function Swap() {
  const [params] = useSearchParams();
  const { theme } = useTheme();
  const initialInput = params.get('input') || '';
  const initialOutput = params.get('output') || '';

  return (
    <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
      <Header />
      <main style={{
        color: theme.colors.primaryText,
        width: '100%',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 40,
        paddingBottom: 40,
      }}>
        <SwapWidget initialInput={initialInput} initialOutput={initialOutput} />
      </main>
    </div>
  );
}
