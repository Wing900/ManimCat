// 代码查看 / 编辑对话框

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n, type TranslationKey } from '../../../shared/i18n/index';
import { useModalTransition } from '../../../shared/hooks/useModalTransition';
import { CustomSelect } from '../../../shared/components/CustomSelect';
import { CodeView } from '../../../shared/components/CodeView';
import type { Quality } from '../../../shared/types/api';

interface CodeModalProps {
  isOpen: boolean;
  code: string;
  defaultQuality: Quality;
  defaultFrameRate: number;
  disabled?: boolean;
  onCodeChange?: (code: string) => void;
  onClose: () => void;
  onRerender: (quality: Quality, frameRate: number) => void;
}

const FRAME_RATE_OPTIONS = [15, 30, 60] as const;

const QUALITY_OPTIONS: { value: Quality; labelKey: TranslationKey }[] = [
  { value: 'low', labelKey: 'settings.video.quality.low' },
  { value: 'medium', labelKey: 'settings.video.quality.medium' },
  { value: 'high', labelKey: 'settings.video.quality.high' },
];

export function CodeModal({
  isOpen,
  code,
  defaultQuality,
  defaultFrameRate,
  disabled = false,
  onCodeChange,
  onClose,
  onRerender,
}: CodeModalProps) {
  const { t } = useI18n();
  const { shouldRender, isExiting } = useModalTransition(isOpen);
  const [quality, setQuality] = useState<Quality>(defaultQuality);
  const [frameRate, setFrameRate] = useState<number>(defaultFrameRate);
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuality(defaultQuality);
      setFrameRate(defaultFrameRate);
    }
  }, [defaultFrameRate, defaultQuality, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  const options = QUALITY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }));
  const frameRateOptions = FRAME_RATE_OPTIONS.map((value) => ({
    value,
    label: `${value} fps`,
  }));

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      {/* 沉浸式背景 */}
      <div
        className={`absolute inset-0 bg-bg-primary/60 backdrop-blur-md ${
          isExiting ? 'animate-overlay-wash-out' : 'animate-overlay-wash-in'
        }`}
        onClick={onClose}
      />

      {/* 模态框主体 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('codeView.title')}
        className={`relative flex h-[80dvh] w-full max-w-5xl flex-col rounded-[2.5rem] border border-border/5 bg-bg-secondary p-5 shadow-2xl sm:p-7 ${
          isExiting ? 'animate-modal-pop-out' : 'animate-modal-pop-in'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between pb-4">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-accent-rgb/40 animate-pulse" />
            <h2 className="text-lg font-medium text-text-primary">{t('codeView.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-2.5 text-text-secondary/50 hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1">
          <CodeView
            code={code}
            editable={Boolean(onCodeChange)}
            onChange={onCodeChange}
            disabled={disabled}
            showTitle={false}
            fadeBottom
            actionsContainer={actionsHost}
            codeFontSizePx={13}
          />
        </div>

        <div className="mt-4 flex shrink-0 flex-col gap-3 pt-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <CustomSelect
              options={options}
              value={quality}
              onChange={setQuality}
              label={t('settings.video.resolution')}
              disabled={disabled}
              placement="top"
              labelLayout="stacked"
              className="w-full text-sm [&_button]:text-sm sm:w-52"
            />
            <CustomSelect
              options={frameRateOptions}
              value={frameRate}
              onChange={setFrameRate}
              label={t('settings.video.frameRate')}
              disabled={disabled}
              placement="top"
              labelLayout="stacked"
              className="w-full text-sm [&_button]:text-sm sm:w-40"
            />
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-3 self-stretch sm:w-auto sm:self-end">
            <div ref={setActionsHost} className="flex items-center gap-3" />
            <button
              type="button"
              onClick={() => onRerender(quality, frameRate)}
              disabled={disabled || !code.trim()}
              className="self-center whitespace-nowrap rounded-full bg-accent px-6 h-12 text-sm font-medium text-white shadow-sm shadow-accent/20 transition-all hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('result.rerender')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
