import { useCallback, useRef, useState } from 'react';
import {
  UploadSimple, FileArrowUp, CheckCircle, Warning, Trash as Trash2,
  CircleNotch as Loader2, Barcode, X, Bank,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { readBoletoPdfs } from '@/lib/pdfBoleto';
import { formatDigitableLine } from '@/lib/boletoParser';

type ReadStatus = 'ok' | 'warning' | 'error';

interface BoletoRow {
  id: string;
  file: File;
  fileName: string;
  status: ReadStatus;
  message: string | null;
  // Campos editáveis lançados no financeiro:
  description: string;
  supplier_id: string;
  category: string;
  due_date: string;
  amount: number;
  bank_name: string;
  barcode: string;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: { id: string; name: string }[];
};

const CATEGORIES = [
  { value: 'material', label: 'Material' },
  { value: 'servico', label: 'Serviço' },
  { value: 'frete', label: 'Frete' },
  { value: 'imposto', label: 'Imposto' },
  { value: 'mao_de_obra', label: 'Mão de Obra' },
  { value: 'overhead', label: 'Overhead' },
  { value: 'outro', label: 'Outro' },
];

let rowSeq = 0;
const nextId = () => `boleto-${Date.now()}-${rowSeq++}`;

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function BoletoUploadDialog({ open, onOpenChange, suppliers }: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BoletoRow[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => {
    setRows([]);
    setReading(false);
    setSaving(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleClose = (o: boolean) => {
    if (!o && (reading || saving)) return; // não fecha durante operação
    if (!o) reset();
    onOpenChange(o);
  };

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    );
    if (files.length === 0) {
      toast.error('Selecione arquivos PDF de boleto.');
      return;
    }
    setReading(true);
    try {
      const results = await readBoletoPdfs(files);
      const newRows: BoletoRow[] = results.map((r, idx) => {
        const p = r.parsed;
        let status: ReadStatus = 'ok';
        let message: string | null = null;
        if (r.error) {
          status = 'error';
          message = r.error;
        } else if (p && !p.valid) {
          status = 'warning';
          message = 'Dígitos verificadores não conferem — confira os dados.';
        } else if (p && (!p.amount || !p.dueDate)) {
          status = 'warning';
          message = p.kind === 'concessionaria'
            ? 'Conta de concessionária: confirme valor e vencimento.'
            : 'Valor ou vencimento não codificados no boleto — preencha.';
        }

        const bankLabel = p?.bankName || '';
        const dueLabel = p?.dueDate ? p.dueDate.split('-').reverse().join('/') : '';
        const description = [
          'Boleto',
          bankLabel,
          dueLabel ? `venc. ${dueLabel}` : '',
        ].filter(Boolean).join(' ') || files[idx].name.replace(/\.pdf$/i, '');

        return {
          id: nextId(),
          file: files[idx],
          fileName: r.fileName,
          status,
          message,
          description,
          supplier_id: '',
          category: 'material',
          due_date: p?.dueDate || '',
          amount: p?.amount || 0,
          bank_name: bankLabel,
          barcode: p ? formatDigitableLine(p.digitableLine) : '',
        };
      });
      setRows((prev) => [...prev, ...newRows]);
      const okCount = newRows.filter((r) => r.status === 'ok').length;
      toast.success(`${newRows.length} boleto(s) processado(s) · ${okCount} lido(s) automaticamente.`);
    } catch (e) {
      toast.error(`Erro ao ler PDFs: ${(e as Error).message}`);
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files);
  };

  const updateRow = (id: string, patch: Partial<BoletoRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const validRows = rows.filter((r) => r.amount > 0 && !!r.due_date);
  const invalidCount = rows.length - validRows.length;
  const totalAmount = validRows.reduce((s, r) => s + r.amount, 0);

  const handleLaunch = async () => {
    if (validRows.length === 0) {
      toast.error('Nenhum boleto pronto: informe valor e vencimento.');
      return;
    }
    setSaving(true);
    let created = 0;
    let attachFailures = 0;
    // Linhas já gravadas — removidas do estado ao final pra que uma nova
    // tentativa (após falha parcial) não relance as contas já criadas.
    const launchedIds: string[] = [];
    try {
      const { data: { user } } = await supabase.auth.getUser();

      for (const r of validRows) {
        const payload = {
          description: r.description || `Boleto ${r.fileName}`,
          supplier_id: r.supplier_id || null,
          category: r.category,
          due_date: r.due_date,
          amount: r.amount,
          amount_paid: 0,
          status: 'pending',
          payment_method: 'boleto',
          bank_name: r.bank_name || null,
          barcode: r.barcode || null,
          installment_number: 1,
          total_installments: 1,
        };
        const { data: inserted, error } = await supabase
          .from('accounts_payable')
          .insert(payload as any)
          .select('id')
          .single();
        if (error) throw error;
        created++;
        launchedIds.push(r.id);

        // Anexa o PDF original ao lançamento (best-effort — não bloqueia o lote).
        try {
          const accountId = (inserted as { id: string }).id;
          const safeName = r.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
          const path = `payable/${accountId}/${Date.now()}_${safeName}`;
          const { error: upErr } = await supabase.storage
            .from('finance-attachments')
            .upload(path, r.file, { contentType: 'application/pdf' });
          if (upErr) throw upErr;
          const { error: attErr } = await supabase.from('finance_attachments').insert({
            account_type: 'payable',
            account_id: accountId,
            file_name: r.fileName,
            file_path: path,
            file_size: r.file.size,
            mime_type: 'application/pdf',
            uploaded_by: user?.id || null,
          } as any);
          if (attErr) {
            await supabase.storage.from('finance-attachments').remove([path]);
            throw attErr;
          }
        } catch {
          attachFailures++;
        }
      }

      queryClient.invalidateQueries({ queryKey: ['accounts_payable'] });
      const attachNote = attachFailures > 0 ? ` (${attachFailures} anexo(s) falharam)` : '';
      toast.success(`${created} conta(s) a pagar lançada(s)!${attachNote}`);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(`Erro ao lançar: ${(e as Error).message}. ${created} já criada(s).`);
      if (created > 0) queryClient.invalidateQueries({ queryKey: ['accounts_payable'] });
    } finally {
      setSaving(false);
      // Tira da lista o que já foi gravado — evita lançamento duplicado se o
      // usuário corrigir o restante e clicar "Lançar" de novo.
      if (launchedIds.length) {
        setRows((prev) => prev.filter((r) => !launchedIds.includes(r.id)));
      }
    }
  };

  const statusBadge = (r: BoletoRow) => {
    if (r.status === 'ok') {
      return <Badge className="bg-green-500/10 text-green-600 border-green-500/20 gap-1"><CheckCircle className="h-3 w-3" /> Lido</Badge>;
    }
    if (r.status === 'warning') {
      return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1"><Warning className="h-3 w-3" /> Conferir</Badge>;
    }
    return <Badge className="bg-red-500/10 text-red-600 border-red-500/20 gap-1"><Warning className="h-3 w-3" /> Manual</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Barcode className="h-5 w-5 text-primary" />
            Importar Boletos (PDF)
          </DialogTitle>
          <DialogDescription>
            Envie um ou vários PDFs de boleto. O sistema lê a linha digitável, valor e
            vencimento. Confira e edite abaixo antes de lançar no financeiro.
          </DialogDescription>
        </DialogHeader>

        {/* Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !reading && inputRef.current?.click()}
          className={`shrink-0 cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && processFiles(e.target.files)}
          />
          {reading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Lendo boletos...
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <UploadSimple className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm font-medium">Arraste os PDFs aqui ou clique para selecionar</p>
              <p className="text-xs text-muted-foreground">Vários arquivos de uma vez · somente PDF</p>
            </div>
          )}
        </div>

        {/* Lista de conferência */}
        {rows.length > 0 && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 -mr-1">
            {rows.map((r, idx) => (
              <div key={r.id} className="rounded-lg border bg-card p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileArrowUp className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium truncate" title={r.fileName}>
                      {idx + 1}. {r.fileName}
                    </span>
                    {statusBadge(r)}
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => removeRow(r.id)} aria-label="Remover">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {r.message && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Warning className="h-3 w-3 shrink-0" /> {r.message}
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Descrição</Label>
                    <Input className="h-8 text-xs" value={r.description} onChange={(e) => updateRow(r.id, { description: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Fornecedor</Label>
                    <SearchableSelect
                      value={r.supplier_id}
                      onChange={(v) => updateRow(r.id, { supplier_id: v })}
                      options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                      placeholder="Selecione"
                      searchPlaceholder="Buscar fornecedor..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Categoria</Label>
                    <Select value={r.category} onValueChange={(v) => updateRow(r.id, { category: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Vencimento</Label>
                    <Input
                      type="date"
                      className={`h-8 text-xs ${!r.due_date ? 'border-destructive' : ''}`}
                      value={r.due_date}
                      onChange={(e) => updateRow(r.id, { due_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Valor</Label>
                    <CurrencyInput
                      className={`h-8 text-xs ${r.amount <= 0 ? 'border-destructive' : ''}`}
                      value={r.amount}
                      onChange={(v) => updateRow(r.id, { amount: v })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs flex items-center gap-1"><Bank className="h-3 w-3" /> Banco</Label>
                    <Input className="h-8 text-xs" value={r.bank_name} onChange={(e) => updateRow(r.id, { bank_name: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Linha digitável / Código de barras</Label>
                    <Input
                      className="h-8 text-xs font-mono"
                      value={r.barcode}
                      onChange={(e) => updateRow(r.id, { barcode: e.target.value })}
                      placeholder="Cole aqui se não foi lido automaticamente"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="shrink-0 flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t pt-3">
          <div className="text-sm text-muted-foreground">
            {rows.length > 0 && (
              <span className="flex flex-wrap items-center gap-x-3">
                <span><strong className="text-foreground">{validRows.length}</strong> pronto(s)</span>
                {invalidCount > 0 && <span className="text-amber-600">{invalidCount} incompleto(s)</span>}
                <span>Total: <strong className="text-foreground font-mono">{fmtBRL(totalAmount)}</strong></span>
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleClose(false)} disabled={reading || saving}>
              <X className="h-4 w-4 mr-1" /> Cancelar
            </Button>
            <Button onClick={handleLaunch} disabled={saving || reading || validRows.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
              {saving ? 'Lançando...' : `Lançar ${validRows.length || ''} no financeiro`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
