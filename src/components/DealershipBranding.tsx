import { DEALERSHIP_CODE, DEALERSHIP_DISPLAY_NAME } from '@/lib/constants';

interface DealershipBrandingProps {
  size?: 'lg' | 'md' | 'sm';
  className?: string;
}

export function DealershipBranding({ size = 'lg', className = '' }: DealershipBrandingProps) {
  const nameClass =
    size === 'lg'
      ? 'text-2xl font-semibold tracking-tight'
      : size === 'md'
        ? 'text-xl font-semibold tracking-tight'
        : 'text-sm font-semibold tracking-tight leading-tight';

  const codeClass =
    size === 'lg'
      ? 'text-sm text-[#8e8e93] mt-1 tracking-[0.25em] font-medium'
      : size === 'md'
        ? 'text-xs text-[#8e8e93] mt-0.5 tracking-[0.25em] font-medium'
        : 'text-[10px] text-[#8e8e93] tracking-[0.2em] font-medium';

  return (
    <div className={`text-center ${className}`}>
      <div className={nameClass}>{DEALERSHIP_DISPLAY_NAME}</div>
      <div className={codeClass}>{DEALERSHIP_CODE}</div>
    </div>
  );
}