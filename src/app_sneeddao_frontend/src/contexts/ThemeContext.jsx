import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Theme definitions
export const themes = {
  dark: {
    name: 'dark',
    colors: {
      // Backgrounds
      primaryBg: '#1a1a1a',
      secondaryBg: '#2a2a2a',
      tertiaryBg: '#3a3a3a',
      headerBg: '#000000',
      cardBg: 'rgba(255, 255, 255, 0.1)',
      modalBg: 'rgba(0, 0, 0, 0.8)',
      
      // Text
      primaryText: '#ffffff',
      secondaryText: '#cccccc',
      mutedText: '#888888',
      linkText: '#3498db',
      
      // Accents
      accent: '#4a90e2',
      accentHover: 'rgba(74, 144, 226, 0.2)',
      success: '#2ecc71',
      warning: '#f39c12',
      error: '#e74c3c',
      gold: '#ffd700',
      
      // Borders
      border: 'rgba(255, 255, 255, 0.18)',
      borderHover: '#3498db',
      
      // Gradients
      primaryGradient: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)',
      cardGradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.1) 100%)',
      accentGradient: 'linear-gradient(to right, rgba(74, 144, 226, 0.15), rgba(74, 144, 226, 0.08))',
      
      // Shadows
      cardShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.829)',
      accentShadow: '0 4px 15px rgba(60, 99, 130, 0.3)'
    }
  },
  bright: {
    name: 'bright',
    colors: {
      // Backgrounds
      primaryBg: '#ffffff',
      secondaryBg: '#f8f9fa',
      tertiaryBg: '#e9ecef',
      headerBg: '#ffffff',
      cardBg: 'rgba(255, 255, 255, 0.9)',
      modalBg: 'rgba(255, 255, 255, 0.95)',
      
      // Text
      primaryText: '#212529',
      secondaryText: '#495057',
      mutedText: '#6c757d',
      linkText: '#0d6efd',
      
      // Accents
      accent: '#6c5ce7',
      accentHover: 'rgba(108, 92, 231, 0.15)',
      success: '#198754',
      warning: '#fd7e14',
      error: '#dc3545',
      gold: '#ffc107',
      
      // Borders
      border: 'rgba(0, 0, 0, 0.125)',
      borderHover: '#0d6efd',
      
      // Gradients
      primaryGradient: 'linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)',
      cardGradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 249, 250, 0.8) 100%)',
      accentGradient: 'linear-gradient(to right, rgba(108, 92, 231, 0.12), rgba(108, 92, 231, 0.06))',
      
      // Shadows
      cardShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.1)',
      accentShadow: '0 4px 15px rgba(13, 110, 253, 0.2)'
    }
  }
};

export const ThemeProvider = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState(() => {
    // Load theme from localStorage or default to dark
    const savedTheme = localStorage.getItem('sneedDao_theme');
    return savedTheme || 'dark';
  });

  const theme = themes[currentTheme];

  const toggleTheme = () => {
    const newTheme = currentTheme === 'dark' ? 'bright' : 'dark';
    setCurrentTheme(newTheme);
    localStorage.setItem('sneedDao_theme', newTheme);
  };

  const setTheme = (themeName) => {
    if (themes[themeName]) {
      setCurrentTheme(themeName);
      localStorage.setItem('sneedDao_theme', themeName);
    }
  };

  // Apply CSS custom properties to document root
  useEffect(() => {
    const root = document.documentElement;
    const colors = theme.colors;
    
    // Convert camelCase to kebab-case for CSS custom properties
    const toKebabCase = (str) => str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    
    // Set CSS custom properties for all theme colors
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${toKebabCase(key)}`, value);
    });
    
    // Set body background
    document.body.style.background = colors.primaryGradient;
    document.body.style.color = colors.primaryText;
    
  }, [theme]);

  const value = {
    theme,
    currentTheme,
    toggleTheme,
    setTheme,
    isDark: currentTheme === 'dark',
    isBright: currentTheme === 'bright'
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export default ThemeContext;
