/**
 * Alçadas de Aprovação de Compras — paridade Tutor32 (compras #2).
 *
 * Configura faixas de valor → perfil exigido para aprovar a OC. O gate é aplicado
 * por trigger no banco (qualquer caminho que marque a OC como aprovada): bloqueia
 * usuário sem o perfil da faixa; admin sempre aprova; fluxos de sistema não bloqueiam.
 */
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Gavel, Plus, PencilSimple as Pencil, Info } from '@phosphor-icons/react';
import { formatCurrency } from '@/lib/utils';
import {
  useApprovalTiers, useApprovalHistory, useSaveApprovalTier, useDeleteApprovalTier,
  emptyTier, APPROVER_ROLES, type ApprovalTier, type ApprovalTierForm,
} from '@/hooks/usePurchaseApprovalTiers';

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'dd/MM/yy HH:mm') : '—');

export default function AlcadasCompras() {
  const { data: tiers, isLoading } = useApprovalTiers();
  const { data: history } = useApprovalHistory();
  const save = useSaveApprovalTier();
  const del = useDeleteApprovalTier();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ApprovalTierForm>(emptyTier());

  function openCreate() { setEditingId(null); setForm(emptyTier()); setOpen(true); }
  function openEdit(t: ApprovalTier) { setEditingId(t.id); const { id, ...rest } = t; setForm(rest); setOpen(true); }
  async function submit() {
    await save.mutateAsync({ id: editingId ?? undefined, data: form });
    setOpen(false);
  }
  const set = (patch: Partial<ApprovalTierForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-6 pb-12">
      <EditorialPageHeader
        sectionNumber="02"
        sectionLabel="COMPRAS · GOVERNANÇA"
        title="Alçadas de Aprovação"
        description="Faixas de valor que definem qual perfil pode aprovar uma ordem de compra."
        actions={<Button onClick={openCreate} className="gap-2"><Plus className="size-4" /> Nova alçada</Button>}
      />

      <div className="flex items-start gap-2 rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground">
        <Info className="size-4 mt-0.5 shrink-0" />
        <span>O bloqueio é aplicado no banco ao aprovar a OC: se o valor cai numa faixa, só quem tem o perfil exigido (ou <strong>admin</strong>) aprova. Sem faixa aplicável, a OC não exige alçada. Fluxos automáticos do sistema não são bloqueados.</span>
      </div>

      <Panel eyebrow="FAIXAS" title="Alçadas por valor" flush>
        {isLoading ? (
          <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !tiers?.length ? (
          <div className="p-6"><EmptyState icon={Gavel} title="Nenhuma alçada" description="Sem faixas, qualquer OC pode ser aprovada por qualquer usuário. Crie faixas para exigir aprovação por valor." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alçada</TableHead>
                <TableHead>Faixa (R$)</TableHead>
                <TableHead>Perfil exigido</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((t) => (
                <TableRow key={t.id} className={!t.active ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{t.name}{t.notes && <span className="block text-[11px] text-muted-foreground">{t.notes}</span>}</TableCell>
                  <TableCell className="tabular-nums text-sm">{formatCurrency(t.min_value)} <span className="text-muted-foreground">→</span> {t.max_value == null ? <Badge variant="outline" className="text-[10px]">sem teto</Badge> : formatCurrency(t.max_value)}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{t.required_role}</Badge></TableCell>
                  <TableCell>{t.active ? <Badge className="text-xs">ativa</Badge> : <Badge variant="outline" className="text-xs">inativa</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(t)}><Pencil className="size-3.5" /></Button>
                      <DeleteConfirmButton onConfirm={() => del.mutate(t.id)} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {!!history?.length && (
        <Panel eyebrow="HISTÓRICO" title="Aprovações registradas" flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>OC</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Alçada</TableHead>
                <TableHead>Perfil</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="text-xs">{fmtDate(h.approved_at || h.created_at)}</TableCell>
                  <TableCell className="font-mono text-xs">{h.purchase_orders?.order_number ?? '—'}</TableCell>
                  <TableCell className="text-sm">{h.purchase_orders?.supplier_name ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.total_value != null ? formatCurrency(h.total_value) : '—'}</TableCell>
                  <TableCell className="text-xs">{h.tier_name ?? '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize text-xs">{h.required_role}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Gavel className="size-5" /> {editingId ? 'Editar' : 'Nova'} alçada</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Nome</Label><Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Compras acima de R$ 5.000" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Início <span className="text-muted-foreground font-normal">(R$)</span></Label>
                <NumberInput value={form.min_value} onChange={(n) => set({ min_value: n })} />
              </div>
              <div className="space-y-1.5">
                <Label>Fim <span className="text-muted-foreground font-normal">(R$, vazio = sem teto)</span></Label>
                <NumberInput value={form.max_value} onChange={(n) => set({ max_value: n === 0 ? null : n })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Perfil exigido para aprovar</Label>
              <Select value={form.required_role} onValueChange={(v) => set({ required_role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{APPROVER_ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Observação</Label><Input value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
            <div className="flex items-center gap-2">
              <Switch id="active" checked={form.active} onCheckedChange={(v) => set({ active: v })} />
              <Label htmlFor="active" className="text-sm">Alçada ativa</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
