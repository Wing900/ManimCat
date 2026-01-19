// 输入表单组件 - MD3 风格

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Quality } from '../types/api';

interface InputFormProps {
  onSubmit: (data: { concept: string; quality: Quality; forceRefresh: boolean }) => void;
  loading: boolean;
}

/** 质量选项 */
const QUALITY_OPTIONS = [
  { value: 'low' as Quality, label: '低 (480p)', desc: '最快' },
  { value: 'medium' as Quality, label: '中 (720p)', desc: '' },
  { value: 'high' as Quality, label: '高 (1080p)', desc: '最慢' },
];

export function InputForm({ onSubmit, loading }: InputFormProps) {
  const [concept, setConcept] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [quality, setQuality] = useState<Quality>('medium');
  const [qualityOpen, setQualityOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setQualityOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 键盘快捷键：Ctrl+Enter 提交
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter' && !loading) {
        e.preventDefault();
        handleSubmit();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [loading, concept, quality, forceRefresh]);

  // 实时验证
  useEffect(() => {
    if (concept.length > 0 && concept.length < 5) {
      setError('请至少输入 5 个字符');
    } else {
      setError(null);
    }
  }, [concept]);

  const handleSubmit = useCallback(() => {
    if (concept.trim().length < 5) {
      setError('请至少输入 5 个字符描述你想要动画的内容');
      textareaRef.current?.focus();
      return;
    }
    setError(null);
    onSubmit({ concept: concept.trim(), quality, forceRefresh });
  }, [concept, quality, forceRefresh, onSubmit]);

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSubmit();
  };

  const selectedOption = QUALITY_OPTIONS.find(opt => opt.value === quality);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleFormSubmit} className="space-y-6">
        {/* 概念输入 - MD3 Filled Text Field */}
        <div className="relative">
          <label
            htmlFor="concept"
            className={`absolute left-4 -top-2.5 px-2 bg-bg-primary text-xs font-medium transition-all ${
              error ? 'text-red-500' : 'text-text-secondary'
            }`}
          >
            {error ? error : '描述你想要的动画'}
          </label>
          <textarea
            ref={textareaRef}
            id="concept"
            name="concept"
            rows={4}
            placeholder="例如：展示单位圆上正弦和余弦的关系..."
            disabled={loading}
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            className={`w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 transition-all resize-none ${
              error
                ? 'focus:ring-red-500/20 bg-red-50/50 dark:bg-red-900/10'
                : 'focus:ring-accent/20 focus:bg-bg-secondary/70'
            }`}
          />
        </div>

        {/* 选项区域 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* 质量选择 - 自定义下拉菜单 */}
          <div className="relative" ref={dropdownRef}>
            <label className="absolute left-3 -top-2 px-1.5 bg-bg-primary text-xs font-medium text-text-secondary">
              视频质量
            </label>

            {/* 触发按钮 */}
            <button
              type="button"
              onClick={() => !loading && setQualityOpen(!qualityOpen)}
              disabled={loading}
              className="w-full px-4 py-3.5 pr-10 bg-bg-secondary/50 rounded-2xl text-left text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-secondary/60"
            >
              <span className="flex items-center justify-between">
                <span>{selectedOption?.label} {selectedOption?.desc && <span className="text-text-secondary/60 text-xs ml-1">- {selectedOption.desc}</span>}</span>
              </span>
            </button>

            {/* 下拉箭头 */}
            <svg
              className={`absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary pointer-events-none transition-transform duration-200 ${
                qualityOpen ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>

            {/* 下拉菜单 */}
            {qualityOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl shadow-black/10 overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-200">
                {QUALITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setQuality(option.value);
                      setQualityOpen(false);
                    }}
                    className={`w-full px-4 py-3.5 text-left transition-colors hover:bg-bg-secondary ${
                      quality === option.value ? 'bg-bg-secondary/70' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-text-primary">{option.label}</span>
                      {option.desc && <span className="text-xs text-text-secondary/60">- {option.desc}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* 隐藏的 input 用于表单提交 */}
            <input type="hidden" name="quality" value={quality} />
          </div>

          {/* 强制刷新 - MD3 Switch */}
          <div className="flex flex-col justify-center">
            <label htmlFor="forceRefresh" className="text-xs font-medium text-text-secondary mb-3">
              强制重新生成
            </label>
            <div className="flex items-center gap-3">
              {/* MD3 Switch */}
              <button
                type="button"
                onClick={() => setForceRefresh(!forceRefresh)}
                disabled={loading}
                className={`relative w-12 h-7 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent/20 ${
                  forceRefresh ? 'bg-accent' : 'bg-bg-tertiary'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${
                    forceRefresh ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <input
                type="checkbox"
                id="forceRefresh"
                name="forceRefresh"
                checked={forceRefresh}
                onChange={(e) => setForceRefresh(e.target.checked)}
                disabled={loading}
                className="sr-only"
              />
              <span className="text-xs text-text-secondary/60">跳过缓存</span>
            </div>
          </div>
        </div>

        {/* 提交按钮 - MD3 Filled Button */}
        <div className="flex justify-center pt-4">
          <button
            type="submit"
            disabled={loading || concept.trim().length < 5}
            className="group relative px-12 py-3.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-full shadow-lg shadow-accent/25 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-xl hover:shadow-accent/35 active:scale-[0.97] overflow-hidden"
          >
            <span className="relative z-10 flex items-center gap-2">
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  生成中...
                </>
              ) : (
                <>
                  生成动画
                  <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </span>
            {/* 按钮光效 */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
          </button>
        </div>

        {/* 快捷键提示 */}
        <p className="text-center text-xs text-text-secondary/50">
          按 <kbd className="px-1.5 py-0.5 bg-bg-secondary/50 rounded text-[10px]">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 bg-bg-secondary/50 rounded text-[10px]">Enter</kbd> 快速提交
        </p>
      </form>
    </div>
  );
}
