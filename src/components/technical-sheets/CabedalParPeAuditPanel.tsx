/**
 * Painel "Padrão de consumo de cabedal (par × pé)" — /system-diagnostics → Consumo.
 *
 * Spec: specs/consumo-cabedal-padrao-par.md (R3+R4).
 *
 * O canônico do consumo de cabedal é POR PAR, mas algumas fichas foram
 * preenchidas com o valor POR PÉ (metade do real) → subcusteiam ~2×. Não dá
 * pra separar por regra numérica cega (unidades misturadas dm²/par × m/par,
 * placeholders copiados, lixo tipo 2000), então a normalização é ASSISTIDA:
 * este painel lista as fichas com material de cabedal, mostra a leitura por
 * par e por pé (÷2) e SINALIZA suspeitas (heurística: valor ≈ 40–60% do maior
 * valor sano do MESMO material). Nada vem pré-marcado — o usuário marca as
 * que sabe terem sido preenchidas por pé e aplica ×2 em lote (RPC
 * double_upper_consumption: dobra escalar + cada chave do JSONB por
 * numeração, inclusive conjugadas "33/34").
 *
 * ⚠ A ação NÃO é idempotente: aplicar 2× dobra 2× (por isso o diálogo de
 * confirmação). Após corrigir, PVs com custo CONGELADO (snapshot) continuam
 * com o valor antigo até recalcular — ver memória cost_snapshot_freeze.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Warning as AlertTriangle, CircleNotch as Loader2, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type AuditRow = {
  id: string;
  name: string;
  model: string | null;
  upper_material: string;
  /** Valor armazenado — POR PAR (canônico). */
  perPair: number;
  /** Quantas numerações preenchidas no JSONB (contexto). */
  perSizeCount: number;
  /** Unidade de consumo do grupo (só contexto — o ×2 é independente de unidade). */
  unit: string;
  /** Heurística: ≈ metade (40–60%) do maior valor sano do mesmo material. */
  suspectPerFoot: boolean;
  /** Badges neutros — casos não-decidíveis por regra. */
  isEmpty: boolean;
  isOutlier: boolean;
  isNonCabedalMaterial: boolean;
};

/** Lixo/placeholder: valor ≥ 100 não é consumo plausível de cabedal em nenhuma
 *  unidade usada (dm²/par fica na casa das dezenas; m/par abaixo de ~10). */
const OUTLIER_THRESHOLD = 100;
/** Material cujo nome indica fluxo próprio (tiras/elástico) — não é cabedal.
 *  Testado sobre o nome SEM acentos (senão "ELÁSTICO" escapa do /elast/). */
