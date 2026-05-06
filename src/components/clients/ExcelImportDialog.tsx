import { useState, useRef, useMemo } from 'react';
import { FileUp, Upload, Loader2, FileSpreadsheet, FileText, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ClientFormData } from '@/hooks/useClients';

const COLUMN_MAP: Record<string, keyof ClientFormData> = {
  'razao': 'razao_social', 'razão': 'razao_social', 'fantasia': 'nome_fantasia',
  'cnpj': 'cnpj', 'inscri': 'inscricao_estadual', 'endereco': 'endereco',
  'endereço': 'endereco', 'cidade': 'cidade', 'estado': 'estado', 'uf': 'estado',
  'cep': 'cep', 'email': 'email', 'telefone': 'telefone', 'fone': 'telefone',
  'contato': 'contato', 'observa': 'notes',
};

function mapColumns(headers: string[]): Record<number, keyof ClientFormData> {
  const result: Record<number, keyof ClientFormData> = {};
  headers.forEach((h, idx) => {
    const lower = h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const [key, field] of Object.entries(COLUMN_MAP)) {
      if (lower.includes(key.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
        result[idx] = field; break;
      }
    }
  });
  return result;
}

const emptyClient = (): ClientFormData => ({
  razao_social: '', nome_fantasia: '', cnpj: '', inscricao_estadual: '',
  endereco: '', cidade: '', estado: '', cep: '', email: '', telefone: '',
  contato: '', notes: '', economic_group_id: null, active: true, logo_url: '',
  silk_url: null, is_favorite: false, accepts_bundled_packaging: true,
  credit_limit: 0,
});

function validateClient(client: ClientFormData): string[] {
  const errors: string[] = [];
  if (!client.razao_social?.trim()) errors.push('Razão Social obrigatória');
  if (client.cnpj && !/^\d{14}$/.test(client.cnpj.replace(/\D/g, ''))) errors.push('CNPJ inválido');
  if (client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) errors.push('E-mail inválido');
  return errors;
}

type ImportStep = 'upload' | 'preview' | 'importing';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; onImport: (clients: ClientFormData[]) => void; }

