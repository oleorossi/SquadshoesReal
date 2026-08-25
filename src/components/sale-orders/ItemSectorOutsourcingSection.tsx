import { useEffect, useMemo, useState } from 'react';
import { Handshake, Warning, X } from '@phosphor-icons/react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useContractors } from '@/hooks/useContractors';
import {
  useActiveReferenceTerceirizacoes,
  type ReferenceTerceirizacao,
} from '@/hooks/useReferenceTerceirizacoes';
import {
  REFERENCE_OUTSOURCE_SECTORS,
  hasValidServiceOrderMaterialComponents,
  isValidOutsourceCapacity,
  isValidOutsourceRate,
  isServiceOrderReturnAllowed,
  serviceOrderReturnSectorsFromSettings,
  type ServiceOrderOption,
} from '@/lib/serviceOrderSectors';
import { useSectorSettings } from '@/hooks/useProductionEngine';

function isReferencePlanningReady(
  config: ReferenceTerceirizacao,
  returnSectors: ReadonlyArray<ServiceOrderOption>,
): boolean {
  return REFERENCE_OUTSOURCE_SECTORS.some((option) => option.value === config.sector)
    && isValidOutsourceCapacity(config.capacity_pairs_per_day)
    && isValidOutsourceRate(config.value_per_pair)
    && isServiceOrderReturnAllowed(config.sector, config.return_before_sector, returnSectors)
    && hasValidServiceOrderMaterialComponents(config.material_components);
}

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
  referenceId: string;
  /** Mapa atual `{ setor: contractor_id }`. */
  value?: Record<string, string> | null;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}

