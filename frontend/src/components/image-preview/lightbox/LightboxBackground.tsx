export function StudioGradientOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.94),_rgba(255,255,255,0.5)_42%,_rgba(244,244,245,0.26)_100%)] dark:bg-[radial-gradient(circle_at_top,_rgba(40,40,40,0.92),_rgba(24,24,24,0.76)_44%,_rgba(18,18,18,0.4)_100%)]" />
      <div className="absolute left-[-8%] top-[-10%] h-[38vh] w-[38vw] rounded-full bg-white/55 blur-[110px] dark:bg-white/5" />
      <div className="absolute bottom-[-16%] right-[-6%] h-[42vh] w-[34vw] rounded-full bg-slate-200/45 blur-[120px] dark:bg-white/4" />
    </div>
  )
}
