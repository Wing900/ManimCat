// 支持作者对话框组件

import { useState } from 'react';
import { useI18n } from '../i18n';
import { useModalTransition } from '../hooks/useModalTransition';

interface DonationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WECHAT_QR_URL = 'https://github.com/user-attachments/assets/09fd8c5f-9644-4c02-97c1-61f10b0fdd1f';
const AFDIAN_URL = 'https://afdian.com/a/wingflow/plan';

export function DonationModal({ isOpen, onClose }: DonationModalProps) {
  const { t } = useI18n();
  const { shouldRender, isExiting } = useModalTransition(isOpen);
  const [showQR, setShowQR] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      {/* 遮罩层 */}
      <div 
        className={`absolute inset-0 bg-bg-primary/60 backdrop-blur-md transition-opacity duration-300 ${
          isExiting ? 'opacity-0' : 'animate-overlay-wash-in'
        }`} 
        onClick={onClose} 
      />

      {/* 模态框内容 */}
      <div className={`relative bg-bg-secondary rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl border border-border/5 overflow-hidden ${
        isExiting ? 'animate-fade-out-soft' : 'animate-fade-in-soft'
      }`}>
        {!showQR ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-2xl bg-accent-rgb/5 text-accent-rgb/60">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h1a1 1 0 011 1v5a1 1 0 01-1 1h-1m-6.854 8.03l-1.772-1.603a4.5 4.5 0 00-6.267 0L6.97 21h8.13l-.648-.57a4.5 4.5 0 00-6.267 0l-.94.85M14.5 9l-1-4h-5l-1 4h7z" />
                </svg>
              </div>
              <h2 className="text-xl font-medium text-text-primary tracking-tight">{t('donation.title')}</h2>
            </div>

            <p className="text-text-secondary text-[15px] mb-10 leading-8 font-light">
              {t('donation.description')}
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowQR(true)}
                className="w-full py-4 text-sm text-bg-primary bg-accent hover:bg-accent/90 rounded-2xl transition-all active:scale-95 font-medium shadow-md shadow-accent/10"
              >
                {t('donation.support')}
              </button>
              <button
                onClick={onClose}
                className="w-full py-4 text-sm text-text-secondary hover:text-text-primary bg-bg-primary/50 hover:bg-bg-tertiary rounded-2xl transition-all active:scale-95"
              >
                {t('donation.maybeLater')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center animate-fade-in">
            <div className="w-full flex items-center justify-between mb-8">
               <button 
                 onClick={() => setShowQR(false)}
                 className="p-2 -ml-2 text-text-secondary/50 hover:text-text-primary transition-colors"
               >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                 </svg>
               </button>
               <span className="text-[11px] uppercase tracking-[0.3em] text-text-secondary/40 font-medium">
                 {t('donation.wechatTitle')}
               </span>
               <div className="w-9" />
            </div>

            <div className="relative w-56 h-56 mb-8 rounded-3xl bg-bg-primary/50 border border-border/5 flex items-center justify-center overflow-hidden shadow-inner group">
              {!imgLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-accent-rgb/20 border-t-accent-rgb/60 rounded-full animate-spin" />
                </div>
              )}
              <img 
                src={WECHAT_QR_URL} 
                alt="WeChat Pay"
                className={`w-full h-full object-contain transition-all duration-700 p-4 ${
                  imgLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95 blur-sm'
                }`}
                onLoad={() => setImgLoaded(true)}
              />
            </div>

            <p className="text-[13px] text-text-secondary/70 font-light mb-10">
              {t('donation.wechatHint')}
            </p>

            <a
              href={AFDIAN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-text-secondary/30 hover:text-accent-rgb underline underline-offset-4 transition-colors"
            >
              {t('donation.afdianLink')}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
