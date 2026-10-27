// 代码预览组件

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { memo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/index';

interface CodeViewProps {
  code: string;
  editable?: boolean;
  onChange?: (value: string) => void;
  disabled?: boolean;
  showTitle?: boolean;
  toolbarPosition?: 'top' | 'bottom';
  codeFontSizePx?: number;
  /**
   * 外部动作宿主：提供时编辑/复制按钮 portal 到该容器，本组件不再渲染工具栏行。
   * undefined = 未提供（默认内部渲染）；null = 宿主尚未挂载（暂不渲染）。
   */
  actionsContainer?: HTMLElement | null;
}

export const CodeView = memo(function CodeView({
  code,
  editable = false,
  onChange,
  disabled = false,
  showTitle = true,
  toolbarPosition = 'top',
  codeFontSizePx = 12,
  actionsContainer
}: CodeViewProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDark, setIsDark] = useState(
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const updateThemeState = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };

    updateThemeState();

    const observer = new MutationObserver(updateThemeState);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const textareaClassName = [
    'w-full h-full resize-none bg-transparent p-4 leading-relaxed overflow-auto',
    'font-mono text-text-primary/90 focus:outline-none',
    disabled ? 'opacity-60 cursor-not-allowed' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const hasExternalActions = actionsContainer !== undefined;

  const actionButtons = (
    <div className="flex items-center gap-3">
      {editable && (
        <button
          onClick={() => setIsEditing((prev) => !prev)}
          disabled={disabled}
          className="inline-flex h-10 items-center rounded-full px-3 text-sm text-text-secondary/70 transition-colors hover:bg-bg-primary/50 hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isEditing ? t('common.preview') : t('common.edit')}
        </button>
      )}
      <button
        onClick={handleCopy}
        className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-text-secondary/70 transition-colors hover:bg-bg-primary/50 hover:text-accent"
      >
        {copied ? (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {t('common.copied')}
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {t('common.copy')}
          </>
        )}
      </button>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-bg-secondary/30 rounded-2xl overflow-hidden">
      {/* 工具栏：可置于代码区域上方或下方；提供外部宿主时整行不渲染 */}
      {!hasExternalActions && (
        <div
          className={`flex items-center gap-3 px-4 py-2.5 ${
            toolbarPosition === 'bottom' ? 'order-2 justify-end' : 'order-1 justify-between'
          }`}
        >
          {showTitle ? (
            <h3 className="text-xs font-medium text-text-secondary/80 uppercase tracking-wide">{t('codeView.title')}</h3>
          ) : null}
          {actionButtons}
        </div>
      )}

      {hasExternalActions && actionsContainer ? createPortal(actionButtons, actionsContainer) : null}

      {/* 代码区域 */}
      <div
        className={`min-h-0 flex-1 overflow-hidden ${
          !hasExternalActions && toolbarPosition === 'bottom' ? 'order-1' : 'order-2'
        }`}
      >
        {editable && isEditing ? (
          <textarea
            value={code}
            onChange={(event) => onChange?.(event.target.value)}
            className={textareaClassName}
            style={{ fontSize: `${codeFontSizePx}px` }}
            disabled={disabled}
            spellCheck={false}
          />
        ) : (
          <div className="h-full overflow-auto">
            <SyntaxHighlighter
              language="python"
              style={isDark ? vscDarkPlus : oneLight}
              customStyle={{
                margin: 0,
                padding: '1rem',
                fontSize: `${codeFontSizePx}px`,
                lineHeight: '1.6',
                minHeight: '100%',
                width: '100%',
                boxSizing: 'border-box',
                fontFamily: 'Monaco, Cascadia Code, Roboto Mono, monospace',
                background: 'transparent',
                whiteSpace: 'pre',
                wordBreak: 'normal',
                overflow: 'visible'
              }}
              codeTagProps={{
                style: {
                  fontFamily: 'Monaco, Cascadia Code, Roboto Mono, monospace',
                  whiteSpace: 'pre',
                  wordBreak: 'normal'
                }
              }}
              showLineNumbers
            >
              {code}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </div>
  );
});
