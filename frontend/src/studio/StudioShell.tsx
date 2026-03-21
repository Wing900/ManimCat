import { StudioAssetsPanel } from './components/StudioAssetsPanel';
import { StudioCommandPanel } from './components/StudioCommandPanel';
import { StudioPipelinePanel } from './components/StudioPipelinePanel';
import { studioAssets, studioMessages, studioTasks } from './theme';

interface StudioShellProps {
  onExit: () => void;
  isExiting?: boolean;
}

export function StudioShell({ onExit, isExiting }: StudioShellProps) {
  return (
    <div className={`min-h-screen bg-bg-primary text-text-primary studio-shell-root ${
      isExiting ? 'animate-studio-exit' : 'animate-studio-entrance'
    }`}>
      {/* 氛围底色：多重径向渐变营造深邃感 */}
      <div className="fixed inset-0 pointer-events-none opacity-40">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] rounded-full bg-accent-rgb/10 blur-[120px]" />
        <div className="absolute bottom-[-5%] right-[-5%] w-[35%] h-[35%] rounded-full bg-accent-rgb/5 blur-[100px]" />
      </div>

      <div className="relative flex min-h-screen overflow-hidden backdrop-blur-[2px]">
        {/* 侧边栏不再是死板的线条，而是带有深度的浮动感 */}
        <StudioAssetsPanel assets={studioAssets} />
        
        <main className="flex min-w-0 flex-1 flex-col bg-bg-primary/30 shadow-[inset_0_0_40px_rgba(0,0,0,0.02)]">
          <StudioCommandPanel messages={studioMessages} onExit={onExit} />
        </main>

        <StudioPipelinePanel tasks={studioTasks} />
      </div>
    </div>
  );
}
