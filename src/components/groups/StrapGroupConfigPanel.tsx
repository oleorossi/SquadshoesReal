/**
 * Cadastro canônico de origem + rendimento m/m da tira no grupo de estoque
 * (specs/tira-material-de-estoque.md R3/R18). O PV só lê o resultado.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Scissors, Trash } from '@phosphor-icons/react';
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
import { useContractors } from '@/hooks/useContractors';
import {
  useSetStrapGroupNapaYield,
  useStrapGroupNapaYields,
  useStrapNapaBaseCandidates,
  type StrapOrigin,
} from '@/hooks/useStrapGroupYields';

const ORIGIN_OPTIONS: { value: StrapOrigin; label: string; hint: string }[] = [
  {
    value: 'prestador',
    label: 'Prestador',
    hint: 'Compra a napa e envia ao prestador. A tira pronta entra no estoque no Recebido do Ateliê.',
  },
  {
    value: 'fabrica',
    label: 'Fábrica',
    hint: 'Corta a tira no Ateliê (Produzido): baixa napa e entra a tira.',
  },
  {
    value: 'comprar_pronto',
    label: 'Comprar pronto',
    hint: 'Compra o SKU da tira acabada. Não movimenta napa.',
  },
];

interface StrapGroupConfigPanelProps {
  groupId: string;
  strapOrigin: StrapOrigin | null;
  onStrapOriginChange: (value: StrapOrigin | null) => void;
  laborCostPerM: number | null;
  onLaborCostPerMChange: (value: number | null) => void;
  defaultContractorId: string | null;
  onDefaultContractorIdChange: (value: string | null) => void;
}

export default function StrapGroupConfigPanel({
  groupId,
  strapOrigin,
  onStrapOriginChange,
  laborCostPerM,
  onLaborCostPerMChange,
  defaultContractorId,
  onDefaultContractorIdChange,
}: StrapGroupConfigPanelProps) {
  const { data: yields = [], isLoading: yieldsLoading } = useStrapGroupNapaYields(groupId, true);
  const { data: napaCandidates = [] } = useStrapNapaBaseCandidates(true);
  const { data: contractors = [] } = useContractors();
  const setYield = useSetStrapGroupNapaYield();

  const [draftYields, setDraftYields] = useState<Record<string, string>>({});
  const [newNapaId, setNewNapaId] = useState<string>('');
  const [newYield, setNewYield] = useState<string>('');

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const row of yields) {
      next[row.napa_group_id] = row.yield_m_per_m != null
        ? String(row.yield_m_per_m)
        : '';
    }
    setDraftYields(next);
  }, [yields]);

  const usedNapaIds = useMemo(
    () => new Set(yields.map((y) => y.napa_group_id)),
    [yields],
  );
  const availableNapas = useMemo(
    () => napaCandidates.filter((n) => !usedNapaIds.has(n.id)),
    [napaCandidates, usedNapaIds],
  );

  const originMeta = ORIGIN_OPTIONS.find((o) => o.value === strapOrigin);
  const needsLabor = strapOrigin === 'prestador' || strapOrigin === 'fabrica';

  const saveYield = (napaGroupId: string, raw: string) => {
    const trimmed = raw.trim().replace(',', '.');
    if (!trimmed) {
      setYield.mutate({ strapGroupId: groupId, napaGroupId, yieldMPerM: null });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value <= 0) return;
    const current = yields.find((y) => y.napa_group_id === napaGroupId)?.yield_m_per_m;
    if (current != null && Math.abs(current - value) < 1e-9) return;
    setYield.mutate({ strapGroupId: groupId, napaGroupId, yieldMPerM: value });
  };

  const addYield = () => {
    if (!newNapaId) return;
    const value = Number(String(newYield).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return;
    setYield.mutate(
      { strapGroupId: groupId, napaGroupId: newNapaId, yieldMPerM: value },
      {
        onSuccess: () => {
          setNewNapaId('');
          setNewYield('');
        },
      },
    );
  };

  return (
    <div className="space-y-4 border border-foreground/15 bg-muted/20 p-4">
      <div className="flex items-start gap-3">
        <Scissors className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Tira — origem e rendimento</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cadastre aqui o rendimento (m de tira por m de napa). No pedido de venda o sistema
            só calcula quantos metros de napa enviar — não edita o rendimento por PV.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Origem padrão</Label>
          <Select
            value={strapOrigin ?? '__none__'}
            onValueChange={(v) => onStrapOriginChange(v === '__none__' ? null : v as StrapOrigin)}
          >
            <SelectTrigger className="mt-1 h-9">
              <SelectValue placeholder="Definir origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sem origem (assume Comprar pronto)</SelectItem>
              {ORIGIN_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {originMeta && (
            <p className="mt-1 text-[10px] text-muted-foreground">{originMeta.hint}</p>
          )}
        </div>

        {needsLabor && (
          <div>
            <Label className="text-xs">Mão de obra (R$/m)</Label>
            <Input
              className="mt-1 h-9 font-mono"
              inputMode="decimal"
              value={laborCostPerM == null ? '' : String(laborCostPerM)}
              onChange={(e) => {
                const raw = e.target.value.trim().replace(',', '.');
                if (!raw) {
                  onLaborCostPerMChange(null);
                  return;
                }
                const n = Number(raw);
                if (Number.isFinite(n) && n >= 0) onLaborCostPerMChange(n);
              }}
              placeholder="0,10"
            />
          </div>
        )}
      </div>

      {strapOrigin === 'prestador' && (
        <div>
          <Label className="text-xs">Prestador padrão</Label>
          <Select
            value={defaultContractorId ?? '__none__'}
            onValueChange={(v) => onDefaultContractorIdChange(v === '__none__' ? null : v)}
          >
            <SelectTrigger className="mt-1 h-9">
              <SelectValue placeholder="Escolher prestador" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sem prestador padrão</SelectItem>
              {(contractors as Array<{ id: string; name: string; active?: boolean }>)
                .filter((c) => c.active !== false)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {needsLabor && (
        <div className="space-y-2">
          <Label className="text-xs">Rendimento por napa-base (m/m)</Label>
          {yieldsLoading ? (
            <p className="text-xs text-muted-foreground">Carregando rendimentos…</p>
          ) : yields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum rendimento cadastrado. Sem ele o PV salva, mas o Ateliê pede o número antes
              de gerar OC/Produzido.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {yields.map((row) => (
                <li
                  key={row.napa_group_id}
                  className="flex flex-wrap items-center gap-2 border border-border/60 bg-background px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {row.napa_group_name}
                  </span>
                  <Input
                    className="h-8 w-24 font-mono text-xs"
                    inputMode="decimal"
                    value={draftYields[row.napa_group_id] ?? ''}
                    onChange={(e) => setDraftYields((prev) => ({
                      ...prev,
                      [row.napa_group_id]: e.target.value,
                    }))}
                    onBlur={() => saveYield(
                      row.napa_group_id,
                      draftYields[row.napa_group_id] ?? '',
                    )}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    aria-label={`Rendimento ${row.napa_group_name}`}
                  />
                  <span className="text-[10px] text-muted-foreground">m/m</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    disabled={setYield.isPending}
                    onClick={() => setYield.mutate({
                      strapGroupId: groupId,
                      napaGroupId: row.napa_group_id,
                      yieldMPerM: null,
                    })}
                    aria-label={`Remover rendimento ${row.napa_group_name}`}
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {availableNapas.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 border border-dashed border-border/60 p-2">
              <div className="min-w-[10rem] flex-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Nova napa
                </Label>
                <Select value={newNapaId || undefined} onValueChange={setNewNapaId}>
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue placeholder="Escolher napa" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableNapas.map((n) => (
                      <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Rend. m/m
                </Label>
                <Input
                  className="mt-1 h-8 font-mono text-xs"
                  inputMode="decimal"
                  value={newYield}
                  onChange={(e) => setNewYield(e.target.value)}
                  placeholder="70"
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={!newNapaId || !newYield || setYield.isPending}
                onClick={addYield}
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