const NON_CABEDAL_RE = /tira|elast|strass/i;
const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function CabedalParPeAuditPanel() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: rows, isLoading, refetch } = useQuery({
    queryKey: ['technical_sheets', 'cabedal-par-pe-audit'],
    queryFn: async (): Promise<AuditRow[]> => {
      const { data: sheets, error } = await supabase
        .from('technical_sheets')
        .select('id, name, model, upper_material, upper_consumption, upper_consumption_per_size');
      if (error) throw error;

      const withCabedal = (sheets || []).filter((s: any) =>
        (s.upper_material || '').trim() !== ''
        || Number(s.upper_consumption || 0) > 0
        || Object.values(s.upper_consumption_per_size || {}).some((value) => Number(value) > 0));

      // Unidade de consumo do grupo — só contexto (mesma precedência resumida do
      // editor: material de bobina/área → dm²; senão unidade do produto ativo).
      const groupNames = [...new Set(withCabedal.map((s: any) => (s.upper_material || '').trim()).filter(Boolean))];
      const { data: groups } = groupNames.length > 0
        ? await supabase.from('product_groups')
            .select('id, name, consumption_unit, dimensions_width, dimensions_length')
            .in('name', groupNames)
        : { data: [] as any[] };
      const groupIds = (groups || []).map((g: any) => g.id);
      const { data: prods } = groupIds.length > 0
        ? await supabase.from('products').select('group_id, unit, active').in('group_id', groupIds)
        : { data: [] as any[] };

      const unitForGroup = (groupName: string): string => {
        const g: any = (groups || []).find((x: any) => (x.name || '').trim() === groupName.trim());
        if (!g) return 'un';
        const prod: any = (prods || []).find((p: any) => p.group_id === g.id && p.active && (p.unit || '').trim())
          || (prods || []).find((p: any) => p.group_id === g.id && (p.unit || '').trim());
        const prodUnit = (prod?.unit || '').toString().trim();
        if (['m', 'cm', 'metro', 'metros', 'mt'].includes(prodUnit.toLowerCase())) {
          const consUnit = (g?.consumption_unit || '').toString().trim().toLowerCase().replace(/2/g, '²');
          const isArea = ['dm²', 'm²', 'cm²'].includes(consUnit);
          if (Number(g?.dimensions_width) > 0 || isArea || Number(g?.dimensions_length) > 0) return 'dm²';
        }
        return prodUnit || (g?.consumption_unit || '').toString().trim() || 'un';
      };

      // Referência por material: MAIOR valor sano (>0 e < outlier) do grupo.
      const maxByMaterial = new Map<string, number>();
      for (const s of withCabedal) {
        const key = (s.upper_material || '').trim().toLowerCase();
        const v = Number(s.upper_consumption || 0);
        if (v > 0 && v < OUTLIER_THRESHOLD) {
          maxByMaterial.set(key, Math.max(maxByMaterial.get(key) || 0, v));
        }
      }

      return withCabedal.map((s: any): AuditRow => {
        const material = (s.upper_material || '').trim();
        const perPair = Number(s.upper_consumption || 0);
        const perSize = (s.upper_consumption_per_size || {}) as Record<string, number>;
        const perSizeCount = Object.values(perSize).filter(v => Number(v) > 0).length;
        const isEmpty = perPair <= 0 && perSizeCount === 0;
        const isOutlier = perPair >= OUTLIER_THRESHOLD;
        const isNonCabedalMaterial = NON_CABEDAL_RE.test(stripAccents(material));
        const ref = maxByMaterial.get(material.toLowerCase()) || 0;
        const ratio = ref > 0 ? perPair / ref : 0;
        const suspectPerFoot = !isEmpty && !isOutlier && !isNonCabedalMaterial
          && ratio >= 0.4 && ratio <= 0.6;
        return {
          id: s.id, name: s.name || '—', model: s.model || null, upper_material: material,
          perPair, perSizeCount, unit: material ? unitForGroup(material) : 'un',
          suspectPerFoot, isEmpty, isOutlier, isNonCabedalMaterial,
        };
      }).sort((a, b) => Number(b.suspectPerFoot) - Number(a.suspectPerFoot) || a.name.localeCompare(b.name));
    },
  });

  const applyDouble = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await (supabase as any).rpc('double_upper_consumption', { p_sheet_ids: ids });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      toast.success(`${n} ficha(s) atualizadas — consumo de cabedal dobrado (por pé → por par).`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['technical_sheets'] });
    },
    onError: (e: any) => toast.error('Falha ao aplicar ×2: ' + e.message),
  });

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  const selectedCount = selected.size;

  return (
    <Panel
      eyebrow="PCP · CONSUMO"
      title="Padrão de consumo de cabedal (par × pé)"
      subtitle="O canônico é POR PAR. Fichas preenchidas com o valor por pé gravam METADE do consumo real (subcusteiam ~2×). Marque as que foram preenchidas por pé e aplique ×2 — dobra o escalar e cada numeração. A suspeita é só uma dica (≈ metade do maior valor do mesmo material); a decisão é sua."
      actions={
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className="h-4 w-4 mr-2" /> Recarregar
          </Button>
          <Button
            size="sm"
            disabled={selectedCount === 0 || applyDouble.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {applyDouble.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <AlertTriangle className="h-4 w-4 mr-2" weight="fill" />}
            Aplicar ×2 ({selectedCount})
          </Button>
        </div>
      }
      bodyClassName="space-y-2"
    >
      {isLoading && <p className="text-sm text-muted-foreground">Carregando fichas…</p>}
      {!isLoading && (rows ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma ficha com material de cabedal encontrada.</p>
      )}
      {(rows ?? []).map((r) => (
        <div key={r.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
          <Checkbox
            className="mt-0.5"
            checked={selected.has(r.id)}
            onCheckedChange={() => toggle(r.id)}
            aria-label={`Selecionar ${r.name}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-foreground">{r.name}{r.model ? ` · ${r.model}` : ''}</p>
              <Badge variant="secondary" className="text-xs">{r.upper_material || 'sem material'}</Badge>
              {r.suspectPerFoot && (
                <Badge variant="outline" className="text-xs uppercase text-warning border-warning/40">
                  suspeita: por pé
                </Badge>
              )}
              {r.isEmpty && <Badge variant="outline" className="text-xs uppercase text-muted-foreground">vazio</Badge>}
              {r.isOutlier && <Badge variant="outline" className="text-xs uppercase text-muted-foreground">valor atípico — revisar na ficha</Badge>}
              {r.isNonCabedalMaterial && <Badge variant="outline" className="text-xs uppercase text-muted-foreground">material não-cabedal</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
              Por par: <strong className="text-foreground">{fmt(r.perPair)} {r.unit}/par</strong>
              <span className="mx-1.5">·</span>
              Por pé (÷2): {fmt(r.perPair / 2)} {r.unit}/pé
              <span className="mx-1.5">·</span>
              {r.perSizeCount > 0 ? `${r.perSizeCount} numeração(ões) preenchidas` : 'sem grade por numeração'}
            </p>
          </div>
        </div>
      ))}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dobrar consumo de cabedal de {selectedCount} ficha(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              O escalar e <strong>cada numeração</strong> (inclusive conjugadas) das fichas
              selecionadas serão multiplicados por 2 — use apenas nas fichas preenchidas
              com o valor <strong>por pé</strong>. A ação não é idempotente: aplicar de novo
              dobra de novo. PVs com custo congelado precisam de recálculo depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => applyDouble.mutate([...selected])}>
              Aplicar ×2
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
