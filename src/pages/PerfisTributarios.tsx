/**
 * Perfis tributários por NCM — paridade Tutor32 (fiscal #2).
 *
 * Registry de tributação (CST/CSOSN, CFOP interno/externo, alíquotas ICMS/IPI/
 * PIS/COFINS, MVA/alíquota ST) por NCM, com relatório de cobertura dos NCMs em
 * uso nas fichas técnicas. Base pra pré-preenchimento da emissão e estimativa.
 */
import { useMemo, useState } from 'react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Receipt, Plus, PencilSimple as Pencil, Warning, CheckCircle } from '@phosphor-icons/react';
import {
  useTaxProfiles, useNcmCoverage, useAddTaxProfile, useUpdateTaxProfile, useDeleteTaxProfile,
  emptyTaxProfile, estimatedTaxLoad, type TaxProfile, type TaxProfileFormData,
} from '@/hooks/useTaxProfiles';

const pct = (n: number | null) => (n == null ? '—' : `${(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

function NumField({ label, unit = '%', value, onChange }: { label: string; unit?: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label} <span className="text-muted-foreground font-normal">({unit})</span></Label>
      <Input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))} className="h-8" />
    </div>
  );
}

function TxtField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8" />
    </div>
  );
}

export default function PerfisTributarios() {
  const { data: profiles, isLoading } = useTaxProfiles();
  const { data: coverage } = useNcmCoverage();
  const add = useAddTaxProfile();
  const update = useUpdateTaxProfile();
  const del = useDeleteTaxProfile();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TaxProfileFormData>(emptyTaxProfile());

  const missing = useMemo(() => (coverage ?? []).filter((c) => !c.has_profile), [coverage]);
  const covered = useMemo(() => (coverage ?? []).filter((c) => c.has_profile).length, [coverage]);

  function openCreate(ncm = '') { setEditingId(null); setForm(emptyTaxProfile(ncm)); setDialogOpen(true); }
  function openEdit(p: TaxProfile) {
    setEditingId(p.id);
    const { id, ...rest } = p;
    setForm(rest);
    setDialogOpen(true);
  }
  async function save() {
    // mutateAsync rejeita em erro (toast no onError) — só fecha se resolver.
    if (editingId) await update.mutateAsync({ id: editingId, data: form });
    else await add.mutateAsync(form);
    setDialogOpen(false);
  }
  const saving = add.isPending || update.isPending;
  const set = (patch: Partial<TaxProfileFormData>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-6 pb-12">
      <EditorialPageHeader
        sectionNumber="02"
        sectionLabel="FISCAL · TRIBUTAÇÃO"
        title="Perfis tributários"
        description="Tributação por NCM (CST/CSOSN, CFOP, alíquotas e ST) que pré-preenche a emissão e serve de base para estimativas."
        actions={<Button onClick={() => openCreate()} className="gap-2"><Plus className="size-4" /> Novo perfil</Button>}
      />

      {/* Cobertura */}
      <Panel eyebrow="COBERTURA" title="NCMs em uso nas fichas técnicas" subtitle={`${covered} com perfil · ${missing.length} sem perfil`}>
        {!coverage?.length ? (
          <p className="text-sm text-muted-foreground">Nenhum NCM cadastrado nas fichas técnicas.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {coverage.map((c) => (
              <button
                key={c.ncm}
                onClick={() => !c.has_profile && openCreate(c.ncm)}
                disabled={c.has_profile}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${c.has_profile ? 'border-border bg-muted/30 cursor-default' : 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20'}`}
              >
                {c.has_profile ? <CheckCircle className="size-3.5 text-green-600" /> : <Warning className="size-3.5 text-amber-600" />}
                <span className="font-mono">{c.ncm}</span>
                <span className="text-muted-foreground">· {c.sheets_using} ficha(s)</span>
                {!c.has_profile && <span className="text-amber-600 font-medium">criar</span>}
              </button>
            ))}
          </div>
        )}
      </Panel>

      {/* Perfis */}
      <Panel eyebrow="PERFIS" title="Tributação por NCM" flush>
        {isLoading ? (
          <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !profiles?.length ? (
          <div className="p-6"><EmptyState icon={Receipt} title="Nenhum perfil tributário" description="Crie perfis por NCM para padronizar a tributação das notas." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>NCM</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>CFOP int/ext</TableHead>
                <TableHead className="text-right">ICMS</TableHead>
                <TableHead className="text-right">IPI</TableHead>
                <TableHead className="text-right">PIS</TableHead>
                <TableHead className="text-right">COFINS</TableHead>
                <TableHead className="text-right">Carga est.</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.id} className={!p.active ? 'opacity-50' : ''}>
                  <TableCell className="font-mono text-xs">{p.ncm}{p.mva_st != null && <Badge variant="outline" className="ml-1.5 text-[10px]">ST</Badge>}</TableCell>
                  <TableCell className="text-xs">{p.description || '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{p.cfop_interno || '—'} / {p.cfop_externo || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(p.aliquota_icms)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(p.aliquota_ipi)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(p.aliquota_pis)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(p.aliquota_cofins)}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-semibold ${p.active && estimatedTaxLoad(p) === 0 ? 'text-amber-600' : ''}`}
                    title={p.active && estimatedTaxLoad(p) === 0 ? 'Perfil ATIVO com todas as alíquotas zeradas — apura imposto ZERO para este NCM. Confira se faltou preencher.' : undefined}
                  >{pct(estimatedTaxLoad(p))}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="size-3.5" /></Button>
                      <DeleteConfirmButton onConfirm={() => del.mutate(p.id)} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt className="size-5" /> {editingId ? 'Editar' : 'Novo'} perfil tributário</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <TxtField label="NCM (8 dígitos)" value={form.ncm} onChange={(v) => set({ ncm: v })} placeholder="64041100" />
              <div className="md:col-span-2"><TxtField label="Descrição" value={form.description} onChange={(v) => set({ description: v })} placeholder="Calçado de matéria têxtil" /></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <TxtField label="Origem" value={form.origem} onChange={(v) => set({ origem: v })} placeholder="0" />
              <TxtField label="CFOP interno" value={form.cfop_interno} onChange={(v) => set({ cfop_interno: v })} placeholder="5101" />
              <TxtField label="CFOP externo" value={form.cfop_externo} onChange={(v) => set({ cfop_externo: v })} placeholder="6101" />
              <div />
            </div>

            <div className="rounded-lg border border-border p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">ICMS</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <TxtField label="CST/CSOSN" value={form.cst_icms} onChange={(v) => set({ cst_icms: v })} placeholder="00 ou 102" />
                <NumField label="Alíquota ICMS" value={form.aliquota_icms} onChange={(v) => set({ aliquota_icms: v ?? 0 })} />
                <NumField label="MVA-ST" value={form.mva_st} onChange={(v) => set({ mva_st: v })} />
                <NumField label="Alíquota ICMS-ST" value={form.aliquota_icms_st} onChange={(v) => set({ aliquota_icms_st: v })} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">IPI</p>
                <TxtField label="CST" value={form.cst_ipi} onChange={(v) => set({ cst_ipi: v })} placeholder="50" />
                <NumField label="Alíquota" value={form.aliquota_ipi} onChange={(v) => set({ aliquota_ipi: v ?? 0 })} />
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">PIS</p>
                <TxtField label="CST" value={form.cst_pis} onChange={(v) => set({ cst_pis: v })} placeholder="01" />
                <NumField label="Alíquota" value={form.aliquota_pis} onChange={(v) => set({ aliquota_pis: v ?? 0 })} />
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">COFINS</p>
                <TxtField label="CST" value={form.cst_cofins} onChange={(v) => set({ cst_cofins: v })} placeholder="01" />
                <NumField label="Alíquota" value={form.aliquota_cofins} onChange={(v) => set({ aliquota_cofins: v ?? 0 })} />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted/40 border border-border p-3">
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={(v) => set({ active: v })} id="active" />
                <Label htmlFor="active" className="text-sm">Perfil ativo</Label>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Carga tributária estimada: </span>
                <span className="font-bold tabular-nums">{pct(estimatedTaxLoad(form))}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
