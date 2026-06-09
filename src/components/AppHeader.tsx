import { Settings } from 'lucide-react';
import { DealershipBranding } from '@/components/DealershipBranding';

interface AppHeaderProps {
  technicianName?: string;
  onOpenSettings: () => void;
}

export function AppHeader({ technicianName, onOpenSettings }: AppHeaderProps) {
  return (
    <header className="ios-header px-4 py-2 flex items-center justify-between sticky top-0 z-50">
      <div className="w-8 shrink-0" />
      <div className="flex-1 min-w-0 px-2">
        <DealershipBranding size="sm" />
        {technicianName && (
          <p className="text-[9px] text-[#8e8e93] text-center truncate mt-0.5">{technicianName}</p>
        )}
      </div>
      <button onClick={onOpenSettings} className="p-2 text-[#8e8e93] shrink-0 w-8">
        <Settings size={20} />
      </button>
    </header>
  );
}