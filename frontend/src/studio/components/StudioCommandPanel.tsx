import { useI18n } from '../../i18n';
import type { StudioMessageItem } from '../types';

interface StudioCommandPanelProps {
  messages: StudioMessageItem[];
  onExit: () => void;
}

export function StudioCommandPanel({ messages, onExit }: StudioCommandPanelProps) {
  const { t } = useI18n();

  return (
    <section className="flex min-w-0 flex-1 flex-col h-full">
      <header className="flex items-center justify-between px-[6%] pt-12 pb-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-rgb/40 animate-pulse" />
            <h1 className="text-[20px] font-normal tracking-[0.06em] text-text-primary/90">ManimCat Studio</h1>
          </div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-text-secondary/40 font-light">
            {t('studio.description')}
          </p>
        </div>

        <button
          type="button"
          onClick={onExit}
          className="group flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-bg-secondary/40 border border-border/5 text-[10px] uppercase tracking-[0.25em] text-text-secondary transition-all hover:bg-red-500/5 hover:text-red-500/70 hover:border-red-500/10 active:scale-[0.96]"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-text-secondary/20 transition-colors group-hover:bg-red-500/40" />
          {t('studio.exit')}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-[6%] pb-12 pt-4 flex flex-col gap-10 scrollbar-hide">
        {messages.map((message) => (
          <article 
            key={message.id} 
            className={`flex flex-col gap-4 max-w-3xl animate-fade-in-soft ${
              message.role === 'user' ? 'ml-auto items-end' : 'items-start'
            }`}
          >
            <div className={`px-8 py-5 rounded-[2.5rem] text-[15px] leading-8 shadow-sm ${
              message.role === 'user' 
                ? 'bg-accent-rgb/5 text-text-primary/80 italic rounded-tr-sm' 
                : 'bg-bg-secondary/40 text-text-primary/90 border border-border/5 rounded-tl-sm'
            }`}>
              {message.content}
            </div>

            {message.code && (
              <div className="w-full overflow-hidden rounded-[1.5rem] border border-border/10 bg-bg-secondary/30 group relative">
                <pre className="p-8 font-mono text-[12px] leading-7 text-text-secondary/80 overflow-x-auto">
                  {message.code}
                </pre>
                <div className="absolute top-4 right-6 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[9px] uppercase tracking-widest text-text-secondary/40 font-mono italic">Code Chunk</span>
                </div>
              </div>
            )}

            {message.formula && (
              <div className="px-6 py-3 rounded-2xl bg-accent-rgb/[0.03] border border-accent-rgb/5 text-xs tracking-[0.12em] text-accent-rgb/50 font-serif">
                {message.formula}
              </div>
            )}
          </article>
        ))}
      </div>

      <footer className="px-[6%] py-10">
        <div className="group relative flex items-center gap-4 bg-bg-secondary/30 border border-border/5 rounded-[2.5rem] px-8 py-5 transition-all hover:border-accent-rgb/20 focus-within:border-accent-rgb/30 focus-within:bg-bg-secondary/50 shadow-sm">
          <div className="h-2.5 w-2.5 rounded-full bg-accent-rgb/20 transition-all group-focus-within:bg-accent-rgb group-focus-within:animate-pulse" />
          <input
            placeholder={t('studio.inputPlaceholder')}
            className="flex-1 bg-transparent text-base tracking-[0.02em] text-text-primary outline-none placeholder:text-text-secondary/30"
          />
          <div className="px-3 py-1.5 rounded-xl border border-border/10 text-[9px] uppercase tracking-[0.2em] text-text-secondary/30 group-focus-within:text-accent-rgb/40 group-focus-within:border-accent-rgb/10 transition-colors">
            Enter
          </div>
        </div>
      </footer>
    </section>
  );
}
