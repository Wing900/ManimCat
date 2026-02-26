import { ThemeToggle } from '../ThemeToggle';

interface TopRightActionsProps {
  onOpenPrompts: () => void;
  onOpenSettings: () => void;
  onOpenUsage: () => void;
}

export function TopRightActions({ onOpenPrompts, onOpenSettings, onOpenUsage }: TopRightActionsProps) {
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
      <button
        onClick={onOpenUsage}
        className="p-2.5 text-text-secondary/70 hover:text-text-secondary hover:bg-bg-secondary/50 rounded-full transition-all active:scale-90 active:duration-75"
        title="用量面板"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 19h16M6 16V9m6 7V5m6 11v-4" />
        </svg>
      </button>
      <button
        onClick={onOpenPrompts}
        className="p-2.5 text-text-secondary/70 hover:text-text-secondary hover:bg-bg-secondary/50 rounded-full transition-all active:scale-90 active:duration-75"
        title="提示词管理"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
        </svg>
      </button>
      <button
        onClick={onOpenSettings}
        className="p-2.5 text-text-secondary/70 hover:text-text-secondary hover:bg-bg-secondary/50 rounded-full transition-all active:scale-90 active:duration-75"
        title="API 设置"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <ThemeToggle />
    </div>
  );
}
