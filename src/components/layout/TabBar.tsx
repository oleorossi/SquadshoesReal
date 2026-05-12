/**
 * Barra de abas no topo do AppLayout — mostra páginas abertas e permite
 * trocar entre elas. Aba ativa highlighted, X pra fechar.
 */
import { useTabs } from '@/contexts/TabsContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { X } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function TabBar() {
  const { tabs, activeId, closeTab, setActiveTab } = useTabs();

  if (tabs.length === 0) return null;

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex items-end gap-0.5 px-2 pt-1 overflow-x-auto scrollbar-thin border-b border-border bg-muted/30">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={cn(
                'group relative flex items-center gap-1.5 pl-3 pr-1 py-1.5 text-xs rounded-t-md border border-b-0 max-w-[200px] shrink-0 transition-colors cursor-pointer',
                isActive
                  ? 'bg-card border-border text-foreground font-medium shadow-[0_1px_0_0_hsl(var(--card))]'
                  : 'bg-muted/40 border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
              onClick={() => setActiveTab(tab.id)}
              title={tab.path}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate select-none">{tab.title}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div>{tab.title}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{tab.path}</div>
                </TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-4 w-4 rounded p-0 shrink-0',
                  isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:opacity-100'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label={`Fechar ${tab.title}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
