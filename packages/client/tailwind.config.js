/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tactical FPS design system — no purple/violet (per agent rules)
        brand: {
          50:  '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',  // primary red accent
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        atk: '#ef4444',     // attacker red
        def: '#3b82f6',     // defender blue
        neutral: {
          950: '#0a0a0a',
        },
        surface: {
          DEFAULT: '#111111',
          card: '#1a1a1a',
          elevated: '#222222',
          border: '#2a2a2a',
        },
        hud: {
          health: '#22c55e',
          armor: '#60a5fa',
          ammo: '#f59e0b',
          credits: '#fbbf24',
          danger: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        display: ['Rajdhani', 'Inter', 'sans-serif'],
      },
      animation: {
        'pulse-fast': 'pulse 0.5s cubic-bezier(0.4,0,0.6,1) infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'spike-pulse': 'spikePulse 1s ease-in-out infinite',
      },
      keyframes: {
        slideUp: { from: { transform: 'translateY(20px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        slideIn: { from: { transform: 'translateX(-20px)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        spikePulse: {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(239,68,68,0.4)' },
          '50%': { boxShadow: '0 0 0 12px rgba(239,68,68,0)' },
        },
      },
    },
  },
  plugins: [],
};
