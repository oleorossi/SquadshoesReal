import { useState, useMemo } from 'react';
import {
  useNfeCCes, useSaveCCe, useDeleteCCe, useMarkCCeEmitted,
  useAuthorizedNfes, useNextCCeSequence,
  type NfeCCe, type NfeCCeStatus,
} from '@/hooks/useNfeCCe';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { FileText as FileEdit, Plus, Trash as Trash2, CheckCircle, WarningCircle as AlertCircle, PaperPlaneRight as Send, CircleNotch as Loader2, MagnifyingGlass as Search } from '@phosphor-icons/react';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

const STATUS_META: Record<NfeCCeStatus, { label: string; className: string; icon: React.ReactNode }> = {
  rascunho:  { label: 'Rascunho',  className: 'bg-muted text-muted-foreground border-border',           icon: <FileEdit className="h-3 w-3" /> },
  emitida:   { label: 'Emitida',   className: 'bg-green-500/10 text-green-600 border-green-500/20',     icon: <CheckCircle className="h-3 w-3" /> },
  rejeitada: { label: 'Rejeitada', className: 'bg-red-500/10 text-red-600 border-red-500/20',           icon: <AlertCircle className="h-3 w-3" /> },
  erro:      { label: 'Erro',      className: 'bg-red-500/10 text-red-600 border-red-500/20',           icon: <AlertCircle className="h-3 w-3" /> },
  cancelada: { label: 'Cancelada', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20', icon: <AlertCircle className="h-3 w-3" /> },
};

function CCeStatusBadge({ status }: { status: NfeCCeStatus }) {
  const cfg = STATUS_META[status] ?? STATUS_META.rascunho;
  return (
    <Badge variant="outline" className={`gap-1 text-xs ${cfg.className}`}>
      {cfg.icon} {cfg.label}
    </Badge>
  );
}

// ─── New / Edit dialog ─────────────────────────────────────────────────────

function CCeDialog({
  open, onClose, editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: (NfeCCe & { nfe_emitidas?: any }) | null;
}) {
  // Hooks SEM condição: precisam rodar mesmo com open=false pra ordem ficar
  // estável (rules of hooks). Mas só fetcham quando o dialog está aberto.
  const isEdit = !!editing;
  const [nfeId, setNfeId] = useState<string>(editing?.nfe_id ?? '');
  const [correctionText, setCorrectionText] = useState(editing?.correction_text ?? '');
  // Pausa o fetch enquanto o dialog está fechado pra evitar trabalho desnecessário
  // e eliminar qualquer trap em embed PostgREST quando o painel ainda não foi visto.
  const { data: nfes = [], isLoading: loadingNfes } = useAuthorizedNfes(open);
  const { data: nextSeq } = useNextCCeSequence(nfeId || null);
  const save = useSaveCCe();

  const selectedNfe = useMemo(
    () => nfes.find((n: any) => n.id === nfeId),
    [nfes, nfeId],
  );

  const trimmed = correctionText.trim();
  const canSubmit = !!nfeId && trimmed.length >= 15 && trimmed.length <= 1000;

  const handleSave = async () => {
    if (!canSubmit) return;
    const payload: Partial<NfeCCe> = {
      correction_text: trimmed,
    };

    if (isEdit && editing) {
      await save.mutateAsync({ id: editing.id, ...payload });
    } else {
      if (!selectedNfe) return;
      await save.mutateAsync({
        ...payload,
        nfe_id: selectedNfe.id,
        nfe_number: selectedNfe.numero,
        nfe_chave: selectedNfe.chave_acesso,
        sequencia: nextSeq ?? 1,
        status: 'rascunho',
      });
    }
    onClose();
    setNfeId('');
    setCorrectionText('');
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileEdit className="h-4 w-4" />
            {isEdit ? `Editar CCe #${editing.sequencia}` : 'Nova Carta de Correção'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Edite o texto da correção do rascunho antes de emitir.'
              : 'Escolha a NF-e autorizada e descreva a correção (15 a 1000 caracteres).'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isEdit && (
            <div>
              <Label>NF-e autorizada</Label>
              <Select value={nfeId} onValueChange={setNfeId} disabled={loadingNfes}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={loadingNfes ? 'Carregando...' : 'Selecione a NF-e a corrigir'} />
                </SelectTrigger>
                <SelectContent>
                  {nfes.map((n: any) => (
                    <SelectItem key={n.id} value={n.id}>
                      NF {n.numero}/{n.serie}
                      {n.data_emissao ? ` · ${new Date(n.data_emissao).toLocaleDateString('pt-BR')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedNfe && (
                <p className="text-xs text-muted-foreground mt-1">
                  Chave: <span className="font-mono">{selectedNfe.chave_acesso}</span> · Sequência da CCe: <span className="font-medium">{nextSeq ?? '...'}</span>
                </p>
              )}
            </div>
          )}

          {isEdit && (
            <div className="text-sm text-muted-foreground">
              NF {editing?.nfe_number} · Sequência {editing?.sequencia}
              <p className="text-xs font-mono mt-0.5">{editing?.nfe_chave}</p>
            </div>
          )}

          <div>
            <Label>Texto da correção</Label>
            <Textarea
              value={correctionText}
              onChange={e => setCorrectionText(e.target.value)}
              placeholder="Descreva precisamente o que está sendo corrigido. Não pode alterar valores, datas, partes ou itens da NF-e."
              rows={6}
              maxLength={1000}
              className="mt-1 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {trimmed.length}/15 mínimo · até 1000 caracteres · A SEFAZ aceita CCe em até 30 dias da emissão.
            </p>
          </div>

          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-4 pb-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
              <p className="font-medium">⚠ Não use CCe para corrigir:</p>
              <ul className="list-disc ml-4 space-y-0.5">
                <li>Valores (totais, preços, impostos)</li>
                <li>Dados do destinatário, remetente ou produto</li>
                <li>Data de emissão ou saída</li>
              </ul>
              <p>Para esses casos, cancele a NF-e e emita outra.</p>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!canSubmit || save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileEdit className="h-4 w-4 mr-2" />}
            {isEdit ? 'Salvar' : 'Criar rascunho'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Mark emitted dialog ───────────────────────────────────────────────────

function MarkEmittedDialog({
  cce, open, onClose,
}: {
  cce: NfeCCe | null;
  open: boolean;
  onClose: () => void;
}) {
  const [protocol, setProtocol] = useState('');
  const [response, setResponse] = useState('');
  const mark = useMarkCCeEmitted();

  const handleConfirm = async () => {
    if (!cce || !protocol.trim()) return;
    await mark.mutateAsync({
      id: cce.id,
      protocol: protocol.trim(),
      sefazResponse: response.trim(),
    });
    setProtocol('');
    setResponse('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-600">
            <Send className="h-4 w-4" /> Marcar CCe como emitida
          </DialogTitle>
          <DialogDescription>
            Cole o protocolo de autorização retornado pela SEFAZ. Use quando a CCe foi
            transmitida fora do sistema e precisa ser registrada aqui.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label>Protocolo SEFAZ</Label>
            <Input
              value={protocol}
              onChange={e => setProtocol(e.target.value)}
              placeholder="ex. 135250000000000"
              className="mt-1 font-mono"
            />
          </div>

          <div>
            <Label>Resposta SEFAZ <span className="text-muted-foreground">(opcional)</span></Label>
            <Textarea
              value={response}
              onChange={e => setResponse(e.target.value)}
              placeholder="Mensagem completa retornada pela SEFAZ"
              rows={3}
              className="mt-1 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button onClick={handleConfirm} disabled={!protocol.trim() || mark.isPending}>
            {mark.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────────

function CCeRow({
  cce, onEdit, onMarkEmitted, onDelete,
}: {
  cce: NfeCCe & { nfe_emitidas?: any };
  onEdit: (c: NfeCCe & { nfe_emitidas?: any }) => void;
  onMarkEmitted: (c: NfeCCe) => void;
  onDelete: (c: NfeCCe) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium">
            NF {cce.nfe_number} #CCe{cce.sequencia}
          </span>
          <CCeStatusBadge status={cce.status} />
        </div>
        <p className="text-sm text-foreground/80 line-clamp-2 mt-0.5" title={cce.correction_text}>
          {cce.correction_text}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {new Date(cce.created_at).toLocaleString('pt-BR')}
          {cce.emitted_at && ` · Emitida ${new Date(cce.emitted_at).toLocaleString('pt-BR')}`}
          {cce.protocol && ` · Prot. ${cce.protocol}`}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {cce.status === 'rascunho' && (
          <>
            <Button variant="ghost" size="icon" title="Editar" onClick={() => onEdit(cce)}>
              <FileEdit className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              title="Marcar como emitida"
              className="text-green-600 hover:text-green-700"
              onClick={() => onMarkEmitted(cce)}
            >
              <CheckCircle className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              title="Excluir rascunho"
              className="text-red-500 hover:text-red-600"
              onClick={() => onDelete(cce)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main panel ────────────────────────────────────────────────────────────

export default function NfeCCePanel() {
  const [statusFilter, setStatusFilter] = useState<'' | NfeCCeStatus>('');
  const [searchText, setSearchText] = useState('');
  const [editingCCe, setEditingCCe] = useState<(NfeCCe & { nfe_emitidas?: any }) | null>(null);
  const [creating, setCreating] = useState(false);
  const [emittingTarget, setEmittingTarget] = useState<NfeCCe | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NfeCCe | null>(null);

  const { data: cces = [], isLoading } = useNfeCCes(
    statusFilter ? { status: statusFilter } : undefined,
  );
  const del = useDeleteCCe();

  const filtered = useMemo(() => {
    if (!searchText) return cces;
    return cces.filter(c => searchMatchesAllTerms(
      searchText,
      c.nfe_number,
      String(c.sequencia ?? ''),
      c.nfe_chave,
      c.correction_text,
      c.protocol,
    ));
  }, [cces, searchText]);


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Cartas de Correção</h2>
          <p className="text-xs text-muted-foreground">
            CCe corrige erros não-substanciais em NF-e autorizada. Prazo legal: 30 dias após emissão.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Nova CCe
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <SearchInput
          className="flex-1 min-w-48"
          placeholder="Buscar por NF, chave de acesso, protocolo ou texto…"
          value={searchText}
          onChange={setSearchText}
          resultCount={filtered.length}
          totalCount={cces.length}
        />
        <Select
          value={statusFilter || '__all__'}
          onValueChange={v => setStatusFilter(v === '__all__' ? '' : (v as NfeCCeStatus))}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            <SelectItem value="rascunho">Rascunho</SelectItem>
            <SelectItem value="emitida">Emitida</SelectItem>
            <SelectItem value="rejeitada">Rejeitada</SelectItem>
            <SelectItem value="erro">Erro</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            searchText ? (
              <EmptyState
                size="sm"
                icon={Search}
                title={`Nenhum resultado para "${searchText}"`}
                action={
                  <Button variant="outline" size="sm" onClick={() => setSearchText('')}>
                    Limpar busca
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={FileEdit}
                title="Nenhuma carta de correção"
                description="Crie uma CCe pra corrigir erros pontuais em NF-e já autorizada."
                action={
                  <Button onClick={() => setCreating(true)} className="gap-2">
                    <Plus className="h-4 w-4" /> Nova CCe
                  </Button>
                }
              />
            )
          ) : (
            <div className="divide-y divide-border/50">
              {filtered.map(c => (
                <CCeRow
                  key={c.id}
                  cce={c}
                  onEdit={setEditingCCe}
                  onMarkEmitted={setEmittingTarget}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* key força remount por alvo: sem ela, o useState inicial do CCeDialog
          nunca recarrega ao trocar de 'Nova CCe' pra 'Editar' (texto ficava vazio
          ou vazava entre aberturas). */}
      <CCeDialog
        key={editingCCe?.id ?? (creating ? 'new' : 'closed')}
        open={creating || !!editingCCe}
        onClose={() => {
          setCreating(false);
          setEditingCCe(null);
        }}
        editing={editingCCe}
      />

      <MarkEmittedDialog
        cce={emittingTarget}
        open={!!emittingTarget}
        onClose={() => setEmittingTarget(null)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar rascunho de CCe?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `NF ${deleteTarget.nfe_number} · Sequência ${deleteTarget.sequencia}. Esta ação não pode ser desfeita.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteTarget) del.mutate(deleteTarget.id); setDeleteTarget(null); }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
