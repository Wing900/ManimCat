// 自定义下拉选择组件 - MD3 风格

import { useState, useRef, useEffect } from 'react';

export interface SelectOption<T = string> {
  value: T;
  label: string;
}

interface CustomSelectProps<T = string> {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}

export function CustomSelect<T = string>({
  options,
  value,
  onChange,
  label,
  className = '',
  disabled = false
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => {
    if (typeof opt.value === 'number' && typeof value === 'number') {
      return opt.value === value;
    }
    return opt.value === value;
  });

  // 点击外部关闭下拉菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <label className="absolute left-3 -top-2 px-1.5 bg-bg-secondary text-xs font-medium text-text-secondary">
        {label}
      </label>

      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full px-4 py-3.5 pr-10 bg-bg-secondary/50 rounded-2xl text-left text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-secondary/60"
      >
        <span>{selectedOption?.label}</span>
      </button>

      {/* 下拉箭头 */}
      <svg
        className={`absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary pointer-events-none transition-transform duration-200 ${
          isOpen ? 'rotate-180' : ''
        }`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-bg-secondary rounded-2xl shadow-xl shadow-black/10 overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-200">
          {options.map((option) => {
            const isSelected = typeof option.value === 'number' && typeof value === 'number'
              ? option.value === value
              : option.value === value;

            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full px-4 py-3.5 text-left transition-colors hover:bg-bg-secondary/70 ${
                  isSelected ? 'bg-bg-secondary/50' : ''
                }`}
              >
                <span className="text-text-primary">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
