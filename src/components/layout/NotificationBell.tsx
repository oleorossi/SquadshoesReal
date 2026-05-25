import { Bell, CurrencyDollar as DollarSign, Package, Factory, Users as Users2, Package as PackageSearch, ArrowSquareOut as ExternalLink } from '@phosphor-icons/react';
import { useNotifications, NotificationItem } from '@/hooks/useNotifications';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

const CATEGORY_ICON: Record<string, typeof DollarSign> = {
  finance: DollarSign,
  stock: Package,
  production: Factory,
  hr: Users2,
  purchasing: PackageSearch,
};

const CATEGORY_LABEL: Record<string, string> = {
  finance: 'Financeiro',
  stock: 'Estoque',
  production: 'Produção',
  hr: 'RH',
  purchasing: 'Compras',
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-l-destructive bg-destructive/5',
  warning: 'border-l-warning bg-warning/5',
  info: 'border-l-primary bg-primary/5',
};

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-destructive',
  warning: 'bg-warning',
  info: 'bg-primary',
};

 export default function NotificationBell({ className }: { className?: string }) {
  const { data } = useNotifications();
  // Guard defensivo: se cache cruzado entregar um objeto (em vez de array),
  // não quebra a render. Vide PR queryKey collision 2026-05-24.
  const notifications = Array.isArray(data) ? data : [];
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const criticalCount = notifications.filter(n => n.severity === 'critical').length;
  const totalCount = notifications.length;

  const handleClick = (n: NotificationItem) => {
    if (n.link) {
      navigate(n.link);
      setOpen(false);
    }
  };

  // Group by category
  const grouped = notifications.reduce<Record<string, NotificationItem[]>>((acc, n) => {
    (acc[n.category] ||= []).push(n);
    return acc;
  }, {});

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
           className={cn("relative h-9 w-9 rounded-lg flex items-center justify-center text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors", className)}
          aria-label="Notificações"
        >
          <Bell className="h-[18px] w-[18px]" />
          {totalCount > 0 && (
            <span
              className={cn(
                'absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full text-xs font-bold flex items-center justify-center px-1 ring-2 ring-sidebar',
                criticalCount > 0
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-warning text-warning-foreground'
              )}
            >
              {totalCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[380px] p-0 max-h-[480px] overflow-auto"
        side="right"
        align="start"
        sideOffset={8}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border sticky top-0 bg-popover z-10">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">Notificações</h3>
            {totalCount > 0 && (
              <Badge variant={criticalCount > 0 ? 'destructive' : 'secondary'} className="text-xs">
                {totalCount} alerta{totalCount !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>

        {totalCount === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma notificação no momento 🎉
          </div>
        ) : (
          <div className="divide-y divide-border">
            {Object.entries(grouped).map(([category, items]) => {
              const Icon = CATEGORY_ICON[category] || Bell;
              return (
                <div key={category}>
                  <div className="px-4 py-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground bg-muted/30">
                    <Icon className="h-3.5 w-3.5" />
                    {CATEGORY_LABEL[category] || category}
                  </div>
                  {items.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className={cn(
                        'w-full text-left px-4 py-3 border-l-[3px] hover:bg-accent/50 transition-colors flex items-start gap-3 group',
                        SEVERITY_STYLES[n.severity]
                      )}
                    >
                      <div className={cn('h-2 w-2 rounded-full mt-1.5 shrink-0', SEVERITY_DOT[n.severity])} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-tight">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.description}</p>
                      </div>
                      {n.link && (
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground shrink-0 mt-0.5 transition-colors" />
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
