// 代码预览组件

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useEffect, useState } from 'react';

interface CodeViewProps {
  code: string;
  editable?: boolean;
  onChange?: (value: string) => void;
  disabled?: boolean;
}

export function CodeView({ code, editable = false, onChange, disabled = false }: CodeViewProps) {
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
    'w-full h-full resize-none bg-transparent p-4 text-[0.75rem] leading-relaxed overflow-auto',
    'font-mono text-text-primary/90 focus:outline-none',
    disabled ? 'opacity-60 cursor-not-allowed' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="h-full flex flex-col bg-bg-secondary/30 rounded-2xl overflow-hidden">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <h3 className="text-xs font-medium text-text-secondary/80 uppercase tracking-wide">生成的代码</h3>
        <div className="flex items-center gap-3">
          {editable && (
            <button
              onClick={() => setIsEditing((prev) => !prev)}
              disabled={disabled}
              className="text-xs text-text-secondary/70 hover:text-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isEditing ? '预览' : '编辑'}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="text-xs text-text-secondary/70 hover:text-accent transition-colors flex items-center gap-1.5"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                已复制
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                复制
              </>
            )}
          </button>
        </div>
      </div>

      {/* 代码区域 */}
      <div className="flex-1 overflow-hidden">
        {editable && isEditing ? (
          <textarea
            value={code}
            onChange={(event) => onChange?.(event.target.value)}
            className={textareaClassName}
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
                fontSize: '0.75rem',
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
}
