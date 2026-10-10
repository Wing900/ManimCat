import { useEffect } from 'react';
import type { ProcessingStage } from '../../../shared/types/api';
import type { MoveDirection } from '../hooks/useGame2048';
import type { TranslationKey } from '../../../shared/i18n/messages';
import { useI18n } from '../../../shared/i18n/index';

interface Game2048PageProps {
  board: number[][];
  score: number;
  bestScore: number;
  isGameOver: boolean;
  hasWon: boolean;
  maxTile: number;
  generationStatus: 'idle' | 'processing' | 'cancelling' | 'completed' | 'error';
  generationStage: ProcessingStage;
  onMove: (direction: MoveDirection) => void;
  onRestart: () => void;
  onBackToStudio: () => void;
}

const tileClassMap: Record<number, string> = {
  0: 'bg-bg-primary/75 text-transparent',
  2: 'bg-[#fff7e9] dark:bg-[#6a583f] text-[#5b4332] dark:text-[#fff3df] font-normal',
  4: 'bg-[#fff0dc] dark:bg-[#6f5a40] text-[#5b4332] dark:text-[#fff3df] font-normal',
  8: 'bg-[#eef3ff] dark:bg-[#415274] text-[#334466] dark:text-[#edf2ff] font-medium',
  16: 'bg-[#e8f8ff] dark:bg-[#3e647b] text-[#2e4f60] dark:text-[#e9fbff] font-medium',
  32: 'bg-[#ffe8f3] dark:bg-[#7a4f64] text-[#6a3950] dark:text-[#ffedf5] font-semibold',
};

function getTileClass(value: number): string {
  if (value <= 32) {
    return tileClassMap[value] ?? tileClassMap[0];
  }

  if (value === 64) {
    return 'bg-[#daf6e2] dark:bg-[#457758] text-[#285f43] dark:text-[#effff5] font-semibold';
  }

  if (value === 128) {
    return 'bg-[#d2eeff] dark:bg-[#3c6f96] text-[#2a5778] dark:text-[#edf7ff] font-semibold';
  }

  if (value === 256) {
    return 'bg-[#e5dcff] dark:bg-[#6058a4] text-[#54489a] dark:text-[#f4f0ff] font-semibold';
  }

  if (value === 512) {
    return 'bg-[#ffe0c3] dark:bg-[#9a6241] text-[#7a4b2d] dark:text-[#fff0e2] font-semibold';
  }

  if (value === 1024) {
    return 'bg-[#ffcfe0] dark:bg-[#a35676] text-[#874565] dark:text-[#ffedf4] font-semibold';
  }

  if (value >= 2048) {
    return 'bg-[#ffc5b2] dark:bg-[#ad5745] text-[#824036] dark:text-[#ffefe9] font-bold';
  }

  return 'bg-[#e8ddff] dark:bg-[#5a4d8d] text-[#4a3f75] dark:text-[#f1ecff] font-semibold';
}

function getStageText(
  stage: ProcessingStage,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (stage === 'still-rendering') {
    return t('loading.stillRendering');
  }

  return t(`loading.${stage}` as TranslationKey);
}

export function Game2048Page({
  board,
  score,
  bestScore,
  isGameOver,
  hasWon,
  maxTile,
  generationStatus,
  generationStage,
  onMove,
  onRestart,
  onBackToStudio,
}: Game2048PageProps) {
  const { t } = useI18n();

  useEffect(() => {
    const keyMap: Record<string, MoveDirection> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const direction = keyMap[event.key];
      if (!direction) {
        return;
      }

      event.preventDefault();
      onMove(direction);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onMove]);

  const generationProcessing = generationStatus === 'processing' || generationStatus === 'cancelling';
  const generationCompleted = generationStatus === 'completed';

  return (
    <div className="min-h-screen px-6 py-6 sm:px-8 sm:py-8 flex items-center justify-center">
      <div className="w-full max-w-[462px] mx-auto">
        <div className="flex items-center justify-between mb-5">
          <button
            type="button"
            onClick={onBackToStudio}
            className="text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            ← {t('game.backToStudio')}
          </button>
        </div>

        <div className="bg-bg-secondary/25 rounded-2xl px-5 py-6 sm:px-6 sm:py-7 shadow-sm shadow-black/5 dark:shadow-black/15">
          <header className="flex items-end justify-between mb-8">
            <h2 className="text-2xl tracking-[0.14em] font-light text-text-primary">2048</h2>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-secondary/70">{t('game.best')}</p>
              <p className="text-xl font-normal text-text-primary tabular-nums">{bestScore.toLocaleString()}</p>
            </div>
          </header>

          <div className="mb-5 text-right">
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-secondary/70">{t('game.score')}</p>
            <p className="text-xl font-normal text-text-primary tabular-nums">{score.toLocaleString()}</p>
          </div>

          <div className="mx-auto grid grid-cols-4 gap-3.5 p-2">
            {board.flat().map((value, index) => (
              <div
                key={`${index}-${value}`}
                className="h-[104px] w-[104px] flex items-center justify-center"
              >
                <div
                  className={`h-[90px] w-[90px] rounded-[12px] border border-white/75 dark:border-white/15 flex items-center justify-center text-2xl transition-all duration-200 ease-out ${getTileClass(value)} ${value === 0 ? 'shadow-none' : 'shadow-[0_4px_10px_rgba(0,0,0,0.12)] dark:shadow-[0_6px_12px_rgba(0,0,0,0.28)]'}`}
                  style={value === 0 ? undefined : { animation: 'tilePop 180ms cubic-bezier(0.2, 0.75, 0.3, 1)' }}
                >
                  {value === 0 ? '' : value}
                </div>
              </div>
            ))}
          </div>

          <footer className="mt-6 flex items-center justify-between text-xs text-text-secondary/70">
            <div>
              <p>{t('game.guide.keys')}</p>
              {generationProcessing && <p className="mt-1">{t('game.renderingNow')} {getStageText(generationStage, t)}</p>}
              {generationCompleted && <p className="mt-1 text-emerald-600 dark:text-emerald-400">{t('game.renderingDone')}</p>}
              {generationStatus === 'error' && <p className="mt-1 text-rose-600 dark:text-rose-400">{t('game.renderingError')}</p>}
              {generationStatus === 'idle' && <p className="mt-1">{t('game.renderingIdle')}</p>}
              {hasWon && maxTile >= 2048 && !isGameOver && <p className="mt-1 text-text-primary">{t('game.win')}</p>}
              {isGameOver && <p className="mt-1 text-text-primary">{t('game.over')}</p>}
            </div>
            <button
              type="button"
              onClick={onRestart}
              className="px-3 py-1.5 rounded-lg bg-bg-secondary/70 text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
            >
              {t('game.restart')}
            </button>
          </footer>
        </div>
      </div>

      <style>{`
        @keyframes tilePop {
          0% { transform: scale(0.88); opacity: 0.75; }
          70% { transform: scale(1.04); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
