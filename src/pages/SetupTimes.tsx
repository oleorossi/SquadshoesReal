/**
 * Tempos de Setup — paridade Tutor32 (PCP · engenharia de tempos).
 *
 * CRUD da tabela production_setup_times (já existia no banco, vazia, sem UI):
 * tempo de preparação ao TROCAR de referência/cor dentro de um setor. Esta
 * etapa entrega só o cadastro; a integração no sequenciamento de ondas
 * (compute_wave_timeline) fica para uma etapa separada por mexer no motor de
 * PCP (risco maior). Referências (de/para) são opcionais → permite setup
 * genérico só por cor (ex.: troca de cor no Silk).
 */
import { useMemo, useState } from 'react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Clock, Plus, PencilSimple as Pencil } from '@phosphor-icons/react';
import { PRODUCTION_SECTORS } from '@/hooks/useProductionStops';
import {
  useSetupTimes, useSaveSetupTime, useDeleteSetupTime, useTechnicalSheetOptions,
  type SetupTime, type SetupTimeFormData,
} from '@/hooks/useSetupTimes';

const ANY = '__any__';

const emptyForm = (): SetupTimeFormData => ({
  stage_name: '', from_reference_id: null, from_color: '', to_reference_id: null, to_color: '', setup_minutes: 15, notes: '',
});

export default function SetupTimes() {
  const { data: rows, isLoading } = useSetupTimes();
  const { data: sheets } = useTechnicalSheetOptions();
  const save = useSaveSetupTime();
  const del = useDeleteSetupTime();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SetupTimeFormData>(emptyForm());

  const sheetMap = useMemo(() => new Map((sheets || []).map(s => [s.id, s])), [sheets]);
  const refLabel = (id: string | null) => (id ? (sheetMap.get(id)?.name || '—') : 'Qualquer ref.');

  function openCreate() { setForm(emptyForm()); setOpen(true); }
  function openEdit(r: SetupTime) {
    setForm({
      id: r.id, stage_name: r.stage_name,
      from_reference_id: r.from_reference_id, from_color: r.from_color || '',
      to_reference_id: r.to_reference_id, to_color: r.to_color || '',
      setup_minutes: r.setup_minutes, notes: r.notes || '',
    });
    setOpen(true);
  }
  async function handleSave() {
    if (!form.stage_name) return;
    await save.mutateAsync(form);
    setOpen(false);
  }

  return (
    <div className="space-y-6 pb-10">
      <EditorialPageHeader
        sectionNumber="03"
        sectionLabel="PCP · ENGENHARIA DE TEMPOS"
        title="Tempos de Setup"
        description="Cadastre o tempo de preparação ao trocar de referência ou cor dentro de cada setor. Base para sequenciar a produção minimizando setup (integração no planejamento numa próxima etapa)."
        actions={<Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Novo Setup</Button>}
      />

      <Panel eyebrow="TEMPOS DE SETUP" title="Trocas cadastradas" subtitle="Por setor · troca de referência / cor">
        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : !rows?.length ? (
          <EmptyState
            icon={Clock}
            title="Nenhum tempo de setup"
            description="Cadastre o primeiro tempo de troca clicando em “Novo Setup”."
            action={<Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Novo Setup</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Setor</TableHead>
                  <TableHead>De</TableHead>
                  <TableHead>Para</TableHead>
                  <TableHead className="text-right">Setup</TableHead>
                  <TableHead>Observação</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold">{r.stage_name}</TableCell>
                    <TableCell className="text-sm">{refLabel(r.from_reference_id)}{r.from_color ? <span className="text-muted-foreground"> · {r.from_color}</span> : ''}</TableCell>
                    <TableCell className="text-sm">{refLabel(r.to_reference_id)}{r.to_color ? <span className="text-muted-foreground"> · {r.to_color}</span> : ''}</TableCell>
                    <TableCell className="text-right tabular-nums font-bold">{r.setup_minutes} min</TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground">{r.notes || '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                        <DeleteConfirmButton onConfirm={() => del.mutate(r.id)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /> {form.id ? 'Editar' : 'Novo'} tempo de setup</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Setor *</Label>
              <Select value={form.stage_name} onValueChange={v => setForm(f => ({ ...f, stage_name: v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o setor..." /></SelectTrigger>
                <SelectContent>{PRODUCTION_SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">De — Referência</Label>
                <Select value={form.from_reference_id || ANY} onValueChange={v => setForm(f => ({ ...f, from_reference_id: v === ANY ? null : v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Qualquer referência</SelectItem>
                    {(sheets || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">De — Cor</Label>
                <Input value={form.from_color} onChange={e => setForm(f => ({ ...f, from_color: e.target.value }))} placeholder="Opcional" className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Para — Referência</Label>
                <Select value={form.to_reference_id || ANY} onValueChange={v => setForm(f => ({ ...f, to_reference_id: v === ANY ? null : v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Qualquer referência</SelectItem>
                    {(sheets || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Para — Cor</Label>
                <Input value={form.to_color} onChange={e => setForm(f => ({ ...f, to_color: e.target.value }))} placeholder="Opcional" className="h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Tempo de setup (min) *</Label>
              <Input type="number" min={0} value={form.setup_minutes} onChange={e => setForm(f => ({ ...f, setup_minutes: Number(e.target.value) }))} className="h-9" />
            </div>
            <div>
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Observação</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Opcional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!form.stage_name || save.isPending}>{save.isPending ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
