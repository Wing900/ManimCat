/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 亮色主题（默认）
        bg: {
          primary: 'rgba(var(--bg-primary-rgb), 1)',
          secondary: 'rgba(var(--bg-secondary-rgb), 1)',
          tertiary: 'rgba(var(--bg-tertiary-rgb), 1)',
        },
        text: {
          primary: 'rgba(var(--text-primary-rgb), 1)',
          secondary: 'rgba(var(--text-secondary-rgb), 1)',
          tertiary: 'rgba(var(--text-tertiary-rgb), 1)',
        },
        accent: {
          DEFAULT: 'rgba(var(--accent-rgb), 1)',
          hover: 'rgba(var(--accent-hover-rgb), 1)',
        },
        border: 'rgba(var(--border-rgb), 1)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"SF Mono"', 'Monaco', 'Cascadia Code', 'Roboto Mono', 'monospace'],
      },
      borderRadius: {
        'md3-sm': '8px',
        'md3': '12px',
        'md3-lg': '16px',
        'md3-xl': '20px',
        'md3-2xl': '24px',
      },
      boxShadow: {
        'md3': '0 1px 3px rgba(0, 0, 0, 0.06)',
        'md3-lg': '0 4px 12px rgba(0, 0, 0, 0.08)',
        'md3-xl': '0 8px 24px rgba(0, 0, 0, 0.12)',
      },
      keyframes: {
        shimmer: {
          '100%': {
            transform: 'translateX(100%)',
          },
        },
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
}