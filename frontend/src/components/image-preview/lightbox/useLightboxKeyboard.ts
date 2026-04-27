import { useEffect } from 'react'

interface UseLightboxKeyboardOptions {
  shouldRender: boolean
  isAnnotating: boolean
  isStudioAppearance: boolean
  hasCommitHandler: boolean
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  onToggleAnnotating: () => void
  onCloseContextMenu: () => void
}

export function useLightboxKeyboard({
  shouldRender,
  isAnnotating,
  isStudioAppearance,
  hasCommitHandler,
  onClose,
  onPrev,
  onNext,
  onToggleAnnotating,
  onCloseContextMenu,
}: UseLightboxKeyboardOptions) {
  useEffect(() => {
    if (!shouldRender) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseContextMenu();
        if (isAnnotating) {
          onToggleAnnotating();
        } else {
          onClose();
        }
      } else if (event.key === 'ArrowLeft') {
        if (isAnnotating) {
          return;
        }
        event.preventDefault();
        onCloseContextMenu();
        onPrev?.();
      } else if (event.key === 'ArrowRight') {
        if (isAnnotating) {
          return;
        }
        event.preventDefault();
        onCloseContextMenu();
        onNext?.();
      } else if (
        isStudioAppearance &&
        hasCommitHandler &&
        event.key === 'Shift' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.repeat
      ) {
        const target = event.target as HTMLElement | null;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target?.isContentEditable
        ) {
          return;
        }
        event.preventDefault();
        onToggleAnnotating();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isAnnotating, isStudioAppearance, hasCommitHandler, onClose, onCloseContextMenu, onNext, onPrev, onToggleAnnotating, shouldRender]);
}
