import React from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import SwapWidget from '../components/SwapWidget';
import { FaExchangeAlt, FaHome, FaChevronRight } from 'react-icons/fa';

const swapPrimary = '#3498db';
const swapSecondary = '#8b5cf6';

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

      <style>{`
        .swap-hero-icon {
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .swap-hero-icon:hover {
          transform: scale(1.1) rotate(5deg);
          box-shadow: 0 8px 32px ${swapPrimary}60;
        }
      `}</style>

      <main style={{ color: theme.colors.primaryText }}>
        {/* Hero Section */}
        <div style={{
          background: `linear-gradient(180deg, ${swapPrimary}12 0%, transparent 100%)`,
          borderBottom: `1px solid ${theme.colors.border}`,
          padding: '2rem 1.5rem 1.5rem',
          position: 'relative',
          overflow: 'hidden',
        }}>
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
              marginBottom: '1.5rem',
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
              marginBottom: '0.5rem',
            }}>
              {/* Icon and Title */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                marginBottom: '0.5rem',
              }}>
                <div
                  className="swap-hero-icon"
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '16px',
                    background: `linear-gradient(135deg, ${swapPrimary}, ${swapSecondary})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: `0 4px 20px ${swapPrimary}40`,
                  }}
                >
                  <FaExchangeAlt size={26} color="white" />
                </div>
                <h1 style={{
                  fontSize: 'clamp(1.8rem, 5vw, 2.5rem)',
                  fontWeight: '800',
                  margin: 0,
                  background: `linear-gradient(135deg, ${theme.colors.primaryText} 30%, ${swapPrimary})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  Swap
                </h1>
              </div>

              <p style={{
                color: theme.colors.mutedText,
                fontSize: '0.95rem',
                margin: 0,
                maxWidth: '500px',
              }}>
                Compare quotes across multiple DEXes and swap tokens at the best rate
              </p>
            </div>
          </div>
        </div>

        {/* Swap Widget */}
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          padding: '2rem 1rem 3rem',
        }}>
          <SwapWidget initialInput={initialInput} initialOutput={initialOutput} />
        </div>
      </main>
    </div>
  );
}
