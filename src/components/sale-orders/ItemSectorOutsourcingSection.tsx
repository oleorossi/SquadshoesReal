import { useMemo, useState } from 'react';
import { Handshake, Warning, X } from '@phosphor-icons/react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useContractors } from '@/hooks/useContractors';
import { SERVICE_ORDER_SECTORS } from '@/lib/serviceOrderSectors';

/**
 * Terceirização por SETOR de UM item do pedido.
 *
 * Grava só a INTENÇÃO em `sale_order_items.outsourced_sectors`
 * (`{ setor: contractor_id }`). Nenhuma OS nasce daqui — ela é criada quando a
 * OP entra em produção, pelo trigger `tg_orders_generate_outsourcing_os`
 * (migration 20261030120000). Gerar OS no save do pedido foi o que produziu 276
 * OS canceladas de 279 na época do transbordo automático: cada edição do pedido
 * virava OS pra cancelar.
 *
 * ⚠ Só entra no mapa o par setor→prestador COMPLETO. Um setor "aceso" sem
 * prestador escolhido fica em estado PENDENTE, apenas local — gravar chave com
 * valor vazio faz o trigger de validação do banco recusar o save do PV inteiro.
 */

export interface ItemSectorOutsourcingSectionProps {
  /** Mapa atual `{ setor: contractor_id }`. */
  value?: Record<string, string> | null;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}

export function ItemSectorOutsourcingSection({
  value, onChange, disabled,
}: ItemSectorOutsourcingSectionProps) {
  const { data: contractors = [] } = useContractors();
  const map = value && typeof value === 'object' ? value : {};

  // Setor clicado mas ainda sem prestador. Vive só aqui: não pode ir pro mapa.
  const [pending, setPending] = useState<string[]>([]);

  const activeContractors = useMemo(
    () => (contractors as any[]).filter((c) => c.active),
    [contractors],
  );
  const contractorName = (id: string) => {
    const c = (contractors as any[]).find((x) => x.id === id);
    return c?.trade_name?.trim() || c?.name?.trim() || 'prestador';
  };

  const semPrestador = activeContractors.length === 0;
  const chosenSectors = Object.keys(map);

  const toggle = (sector: string) => {
    if (disabled || semPrestador) return;
    if (map[sector]) {
      const next = { ...map };
      delete next[sector];
      onChange(next);
      return;
    }
    setPending((p) => (p.includes(sector) ? p.filter((s) => s !== sector) : [...p, sector]));
  };

  const assign = (sector: string, contractorId: string) => {
    onChange({ ...map, [sector]: contractorId });
    setPending((p) => p.filter((s) => s !== sector));
  };

  const dropPending = (sector: string) => setPending((p) => p.filter((s) => s !== sector));

  // Linhas que precisam de um seletor: pendentes + já atribuídas (pra trocar).
  const rows = [...pending, ...chosenSectors.filter((s) => !pending.includes(s))];

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Handshake className="h-3.5 w-3.5" />
          Terceirizar setores
        </span>
        {chosenSectors.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {chosenSectors.length} pra fora · o resto fica na fábrica
          </span>
        )}
      </div>

      {semPrestador ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
          <Warning className="h-3.5 w-3.5 shrink-0" />
          Nenhum prestador ativo cadastrado — cadastre em Terceirizados pra poder
          mandar setor pra fora.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {SERVICE_ORDER_SECTORS.map((s) => {
              const on = !!map[s.value];
              const isPending = pending.includes(s.value);
              return (
                <button
                  key={s.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(s.value)}
                  aria-pressed={on}
                  className={cn(
                    'min-h-7 rounded-full border px-3 text-xs font-semibold transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    on && 'border-primary bg-primary text-primary-foreground',
                    isPending && 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                    !on && !isPending && 'border-border bg-transparent text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {rows.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {rows.map((sector) => {
                const label = SERVICE_ORDER_SECTORS.find((o) => o.value === sector)?.label ?? sector;
                const current = map[sector] || '';
                return (
                  <div key={sector} className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      'text-[10px] font-bold uppercase tracking-wider w-24 shrink-0',
                      current ? 'text-foreground' : 'text-amber-700 dark:text-amber-400',
                    )}>
                      {label}
                    </span>
                    <Select
                      value={current}
                      onValueChange={(v) => assign(sector, v)}
                      disabled={disabled}
                    >
                      <SelectTrigger className={cn(
                        'h-7 flex-1 min-w-[140px] text-xs',
                        !current && 'border-amber-500/60',
                      )}>
                        <SelectValue placeholder="Escolher prestador..." />
                      </SelectTrigger>
                      <SelectContent>
                        {activeContractors.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.trade_name?.trim() || c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!current && (
                      <button
                        type="button"
                        onClick={() => dropPending(sector)}
                        className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-destructive"
                        aria-label={`Cancelar terceirização de ${label}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {pending.length > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Setor sem prestador não é salvo — escolha um ou remova a marcação.
            </p>
          )}

          {chosenSectors.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {chosenSectors
                .map((s) => `${SERVICE_ORDER_SECTORS.find((o) => o.value === s)?.label ?? s} → ${contractorName(map[s])}`)
                .join(' · ')}
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Marcar aqui é intenção. A Ordem de Serviço é criada quando o pedido
            entra em produção.
          </p>
        </>
      )}
    </div>
  );
}
