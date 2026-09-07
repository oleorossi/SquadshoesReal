/**
 * Plano de inspeção por família de solado — limites aprovados com lab/fornecedor.
 *
 * Não inventa Shore/abrasão/flexão: campos começam vazios. O gate
 * `block_lot_without_test` fica desligado por padrão até o dono decidir.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { FloppyDisk as Save, CircleNotch as Loader2, Flask as FlaskConical, Info } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
  EMPTY_SOLE_INSPECTION_PLAN,
  parseSoleInspectionPlan,
  serializeSoleInspectionPlan,
  soleInspectionPlanIsEmpty,
  type SoleInspectionPlan,
} from '@/lib/soleInspectionPlan';

interface Props {
  soleGroupId: string | null;
  soleGroupName?: string;
}

export default function SoleInspectionPlanPanel({ soleGroupId, soleGroupName }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<SoleInspectionPlan>(EMPTY_SOLE_INSPECTION_PLAN);

  const { data, isLoading } = useQuery({
    queryKey: ['sole_inspection_plan', soleGroupId],
    enabled: !!soleGroupId,
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from('product_groups')
        .select('id, name, sole_inspection_plan')
        .eq('id', soleGroupId!)
        .maybeSingle();
      if (error) throw error;
      return row;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    setForm(parseSoleInspectionPlan(data?.sole_inspection_plan));
  }, [data?.sole_inspection_plan, soleGroupId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!soleGroupId) throw new Error('Solado sem família (group_id) — vincule ao grupo antes.');
      const payload = serializeSoleInspectionPlan(form) as Json;
      const { error } = await supabase
        .from('product_groups')
        .update({ sole_inspection_plan: payload })
        .eq('id', soleGroupId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sole_inspection_plan', soleGroupId] });
      toast.success('Plano de inspeção salvo na família do solado.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Falha ao salvar plano de inspeção.');
    },
  });

  if (!soleGroupId) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-3 text-sm text-muted-foreground">
          Vincule este solado a uma família (grupo) pra cadastrar o plano de inspeção —
          os limites valem pro modelo inteiro, não por cor.
        </CardContent>
      </Card>
    );
  }

  const empty = soleInspectionPlanIsEmpty(form);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          Plano de inspeção (família)
          {empty ? (
            <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-transparent">
              vazio
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-emerald-500/10 text-emerald-600 border-transparent">
              preenchido
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Limites aprovados com fornecedor/lab (IBTeC, ISO 20871 abrasão, 17707 flexão,
          20872 rasgo, 24267 atrito, 20875 delaminação). Vale para{' '}
          <strong>{soleGroupName || data?.name || 'esta família'}</strong>. O software
          não inventa números — deixe em branco até ter a especificação aprovada.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Shore mín.</Label>
                <NumberInput
                  value={form.shore_min}
                  onChange={(n) => setForm((f) => ({ ...f, shore_min: n }))}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Shore máx.</Label>
                <NumberInput
                  value={form.shore_max}
                  onChange={(n) => setForm((f) => ({ ...f, shore_max: n }))}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unidade Shore</Label>
                <Input
                  value={form.shore_unit ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, shore_unit: e.target.value }))}
                  className="h-8"
                  placeholder="Shore A"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Abrasão máx.</Label>
                <NumberInput
                  value={form.abrasion_max}
                  onChange={(n) => setForm((f) => ({ ...f, abrasion_max: n }))}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unidade abrasão</Label>
                <Input
                  value={form.abrasion_unit ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, abrasion_unit: e.target.value }))}
                  className="h-8"
                  placeholder="mm³"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Flexão mín. (ciclos)</Label>
                <NumberInput
                  value={form.flexion_min_cycles}
                  onChange={(n) => setForm((f) => ({ ...f, flexion_min_cycles: n }))}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Rasgo mín.</Label>
                <NumberInput
                  value={form.tear_min}
                  onChange={(n) => setForm((f) => ({ ...f, tear_min: n }))}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Atrito mín.</Label>
                <NumberInput
                  value={form.friction_min}
                  onChange={(n) => setForm((f) => ({ ...f, friction_min: n }))}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Delaminação mín.</Label>
                <NumberInput
                  value={form.delamination_min}
                  onChange={(n) => setForm((f) => ({ ...f, delamination_min: n }))}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Encolhimento máx. %</Label>
                <NumberInput
                  value={form.dimensional_max_pct}
                  onChange={(n) => setForm((f) => ({ ...f, dimensional_max_pct: n }))}
                  className="h-8"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Notas / norma aprovada</Label>
              <Textarea
                value={form.notes ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="Ex.: laudo IBTeC nº …, composto PVC, data de aprovação…"
                className="text-sm"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">Bloquear lote sem ensaio</div>
                <p className="text-xs text-muted-foreground">
                  Desligado por padrão. Só ligue depois de ter o plano preenchido e o
                  fluxo de quarentena alinhado — o gate ainda não corta recebimento
                  automaticamente nesta entrega.
                </p>
              </div>
              <Switch
                checked={Boolean(form.block_lot_without_test)}
                onCheckedChange={(v) => setForm((f) => ({ ...f, block_lot_without_test: v }))}
              />
            </div>

            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => save.mutate()}
                disabled={save.isPending}
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar plano
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
