/**
 * Módulo isolado "ETIQUETAGEM CLIENTE" — etiqueta no padrão do cliente.
 *
 * Lê o arquivo de exportação do pedido de compra do ERP do cliente e gera:
 *   - produção no rolo térmico 50 × 40 mm;
 *   - gráfica em duas etiquetas couchê 50 × 30 mm lado a lado.
 * A geometria e o módulo do CODE128 moram em `@/lib/babyNalinLabels`.
 */
import { useEffect, useRef, useState } from 'react';
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
  Factory,
  Palette,
  CheckCircle,
  Warning,
  X,
  CircleNotch as Loader2,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import logoFornecedor from '@/assets/baby-nalin/marca-fornecedor.png';
import {
  ART_WIDTH_MM,
  BARCODE_FORMAT,
  COUCHE_COLUMNS,
  DEFAULT_COUCHE_ROLL_PROFILE,
  COUCHE_LABEL_HEIGHT_MM,
  COUCHE_LABEL_WIDTH_MM,
  MAX_PDF_LABELS,
  MODULE_MM,
  analyzeClientSkus,
  buildBabyNalinPdf,
  clientSkuKey,
  countExpandedRows,
  graphicPageCount,
  graphicPdfFilename,
  loadLogoDataUrl,
  measureBarcode,
  parseClientOrderFile,
  pdfFilename,
  resolveCoucheRollGeometry,
  type BabyNalinRow,
  type CoucheRollProfile,
} from '@/lib/babyNalinLabels';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

const ACCEPT = '.csv,.txt,.xlsx,.xls';
const MAX_PROFILE_MEASURE_MM = 50;

const COUCHE_PROFILE_FIELDS: Array<{
  key: keyof CoucheRollProfile;
  label: string;
}> = [
  { key: 'columnGapMm', label: 'Vão entre colunas' },
  { key: 'leftMarginMm', label: 'Margem esquerda' },
  { key: 'rightMarginMm', label: 'Margem direita' },
  { key: 'topMarginMm', label: 'Margem superior' },
  { key: 'bottomMarginMm', label: 'Margem inferior / avanço' },
];

