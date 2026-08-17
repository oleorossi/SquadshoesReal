/**
 * Aba "Cliente (importar)" — etiqueta de caixa no padrão do cliente.
 *
 * Lê o arquivo de exportação do pedido de compra do ERP do cliente e gera um
 * PDF no tamanho exato do rolo térmico (50 × 40 mm), uma etiqueta por página.
 * A arte 46 × 38 mm e o módulo do CODE128 são padrão fixo do cliente — a
 * geometria toda mora em `@/lib/babyNalinLabels`, não aqui.
 */
import { useRef, useState } from 'react';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { SearchInput } from '@/components/ui/search-input';
import {
  UploadSimple as Upload,
  FilePdf,
  Barcode,
  Warning,
  X,
  CircleNotch as Loader2,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import logoFornecedor from '@/assets/baby-nalin/marca-fornecedor.png';
import {
  ART_HEIGHT_MM,
  ART_WIDTH_MM,
  MEDIA_HEIGHT_MM,
  MEDIA_WIDTH_MM,
  MODULE_MM,
  buildBabyNalinPdf,
  expandRows,
  loadLogoDataUrl,
  measureBarcode,
  parseClientOrderFile,
  pdfFilename,
  type BabyNalinRow,
} from '@/lib/babyNalinLabels';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

const ACCEPT = '.csv,.txt,.xlsx,.xls';

export function LabelClientImportTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BabyNalinRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [repeatByQuantity, setRepeatByQuantity] = useState(false);
  const [repeatMultiplier, setRepeatMultiplier] = useState(1);
  const [reading, setReading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState('');

  const totalPaginas = expandRows(rows, repeatByQuantity, repeatMultiplier).length;
  const totalPares = rows.reduce((t, r) => t + r.quantidade, 0);
  // Código que não respeita a zona de silêncio não pode virar etiqueta — a
  // barra sairia cortada e só se descobre no leitor da loja.
  const foraDoPadrao = rows.filter(r => !measureBarcode(r.codigoBarra).fits);
  const visibleRows = rows.filter(row => searchMatchesAllTerms(
    search,
    row.referencia,
    row.cor,
    row.tamanho,
    row.codProduto,
    row.codigoBarra,
  ));

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const lidas = await parseClientOrderFile(file);
      setRows(lidas);
      setFileName(file.name);
      toast.success(`${lidas.length} etiqueta(s) lidas de ${file.name}`);
    } catch (error) {
      setRows([]);
      setFileName('');
      toast.error(error instanceof Error ? error.message : 'Não consegui ler o arquivo.');
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleGenerate() {
    if (rows.length === 0) return;
    if (foraDoPadrao.length > 0) {
      toast.error(`${foraDoPadrao.length} código(s) não cabem na etiqueta. Corrija o pedido antes de gerar.`);
      return;
    }

    setGenerating(true);
    try {
      const logo = await loadLogoDataUrl(logoFornecedor);
      if (!logo) toast.warning('Não carreguei a logomarca — o PDF sai sem ela.');

      const doc = await buildBabyNalinPdf(rows, { repeatByQuantity, repeatMultiplier, logo });
      doc.save(pdfFilename(fileName));
      toast.success(`PDF com ${totalPaginas} etiqueta(s) gerado.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao gerar o PDF.');
    } finally {
      setGenerating(false);
    }
  }

  function limpar() {
    setRows([]);
    setFileName('');
    setRepeatByQuantity(false);
    setRepeatMultiplier(1);
    setSearch('');
  }

  return (
    <div className="space-y-4">
      <Panel
        eyebrow="ETIQUETAS · CLIENTE"
        title="Importar pedido do cliente"
        subtitle={`Arte ${ART_WIDTH_MM} × ${ART_HEIGHT_MM} mm centralizada em rolo ${MEDIA_WIDTH_MM} × ${MEDIA_HEIGHT_MM} mm · CODE128 com módulo de ${MODULE_MM.toFixed(4).replace('.', ',')} mm`}
        actions={
          rows.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={limpar} className="h-9">
              <X className="h-4 w-4 mr-1.5" />
              Limpar
            </Button>
          ) : null
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          id="client-order-upload"
          onChange={e => void handleFile(e.target.files?.[0])}
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={Barcode}
            title="Nenhum pedido importado"
            description="Selecione o arquivo de exportação de etiquetas do pedido de compra (CSV ou XLSX). Uma etiqueta por linha do arquivo."
            action={
              <Button onClick={() => inputRef.current?.click()} disabled={reading}>
                {reading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                {reading ? 'Lendo…' : 'Escolher arquivo'}
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <StatGrid>
              <StatCard label="Etiquetas" value={rows.length} hint={fileName} />
              <StatCard label="Pares no pedido" value={totalPares} unit="pares" />
              <StatCard
                label="Páginas do PDF"
                value={totalPaginas}
                hint={repeatByQuantity ? `${repeatMultiplier} por par` : 'uma por linha'}
              />
            </StatGrid>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="repeat-by-quantity"
                  checked={repeatByQuantity}
                  onCheckedChange={v => setRepeatByQuantity(v === true)}
                />
                <Label htmlFor="repeat-by-quantity" className="text-sm font-normal cursor-pointer">
                  Repetir cada etiqueta pela quantidade solicitada
                </Label>
              </div>

              {repeatByQuantity && (
                <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5">
                  <Label htmlFor="repeat-multiplier" className="whitespace-nowrap text-xs font-semibold text-foreground">
                    Etiquetas por par
                  </Label>
                  <Input
                    id="repeat-multiplier"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={repeatMultiplier}
                    onChange={e => {
                      const next = Math.trunc(Number(e.target.value));
                      setRepeatMultiplier(Number.isFinite(next) ? Math.min(100, Math.max(1, next)) : 1);
                    }}
                    className="h-8 w-16 bg-background text-center font-mono"
                    aria-describedby="repeat-multiplier-help"
                  />
                  <span id="repeat-multiplier-help" className="text-xs text-muted-foreground">
                    {totalPaginas.toLocaleString('pt-BR')} etiquetas no total
                  </span>
                </div>
              )}

              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-9" onClick={() => inputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1.5" />
                  Trocar arquivo
                </Button>
                <Button onClick={() => void handleGenerate()} disabled={generating || foraDoPadrao.length > 0}>
                  {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FilePdf className="h-4 w-4 mr-2" />}
                  {generating ? 'Gerando…' : `Gerar PDF (${totalPaginas})`}
                </Button>
              </div>
            </div>

            {foraDoPadrao.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
                <Warning className="h-4 w-4 mt-0.5 shrink-0" weight="fill" />
                <span>
                  {foraDoPadrao.length} código(s) longos demais para a etiqueta de {ART_WIDTH_MM} mm — a barra sairia
                  cortada. Confira a coluna <strong>Codigo Barra</strong> do pedido.
                </span>
              </div>
            )}

            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar no arquivo por referência, cor, tamanho ou código…"
              resultCount={visibleRows.length}
              totalCount={rows.length}
              className="max-w-lg"
            />

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 font-medium text-muted-foreground">Referência</th>
                    <th className="py-2 pr-3 font-medium text-muted-foreground">Cor</th>
                    <th className="py-2 pr-3 font-medium text-muted-foreground">Tam.</th>
                    <th className="py-2 pr-3 font-medium text-muted-foreground">Cód. produto</th>
                    <th className="py-2 pr-3 font-medium text-muted-foreground">Código de barras</th>
                    <th className="py-2 pr-3 font-medium text-muted-foreground text-right">Qtd.</th>
                    <th className="py-2 font-medium text-muted-foreground text-right">Largura</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, i) => {
                    const fit = measureBarcode(row.codigoBarra);
                    return (
                      <tr key={`${row.codigoBarra}-${i}`} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3 font-medium text-foreground">{row.referencia || '—'}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{row.cor || '—'}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{row.tamanho || '—'}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{row.codProduto || '—'}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-foreground">{row.codigoBarra}</td>
                        <td className="py-2 pr-3 text-right text-muted-foreground">{row.quantidade}</td>
                        <td className="py-2 text-right">
                          {fit.fits ? (
                            <span className="text-muted-foreground">{fit.widthMm.toFixed(1)} mm</span>
                          ) : (
                            <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">
                              não cabe
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Imprima em escala 100% (sem "ajustar à página") e passe o leitor da loja no código antes de rodar o
              pedido inteiro.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
