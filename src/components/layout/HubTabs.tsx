import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Icon as LucideIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export interface HubTab {
  value: string;
  label: string;
  icon?: LucideIcon;
  badge?: number | string;
}

interface HubTabsListProps {
  tabs: HubTab[];
  className?: string;
  size?: 'sm' | 'md';
  /** Nome anunciado para a navegação entre as seções do hub. */
  ariaLabel?: string;
}

/**
 * Shared tab list for all hub pages — ensures consistent spacing, font size,
 * active state, and horizontal-scroll behaviour across the entire app.
 */
export function HubTabsList({ tabs, className, size = 'sm', ariaLabel = 'Seções da página' }: HubTabsListProps) {
  return (
    <div
      className="overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0 pb-px"
      aria-label={ariaLabel}
    >
      <TabsList
        className={cn(
          "inline-flex w-max h-auto gap-0.5 bg-muted/40 border border-border/50 rounded-lg p-1",
          className
        )}
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className={cn(
              "relative flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all snap-start",
              "text-muted-foreground hover:text-foreground",
              "data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground",
              size === 'sm' ? "text-xs px-3 py-2 md:min-h-8 md:py-1.5" : "text-sm px-4 py-2"
            )}
          >
            {tab.icon && (
              <tab.icon
                className={cn(
                  "shrink-0",
                  size === 'sm' ? "h-3.5 w-3.5" : "h-4 w-4"
                )}
              />
            )}
            {tab.label}
            {tab.badge !== undefined && (
              <span className="ml-0.5 min-w-[18px] h-[18px] rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center px-1 leading-none">
                {tab.badge}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
