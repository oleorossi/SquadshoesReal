/**
 * Padrão da ficha e quem atende cada setor de rua.
 * A tarifa e o prazo continuam no cadastro de terceirizados.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useContractors, type Contractor } from '@/hooks/useContractors';
import {
  useAtelierContractorSectors,
  useSetAtelierReferenceDefault,
  useUpsertAtelierContractorSector,
} from '@/hooks/useAtelier';
import {
  ATELIER_EXECUTION_MODE_LABEL,
  ATELIER_SECTOR_LABEL,
  type AtelierExecutionMode,
  type AtelierSector,
} from '@/lib/atelier';
import {
  atelierContractorCanTake,
  atelierRateSector,
  atelierStreetSector,
} from '@/lib/atelierAdmin';
import { formatCurrency } from '@/lib/utils';

const INHERIT = '__inherit__';
const NONE = '__none__';

interface RateRow {
  contractor_id: string;
  sector: string;
  price_per_pair: number;
  valid_to: string | null;
}

function useOpenRates() {
  return useQuery({
    queryKey: ['contractor_service_rates', 'atelier-open'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contractor_service_rates')
        .select('contractor_id, sector, price_per_pair, valid_to')
        .is('valid_to', null);
      if (error) throw error;
      return (data ?? []) as RateRow[];
    },
    staleTime: 30_000,
  });
}

export function AtelierExecutionDefaultControl({
  referenceId,
  sector,
  mode,
  contractorId,
}: {
  referenceId: string;
  sector: AtelierSector;
  mode: AtelierExecutionMode | null;
  contractorId: string | null;
}) {
  const save = useSetAtelierReferenceDefault();
  const { data: contractors = [] } = useContractors();
  const { data: sectors = [] } = useAtelierContractorSectors();
  if (!atelierStreetSector(sector)) return null;

  const eligible = (contractors as Contractor[]).filter((c) =>
    atelierContractorCanTake(c, sector, sectors),
  );
  const modeValue = mode === 'internal' || mode === 'contractor' ? mode : INHERIT;

  const commit = (nextMode: AtelierExecutionMode | null, nextContractor: string | null) => {
    save.mutate({
      referenceId,
      sector,
      mode: nextMode,
      contractorId: nextMode === 'contractor' ? nextContractor : null,
    });
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-xs">Quem faz por padrão</Label>
        <Select
          value={modeValue}
          onValueChange={(value) => {
            if (value === INHERIT) commit(null, null);
            else if (value === 'internal') commit('internal', null);
            else commit('contractor', contractorId);
          }}
          disabled={save.isPending}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Quem faz por padrão">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>Como o pedido</SelectItem>
            <SelectItem value="internal">{ATELIER_EXECUTION_MODE_LABEL.internal}</SelectItem>
            <SelectItem value="contractor">{ATELIER_EXECUTION_MODE_LABEL.contractor}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === 'contractor' && (
        <div className="space-y-1">
          <Label className="text-xs">Prestador sugerido</Label>
          <Select
            value={contractorId || NONE}
            onValueChange={(value) => commit('contractor', value === NONE ? null : value)}
            disabled={save.isPending}
          >
            <SelectTrigger className="h-8 text-xs" aria-label="Prestador sugerido">
              <SelectValue placeholder="Sem sugestão" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sem sugestão</SelectItem>
              {eligible.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {eligible.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              Nenhum prestador ativo para {ATELIER_SECTOR_LABEL[sector].toLowerCase()}.
            </p>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        O job novo copia este padrão. Até o corte, a fila ainda pode trocar.
      </p>
    </div>
  );
}

function CapacityField({
  value,
  disabled,
  onCommit,
}: {
  value: number | null;
  disabled: boolean;
  onCommit: (next: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  return (
    <Input
      inputMode="numeric"
      className="h-8 w-24 font-mono text-xs"
      aria-label="Pares por dia"
      disabled={disabled}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const trimmed = text.trim();
        if (!trimmed) {
          onCommit(null);
          return;
        }
        const n = Number(trimmed.replace(',', '.'));
        if (!Number.isFinite(n) || n <= 0) {
          setText(value == null ? '' : String(value));
          return;
        }
        onCommit(n);
      }}
    />
  );
}

export function AtelierSectorAdmin({ sector }: { sector: AtelierSector }) {
  const street = atelierStreetSector(sector);
  const { data: contractors = [], isLoading } = useContractors();
  const { data: sectors = [] } = useAtelierContractorSectors();
  const { data: rates = [] } = useOpenRates();
  const save = useUpsertAtelierContractorSector();
  if (!street) return null;

  const rateSector = atelierRateSector(sector);
  const people = (contractors as Contractor[])
    .filter((c) => c.active && (Number(c.payment_days) || 0) < 999)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Prestadores de {ATELIER_SECTOR_LABEL[sector].toLowerCase()}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Marque quem atende e a capacidade do dia. A tarifa vigente é a que trava no envio.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-8" asChild>
          <Link to="/terceirizados">Cadastro e tarifa</Link>
        </Button>
      </header>
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum prestador ativo. O nome e o prazo ficam em Terceirizados.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {people.map((person) => {
            const row = sectors.find((s) => s.contractor_id === person.id && s.sector === sector);
            const serves = !!row?.active;
            const rate = rates.find((r) => r.contractor_id === person.id && r.sector === rateSector);
            const lead = (person as Contractor & { default_lead_days?: number | null }).default_lead_days;
            return (
              <li key={person.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-[140px] flex-1">
                  <p className="text-sm text-foreground">{person.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {rate ? formatCurrency(rate.price_per_pair) + '/par' : 'Sem tarifa neste setor'}
                    {lead != null ? ` · prazo ${lead} dias` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`cap-${person.id}`} className="text-[11px] text-muted-foreground">
                    Pares/dia
                  </Label>
                  <CapacityField
                    key={`${person.id}-${row?.capacity_pairs_per_day ?? 'vazio'}`}
                    value={row?.capacity_pairs_per_day ?? null}
                    disabled={save.isPending}
                    onCommit={(next) => {
                      save.mutate({
                        contractorId: person.id,
                        sector,
                        capacity: next,
                        active: next == null ? serves : true,
                      });
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`serve-${person.id}`} className="text-xs">Atende</Label>
                  <Switch
                    id={`serve-${person.id}`}
                    checked={serves}
                    disabled={save.isPending}
                    onCheckedChange={(next) => {
                      save.mutate({
                        contractorId: person.id,
                        sector,
                        capacity: row?.capacity_pairs_per_day ?? null,
                        active: next,
                      });
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
