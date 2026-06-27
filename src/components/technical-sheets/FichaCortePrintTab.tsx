import { useMemo, useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Plus, Trash, Printer, FloppyDisk as Save, Scissors, CircleNotch as Loader2 } from '@phosphor-icons/react';
import {
  type FichaCorteData, normalizeFichaCorte, emptyFichaRow, emptyFichaFixo, printFichaTecnica,
} from '@/lib/printFichaTecnica';

interface Props {
  sheet: any;
}

/**
 * Aba "Ficha Imprimível" (Ficha de Corte): preenche o cabeçalho + a tabela de
 * Materiais Variáveis (faca/peça) + itens fixos e gera o A4 industrial. Persiste
 * em technical_sheets.ficha_corte (jsonb).
 */
export function FichaCortePrintTab({ sheet }: Props) {
  const qc = useQueryClient();
  const initial = useMemo(() => normalizeFichaCorte(sheet?.ficha_corte, sheet?.code || ''), [sheet?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [data, setData] = useState<FichaCorteData>(initial);
  const [printing, setPrinting] = useState(false);

  // Salva SÓ a ficha_corte (campo de impressão) DIRETO — sem o resync pesado do
  // useUpdateSheet (estorno + re-débito de estoque + recriação de etapas), que é
  // desnecessário pra um campo que não afeta consumo/produção.
  const saveMut = useMutation({
    mutationFn: async (payload: FichaCorteData) => {
      const { data: upd, error } = await supabase
        .from('technical_sheets')
        .update({ ficha_corte: payload } as any)
        .eq('id', sheet.id)
        .select('id');
      if (error) throw error;
      if (!upd || upd.length === 0) throw new Error('Não persistiu — verifique permissão (admin/gerente).');
    },
    onError: (e: any) => toast.error('Falha ao salvar: ' + (e?.message || '')),
  });

  const set = <K extends keyof FichaCorteData>(k: K, v: FichaCorteData[K]) => setData(d => ({ ...d, [k]: v }));
  const setMat = (i: number, patch: Partial<FichaCorteData['materiais'][number]>) =>
    setData(d => ({ ...d, materiais: d.materiais.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const setFixo = (i: number, patch: Partial<FichaCorteData['fixos'][number]>) =>
    setData(d => ({ ...d, fixos: d.fixos.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));

  const save = (silent = false) =>
    saveMut.mutate(data, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['technical_sheets'] }); if (!silent) toast.success('Ficha de corte salva'); },
    });

  const gerar = async () => {
    setPrinting(true);
    try {
      save(true); // persiste o que está sendo impresso
      await printFichaTecnica(data, sheet?.images?.[0], sheet?.name || data.referencia);
    } catch (e: any) {
      toast.error('Falha ao gerar a ficha: ' + (e?.message || ''));
    } finally {
      setPrinting(false);
    }
  };

  const HEADER: { key: keyof FichaCorteData; label: string; placeholder?: string }[] = [
    { key: 'linha', label: 'Linha', placeholder: '90.000' },
    { key: 'referencia', label: 'Referência', placeholder: sheet?.code || '90.004' },
    { key: 'corte', label: 'Corte', placeholder: '1498' },
    { key: 'cabedal', label: 'Cabedal', placeholder: '1499' },
    { key: 'peso', label: 'Peso (nº 37)', placeholder: '—' },
  ];

  return (
    <div className="mt-4 space-y-4">
      {/* Barra de ações */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Scissors className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-bold">Ficha Imprimível (Ficha de Corte)</h3>
            <p className="text-xs text-muted-foreground">Preencha o cabeçalho e os materiais variáveis. "Gerar" produz o A4 pra impressão/PDF.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => save()} disabled={saveMut.isPending}>
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={gerar} disabled={printing}>
            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Gerar ficha imprimível
          </Button>
        </div>
      </div>

      {/* Cabeçalho */}
      <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
        <span className="section-label">Cabeçalho</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {HEADER.map(({ key, label, placeholder }) => (
            <div key={key}>
              <Label className="text-xs">{label}</Label>
              <Input className="h-9 mt-1 font-mono" value={String(data[key] ?? '')} placeholder={placeholder} onChange={e => set(key, e.target.value as any)} />
            </div>
          ))}
        </div>
        <div>
          <Label className="text-xs">OBS</Label>
          <Textarea className="mt-1" rows={2} value={data.obs} placeholder="Observações da ficha…" onChange={e => set('obs', e.target.value)} />
        </div>
      </div>

      {/* Materiais variáveis */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="section-label">Materiais Variáveis</span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setData(d => ({ ...d, materiais: [...d.materiais, emptyFichaRow()] }))}>
            <Plus className="h-3.5 w-3.5" /> Adicionar peça
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="[&_th]:p-2 [&_th]:text-left [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground [&_th]:text-[10px]">
                <th className="w-[110px]">Código Faca</th>
                <th>Peça</th>
                <th className="w-[110px]">Ref Faca</th>
                <th className="w-[180px]">Agrupamento Faca</th>
                <th className="w-[110px]">Consumo</th>
                <th className="w-9"></th>
              </tr>
            </thead>
            <tbody>
              {data.materiais.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground italic">Nenhuma peça. Clique em "Adicionar peça".</td></tr>
              ) : data.materiais.map((r, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="p-1"><Input className="h-8 font-mono" value={r.codigo_faca} placeholder="F32" onChange={e => setMat(i, { codigo_faca: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-8 uppercase" value={r.peca} placeholder="FORRO TRASEIRO" onChange={e => setMat(i, { peca: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-8 font-mono" value={r.ref_faca} placeholder="BASE 3" onChange={e => setMat(i, { ref_faca: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-8" value={r.agrupamento} placeholder="NUMERO A NUMERO" onChange={e => setMat(i, { agrupamento: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-8" value={r.consumo} placeholder="—" onChange={e => setMat(i, { consumo: e.target.value })} /></td>
                  <td className="p-1 text-center">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setData(d => ({ ...d, materiais: d.materiais.filter((_, idx) => idx !== i) }))} aria-label="Remover peça">
                      <Trash className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Itens fixos (aviamento) */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="section-label">Itens Fixos (aviamento)</span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setData(d => ({ ...d, fixos: [...d.fixos, emptyFichaFixo()] }))}>
            <Plus className="h-3.5 w-3.5" /> Adicionar item
          </Button>
        </div>
        <div className="p-2 space-y-1">
          {data.fixos.length === 0 ? (
            <p className="p-4 text-center text-muted-foreground italic text-xs">Ex.: ATACADOR — 1 PAR · ENFEITE PINGENTE ESTRELA — 2 UNIDADES.</p>
          ) : data.fixos.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="h-8 flex-1 uppercase" value={f.peca} placeholder="ATACADOR" onChange={e => setFixo(i, { peca: e.target.value })} />
              <Input className="h-8 w-40 uppercase" value={f.quantidade} placeholder="1 PAR" onChange={e => setFixo(i, { quantidade: e.target.value })} />
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0" onClick={() => setData(d => ({ ...d, fixos: d.fixos.filter((_, idx) => idx !== i) }))} aria-label="Remover item">
                <Trash className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">A foto da referência sai da aba <strong>Identificação / Fotos</strong>. "Gerar" também salva o que foi preenchido.</p>
    </div>
  );
}
