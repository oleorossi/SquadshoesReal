import React, { useState } from 'react';
import { History, Plus, CheckCircle2, Clock, XCircle, Loader2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBomVersions, useCreateBomVersion, useUpdateBomVersionStatus } from '@/hooks/useBomVersions';
import { useBomOperations } from '@/hooks/useBomOperations';
import { useSheetMaterials, SheetFormData } from '@/hooks/useTechnicalSheets';
import { Separator } from '@/components/ui/separator';

const STATUS_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
  'draft': { icon: Clock, label: 'Rascunho', color: 'bg-muted text-muted-foreground' },
  'pending_approval': { icon: Clock, label: 'Aguardando Aprovação', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  'approved': { icon: CheckCircle2, label: 'Aprovada', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  'rejected': { icon: XCircle, label: 'Rejeitada', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
};

export function VersionsTab({ sheetId, form, updateField }: {
  sheetId: string;
  form: SheetFormData;
  updateField: (key: keyof SheetFormData, value: any) => void;
}) {
  const { data: versions = [], isLoading } = useBomVersions(sheetId);
  const { data: materials = [] } = useSheetMaterials(sheetId);
  const { data: operations = [] } = useBomOperations(sheetId);
  const createVersion = useCreateBomVersion();
  const updateStatus = useUpdateBomVersionStatus();

  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [viewingVersion, setViewingVersion] = useState<any>(null);

  const nextVersion = `v${versions.length + 1}`;

  const handleCreateSnapshot = () => {
    createVersion.mutate({
      sheetId,
      versionNumber: nextVersion,
      description,
      snapshot: form,
      materialsSnapshot: materials,
      operationsSnapshot: operations,
      createdBy: '',
    }, {
      onSuccess: () => {
        updateField('version_number', nextVersion);
        setCreating(false);
        setDescription('');
      }
    });
  };

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <div className="space-y-4">
      {/* Current version controls */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Controle de Versão</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Versão Atual</Label>
            <Input value={form.version_number} onChange={e => updateField('version_number', e.target.value)} className="mt-1 h-9 text-sm font-mono" placeholder="v1" />
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="default" className="gap-1 text-xs" onClick={() => setCreating(true)}>
            <Plus className="h-3 w-3" /> Criar Snapshot da Versão Atual
          </Button>
        </div>
      </div>

      {/* Create version dialog */}
      {creating && (
        <div className="p-4 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 space-y-3">
          <p className="text-xs font-semibold text-primary">Criar Snapshot — {nextVersion}</p>
          <p className="text-xs text-muted-foreground">
            Salva o estado atual da ficha técnica, BOM e operações como uma versão imutável para rastreabilidade.
          </p>
          <div>
            <Label className="text-xs">Descrição da Alteração</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} className="mt-1" rows={2} placeholder="O que mudou nesta versão..." />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleCreateSnapshot} disabled={createVersion.isPending}>
              {createVersion.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Salvar Versão
            </Button>
          </div>
        </div>
      )}

      <Separator />

      {/* Version History */}
      <h3 className="text-sm font-semibold">Histórico de Versões</h3>
      {versions.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <History className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Nenhuma versão salva</p>
          <p className="text-xs mt-1">Crie snapshots para manter o histórico de alterações</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 border-b-2 border-border">
                <TableHead className="text-[11px] font-bold uppercase tracking-wider">Versão</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider">Data</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider">Descrição</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider">Criado por</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wider">Aprovador</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((v: any) => {
                const cfg = STATUS_CONFIG[v.status] || STATUS_CONFIG.draft;
                const StatusIcon = cfg.icon;
                return (
                  <TableRow key={v.id}>
                    <TableCell className="text-xs font-mono font-bold">{v.version_number}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {new Date(v.created_at).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{v.description || '—'}</TableCell>
                    <TableCell className="text-xs">{v.created_by || '—'}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] gap-1 ${cfg.color}`}>
                        <StatusIcon className="h-3 w-3" />
                        {cfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{v.approved_by || '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setViewingVersion(v)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        {v.status === 'draft' && (
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                            onClick={() => updateStatus.mutate({ id: v.id, status: 'pending_approval' })}>
                            Enviar
                          </Button>
                        )}
                        {v.status === 'pending_approval' && (
                          <>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-green-600"
                              onClick={() => updateStatus.mutate({ id: v.id, status: 'approved', approvedBy: '' })}>
                              Aprovar
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-destructive"
                              onClick={() => updateStatus.mutate({ id: v.id, status: 'rejected' })}>
                              Rejeitar
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Version detail dialog */}
      <Dialog open={!!viewingVersion} onOpenChange={() => setViewingVersion(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Versão {viewingVersion?.version_number} — {viewingVersion?.description}</DialogTitle>
          </DialogHeader>
          {viewingVersion && (
            <div className="space-y-4 text-xs">
              <div>
                <p className="font-semibold mb-1">Dados da Ficha:</p>
                <pre className="bg-muted p-3 rounded-md overflow-auto max-h-48 text-[10px] font-mono">
                  {JSON.stringify(viewingVersion.snapshot, null, 2)}
                </pre>
              </div>
              <div>
                <p className="font-semibold mb-1">Materiais ({Array.isArray(viewingVersion.materials_snapshot) ? viewingVersion.materials_snapshot.length : 0}):</p>
                <pre className="bg-muted p-3 rounded-md overflow-auto max-h-48 text-[10px] font-mono">
                  {JSON.stringify(viewingVersion.materials_snapshot, null, 2)}
                </pre>
              </div>
              <div>
                <p className="font-semibold mb-1">Operações ({Array.isArray(viewingVersion.operations_snapshot) ? viewingVersion.operations_snapshot.length : 0}):</p>
                <pre className="bg-muted p-3 rounded-md overflow-auto max-h-48 text-[10px] font-mono">
                  {JSON.stringify(viewingVersion.operations_snapshot, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Approvals Editor (moved from TechnicalSheets.tsx) */
function ApprovalsEditor({ value, onChange }: { value: Record<string, any>; onChange: (v: Record<string, any>) => void }) {
  const roles = ['Designer', 'Modelista', 'Produção', 'Compras', 'Qualidade'];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {roles.map(role => (
        <div key={role} className="space-y-1">
          <Label className="text-xs text-muted-foreground">{role}</Label>
          <Input
            value={value[role]?.name || ''} placeholder="Nome"
            onChange={e => onChange({ ...value, [role]: { ...value[role], name: e.target.value } })}
            className="h-8 text-xs"
          />
          <Input
            type="date" value={value[role]?.date || ''}
            onChange={e => onChange({ ...value, [role]: { ...value[role], date: e.target.value } })}
            className="h-8 text-xs font-mono"
          />
        </div>
      ))}
    </div>
  );
}

/* Change Log Editor (moved from TechnicalSheets.tsx) */
function ChangeLogEditor({ value, onChange }: { value: any[]; onChange: (v: any[]) => void }) {
  const [entry, setEntry] = useState({ what: '', who: '', date: new Date().toISOString().split('T')[0], why: '' });

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader><TableRow className="bg-muted/30">
              <TableHead className="text-[11px]">Data</TableHead>
              <TableHead className="text-[11px]">O quê</TableHead>
              <TableHead className="text-[11px]">Quem</TableHead>
              <TableHead className="text-[11px]">Por quê</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {value.map((e: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-mono">{e.date}</TableCell>
                  <TableCell className="text-xs">{e.what}</TableCell>
                  <TableCell className="text-xs">{e.who}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.why}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                      onClick={() => onChange(value.filter((_, j) => j !== i))}>
                      <XCircle className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Input value={entry.what} onChange={e => setEntry(f => ({ ...f, what: e.target.value }))} placeholder="O que mudou" className="h-8 text-xs" />
        <Input value={entry.who} onChange={e => setEntry(f => ({ ...f, who: e.target.value }))} placeholder="Responsável" className="h-8 text-xs" />
        <Input type="date" value={entry.date} onChange={e => setEntry(f => ({ ...f, date: e.target.value }))} className="h-8 text-xs font-mono" />
        <div className="flex gap-1">
          <Input value={entry.why} onChange={e => setEntry(f => ({ ...f, why: e.target.value }))} placeholder="Motivo" className="h-8 text-xs" />
          <Button size="sm" className="h-8" onClick={() => { if (entry.what) { onChange([...value, entry]); setEntry({ what: '', who: '', date: new Date().toISOString().split('T')[0], why: '' }); } }}>+</Button>
        </div>
      </div>
    </div>
  );
}
