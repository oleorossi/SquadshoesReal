import { useEffect, useMemo, useState } from 'react';
import {
  Handshake, Plus, PencilSimple, Trash, CurrencyDollar, Buildings, Warning,
} from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { formatCurrency } from '@/lib/utils';
import { useContractors } from '@/hooks/useContractors';
import {
  useReferenceTerceirizacoes,
  useCreateReferenceTerceirizacao,
  useUpdateReferenceTerceirizacao,
  useDeleteReferenceTerceirizacao,
  type ReferenceTerceirizacao,
} from '@/hooks/useReferenceTerceirizacoes';

/**
 * Aba "Terceirizados" da ficha técnica. Cadastra, por referência, o prestador +
 * descrição do serviço + valor POR PAR. Cada entrada vira opção (opcional) de
 * terceirização item-a-item na criação do pedido de venda.
 */
export function ReferenceTerceirizacoesPanel({ sheetId }: { sheetId: string }) {
  const { data: entries = [], isLoading } = useReferenceTerceirizacoes(sheetId);
  const del = useDeleteReferenceTerceirizacao();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ReferenceTerceirizacao | null>(null);

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (e: ReferenceTerceirizacao) => { setEditing(e); setDialogOpen(true); };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Handshake className="h-4 w-4 text-primary" />
            Terceirizados
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            Cadastre serviços que podem ser terceirizados desta referência (prestador,
            descrição e <strong>valor por par</strong>). Na criação do pedido você escolhe,
            item a item e de forma opcional, quais terceirizar — a Ordem de Serviço é
            gerada automaticamente.
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="h-9 gap-1.5 shrink-0">
          <Plus className="h-4 w-4" /> Adicionar
        </Button>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-8 text-center">Carregando…</div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="Nenhuma terceirização cadastrada"
          description="Adicione um serviço terceirizável (ex.: Costura na Contratada A, Solagem na Contratada B) com o valor por par."
          action={<Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Adicionar terceirização</Button>}
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr className="text-left text-xs uppercase tracking-wide">
                <th className="px-3 py-2 font-semibold">Contratada</th>
                <th className="px-3 py-2 font-semibold">Descrição</th>
                <th className="px-3 py-2 font-semibold text-right">Valor/par</th>
                <th className="px-3 py-2 font-semibold text-center">Ativa</th>
                <th className="px-3 py-2 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <span className="font-medium">
                      {e.contractors?.trade_name || e.contractors?.name || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{e.description}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCurrency(e.value_per_pair)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {e.active ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/40 dark:text-green-400 text-[10px]">Ativa</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">Inativa</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(e)} aria-label="Editar">
                        <PencilSimple className="h-3.5 w-3.5" />
                      </Button>
                      <DeleteConfirmButton
                        onConfirm={() => del.mutate(e.id)}
                        title="Remover terceirização?"
                        description={`"${e.description}" deixará de aparecer como opção no pedido de venda.`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TerceirizacaoFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        sheetId={sheetId}
        editing={editing}
      />
    </div>
  );
}

function TerceirizacaoFormDialog({
  open, onOpenChange, sheetId, editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sheetId: string;
  editing: ReferenceTerceirizacao | null;
}) {
  const { data: contractors = [] } = useContractors();
  const create = useCreateReferenceTerceirizacao();
  const update = useUpdateReferenceTerceirizacao();

  const [contractorId, setContractorId] = useState('');
  const [description, setDescription] = useState('');
  const [valuePerPair, setValuePerPair] = useState(0);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (open) {
      setContractorId(editing?.contractor_id || '');
      setDescription(editing?.description || '');
      setValuePerPair(editing?.value_per_pair || 0);
      setActive(editing?.active ?? true);
    }
  }, [open, editing]);

  const activeContractors = useMemo(
    () => contractors.filter((c: any) => c.active !== false || c.id === contractorId),
    [contractors, contractorId],
  );

  const canSubmit = !!contractorId && !!description.trim() && valuePerPair > 0;
  const isPending = create.isPending || update.isPending;

  const submit = () => {
    if (!canSubmit) return;
    if (editing) {
      update.mutate(
        { id: editing.id, contractor_id: contractorId, description, value_per_pair: valuePerPair, active },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      create.mutate(
        { reference_id: sheetId, contractor_id: contractorId, description, value_per_pair: valuePerPair, active },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-5 w-5 text-primary" />
            {editing ? 'Editar terceirização' : 'Nova terceirização'}
          </DialogTitle>
          <DialogDescription>
            Prestador, descrição do serviço e valor por par. Vira opção (opcional) na
            criação do pedido de venda.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs flex items-center gap-1">
              <Buildings className="h-3 w-3" /> Contratada *
            </Label>
            <Select value={contractorId} onValueChange={setContractorId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Selecionar contratada…" />
              </SelectTrigger>
              <SelectContent>
                {contractors.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1">
                    <Warning className="h-3 w-3" /> Nenhuma contratada. Cadastre em /terceirizados.
                  </div>
                )}
                {activeContractors.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.trade_name || c.name}
                    {c.service_type && (
                      <Badge variant="outline" className="h-4 text-[10px] ml-2">{c.service_type}</Badge>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Descrição do serviço *</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: Costura do cabedal"
              rows={2}
              className="mt-1 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <Label className="text-xs flex items-center gap-1">
                <CurrencyDollar className="h-3 w-3" /> Valor por par (R$) *
              </Label>
              <NumberInput value={valuePerPair} onChange={setValuePerPair} step="0.01" min={0} className="mt-1 h-9" />
            </div>
            <div className="flex items-center gap-2 h-9">
              <Switch id="terc-active" checked={active} onCheckedChange={setActive} />
              <Label htmlFor="terc-active" className="text-xs cursor-pointer">Ativa</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancelar</Button>
          <Button onClick={submit} disabled={!canSubmit || isPending}>
            {isPending ? 'Salvando…' : editing ? 'Salvar' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
