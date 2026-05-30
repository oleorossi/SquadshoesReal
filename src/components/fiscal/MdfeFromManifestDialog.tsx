/**
 * Gerar rascunho de MDF-e a partir de um romaneio — paridade Tutor32 (fiscal #4).
 *
 * Lista os romaneios (shipping_manifests) e, ao escolher um, chama a RPC
 * mdfe_draft_from_manifest que monta o rascunho com veículo/motorista/UF e as
 * chaves das NF-e autorizadas dos PVs do romaneio — sem digitação manual.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Truck, FileText } from '@phosphor-icons/react';
import { toast } from 'sonner';

interface Props { open: boolean; onClose: () => void; }

export function MdfeFromManifestDialog({ open, onClose }: Props) {
  const qc = useQueryClient();

  const { data: manifests = [], isLoading } = useQuery({
    queryKey: ['shipping_manifests_for_mdfe'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipping_manifests' as any)
        .select('id, manifest_number, emission_date, driver_name, vehicle_plate, total_pairs, status')
        .order('emission_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const gen = useMutation({
    mutationFn: async (manifestId: string) => {
      const { error } = await supabase.rpc('mdfe_draft_from_manifest' as any, { p_manifest_id: manifestId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mdfe_emissions_list'] });
      toast.success('Rascunho de MDF-e gerado a partir do romaneio.');
      onClose();
    },
    onError: (e: Error) => toast.error(`Erro: ${e.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="size-5" /> Gerar MDF-e de um romaneio</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando romaneios…</p>
        ) : !manifests.length ? (
          <EmptyState icon={FileText} title="Nenhum romaneio" description="Crie romaneios na Logística para gerar MDF-e automaticamente a partir deles." />
        ) : (
          <div className="space-y-2">
            {manifests.map((m) => (
              <button
                key={m.id}
                onClick={() => gen.mutate(m.id)}
                disabled={gen.isPending}
                className="w-full text-left rounded-lg border border-border hover:bg-muted/40 p-3 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold">{m.manifest_number}</span>
                  <Badge variant="outline" className="text-xs capitalize">{m.status}</Badge>
                  <span className="text-xs text-muted-foreground">{m.emission_date ? format(parseISO(m.emission_date), 'dd/MM/yyyy') : '—'}</span>
                </div>
                <p className="text-sm mt-0.5">{m.driver_name || '—'}{m.vehicle_plate && ` · 🚛 ${m.vehicle_plate}`} · {m.total_pairs} pares</p>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
