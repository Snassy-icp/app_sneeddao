import React, { useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useWalletOptional } from '../contexts/WalletContext';
import Header from '../components/Header';
import SwapWidget from '../components/SwapWidget';
import { FaExchangeAlt, FaHome, FaChevronRight } from 'react-icons/fa';

const swapPrimary = '#3498db';
const swapSecondary = '#8b5cf6';

const ICP_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const SNEED_CANISTER_ID = 'hvgxa-wqaaa-aaaaq-aacia-cai';

/**
 * /swap page — Full-page swap interface.
 *
 * Supports URL params:  ?input=<canisterId>&output=<canisterId>
 * Defaults: ICP as input, SNEED as output.
 */
export default function Swap() {
  const [params, setParams] = useSearchParams();
  const { theme } = useTheme();
  const walletContext = useWalletOptional();
  const initialInput = params.get('input') || ICP_CANISTER_ID;
  const initialOutput = params.get('output') || SNEED_CANISTER_ID;

  const handleSwapComplete = useCallback((inputTokenId, outputTokenId) => {
    const refreshFn = walletContext?.refreshTokenBalance;
    if (refreshFn) {
      if (inputTokenId) refreshFn(inputTokenId);
      if (outputTokenId) refreshFn(outputTokenId);
    }
  }, [walletContext]);

  const handleInputTokenChange = useCallback((tokenId) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (tokenId) next.set('input', tokenId);
      else next.delete('input');
      return next;
    }, { replace: true });
  }, [setParams]);

  const handleOutputTokenChange = useCallback((tokenId) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (tokenId) next.set('output', tokenId);
      else next.delete('output');
      return next;
    }, { replace: true });
  }, [setParams]);

  return (
    <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
      <Header />

      <style>{`
        .swap-hero-icon {
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .swap-hero-icon:hover {
          transform: scale(1.1) rotate(5deg);
          box-shadow: 0 8px 32px ${swapPrimary}60;
        }
        @media (max-width: 600px) {
          .swap-hero-section {
            padding: 1rem 1rem 0.75rem !important;
          }
          .swap-hero-title {
            font-size: 1.5rem !important;
          }
          .swap-hero-icon-box {
            width: 40px !important;
            height: 40px !important;
            border-radius: 12px !important;
          }
          .swap-widget-wrapper {
            padding: 1rem 0.5rem 2rem !important;
          }
        }
      `}</style>

      <main style={{ color: theme.colors.primaryText }}>
        {/* Hero Section */}
        <div
          className="swap-hero-section"
          style={{
            background: `linear-gradient(180deg, ${swapPrimary}12 0%, transparent 100%)`,
            borderBottom: `1px solid ${theme.colors.border}`,
            padding: '1.5rem 1.5rem 1rem',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Decorative glows */}
          <div style={{
            position: 'absolute',
            top: '-50%',
            right: '-10%',
            width: '400px',
            height: '400px',
            background: `radial-gradient(circle, ${swapPrimary}20 0%, transparent 70%)`,
            borderRadius: '50%',
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute',
            bottom: '-30%',
            left: '-5%',
            width: '300px',
            height: '300px',
            background: `radial-gradient(circle, ${swapSecondary}15 0%, transparent 70%)`,
            borderRadius: '50%',
            pointerEvents: 'none',
          }} />

          <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
            {/* Breadcrumb */}
            <nav style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1rem',
              fontSize: '0.85rem',
            }}>
              <Link to="/" style={{
                color: theme.colors.mutedText,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}>
                <FaHome size={12} /> Home
              </Link>
              <FaChevronRight size={10} style={{ color: theme.colors.mutedText }} />
              <Link to="/sneedex_offers" style={{
                color: theme.colors.mutedText,
                textDecoration: 'none',
              }}>
                Sneedex
              </Link>
              <FaChevronRight size={10} style={{ color: theme.colors.mutedText }} />
              <span style={{ color: swapPrimary, fontWeight: '600' }}>Swap</span>
            </nav>

            {/* Hero Content */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              marginBottom: '0.25rem',
            }}>
              {/* Icon and Title */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '0.35rem',
              }}>
                <div
                  className="swap-hero-icon swap-hero-icon-box"
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '14px',
                    background: `linear-gradient(135deg, ${swapPrimary}, ${swapSecondary})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: `0 4px 20px ${swapPrimary}40`,
                  }}
                >
                  <FaExchangeAlt size={22} color="white" />
                </div>
                <h1
                  className="swap-hero-title"
                  style={{
                    fontSize: 'clamp(1.5rem, 4vw, 2rem)',
                    fontWeight: '800',
                    margin: 0,
                    background: `linear-gradient(135deg, ${theme.colors.primaryText} 30%, ${swapPrimary})`,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  Sneedex Swap
                </h1>
              </div>

              <p style={{
                color: theme.colors.mutedText,
                fontSize: '0.9rem',
                margin: 0,
                maxWidth: '500px',
              }}>
                Compare quotes across multiple DEXes and swap tokens at the best rate
              </p>
            </div>
          </div>
        </div>

        {/* Swap Widget */}
        <div
          className="swap-widget-wrapper"
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            padding: '1.5rem 1rem 3rem',
          }}
        >
          <SwapWidget
            initialInput={initialInput}
            initialOutput={initialOutput}
            onInputTokenChange={handleInputTokenChange}
            onOutputTokenChange={handleOutputTokenChange}
            onSwapComplete={handleSwapComplete}
          />
        </div>
      </main>
    </div>
  );
}