export default function ExcelImportDialog({ open, onOpenChange, onImport }: Props) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [preview, setPreview] = useState<ClientFormData[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<number, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [activeTab, setActiveTab] = useState('excel');
  const fileRef = useRef<HTMLInputElement>(null);
  const wordFileRef = useRef<HTMLInputElement>(null);

  const validationSummary = useMemo(() => {
    const total = preview.length;
    const withErrors = Object.values(validationErrors).filter(e => e.length > 0).length;
    const valid = total - withErrors;
    const errorTypes = new Set(Object.values(validationErrors).flat());
    return { total, withErrors, valid, errorTypes };
  }, [preview, validationErrors]);

  const processClients = (clients: ClientFormData[]) => {
    const errors: Record<number, string[]> = {};
    clients.forEach((c, i) => { const errs = validateClient(c); if (errs.length > 0) errors[i] = errs; });
    setPreview(clients);
    setValidationErrors(errors);
    setStep('preview');
  };

  const handleExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) { toast.error('Planilha vazia.'); setLoading(false); return; }
      const rows: any[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => { rows.push(row.values ? (row.values as any[]).slice(1) : []); });
      if (rows.length < 2) { toast.error('Planilha sem dados.'); setLoading(false); return; }
      const headers = rows[0].map(String);
      const colMap = mapColumns(headers);
      if (!Object.values(colMap).includes('razao_social')) { toast.error('Coluna "Razão Social" não encontrada.'); setLoading(false); return; }
      const clients: ClientFormData[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        const client = emptyClient();
        for (const [colIdx, field] of Object.entries(colMap)) {
          const val = row[Number(colIdx)];
          if (val !== undefined && val !== null && field !== 'economic_group_id' && field !== 'active') (client as any)[field] = String(val).trim();
        }
        if (client.razao_social) clients.push(client);
      }
      processClients(clients);
      toast.success(`${clients.length} clientes encontrados.`);
    } catch { toast.error('Erro ao ler arquivo Excel.'); }
    setLoading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleWordFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      if (!result.value?.trim()) { toast.error('Documento vazio.'); setLoading(false); return; }
      const clients = parseWordClients(result.value);
      if (!clients.length) { toast.error('Nenhum cliente encontrado.'); setLoading(false); return; }
      processClients(clients);
      toast.success(`${clients.length} clientes encontrados.`);
    } catch { toast.error('Erro ao ler arquivo Word.'); }
    setLoading(false);
    if (wordFileRef.current) wordFileRef.current.value = '';
  };

  const handleImport = async () => {
    setStep('importing');
    const validClients = preview.filter((_, i) => !validationErrors[i]?.length);
    for (let i = 0; i < validClients.length; i++) {
      setImportProgress(Math.round(((i + 1) / validClients.length) * 100));
      await new Promise(r => setTimeout(r, 10));
    }
    onImport(validClients);
    toast.success(`${validClients.length} clientes importados com sucesso!`);
    handleReset();
    onOpenChange(false);
  };

  const handleReset = () => { setPreview([]); setValidationErrors({}); setStep('upload'); setImportProgress(0); };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleReset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileUp className="h-5 w-5" />Importar Clientes</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {(['upload', 'preview', 'importing'] as ImportStep[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                step === s ? "bg-primary text-primary-foreground" :
                (['upload','preview','importing'].indexOf(step) > i) ? "bg-success text-success-foreground" :
                "bg-muted text-muted-foreground")}>
                {['upload','preview','importing'].indexOf(step) > i ? '✓' : i + 1}
              </div>
              <span className={step === s ? 'text-foreground font-medium' : ''}>
                {s === 'upload' ? 'Selecionar' : s === 'preview' ? 'Validar' : 'Importar'}
              </span>
              {i < 2 && <span className="text-muted-foreground/40">→</span>}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {step === 'upload' && (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="excel" className="gap-2"><FileSpreadsheet className="h-4 w-4" />Excel</TabsTrigger>
                <TabsTrigger value="word" className="gap-2"><FileText className="h-4 w-4" />Word</TabsTrigger>
              </TabsList>
              <TabsContent value="excel" className="space-y-4 mt-4">
                <label htmlFor="excel-upload" className={cn("border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors", loading ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50")}>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelFile} className="hidden" id="excel-upload" />
                  {loading ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
                  <div className="text-center">
                    <p className="text-sm font-medium">Arraste ou clique para selecionar</p>
                    <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .csv</p>
                  </div>
                </label>
                <p className="text-xs text-muted-foreground bg-muted/50 rounded p-3"><strong>Colunas:</strong> Razão Social* · Nome Fantasia · CNPJ · Endereço · Cidade · UF · CEP · Email · Telefone</p>
              </TabsContent>
              <TabsContent value="word" className="space-y-4 mt-4">
                <label htmlFor="word-upload" className={cn("border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors", loading ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50")}>
                  <input ref={wordFileRef} type="file" accept=".docx" onChange={handleWordFile} className="hidden" id="word-upload" />
                  {loading ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
                  <div className="text-center">
                    <p className="text-sm font-medium">Arraste ou clique para selecionar</p>
                    <p className="text-xs text-muted-foreground mt-1">.docx</p>
                  </div>
                </label>
              </TabsContent>
            </Tabs>
          )}

          {step === 'preview' && (
            <div className="space-y-4 mt-2">
              <div className={cn("rounded-lg border p-3 flex items-start gap-3", validationSummary.withErrors > 0 ? "border-warning/30 bg-warning/5" : "border-success/30 bg-success/5")}>
                {validationSummary.withErrors > 0 ? <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" /> : <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />}
                <div className="text-sm flex-1">
                  <p className="font-medium">{validationSummary.withErrors > 0 ? `${validationSummary.withErrors} linha(s) com problemas` : 'Todos os dados válidos'}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{validationSummary.valid} de {validationSummary.total} registros serão importados</p>
                  {validationSummary.withErrors > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {[...validationSummary.errorTypes].map(e => <Badge key={e} variant="outline" className="text-[10px] border-warning/40 text-warning">{e}</Badge>)}
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-lg border overflow-hidden">
                <div className="overflow-x-auto max-h-[45vh]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>Razão Social</TableHead>
                        <TableHead>CNPJ</TableHead>
                        <TableHead>Cidade/UF</TableHead>
                        <TableHead className="w-28">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.map((c, i) => {
                        const errs = validationErrors[i] || [];
                        const hasError = errs.length > 0;
                        return (
                          <TableRow key={i} className={cn(hasError && "bg-destructive/5")}>
                            <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className={cn("font-medium text-sm", hasError && "text-destructive/80")}>{c.razao_social || <span className="text-destructive italic text-xs">Vazio</span>}</TableCell>
                            <TableCell className="font-mono text-sm">{c.cnpj || '—'}</TableCell>
                            <TableCell className="text-sm">{[c.cidade, c.estado].filter(Boolean).join('/') || '—'}</TableCell>
                            <TableCell>
                              {hasError
                                ? <div className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-destructive" /><span className="text-[10px] text-destructive">{errs[0]}</span></div>
                                : <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="py-12 space-y-6 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <div className="space-y-2">
                <p className="text-sm font-medium">Importando {validationSummary.valid} clientes...</p>
                <Progress value={importProgress} className="h-2 max-w-xs mx-auto" />
                <p className="text-xs text-muted-foreground">{importProgress}%</p>
              </div>
            </div>
          )}
        </div>

        {step === 'preview' && (
          <DialogFooter className="flex-row items-center gap-2 border-t pt-4">
            <Button variant="outline" onClick={handleReset} className="mr-auto">← Voltar</Button>
            <Button onClick={handleImport} disabled={validationSummary.valid === 0} className="gap-2">
              <FileUp className="h-4 w-4" />Importar {validationSummary.valid} clientes
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function parseWordClients(_rawText: string): ClientFormData[] { return []; }
