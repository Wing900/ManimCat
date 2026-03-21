export function useModalTransition(isOpen: boolean, duration: number = 400) {
  void duration;
  return { shouldRender: isOpen, isExiting: false };
}
