import { useI18n } from '../../i18n';
import ManimCatLogo from '../../components/ManimCatLogo';
import type { StudioAssetItem } from '../types';

interface StudioAssetsPanelProps {
  assets: StudioAssetItem[];
}

export function StudioAssetsPanel({ assets }: StudioAssetsPanelProps) {
  const { t } = useI18n();

  function getStateLabel(state: StudioAssetItem['state']): string {
    switch (state) {
      case 'editing':
        return t('studio.assets.state.editing');
      case 'draft':
        return t('studio.assets.state.draft');
      default:
        return t('studio.assets.state.ready');
    }
  }

  return (
    <aside className="w-[280px] shrink-0 border-r border-border/5 px-8 pt-12 pb-8 flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.4em] text-text-secondary/40 font-medium">
            {t('studio.assets.title')}
          </span>
          <div className="p-2 rounded-xl bg-accent-rgb/5 text-accent-rgb/40">
            <ManimCatLogo className="h-5 w-5" />
          </div>
        </div>
        <p className="text-[11px] leading-6 text-text-secondary/50 font-light">
          {t('studio.assets.description')}
        </p>
      </div>

      <div className="flex-1 flex flex-col gap-2 -mx-4">
        {assets.map((asset) => (
          <div 
            key={asset.id} 
            className="group px-4 py-4 rounded-2xl transition-all hover:bg-bg-secondary/50 cursor-pointer active:scale-[0.98]"
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <p className="text-[14px] font-medium text-text-primary/80 group-hover:text-text-primary transition-colors">
                {asset.title}
              </p>
              <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-md uppercase tracking-widest ${
                asset.state === 'ready' ? 'bg-green-500/5 text-green-500/40' : 'bg-accent-rgb/5 text-accent-rgb/40'
              }`}>
                {getStateLabel(asset.state)}
              </span>
            </div>
            <p className="font-mono text-[10px] tracking-wider text-text-secondary/35">
              {asset.meta}
            </p>
          </div>
        ))}
      </div>

      <button className="w-full py-4 rounded-2xl border border-dashed border-border/10 text-[11px] uppercase tracking-widest text-text-secondary/30 transition-all hover:border-accent-rgb/20 hover:text-accent-rgb/50">
        + {t('studio.assets.newEntry')}
      </button>
    </aside>
  );
}
