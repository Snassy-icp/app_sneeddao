import React from 'react';
import { useSearchParams } from 'react-router-dom';
import SwapWidget from '../components/SwapWidget';

/**
 * /swap page — Full-page swap interface.
 *
 * Supports URL params:  ?input=<canisterId>&output=<canisterId>
 */
export default function Swap() {
  const [params] = useSearchParams();
  const initialInput = params.get('input') || '';
  const initialOutput = params.get('output') || '';

  return (
    <div style={{
      width: '100%',
      minHeight: '80vh',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: 40,
      paddingBottom: 40,
    }}>
      <SwapWidget initialInput={initialInput} initialOutput={initialOutput} />
    </div>
  );
}