export function ClientLabelingWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRequestIdRef = useRef(0);
  const [rows, setRows] = useState<BabyNalinRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [repeatByQuantity, setRepeatByQuantity] = useState(false);
  const [repeatMultiplier, setRepeatMultiplier] = useState(1);
  const [reading, setReading] = useState(false);
  const [generating, setGenerating] = useState<'production' | 'graphic' | null>(null);
  const [search, setSearch] = useState('');
  const [selectedSkuKeys, setSelectedSkuKeys] = useState<Set<string>>(new Set());
  const [coucheProfile, setCoucheProfile] = useState<CoucheRollProfile>({
    ...DEFAULT_COUCHE_ROLL_PROFILE,
  });
  const [coucheProfileConfirmed, setCoucheProfileConfirmed] = useState(false);

  const skuAnalysis = analyzeClientSkus(rows);
  const rowEntries = rows.map((row, sourceIndex) => ({
    row,
    sourceIndex,
    skuKey: clientSkuKey(row),
    barcodeFit: measureBarcode(row.codigoBarra),
  }));
  const selectedEntries = rowEntries.filter(entry => selectedSkuKeys.has(entry.skuKey));
  const selectedRows = selectedEntries.map(entry => entry.row);
  const selectedSkuAnalysis = analyzeClientSkus(selectedRows);
  const totalPaginas = countExpandedRows(selectedRows, repeatByQuantity, repeatMultiplier);
  const totalPares = selectedRows.reduce((t, r) => t + r.quantidade, 0);
  const totalParesNoArquivo = rows.reduce((t, r) => t + r.quantidade, 0);
  const paginasGrafica = graphicPageCount(selectedSkuAnalysis.rows.length);
  const skuSelecionadoLabel = selectedSkuAnalysis.rows.length === 1 ? 'SKU' : 'SKUs';
  // Código que não respeita a zona de silêncio não pode virar etiqueta — a
  // barra sairia cortada e só se descobre no leitor da loja.
  const foraDoPadrao = rowEntries.filter(entry => !entry.barcodeFit.fits);
  const selecionadasForaDoPadrao = selectedEntries.filter(entry => !entry.barcodeFit.fits);
  const visibleRows = rowEntries.filter(({ row }) => searchMatchesAllTerms(
      search,
      row.referencia,
      row.cor,
      row.tamanho,
      row.codProduto,
      row.codigoBarra,
    ));
  const coucheGeometry = resolveCoucheRollGeometry(coucheProfile);
  const visibleSkuKeys = [...new Set(visibleRows.map(entry => entry.skuKey))];
  const allVisibleSelected = visibleSkuKeys.length > 0 && visibleSkuKeys.every(key => selectedSkuKeys.has(key));
  const someVisibleSelected = visibleSkuKeys.some(key => selectedSkuKeys.has(key));
  const isBusy = reading || generating !== null;
  const productionOverLimit = totalPaginas > MAX_PDF_LABELS;

  useEffect(() => () => {
    fileRequestIdRef.current += 1;
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const requestId = ++fileRequestIdRef.current;
    setReading(true);
    try {
      const lidas = await parseClientOrderFile(file);
      if (requestId !== fileRequestIdRef.current) return;
      setRows(lidas);
      setFileName(file.name);
      setSelectedSkuKeys(new Set(analyzeClientSkus(lidas).rows.map(clientSkuKey)));
      toast.success(`${lidas.length} etiqueta(s) lidas de ${file.name}`);
    } catch (error) {
      if (requestId !== fileRequestIdRef.current) return;
      setRows([]);
      setFileName('');
      setSelectedSkuKeys(new Set());
      toast.error(error instanceof Error ? error.message : 'Não consegui ler o arquivo.');
    } finally {
      if (requestId === fileRequestIdRef.current) {
        setReading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    }
  }

  async function handleGenerate(mode: 'production' | 'graphic') {
    if (isBusy) return;
    if (selectedRows.length === 0) {
      toast.info('Selecione ao menos um SKU antes de gerar.');
      return;
    }
    if (selecionadasForaDoPadrao.length > 0) {
      toast.error(`${selecionadasForaDoPadrao.length} código(s) selecionado(s) não cabem na etiqueta.`);
      return;
    }
    if (mode === 'graphic' && selectedSkuAnalysis.conflicts.length > 0) {
      toast.error(`${selectedSkuAnalysis.conflicts.length} SKU(s) selecionado(s) possuem dados de impressão conflitantes.`);
      return;
    }
    if (mode === 'graphic' && !coucheProfileConfirmed) {
      toast.info('Confirme as medidas da faca e do liner antes de gerar para a gráfica.');
      return;
    }
    if (mode === 'production' && productionOverLimit) {
      toast.error(`O limite seguro é ${MAX_PDF_LABELS.toLocaleString('pt-BR')} etiquetas por PDF.`);
      return;
    }

    const generationRows = [...selectedRows];
    const generationFileName = fileName;
    const generationRepeatByQuantity = repeatByQuantity;
    const generationRepeatMultiplier = repeatMultiplier;
    const generationTotalPages = totalPaginas;
    const generationSkuCount = selectedSkuAnalysis.rows.length;
    const generationCoucheProfile = { ...coucheProfile };
    setGenerating(mode);
    try {
      const logo = await loadLogoDataUrl(logoFornecedor);
      if (!logo) toast.warning('Não carreguei a logomarca — o PDF sai sem ela.');

      const doc = await buildBabyNalinPdf(generationRows, {
        mode,
        repeatByQuantity: mode === 'production' ? generationRepeatByQuantity : false,
        repeatMultiplier: generationRepeatMultiplier,
        coucheProfile: generationCoucheProfile,
        logo,
      });
      if (mode === 'graphic') {
        doc.save(graphicPdfFilename(generationFileName));
        toast.success(`Arquivo para gráfica com ${generationSkuCount} SKU(s) gerado.`);
      } else {
        doc.save(pdfFilename(generationFileName));
        toast.success(`PDF de produção com ${generationTotalPages} etiqueta(s) gerado.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao gerar o PDF.');
    } finally {
      setGenerating(null);
    }
  }

  function limpar() {
    fileRequestIdRef.current += 1;
    setReading(false);
    setRows([]);
    setFileName('');
    setRepeatByQuantity(false);
    setRepeatMultiplier(1);
    setSearch('');
    setSelectedSkuKeys(new Set());
    setCoucheProfileConfirmed(false);
  }

  function setCoucheProfileMeasure(field: keyof CoucheRollProfile, rawValue: string) {
    const parsed = Number(rawValue);
    const value = Number.isFinite(parsed)
      ? Math.min(MAX_PROFILE_MEASURE_MM, Math.max(0, parsed))
      : 0;
    setCoucheProfile(current => ({ ...current, [field]: value }));
    setCoucheProfileConfirmed(false);
  }

  function setSkuSelected(skuKey: string, selected: boolean) {
    setSelectedSkuKeys(current => {
      const next = new Set(current);
      if (selected) next.add(skuKey);
      else next.delete(skuKey);
      return next;
    });
  }

  function setVisibleSelected(selected: boolean) {
    setSelectedSkuKeys(current => {
      const next = new Set(current);
      visibleSkuKeys.forEach(key => {
        if (selected) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <Panel
        eyebrow="ETIQUETAS · CLIENTE"
        title="Importar pedido do cliente"
        subtitle={`${BARCODE_FORMAT} com módulo de ${MODULE_MM.toFixed(4).replace('.', ',')} mm · produção 50 × 40 mm · gráfica couchê 2 × 50 × 30 mm`}
        actions={
          rows.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={limpar} className="h-9" disabled={isBusy}>
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
          disabled={isBusy}
          onChange={e => void handleFile(e.target.files?.[0])}
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={Barcode}
            title="Nenhum pedido importado"
            description="Selecione o arquivo de exportação de etiquetas do pedido de compra (CSV ou XLSX). Uma etiqueta por linha do arquivo."
            action={
              <Button onClick={() => inputRef.current?.click()} disabled={isBusy}>
                {reading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                {reading ? 'Lendo…' : 'Escolher arquivo'}
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <StatGrid>
              <StatCard
                label="SKUs selecionados"
                value={selectedSkuAnalysis.rows.length}
                hint={`${skuAnalysis.rows.length} no arquivo · ${fileName}`}
              />
              <StatCard
                label="Pares selecionados"
                value={totalPares}
                unit="pares"
                hint={`${totalParesNoArquivo.toLocaleString('pt-BR')} no arquivo`}
              />
              <StatCard
                label="Etiquetas de produção"
                value={totalPaginas}
                hint={repeatByQuantity ? `${repeatMultiplier} por par` : 'uma por linha'}
              />
            </StatGrid>

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="rounded-lg border border-border bg-muted/20 p-4 space-y-4" aria-labelledby="production-output-title">
                <div className="flex items-start gap-3">
                  <div className="rounded-md border border-border bg-background p-2 text-foreground">
                    <Factory className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 id="production-output-title" className="font-semibold text-foreground">PDF para produção</h3>
                      <Badge variant="outline">50 × 40 mm</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Imprime somente os SKUs selecionados, repetindo conforme a quantidade do pedido.
                    </p>
                  </div>
                </div>

                <div className="space-y-3 rounded-md border border-border bg-background p-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="repeat-by-quantity"
                      checked={repeatByQuantity}
                      onCheckedChange={v => setRepeatByQuantity(v === true)}
                      disabled={isBusy}
                    />
                    <Label htmlFor="repeat-by-quantity" className="text-sm font-normal cursor-pointer">
                      Usar quantidade solicitada
                    </Label>
                  </div>

                  {repeatByQuantity && (
                    <div className="flex flex-wrap items-center gap-2">
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
                        disabled={isBusy}
                        onChange={e => {
                          const next = Math.trunc(Number(e.target.value));
                          setRepeatMultiplier(Number.isFinite(next) ? Math.min(100, Math.max(1, next)) : 1);
                        }}
                        className="h-8 w-20 bg-background text-center font-mono"
                        aria-describedby="repeat-multiplier-help"
                      />
                      <span id="repeat-multiplier-help" className="text-xs text-muted-foreground">
                        {totalPaginas.toLocaleString('pt-BR')} etiquetas
                      </span>
                    </div>
                  )}
                </div>

                <Button
                  className="w-full"
                  onClick={() => void handleGenerate('production')}
                  disabled={
                    isBusy
                    || selectedRows.length === 0
                    || selecionadasForaDoPadrao.length > 0
                    || productionOverLimit
                  }
                >
                  {generating === 'production' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FilePdf className="h-4 w-4 mr-2" />}
                  {generating === 'production' ? 'Gerando…' : `Gerar produção (${totalPaginas})`}
                </Button>
              </section>

              <section className="rounded-lg border border-primary/25 bg-primary/5 p-4 space-y-4" aria-labelledby="graphic-output-title">
                <div className="flex items-start gap-3">
                  <div className="rounded-md border border-primary/20 bg-background p-2 text-primary">
                    <Palette className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 id="graphic-output-title" className="font-semibold text-foreground">Arquivo para gráfica</h3>
                      <Badge className="bg-primary text-primary-foreground">
                        {COUCHE_COLUMNS} × {COUCHE_LABEL_WIDTH_MM} × {COUCHE_LABEL_HEIGHT_MM} mm
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Duas etiquetas couchê lado a lado por página, sem repetir a quantidade do pedido.
                    </p>
                  </div>
                </div>

                <div className="rounded-md border border-primary/20 bg-background p-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">SKUs selecionados</span>
                    <strong className="font-mono text-foreground">{selectedSkuAnalysis.rows.length}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Linhas de 2 colunas</span>
                    <strong className="font-mono text-foreground">{paginasGrafica}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Código de barras</span>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                      <CheckCircle className="h-4 w-4 text-emerald-600" weight="fill" /> {BARCODE_FORMAT}
                    </span>
                  </div>
                </div>

                <details className="rounded-md border border-primary/20 bg-background p-3 text-sm">
                  <summary className="cursor-pointer font-semibold text-foreground">
                    Medidas da faca e do liner
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Confirme estas medidas na ficha da gráfica. Elas alteram somente o arquivo couchê deste módulo.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {COUCHE_PROFILE_FIELDS.map(field => (
                      <div key={field.key} className="space-y-1">
                        <Label htmlFor={`couche-${field.key}`} className="text-xs font-medium">
                          {field.label} (mm)
                        </Label>
                        <Input
                          id={`couche-${field.key}`}
                          type="number"
                          min={0}
                          max={MAX_PROFILE_MEASURE_MM}
                          step={0.1}
                          value={coucheProfile[field.key]}
                          disabled={isBusy}
                          onChange={event => setCoucheProfileMeasure(field.key, event.target.value)}
                          className="h-8 bg-background font-mono"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
                    <span className="text-muted-foreground">Mídia calculada do PDF</span>
                    <strong className="font-mono text-foreground">
                      {coucheGeometry.pageWidthMm.toLocaleString('pt-BR')} × {coucheGeometry.pageHeightMm.toLocaleString('pt-BR')} mm
                    </strong>
                  </div>
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/40 p-2.5">
                    <Checkbox
                      id="couche-profile-confirmed"
                      checked={coucheProfileConfirmed}
                      disabled={isBusy}
                      onCheckedChange={value => setCoucheProfileConfirmed(value === true)}
                    />
                    <Label htmlFor="couche-profile-confirmed" className="cursor-pointer text-xs font-normal leading-relaxed">
                      Confirmo que estas medidas foram conferidas com a gráfica.
                    </Label>
                  </div>
                </details>

                <Button
                  className="w-full"
                  onClick={() => void handleGenerate('graphic')}
                  disabled={
                    isBusy
                    || selectedRows.length === 0
                    || selecionadasForaDoPadrao.length > 0
                    || selectedSkuAnalysis.conflicts.length > 0
                    || !coucheProfileConfirmed
                  }
                >
                  {generating === 'graphic' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FilePdf className="h-4 w-4 mr-2" />}
                  {generating === 'graphic'
                    ? 'Gerando…'
                    : `Gerar gráfica (${selectedSkuAnalysis.rows.length} ${skuSelecionadoLabel})`}
                </Button>
              </section>
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => inputRef.current?.click()}
                disabled={isBusy}
              >
                {reading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
                {reading ? 'Lendo novo arquivo…' : 'Trocar arquivo'}
              </Button>
            </div>

            {foraDoPadrao.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
                <Warning className="h-4 w-4 mt-0.5 shrink-0" weight="fill" />
                <span>
                  {foraDoPadrao.length} código(s) inválidos para CODE128 ou largos demais para a etiqueta de {ART_WIDTH_MM} mm.
                  {' '}{selecionadasForaDoPadrao.length > 0
                    ? `${selecionadasForaDoPadrao.length} fazem parte da seleção e bloqueiam a geração.`
                    : 'Nenhum faz parte da seleção atual.'}
                </span>
              </div>
            )}

            {skuAnalysis.conflicts.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <Warning className="h-4 w-4 mt-0.5 shrink-0" weight="fill" />
                <span>
                  {skuAnalysis.conflicts.length} SKU(s) possuem código de barras ou código de produto divergente. {selectedSkuAnalysis.conflicts.length > 0
                    ? `${selectedSkuAnalysis.conflicts.length} fazem parte da seleção e bloqueiam o arquivo para a gráfica.`
                    : 'Nenhum faz parte da seleção atual.'}
                </span>
              </div>
            )}

            {productionOverLimit && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <Warning className="h-4 w-4 mt-0.5 shrink-0" weight="fill" />
                <span>
                  A seleção produziria {totalPaginas.toLocaleString('pt-BR')} etiquetas. Divida o pedido em arquivos de até{' '}
                  {MAX_PDF_LABELS.toLocaleString('pt-BR')} etiquetas para evitar travar o navegador.
                </span>
              </div>
            )}

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Buscar no arquivo por referência, cor, tamanho ou código…"
                resultCount={visibleRows.length}
                totalCount={rows.length}
                className="w-full max-w-lg"
              />
              <div
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                aria-live="polite"
              >
                <Badge variant="secondary" className="font-mono">
                  {selectedSkuAnalysis.rows.length}/{skuAnalysis.rows.length}
                </Badge>
                <span className="text-xs text-muted-foreground">SKUs selecionados</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelectedSkuKeys(new Set(visibleSkuKeys))}
                  disabled={visibleSkuKeys.length === 0 || isBusy}
                >
                  Selecionar só exibidos
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelectedSkuKeys(new Set())}
                  disabled={selectedSkuAnalysis.rows.length === 0 || isBusy}
                >
                  Limpar seleção
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="w-10 py-2 pr-3">
                      <Checkbox
                        checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                        onCheckedChange={value => setVisibleSelected(value === true)}
                        disabled={visibleSkuKeys.length === 0 || isBusy}
                        aria-label={allVisibleSelected ? 'Desmarcar todos os SKUs exibidos' : 'Selecionar todos os SKUs exibidos'}
                      />
                    </th>
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
                  {visibleRows.map(({ row, sourceIndex, skuKey, barcodeFit }) => {
                    const selected = selectedSkuKeys.has(skuKey);
                    return (
                      <tr
                        key={`${skuKey}-${row.codigoBarra}-${sourceIndex}`}
                        className={`border-b border-border/60 transition-colors last:border-0 ${selected ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                        data-state={selected ? 'selected' : undefined}
                      >
                        <td className="w-10 py-2 pr-3">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={value => setSkuSelected(skuKey, value === true)}
                            disabled={isBusy}
                            aria-label={
                              `Selecionar linha ${sourceIndex + 1}: SKU ${row.referencia || 'sem referência'}, `
                              + `${row.cor || 'sem cor'}, tamanho ${row.tamanho || 'não informado'}, `
                              + `produto ${row.codProduto || 'não informado'}, código ${row.codigoBarra}`
                            }
                          />
                        </td>
                        <td className="py-2 pr-3 font-medium text-foreground">{row.referencia || '—'}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{row.cor || '—'}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{row.tamanho || '—'}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{row.codProduto || '—'}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-foreground">{row.codigoBarra}</td>
                        <td className="py-2 pr-3 text-right text-muted-foreground">{row.quantidade}</td>
                        <td className="py-2 text-right">
                          {barcodeFit.fits ? (
                            <span className="text-muted-foreground">{barcodeFit.widthMm.toFixed(1)} mm</span>
                          ) : (
                            <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">
                              {barcodeFit.error ? 'inválido' : 'não cabe'}
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
