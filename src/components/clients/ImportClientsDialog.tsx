import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { UploadSimple as Upload, CircleNotch as Loader2, Warning as AlertTriangle, CheckCircle, ArrowRight, ArrowsClockwise as RefreshCw, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
  extractClientsFromFile,
  findExistingByCnpj,
  onlyDigits,
  useSaveImportedClient,
  type ExtractedClient,
} from '@/hooks/useImportClients';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Stage = 'upload' | 'review' | 'done';

interface ReviewItem {
  client: ExtractedClient;
  existingId: string | null;
  existingName: string | null;
  resolution: 'pending' | 'created' | 'updated' | 'skipped';
}

export function ImportClientsDialog({ open, onOpenChange }: Props) {
  const [stage, setStage] = useState<Stage>('upload');
  const [isExtracting, setIsExtracting] = useState(false);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [draft, setDraft] = useState<ExtractedClient | null>(null);
  const saveMut = useSaveImportedClient();

  const reset = useCallback(() => {
    setStage('upload');
    setIsExtracting(false);
    setItems([]);
    setCurrentIdx(0);
    setDraft(null);
  }, []);

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  // Progresso visível ao usuário durante extração multi-arquivo.
  // Updates conforme cada arquivo é processado em sequência.
  const [progress, setProgress] = useState<{ done: number; total: number; current: string | null }>({
    done: 0, total: 0, current: null,
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsExtracting(true);
    setProgress({ done: 0, total: files.length, current: files[0].name });

    // Resultado bruto de TODOS os arquivos. Mesmo se 1 falhar, o resto segue.
    const allExtracted: ExtractedClient[] = [];
    const failures: Array<{ name: string; reason: string }> = [];

    // Sequencial pra evitar rate-limit do Gemini (PDF/imagem usam IA).
    // Excel/CSV são instantâneos e poderiam ser paralelos, mas a complicação
    // de roteamento por tipo não compensa — 1-2s/arquivo no pior caso.
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setProgress({ done: i, total: files.length, current: f.name });
      try {
        const extracted = await extractClientsFromFile(f);
        if (extracted.length === 0) {
          failures.push({ name: f.name, reason: 'Nenhum cliente identificado' });
        } else {
          allExtracted.push(...extracted);
        }
      } catch (err: any) {
        console.error(`[ImportClients] extract error (${f.name}):`, err);
        failures.push({ name: f.name, reason: err?.message || 'Falha desconhecida' });
      }
    }
    setProgress({ done: files.length, total: files.length, current: null });

    // Dedup local por CNPJ: se o mesmo CNPJ apareceu em 2+ arquivos, mantém
    // a versão MAIS COMPLETA (mais campos preenchidos) — operador edita
    // tudo na revisão, mas começamos com o melhor candidato. Sem CNPJ,
    // ignora dedup (cliente sem documento sempre cria novo).
    const dedupKey = (c: ExtractedClient) => onlyDigits(c.cnpj);
    const byKey = new Map<string, ExtractedClient>();
    const sansCnpj: ExtractedClient[] = [];
    for (const c of allExtracted) {
      const k = dedupKey(c);
      if (!k) { sansCnpj.push(c); continue; }
      const prev = byKey.get(k);
      if (!prev) { byKey.set(k, c); continue; }
      // Score = qtd de campos truthy. Vence o mais completo.
      const score = (x: ExtractedClient) => Object.values(x).filter(v => v && String(v).trim()).length;
      byKey.set(k, score(c) > score(prev) ? c : prev);
    }
    const consolidated = [...byKey.values(), ...sansCnpj];

    if (consolidated.length === 0) {
      const msg = failures.length > 0
        ? `Nenhum cliente extraído. Falhas: ${failures.map(f => `${f.name} (${f.reason})`).join('; ')}`
        : 'Nenhum cliente identificado nos arquivos.';
      toast.error(msg, { duration: 10000 });
      setIsExtracting(false);
      e.target.value = '';
      return;
    }

    // Pra cada consolidado, verifica duplicata por CNPJ NO BANCO
    const enriched: ReviewItem[] = await Promise.all(
      consolidated.map(async c => {
        const existing = await findExistingByCnpj(c.cnpj);
        return {
          client: c,
          existingId: existing?.id ?? null,
          existingName: existing?.razao_social ?? null,
          resolution: 'pending' as const,
        };
      }),
    );

    setItems(enriched);
    setCurrentIdx(0);
    setDraft({ ...enriched[0].client });
    setStage('review');

    const msg = `${enriched.length} cliente${enriched.length === 1 ? '' : 's'} de ${files.length} arquivo${files.length === 1 ? '' : 's'}` +
      (failures.length > 0 ? ` · ${failures.length} arquivo${failures.length === 1 ? '' : 's'} com erro` : '');
    toast.success(msg);
    if (failures.length > 0) {
      toast.warning(`Arquivos com erro: ${failures.map(f => f.name).join(', ')}`, { duration: 8000 });
    }

    setIsExtracting(false);
    e.target.value = ''; // permite re-upload do mesmo arquivo
  };

  const advance = () => {
    if (currentIdx < items.length - 1) {
      const next = currentIdx + 1;
      setCurrentIdx(next);
      setDraft({ ...items[next].client });
    } else {
      setStage('done');
    }
  };

  const handleSkip = () => {
    setItems(prev => prev.map((it, i) => i === currentIdx ? { ...it, resolution: 'skipped' } : it));
    advance();
  };

  const handleSave = async (mode: 'create' | 'update') => {
    if (!draft) return;
    if (!draft.razao_social?.trim()) {
      toast.error('Razão Social é obrigatória.');
      return;
    }
    const current = items[currentIdx];
    try {
      const result = await saveMut.mutateAsync({
        client: draft,
        existingId: current.existingId,
        mode,
      });
      setItems(prev => prev.map((it, i) => i === currentIdx ? { ...it, resolution: result.action } : it));
      toast.success(result.action === 'created' ? 'Cliente criado' : 'Cliente atualizado');
      advance();
    } catch {
      // toast já tratado pelo hook
    }
  };

  const current = items[currentIdx];
  const stats = items.reduce(
    (acc, it) => {
      acc[it.resolution] = (acc[it.resolution] ?? 0) + 1;
      return acc;
    },
    { pending: 0, created: 0, updated: 0, skipped: 0 } as Record<ReviewItem['resolution'], number>,
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Clientes</DialogTitle>
          <DialogDescription>
            Envie um ou vários arquivos (Excel, CSV, PDF, Word, ou foto) com lista de lojistas. O sistema processa cada um, consolida por CNPJ e você revisa loja por loja antes de salvar.
          </DialogDescription>
        </DialogHeader>

        {stage === 'upload' && (
          <div className="space-y-4 py-2">
            <label
              htmlFor="import-clients-file"
              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-12 px-6 cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <p className="text-sm font-medium">
                    {progress.total > 1
                      ? `Processando ${progress.done + (progress.current ? 1 : 0)} de ${progress.total} arquivos…`
                      : 'Lendo arquivo e extraindo dados…'}
                  </p>
                  {progress.current && (
                    <p className="text-xs text-muted-foreground truncate max-w-xs">{progress.current}</p>
                  )}
                  <p className="text-xs text-muted-foreground">PDF/imagem usam IA — pode levar 10-20s cada</p>
                </>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium">Clique pra escolher arquivos</p>
                  <p className="text-xs text-muted-foreground text-center">
                    Pode selecionar VÁRIOS arquivos (Ctrl/Cmd + clique).<br />
                    Aceito: .xlsx · .xls · .csv · .pdf · .docx · .jpg · .png<br />
                    Excel/CSV: parse direto (instantâneo). PDF/Word/Imagem: IA Gemini.
                  </p>
                </>
              )}
              <input
                id="import-clients-file"
                type="file"
                multiple
                accept=".xlsx,.xls,.csv,.pdf,.docx,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleFileChange}
                disabled={isExtracting}
              />
            </label>

            <div className="rounded-md bg-muted/40 border border-border/60 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Dica de campos esperados:</p>
              <ul className="list-disc ml-4 space-y-0.5">
                <li><strong>Excel/CSV</strong>: cabeçalhos como "Razão Social", "CNPJ", "Cidade", "UF", "CEP", "Telefone", "Email", "Inscrição Estadual"</li>
                <li><strong>PDF/Word/Imagem</strong>: a IA extrai automaticamente — qualquer formato de listagem</li>
              </ul>
            </div>
          </div>
        )}

        {stage === 'review' && current && draft && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between text-sm">
              <div>
                <p className="font-bold">Cliente {currentIdx + 1} de {items.length}</p>
                <p className="text-xs text-muted-foreground">
                  {stats.created} criados · {stats.updated} atualizados · {stats.skipped} pulados
                </p>
              </div>
              <Progress value={((currentIdx + (current.resolution !== 'pending' ? 1 : 0)) / items.length) * 100} className="w-32 h-2" />
            </div>

            {current.existingId && (
              <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold text-amber-900 dark:text-amber-300">CNPJ já cadastrado</p>
                  <p className="text-amber-900/80 dark:text-amber-200/80">
                    Existe um cliente com este CNPJ: <strong>{current.existingName}</strong>.
                    Você pode atualizar os dados desse cliente OU pular essa entrada.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Razão Social *" value={draft.razao_social} onChange={v => setDraft(d => d ? { ...d, razao_social: v } : d)} required />
              <Field label="Nome Fantasia" value={draft.nome_fantasia ?? ''} onChange={v => setDraft(d => d ? { ...d, nome_fantasia: v } : d)} />
              <Field label="CNPJ" value={draft.cnpj ?? ''} onChange={v => setDraft(d => d ? { ...d, cnpj: v } : d)} mono />
              <Field label="Inscrição Estadual" value={draft.inscricao_estadual ?? ''} onChange={v => setDraft(d => d ? { ...d, inscricao_estadual: v } : d)} mono />
              <Field label="Regime Tributário" value={draft.regime_tributario ?? ''} onChange={v => setDraft(d => d ? { ...d, regime_tributario: v } : d)} />
              <Field label="Telefone" value={draft.telefone ?? ''} onChange={v => setDraft(d => d ? { ...d, telefone: v } : d)} />
              <Field label="E-mail" value={draft.email ?? ''} onChange={v => setDraft(d => d ? { ...d, email: v } : d)} type="email" className="md:col-span-2" />
              <Field label="Endereço" value={draft.endereco ?? ''} onChange={v => setDraft(d => d ? { ...d, endereco: v } : d)} className="md:col-span-2" />
              <Field label="Número" value={draft.numero ?? ''} onChange={v => setDraft(d => d ? { ...d, numero: v } : d)} />
              <Field label="Bairro" value={draft.bairro ?? ''} onChange={v => setDraft(d => d ? { ...d, bairro: v } : d)} />
              <Field label="Cidade" value={draft.cidade ?? ''} onChange={v => setDraft(d => d ? { ...d, cidade: v } : d)} />
              <Field label="UF" value={draft.estado ?? ''} onChange={v => setDraft(d => d ? { ...d, estado: v.toUpperCase().slice(0, 2) } : d)} maxLength={2} />
              <Field label="CEP" value={draft.cep ?? ''} onChange={v => setDraft(d => d ? { ...d, cep: v } : d)} mono />
              <Field label="Contato" value={draft.contato ?? ''} onChange={v => setDraft(d => d ? { ...d, contato: v } : d)} />
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t">
              <Button variant="ghost" onClick={handleSkip} className="gap-1">
                <X className="h-4 w-4" /> Pular
              </Button>
              <div className="flex gap-2">
                {current.existingId ? (
                  <Button onClick={() => handleSave('update')} disabled={saveMut.isPending} className="gap-1">
                    {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Atualizar existente e próximo
                  </Button>
                ) : (
                  <Button onClick={() => handleSave('create')} disabled={saveMut.isPending} className="gap-1">
                    {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    Salvar e próximo
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle className="h-12 w-12 text-emerald-600 mx-auto" />
            <div>
              <p className="text-lg font-bold">Importação concluída</p>
              <p className="text-sm text-muted-foreground mt-1">
                {items.length} cliente{items.length === 1 ? '' : 's'} processado{items.length === 1 ? '' : 's'}.
              </p>
            </div>
            <div className="flex justify-center gap-2 flex-wrap">
              {stats.created > 0 && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">{stats.created} criados</Badge>}
              {stats.updated > 0 && <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400">{stats.updated} atualizados</Badge>}
              {stats.skipped > 0 && <Badge variant="outline" className="bg-muted text-muted-foreground">{stats.skipped} pulados</Badge>}
            </div>
            <div className="flex justify-center gap-2 pt-2">
              <Button variant="outline" onClick={reset}>Importar outro arquivo</Button>
              <Button onClick={() => handleClose(false)}>Fechar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, value, onChange, required, mono, type, maxLength, className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  mono?: boolean;
  type?: string;
  maxLength?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-[10px] text-muted-foreground uppercase font-bold mb-1 block">{label}</Label>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        type={type}
        maxLength={maxLength}
        className={`h-9 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}
