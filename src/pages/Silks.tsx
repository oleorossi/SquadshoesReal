import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Paintbrush, Footprints, User, Users as UsersIcon } from 'lucide-react';
import { SilkGlobalPanel } from '@/components/technical-sheets/SilkGlobalPanel';
import { cn } from '@/lib/utils';

type Scope = 'default' | 'client' | 'economic_group';

const TABS: Array<{ key: Scope; label: string; icon: typeof Footprints; description: string }> = [
  {
    key: 'default',
    label: 'Por Solado',
    icon: Footprints,
    description: 'Silk padrão de cada solado — usada quando o cliente/grupo não tem silk própria',
  },
  {
    key: 'client',
    label: 'Por Cliente',
    icon: User,
    description: 'Silk customizada por cliente específico — sobrepõe a silk padrão do solado',
  },
  {
    key: 'economic_group',
    label: 'Por Grupo Econômico',
    icon: UsersIcon,
    description: 'Silk de todo um grupo econômico — sobrepõe a silk do solado mas é sobreposta pela do cliente',
  },
];

/**
 * Página centralizada de gestão de Silks.
 *
 * Cascata de resolução (do mais específico ao mais genérico):
 *   1. Silk do Cliente
 *   2. Silk do Grupo Econômico
 *   3. Silk padrão do Solado
 *
 * Layout: aba lateral (3 escopos) + conteúdo principal. Cada escopo reutiliza
 * o `SilkGlobalPanel` filtrado por escopo correspondente.
 */
export default function Silks() {
  const [scope, setScope] = useState<Scope>('default');
  const activeTab = TABS.find(t => t.key === scope)!;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Paintbrush className="h-7 w-7 text-primary mt-1" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Silks</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie as silks (estampas que vão coladas na forração) por solado, por cliente ou por
            grupo econômico. Cliente {'>'} Grupo {'>'} Solado na hora de aplicar nas fichas.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-4">
        {/* Aba lateral */}
        <Card className="h-fit sticky top-4">
          <CardContent className="p-2">
            <nav className="space-y-1">
              {TABS.map(t => {
                const Icon = t.icon;
                const isActive = scope === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setScope(t.key)}
                    className={cn(
                      'w-full flex items-start gap-2 px-3 py-2 rounded-md text-left transition-colors text-sm',
                      isActive
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'hover:bg-muted text-muted-foreground hover:text-foreground border border-transparent',
                    )}
                  >
                    <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', isActive ? 'text-primary' : '')} />
                    <div className="min-w-0">
                      <p className={cn('font-semibold leading-tight', isActive ? 'text-primary' : '')}>
                        {t.label}
                      </p>
                    </div>
                  </button>
                );
              })}
            </nav>
          </CardContent>
        </Card>

        {/* Conteúdo */}
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {activeTab.label}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{activeTab.description}</p>
          </div>
          <SilkGlobalPanel scope={scope} />
        </div>
      </div>
    </div>
  );
}
