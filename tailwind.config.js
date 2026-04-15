/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        mira: {
          50: '#f0e7ff',
          100: '#d4bfff',
          200: '#b794ff',
          300: '#9a68ff',
          400: '#8347ff',
          500: '#6d28d9',
          600: '#5b21b6',
          700: '#4c1d95',
          800: '#3b0f7a',
          900: '#2e0a61',
        },
        surface: {
          dark: '#0a0a0f',
          'dark-2': '#111118',
          'dark-3': '#16161f',
          light: '#f8f9fc',
          'light-2': '#ffffff',
          'light-3': '#eef0f4',
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'blob': 'blob 8s infinite',
        'blob-slow': 'blob 12s infinite',
        'float': 'float 6s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'slide-in-up': 'slideInUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        blob: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '25%': { transform: 'translate(30px, -50px) scale(1.1)' },
          '50%': { transform: 'translate(-20px, 20px) scale(0.9)' },
          '75%': { transform: 'translate(20px, 40px) scale(1.05)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%': { opacity: '0.5' },
          '100%': { opacity: '1' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideInUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
