// 支持作者对话框组件

interface DonationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DonationModal({ isOpen, onClose }: DonationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* 模态框内容 */}
      <div className="relative bg-bg-secondary rounded-2xl p-6 max-w-sm w-full shadow-xl animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {/* 咖啡图标 */}
            <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h1a1 1 0 011 1v5a1 1 0 01-1 1h-1m-6.854 8.03l-1.772-1.603a4.5 4.5 0 00-6.267 0L6.97 21h8.13l-.648-.57a4.5 4.5 0 00-6.267 0l-.94.85M14.5 9l-1-4h-5l-1 4h7z" />
            </svg>
            <h2 className="text-lg font-medium text-text-primary">请喝可乐</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-secondary/70 hover:text-text-secondary hover:bg-bg-primary/50 rounded-full transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-text-secondary text-sm mb-6 leading-relaxed">
          如果你觉得可爱的 ManimCat 有帮助到你或者有所启发，欢迎请作者喝瓶可口可乐~
        </p>

        <div className="flex gap-3">
          <a
            href="https://afdian.com/a/wingflow/plan"
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm text-bg-primary bg-accent hover:bg-accent-hover rounded-xl transition-all active:scale-95 active:duration-75 font-medium text-center"
          >
            支持一下
          </a>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary bg-bg-primary hover:bg-bg-tertiary rounded-xl transition-all active:scale-95 active:duration-75 text-center"
          >
            下次一定
          </button>
        </div>
      </div>

      {/* 添加淡入动画 */}
      <style>{`
        @keyframes fadeIn {
          0% {
            opacity: 0;
            transform: scale(0.95);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-fade-in {
          animation: fadeIn 0.2s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