export function ItemSectorOutsourcingSection({
  referenceId, value, onChange, disabled,
}: ItemSectorOutsourcingSectionProps) {
  const {
    data: contractors = [],
    isLoading: loadingContractors,
    isError: contractorsFailed,
    refetch: refetchContractors,
  } = useContractors();
  const {
    data: sectorSettings = [],
    isLoading: loadingSettings,
    isError: settingsFailed,
    refetch: refetchSettings,
  } = useSectorSettings();
  const {
    data: referenceConfigs = [],
    isLoading: loadingConfigs,
    isError: configsFailed,
    refetch: refetchConfigs,
  } = useActiveReferenceTerceirizacoes(referenceId);
  const map = value && typeof value === 'object' ? value : {};

  // Setor clicado mas ainda sem prestador. Vive só aqui: não pode ir pro mapa.
  const [pending, setPending] = useState<string[]>([]);

  useEffect(() => {
    setPending([]);
  }, [referenceId]);

  const activeContractorIds = useMemo(
    () => new Set(contractors.filter((contractor) => contractor.active).map((contractor) => contractor.id)),
    [contractors],
  );
  const liveReturnSectors = useMemo(
    () => serviceOrderReturnSectorsFromSettings(sectorSettings),
    [sectorSettings],
  );
  const configsBySector = useMemo(() => {
    const result = new Map<string, ReferenceTerceirizacao[]>();
    for (const config of referenceConfigs) {
      if (!isReferencePlanningReady(config, liveReturnSectors) || !activeContractorIds.has(config.contractor_id)) continue;
      const sectorConfigs = result.get(config.sector!) || [];
      sectorConfigs.push(config);
      result.set(config.sector!, sectorConfigs);
    }
    return result;
  }, [activeContractorIds, liveReturnSectors, referenceConfigs]);
  const contractorName = (id: string) => {
    const c = contractors.find((candidate) => candidate.id === id);
    return c?.trade_name?.trim() || c?.name?.trim() || 'prestador';
  };

  const loadingPlanning = loadingContractors || loadingSettings || loadingConfigs;
  const settingsMissing = !loadingSettings && !settingsFailed && sectorSettings.length === 0;
  const planningFailed = contractorsFailed || settingsFailed || settingsMissing || configsFailed;
  const semConfiguracao = !loadingPlanning && !planningFailed && configsBySector.size === 0;
  const chosenSectors = Object.keys(map);

  const toggle = (sector: string) => {
    const sectorConfigs = configsBySector.get(sector) || [];
    if (disabled) return;
    if (map[sector]) {
      const next = { ...map };
      delete next[sector];
      onChange(next);
      return;
    }
    if (sectorConfigs.length === 0) return;
    if (sectorConfigs.length === 1) {
      onChange({ ...map, [sector]: sectorConfigs[0].contractor_id });
      return;
    }
    setPending((p) => (p.includes(sector) ? p.filter((s) => s !== sector) : [...p, sector]));
  };

  const assign = (sector: string, contractorId: string) => {
    onChange({ ...map, [sector]: contractorId });
    setPending((p) => p.filter((s) => s !== sector));
  };

  const dropPending = (sector: string) => setPending((p) => p.filter((s) => s !== sector));
  const removeSector = (sector: string) => {
    if (disabled) return;
    const next = { ...map };
    delete next[sector];
    onChange(next);
    dropPending(sector);
  };

  // Linhas que precisam de um seletor: pendentes + já atribuídas (pra trocar).
  const rows = [...pending, ...chosenSectors.filter((s) => !pending.includes(s))];

  if (planningFailed) {
    return (
      <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Não foi possível conferir as configurações de terceirização. Nenhuma marcação salva foi alterada.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void Promise.all([refetchContractors(), refetchSettings(), refetchConfigs()])}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

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

      {semConfiguracao && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
          <Warning className="h-3.5 w-3.5 shrink-0" />
          Esta referência ainda não tem atividade externa completa. Configure
          atividade, prestador, capacidade, retorno e materiais na ficha técnica.
        </p>
      )}

      {(!semConfiguracao || chosenSectors.length > 0) && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {REFERENCE_OUTSOURCE_SECTORS.map((s) => {
              const on = !!map[s.value];
              const isPending = pending.includes(s.value);
              const configured = (configsBySector.get(s.value)?.length || 0) > 0;
              return (
                <button
                  key={s.value}
                  type="button"
                  disabled={disabled || loadingPlanning || !configured}
                  onClick={() => toggle(s.value)}
                  aria-pressed={on}
                  className={cn(
                    'min-h-7 rounded-full border px-3 text-xs font-semibold transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
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
                const label = REFERENCE_OUTSOURCE_SECTORS.find((o) => o.value === sector)?.label ?? sector;
                const current = map[sector] || '';
                const sectorConfigs = configsBySector.get(sector) || [];
                const configuredContractorIds = new Set(sectorConfigs.map((config) => config.contractor_id));
                const invalidSavedChoice = !!current && !configuredContractorIds.has(current);
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
                      disabled={disabled || sectorConfigs.length === 0}
                    >
                      <SelectTrigger className={cn(
                        'h-7 flex-1 min-w-[140px] text-xs',
                        !current && 'border-amber-500/60',
                      )}>
                        <SelectValue placeholder="Escolher prestador..." />
                      </SelectTrigger>
                      <SelectContent>
                        {sectorConfigs.map((config) => {
                          const contractor = contractors.find((candidate) => candidate.id === config.contractor_id);
                          return (
                            <SelectItem key={config.id} value={config.contractor_id}>
                              {contractor?.trade_name?.trim() || contractor?.name || 'Prestador configurado'}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {(!current || invalidSavedChoice) && (
                      <button
                        type="button"
                        onClick={() => (invalidSavedChoice ? removeSector(sector) : dropPending(sector))}
                        className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-destructive"
                        aria-label={`Remover terceirização de ${label}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {invalidSavedChoice && (
                      <span className="w-full pl-24 text-[10px] text-amber-700 dark:text-amber-400">
                        O prestador salvo não possui mais configuração completa nesta ficha; remova ou escolha uma opção válida.
                      </span>
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
                .map((s) => `${REFERENCE_OUTSOURCE_SECTORS.find((o) => o.value === s)?.label ?? s} → ${contractorName(map[s])}`)
                .join(' · ')}
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Só aparecem como selecionáveis as atividades completas da ficha. A
            marcação é intenção; a OS nasce quando o pedido entra em produção.
          </p>
        </>
      )}
    </div>
  );
}
