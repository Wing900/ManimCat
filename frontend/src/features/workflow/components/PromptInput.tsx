// 提示词输入组件
// 提供统一的提示词编辑界面

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  showWordCount?: boolean;
  onSave?: () => void;
  onRestoreDefault?: () => void;
}

export function PromptInput({
  value,
  onChange,
  label,
  placeholder,
  maxLength = 20000,
  disabled = false,
  showWordCount = true,
  onSave,
  onRestoreDefault
}: PromptInputProps) {
  const wordCount = value.length;
  const isMaxLength = wordCount >= maxLength;

  return (
    <div className="w-full space-y-4">
      {/* 标签和操作按钮 */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-primary">
          {label}
        </label>
        <div className="flex gap-2">
          {onRestoreDefault && (
            <button
              onClick={onRestoreDefault}
              disabled={disabled}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-secondary/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              恢复默认
            </button>
          )}
          {onSave && (
            <button
              onClick={onSave}
              disabled={disabled}
              className="px-3 py-1.5 text-xs bg-accent text-white hover:bg-accent-hover rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              保存
            </button>
          )}
        </div>
      </div>

      {/* 输入区域 */}
      <textarea
        value={value}
        onChange={(e) => {
          if (e.target.value.length <= maxLength) {
            onChange(e.target.value);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        rows={20}
        className={`w-full px-4 py-3 bg-bg-secondary/50 border border-bg-secondary/50 rounded-xl text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 focus:border-accent/30 transition-all resize-y min-h-[480px] ${
          isMaxLength
            ? 'border-red-500/30 focus:ring-red-500/20 focus:border-red-500/50'
            : ''
        }`}
      />

      {/* 字符计数 */}
      {showWordCount && (
        <div className="flex items-center justify-between text-xs text-text-secondary/60">
          <span>{wordCount} / {maxLength} 字符</span>
          {isMaxLength && (
            <span className="text-red-500">已达到字符限制</span>
          )}
        </div>
      )}
    </div>
  );
}
