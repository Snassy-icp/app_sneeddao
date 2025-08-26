import React from 'react';
import { FaSun, FaMoon } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';

const ThemeToggle = ({ size = 'medium', showLabel = false }) => {
  const { toggleTheme, isDark, theme } = useTheme();

  const sizes = {
    small: {
      container: { width: '40px', height: '20px' },
      slider: { width: '16px', height: '16px', fontSize: '8px' }
    },
    medium: {
      container: { width: '50px', height: '25px' },
      slider: { width: '21px', height: '21px', fontSize: '10px' }
    },
    large: {
      container: { width: '60px', height: '30px' },
      slider: { width: '26px', height: '26px', fontSize: '12px' }
    }
  };

  const currentSize = sizes[size];

  const containerStyle = {
    position: 'relative',
    width: currentSize.container.width,
    height: currentSize.container.height,
    backgroundColor: isDark ? '#4a4a4a' : '#e9ecef',
    borderRadius: currentSize.container.height,
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    border: `2px solid ${theme.colors.border}`,
    display: 'flex',
    alignItems: 'center',
    padding: '2px',
    boxShadow: isDark 
      ? 'inset 0 2px 4px rgba(0, 0, 0, 0.3)' 
      : 'inset 0 2px 4px rgba(0, 0, 0, 0.1)',
  };

  const sliderStyle = {
    position: 'absolute',
    top: '2px',
    left: isDark ? '2px' : `calc(100% - ${currentSize.slider.width} - 2px)`,
    width: currentSize.slider.width,
    height: currentSize.slider.height,
    backgroundColor: isDark ? '#2c3e50' : '#fff',
    borderRadius: '50%',
    transition: 'all 0.3s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: currentSize.slider.fontSize,
    color: isDark ? '#f39c12' : '#ffc107',
    boxShadow: isDark
      ? '0 2px 6px rgba(0, 0, 0, 0.3), 0 0 8px rgba(243, 156, 18, 0.3)'
      : '0 2px 6px rgba(0, 0, 0, 0.2), 0 0 8px rgba(255, 193, 7, 0.4)',
    border: `1px solid ${isDark ? '#34495e' : '#dee2e6'}`,
  };

  const wrapperStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const labelStyle = {
    fontSize: '14px',
    fontWeight: '500',
    color: theme.colors.secondaryText,
    userSelect: 'none',
  };

  const handleToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleTheme();
  };

  return (
    <div style={wrapperStyle}>
      {showLabel && (
        <span style={labelStyle}>
          {isDark ? 'Dark' : 'Bright'}
        </span>
      )}
      <div
        style={containerStyle}
        onClick={handleToggle}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = theme.colors.borderHover;
          e.currentTarget.style.transform = 'scale(1.05)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = theme.colors.border;
          e.currentTarget.style.transform = 'scale(1)';
        }}
        title={`Switch to ${isDark ? 'bright' : 'dark'} mode`}
      >
        <div style={sliderStyle}>
          {isDark ? <FaMoon /> : <FaSun />}
        </div>
      </div>
    </div>
  );
};

export default ThemeToggle;
