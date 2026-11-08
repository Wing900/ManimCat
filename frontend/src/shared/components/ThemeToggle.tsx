import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index';

type ThemeMode = 'light' | 'dark';

function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    return savedTheme;
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

const THEME_ORDER: ThemeMode[] = ['light', 'dark'];

function nextTheme(current: ThemeMode): ThemeMode {
  const index = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length];
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(resolveInitialTheme);
  const { t } = useI18n();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark');
    if (theme === 'dark') {
      root.classList.add('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const labelMap: Record<ThemeMode, string> = {
    light: t('theme.light'),
    dark: t('theme.dark'),
  };

  const next = nextTheme(theme);

  return (
    <button
      onClick={() => setTheme(next)}
      className="p-2.5 text-text-secondary/70 hover:text-text-secondary hover:bg-bg-secondary/50 rounded-full transition-all active:scale-90 active:duration-75"
      aria-label={labelMap[next]}
      title={labelMap[next]}
    >
      {theme === 'light' && (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      )}
      {theme === 'dark' && (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      )}
    </button>
  );
}
