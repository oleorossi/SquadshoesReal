/**
 * Etiquetagem Cliente multi-cliente.
 *
 * Fluxo: escolher cliente → carregar/salvar 1..N tipos em `clients.label_pattern`
 * (Nalin e Objetiva no mesmo cadastro; sem histórico de arquivo) → importar
 * 1..N CSV/XLSX → gerar PDF do tipo ativo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  UploadSimple,
  FilePdf,
  FloppyDisk,
  Factory,
  Palette,
  CheckCircle,
  Warning,
  X,
  CircleNotch,
  Trash,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import logoFornecedor from '@/assets/baby-nalin/marca-fornecedor.png';
import { ClientLabelLogoUpload } from '@/components/client-labeling/ClientLabelLogoUpload';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useClientLabelPattern,
  useClientsForLabeling,
  useSaveClientLabelPattern,
} from '@/hooks/useClientLabelPattern';
import {
  BARCODE_FORMAT,
  COUCHE_COLUMNS,
  COUCHE_LABEL_HEIGHT_MM,
  COUCHE_LABEL_WIDTH_MM,
  DEFAULT_COUCHE_ROLL_PROFILE,
  MAX_PDF_LABELS,
  MODULE_MM,
  analyzeClientSkus,
  buildBabyNalinPdf,
  countExpandedRows,
  graphicPageCount,
  graphicPdfFilename,
  loadLogoDataUrl,
  measureBarcode,
  pdfFilename,
  resolveCoucheRollGeometry,
  type BabyNalinRow,
  type CoucheRollProfile,
} from '@/lib/babyNalinLabels';
import {
  BABY_NALIN_DEFAULT_GEOMETRY,
  OBJETIVA_DEFAULT_BRANDING,
  OBJETIVA_DEFAULT_GEOMETRY,
  activatePattern,
  activePatternFromCollection,
  clientOrderLineSkuKey,
  collectionPatternKeys,
  coucheProfileFromGeometry,
  emptyLabelCollection,
  geometryFromCoucheProfile,
  patternLabel,
  removePattern,
  savedPatternStatusLabel,
  upsertActivePattern,
  type ClientLabelPattern,
  type ClientLabelPatternCollection,
  type ClientLabelPatternKey,
  type ClientOrderLine,
} from '@/lib/clientLabelPattern';
import {
  ACCEPT_CLIENT_ORDER_FILES,
  parseClientOrderFiles,
  summarizeImport,
} from '@/lib/clientOrderImport';
import {
  buildObjetivaPdf,
  countObjetivaLabels,
  objetivaPdfFilename,
} from '@/lib/objetivaLabels';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { cn } from '@/lib/utils';

const MAX_PROFILE_MEASURE_MM = 50;

const COUCHE_PROFILE_FIELDS: Array<{ key: keyof CoucheRollProfile; label: string }> = [
  { key: 'columnGapMm', label: 'Vão entre colunas' },
  { key: 'leftMarginMm', label: 'Margem esquerda' },
  { key: 'rightMarginMm', label: 'Margem direita' },
  { key: 'topMarginMm', label: 'Margem superior' },
  { key: 'bottomMarginMm', label: 'Margem inferior / avanço' },
];

const OBJETIVA_GEOMETRY_FIELDS: Array<{
  key: keyof ClientLabelPattern['geometry'];
  label: string;
  step?: number;
}> = [
  { key: 'labelWidthMm', label: 'Largura (mm)' },
  { key: 'labelHeightMm', label: 'Altura (mm)' },
  { key: 'columns', label: 'Colunas', step: 1 },
  { key: 'columnGapMm', label: 'Vão (mm)' },
  { key: 'leftMarginMm', label: 'Esq. (mm)' },
  { key: 'rightMarginMm', label: 'Dir. (mm)' },
  { key: 'topMarginMm', label: 'Sup. (mm)' },
  { key: 'bottomMarginMm', label: 'Inf. (mm)' },
];

function initialPrintQuantities(rows: ClientOrderLine[]): Record<string, number> {
  return Object.fromEntries(rows.map(row => [clientOrderLineSkuKey(row), row.quantidade]));
}

function clampPrintQuantity(rawValue: string, requestedQuantity: number): number {
  const parsed = Math.trunc(Number(rawValue));
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(requestedQuantity, Math.max(1, parsed));
}

function toBabyRows(rows: ClientOrderLine[]): BabyNalinRow[] {
  return rows.map(row => ({
    tamanho: row.tamanho,
    cor: row.cor,
    referencia: row.referencia,
    codProduto: row.codProduto,
    codigoBarra: row.codigoBarra,
    quantidade: row.quantidade,
  }));
}

export function ClientLabelingWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRequestIdRef = useRef(0);

  const [clientSearch, setClientSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [draftCollection, setDraftCollection] = useState<ClientLabelPatternCollection | null>(null);
  const [patternDirty, setPatternDirty] = useState(false);

  const [rows, setRows] = useState<ClientOrderLine[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [generating, setGenerating] = useState<'production' | 'graphic' | null>(null);
  const [search, setSearch] = useState('');
  const [selectedSkuKeys, setSelectedSkuKeys] = useState<Set<string>>(new Set());
  const [printQuantities, setPrintQuantities] = useState<Record<string, number>>({});
  const [coucheConfirmed, setCoucheConfirmed] = useState(true);

  const { data: clients = [], isLoading: clientsLoading } = useClientsForLabeling();
  const { data: savedCollection, isLoading: patternLoading } = useClientLabelPattern(
    selectedClientId || undefined,
  );
  const savePatternMutation = useSaveClientLabelPattern();

  const selectedClient = clients.find(c => c.id === selectedClientId) ?? null;

  useEffect(() => {
    if (!selectedClientId) {
      setDraftCollection(null);
      setPatternDirty(false);
      return;
    }
    if (patternLoading) return;
    setDraftCollection(savedCollection ?? emptyLabelCollection());
    setPatternDirty(false);
    setCoucheConfirmed(true);
  }, [selectedClientId, savedCollection, patternLoading]);

  const pattern = activePatternFromCollection(draftCollection);
  const savedKeys = collectionPatternKeys(savedCollection);
  const draftKeys = collectionPatternKeys(draftCollection);
  const isObjetiva = pattern?.key === 'objetiva';
  const isNalin = pattern?.key === 'baby_nalin';

  const coucheProfile: CoucheRollProfile = useMemo(() => {
    if (pattern?.key === 'baby_nalin') {
      return { ...DEFAULT_COUCHE_ROLL_PROFILE, ...coucheProfileFromGeometry(pattern.geometry) };
    }
    return { ...DEFAULT_COUCHE_ROLL_PROFILE };
  }, [pattern]);

  const coucheGeometry = resolveCoucheRollGeometry(coucheProfile);

  const filteredClients = useMemo(
    () =>
      clients.filter(c =>
        searchMatchesAllTerms(clientSearch, c.razao_social, c.nome_fantasia ?? ''),
      ),
    [clients, clientSearch],
  );

  const rowEntries = useMemo(
    () =>
      rows.map((row, sourceIndex) => ({
        row,
        sourceIndex,
        skuKey: clientOrderLineSkuKey(row),
        barcodeFit: measureBarcode(row.codigoBarra),
      })),
    [rows],
  );

  const visibleEntries = useMemo(
    () =>
      rowEntries.filter(({ row }) =>
        searchMatchesAllTerms(
          search,
          row.referencia,
          row.cor,
          row.tamanho,
          row.codProduto,
          row.codigoBarra,
          row.descricao ?? '',
          row.sourceFile ?? '',
        ),
      ),
    [rowEntries, search],
  );

  const selectedEntries = rowEntries.filter(e => selectedSkuKeys.has(e.skuKey));
  const selectedRows = selectedEntries.map(e => e.row);
  const productionRows = selectedEntries.map(({ row, skuKey }) => ({
    ...row,
    quantidade: printQuantities[skuKey] ?? row.quantidade,
  }));

  const selectedBabyRows = toBabyRows(selectedRows);
  const productionBabyRows = toBabyRows(productionRows);
  const selectedSkuAnalysis = analyzeClientSkus(selectedBabyRows);

  const totalEtiquetas = isObjetiva
    ? countObjetivaLabels(productionRows, true)
    : countExpandedRows(productionBabyRows, true);
  const paginasGrafica = isObjetiva
    ? countObjetivaLabels(selectedRows, false)
    : graphicPageCount(selectedSkuAnalysis.rows.length);
  const skuLabel = selectedSkuKeys.size === 1 ? 'SKU' : 'SKUs';
  const foraDoPadrao = isNalin ? rowEntries.filter(e => !e.barcodeFit.fits) : [];
  const selecionadasFora = isNalin ? selectedEntries.filter(e => !e.barcodeFit.fits) : [];

  const visibleSkuKeys = [...new Set(visibleEntries.map(e => e.skuKey))];
  const allVisibleSelected =
    visibleSkuKeys.length > 0 && visibleSkuKeys.every(k => selectedSkuKeys.has(k));
  const someVisibleSelected = visibleSkuKeys.some(k => selectedSkuKeys.has(k));
  const visibleSelectedCount = visibleSkuKeys.filter(k => selectedSkuKeys.has(k)).length;
  const hiddenSelectedCount = Math.max(0, selectedSkuKeys.size - visibleSelectedCount);
  const isBusy = reading || generating !== null || savePatternMutation.isPending;
  const productionOverLimit = totalEtiquetas > MAX_PDF_LABELS;
  const uniqueSkuCount = new Set(rows.map(clientOrderLineSkuKey)).size;
  const clientLabel = selectedClient
    ? selectedClient.nome_fantasia || selectedClient.razao_social
    : null;

  useEffect(
    () => () => {
      fileRequestIdRef.current += 1;
    },
    [],
  );

  function clearOrder() {
    fileRequestIdRef.current += 1;
    setReading(false);
    setRows([]);
    setFileNames([]);
    setSearch('');
    setSelectedSkuKeys(new Set());
    setPrintQuantities({});
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function updateDraft(next: ClientLabelPattern) {
    setDraftCollection(current => upsertActivePattern(current ?? emptyLabelCollection(), next));
    setPatternDirty(true);
    if (next.key === 'baby_nalin') setCoucheConfirmed(false);
  }

  function handlePatternKeyChange(key: ClientLabelPatternKey) {
    const base = draftCollection ?? emptyLabelCollection();
    const adding = !base.patterns[key];
    setDraftCollection(activatePattern(base, key));
    if (adding) setPatternDirty(true);
    clearOrder();
    setCoucheConfirmed(key !== 'baby_nalin');
  }

  function handleRemovePattern() {
    if (!draftCollection?.activeKey) return;
    setDraftCollection(removePattern(draftCollection, draftCollection.activeKey));
    setPatternDirty(true);
    clearOrder();
    setCoucheConfirmed(true);
  }

  function setCoucheMeasure(field: keyof CoucheRollProfile, rawValue: string) {
    if (!pattern || pattern.key !== 'baby_nalin') return;
    const parsed = Number(rawValue);
    const value = Number.isFinite(parsed)
      ? Math.min(MAX_PROFILE_MEASURE_MM, Math.max(0, parsed))
      : 0;
    updateDraft({
      ...pattern,
      geometry: geometryFromCoucheProfile({ ...coucheProfile, [field]: value }),
    });
    setCoucheConfirmed(false);
  }

  function setObjetivaGeometry(field: keyof ClientLabelPattern['geometry'], rawValue: string) {
    if (!pattern || pattern.key !== 'objetiva') return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const value = field === 'columns' ? Math.max(1, Math.trunc(parsed)) : Math.max(0, parsed);
    updateDraft({ ...pattern, geometry: { ...pattern.geometry, [field]: value } });
  }

  function setBrandingField(field: keyof ClientLabelPattern['branding'], value: string) {
    if (!pattern) return;
    updateDraft({
      ...pattern,
      branding: {
        ...pattern.branding,
        [field]: field === 'logoUrl' ? value.trim() || null : value,
      },
    });
  }

  async function handleSavePattern() {
    if (!selectedClientId || !draftCollection) {
      toast.info('Escolha o cliente e o tipo de layout antes de salvar.');
      return;
    }
    if (!pattern && collectionPatternKeys(draftCollection).length === 0) {
      toast.info('Escolha o cliente e o tipo de layout antes de salvar.');
      return;
    }
    try {
      await savePatternMutation.mutateAsync({
        clientId: selectedClientId,
        collection: draftCollection,
      });
      setPatternDirty(false);
      setCoucheConfirmed(true);
    } catch {
      /* toast no hook */
    }
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    if (!pattern) {
      toast.info('Salve (ou escolha) o padrão do cliente antes de importar.');
      return;
    }
    if (patternDirty) {
      toast.info('Salve o padrão do cliente antes de importar o pedido.');
      return;
    }

    const files = Array.from(fileList);
    const requestId = ++fileRequestIdRef.current;
    setReading(true);
    try {
      const result = await parseClientOrderFiles(files, pattern.key);
      if (requestId !== fileRequestIdRef.current) return;
      setRows(result.rows);
      setFileNames(result.fileNames);
      setSelectedSkuKeys(new Set());
      setPrintQuantities(initialPrintQuantities(result.rows));
      const summary = summarizeImport(result);
      if (result.errors.length > 0) {
        toast.warning(`${summary}. Falhas: ${result.errors.map(e => e.fileName).join(', ')}`);
      } else {
        toast.success(`${summary}. Selecione os SKUs para imprimir.`);
      }
    } catch (error) {
      if (requestId !== fileRequestIdRef.current) return;
      clearOrder();
      toast.error(error instanceof Error ? error.message : 'Não consegui ler os arquivos.');
    } finally {
      if (requestId === fileRequestIdRef.current) {
        setReading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    }
  }

  async function handleGenerate(mode: 'production' | 'graphic') {
    if (isBusy || !pattern) return;
    if (selectedRows.length === 0) {
      toast.info('Selecione ao menos um SKU antes de gerar.');
      return;
    }
    if (patternDirty) {
      toast.info('Salve o padrão do cliente antes de gerar o PDF.');
      return;
    }
    if (selecionadasFora.length > 0) {
      toast.error(`${selecionadasFora.length} código(s) selecionado(s) não cabem na etiqueta.`);
      return;
    }
    if (isNalin && mode === 'graphic' && selectedSkuAnalysis.conflicts.length > 0) {
      toast.error(
        `${selectedSkuAnalysis.conflicts.length} SKU(s) selecionado(s) possuem dados de impressão conflitantes.`,
      );
      return;
    }
    if (isNalin && !coucheConfirmed) {
      toast.info('Confirme as medidas do rolo de duas colunas antes de gerar.');
      return;
    }
    if (mode === 'production' && productionOverLimit) {
      toast.error(`O limite seguro é ${MAX_PDF_LABELS.toLocaleString('pt-BR')} etiquetas por PDF.`);
      return;
    }

    const originName = fileNames[0] ?? 'pedido';
    setGenerating(mode);
    try {
      if (pattern.key === 'objetiva') {
        let logo: { dataUrl: string; width: number; height: number } | null = null;
        if (pattern.branding.logoUrl) {
          logo = await loadLogoDataUrl(pattern.branding.logoUrl);
          if (!logo) toast.warning('Não carreguei a logomarca — o PDF sai com o wordmark.');
        }
        const doc = await buildObjetivaPdf(mode === 'production' ? productionRows : selectedRows, {
          geometry: pattern.geometry,
          branding: pattern.branding,
          repeatByQuantity: mode === 'production',
          logo,
        });
        doc.save(objetivaPdfFilename(originName));
        toast.success(
          mode === 'graphic'
            ? `PDF Objetiva (amostra) com ${selectedRows.length} SKU(s) gerado.`
            : `PDF Objetiva com ${totalEtiquetas} etiqueta(s) gerado.`,
        );
      } else {
        const logo = await loadLogoDataUrl(logoFornecedor);
        if (!logo) toast.warning('Não carreguei a logomarca — o PDF sai sem ela.');
        const doc = await buildBabyNalinPdf(
          mode === 'production' ? productionBabyRows : selectedBabyRows,
          {
            mode,
            repeatByQuantity: mode === 'production',
            coucheProfile,
            logo,
          },
        );
        if (mode === 'graphic') {
          doc.save(graphicPdfFilename(originName));
          toast.success(`Arquivo para gráfica com ${selectedSkuAnalysis.rows.length} SKU(s) gerado.`);
        } else {
          doc.save(pdfFilename(originName));
          toast.success(`PDF de produção com ${totalEtiquetas} etiqueta(s) gerado.`);
        }
      }
      clearOrder();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao gerar o PDF.');
    } finally {
      setGenerating(null);
    }
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

  function setPrintQuantity(skuKey: string, requestedQuantity: number, rawValue: string) {
    setPrintQuantities(current => ({
      ...current,
      [skuKey]: clampPrintQuantity(rawValue, requestedQuantity),
    }));
  }

  return (
    <div className="space-y-4">
      <Panel
        eyebrow="ETIQUETAS · CLIENTE"
        title="Cliente e tipos de etiqueta"
        subtitle="O mesmo cliente pode ter Nalin e Objetiva. Trocar o tipo não apaga o outro. O arquivo do pedido não é guardado."
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
            <div className="space-y-2">
              <Label htmlFor="client-search">Buscar cliente</Label>
              <SearchInput
                id="client-search"
                value={clientSearch}
                onChange={setClientSearch}
                placeholder="Razão social ou fantasia"
                debounceMs={0}
              />
            </div>
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Select
                value={selectedClientId || undefined}
                onValueChange={value => {
                  setSelectedClientId(value);
                  clearOrder();
                }}
                disabled={clientsLoading || isBusy}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={clientsLoading ? 'Carregando…' : 'Selecione o cliente'} />
                </SelectTrigger>
                <SelectContent>
                  {filteredClients.map(client => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.nome_fantasia || client.razao_social}
                      {' · '}
                      {savedPatternStatusLabel(client.label_pattern)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!selectedClientId ? (
            <EmptyState
              title="Escolha um cliente"
              description="Cada cliente pode gravar mais de um layout (Nalin e Objetiva), com medidas e textos próprios."
            />
          ) : patternLoading ? (
            <p className="text-sm text-muted-foreground">Carregando padrão…</p>
          ) : (
            <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2 min-w-[12rem]">
                  <Label>Tipo de layout</Label>
                  <Select
                    value={pattern?.key}
                    onValueChange={value => handlePatternKeyChange(value as ClientLabelPatternKey)}
                    disabled={isBusy}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Escolha Nalin ou Objetiva" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baby_nalin">
                        Nalin (couchê 50×30)
                        {savedKeys.includes('baby_nalin') ? ' · salvo' : ''}
                      </SelectItem>
                      <SelectItem value="objetiva">
                        Objetiva (hangtag)
                        {savedKeys.includes('objetiva') ? ' · salvo' : ''}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {draftKeys.map(key => (
                  <Badge key={key} variant={key === pattern?.key ? 'outline' : 'secondary'}>
                    {patternLabel(key)}
                    {savedKeys.includes(key) ? '' : ' · não salvo'}
                  </Badge>
                ))}
                {patternDirty && <Badge variant="secondary">Alterações não salvas</Badge>}
                {draftKeys.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    onClick={handleRemovePattern}
                    disabled={!pattern || isBusy}
                  >
                    <Trash className="h-4 w-4 mr-1.5" />
                    Remover este tipo
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-9 ml-auto"
                  onClick={() => void handleSavePattern()}
                  disabled={isBusy || (!pattern && !patternDirty)}
                >
                  {savePatternMutation.isPending ? (
                    <CircleNotch className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <FloppyDisk className="h-4 w-4 mr-1.5" />
                  )}
                  Salvar padrões do cliente
                </Button>
              </div>

              {!pattern ? (
                <p className="text-sm text-muted-foreground">
                  Este cliente ainda não tem padrão. Escolha Nalin ou Objetiva e salve. O mesmo
                  cadastro pode guardar os dois tipos.
                </p>
              ) : isNalin ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Medidas do rolo 2 × {COUCHE_LABEL_WIDTH_MM} × {COUCHE_LABEL_HEIGHT_MM} mm · módulo{' '}
                    {MODULE_MM.toFixed(3).replace('.', ',')} mm ({BARCODE_FORMAT}).
                  </p>
                  <details className="rounded-md border border-border bg-background p-3 text-sm" open>
                    <summary className="cursor-pointer font-semibold">
                      Medidas do rolo de duas colunas
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {COUCHE_PROFILE_FIELDS.map(field => (
                        <div key={field.key} className="space-y-1">
                          <Label htmlFor={`couche-${field.key}`} className="text-xs">
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
                            onChange={event => setCoucheMeasure(field.key, event.target.value)}
                            className="h-8 font-mono"
                          />
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Página calculada: {coucheGeometry.pageWidthMm.toLocaleString('pt-BR')} ×{' '}
                      {coucheGeometry.pageHeightMm.toLocaleString('pt-BR')} mm
                    </p>
                    <div className="mt-3 flex items-start gap-2">
                      <Checkbox
                        id="couche-confirmed"
                        checked={coucheConfirmed}
                        disabled={isBusy}
                        onCheckedChange={value => setCoucheConfirmed(value === true)}
                      />
                      <Label
                        htmlFor="couche-confirmed"
                        className="cursor-pointer text-xs font-normal leading-relaxed"
                      >
                        Confirmo que estas medidas correspondem ao rolo usado na L42PRO e pela gráfica.
                      </Label>
                    </div>
                  </details>
                </div>
              ) : (
                <div className="space-y-3">
                  <ClientLabelLogoUpload
                    clientId={selectedClientId}
                    logoUrl={pattern.branding.logoUrl}
                    disabled={isBusy}
                    onLogoChange={url => setBrandingField('logoUrl', url ?? '')}
                  />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {OBJETIVA_GEOMETRY_FIELDS.map(field => (
                      <div key={field.key} className="space-y-1">
                        <Label htmlFor={`obj-${field.key}`} className="text-xs">
                          {field.label}
                        </Label>
                        <Input
                          id={`obj-${field.key}`}
                          type="number"
                          min={0}
                          step={field.step ?? 0.1}
                          value={pattern.geometry[field.key]}
                          disabled={isBusy}
                          onChange={event => setObjetivaGeometry(field.key, event.target.value)}
                          className="h-8 font-mono"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="obj-motto" className="text-xs">
                        Motto
                      </Label>
                      <Input
                        id="obj-motto"
                        value={pattern.branding.motto}
                        disabled={isBusy}
                        onChange={event => setBrandingField('motto', event.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="obj-exchange" className="text-xs">
                        Texto de troca
                      </Label>
                      <Input
                        id="obj-exchange"
                        value={pattern.branding.exchangeText}
                        disabled={isBusy}
                        onChange={event => setBrandingField('exchangeText', event.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="obj-material" className="text-xs">
                        Prefixo material
                      </Label>
                      <Input
                        id="obj-material"
                        value={pattern.branding.materialPrefix}
                        disabled={isBusy}
                        onChange={event => setBrandingField('materialPrefix', event.target.value)}
                        className="h-8"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Defaults: motto “{OBJETIVA_DEFAULT_BRANDING.motto}”, troca “
                    {OBJETIVA_DEFAULT_BRANDING.exchangeText}”, material “
                    {OBJETIVA_DEFAULT_BRANDING.materialPrefix}”, {OBJETIVA_DEFAULT_GEOMETRY.labelWidthMm}×
                    {OBJETIVA_DEFAULT_GEOMETRY.labelHeightMm} mm.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel
        eyebrow="PEDIDO"
        title="Importar arquivos do pedido"
        subtitle={
          clientLabel
            ? `${clientLabel}${pattern ? ` · ${patternLabel(pattern.key)}` : ''}`
            : 'Selecione o cliente e salve ao menos um tipo para liberar a importação.'
        }
        actions={
          rows.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={clearOrder} className="h-9" disabled={isBusy}>
              <X className="h-4 w-4 mr-1.5" />
              Limpar
            </Button>
          ) : null
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_CLIENT_ORDER_FILES}
          multiple
          className="hidden"
          id="client-order-upload"
          disabled={isBusy || !pattern || patternDirty}
          onChange={event => void handleFiles(event.target.files)}
        />

        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum pedido importado"
            description={
              !pattern
                ? 'Defina e salve ao menos um tipo de etiqueta para importar CSV/XLSX.'
                : patternDirty
                  ? 'Salve o padrão antes de importar.'
                  : 'Pode enviar vários arquivos de uma vez (Objetiva: 1 SKU por arquivo).'
            }
            action={
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy || !pattern || patternDirty}
              >
                {reading ? (
                  <CircleNotch className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <UploadSimple className="h-4 w-4 mr-2" />
                )}
                {reading ? 'Lendo…' : 'Escolher arquivos'}
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <StatGrid>
              <StatCard
                label="SKUs selecionados"
                value={`${selectedSkuKeys.size}/${uniqueSkuCount}`}
                hint={fileNames.join(', ')}
              />
              <StatCard
                label="Linhas no lote"
                value={rows.length}
                hint={`${fileNames.length} arquivo(s)`}
              />
              <StatCard
                label={isObjetiva ? 'Hangtags' : 'Etiquetas'}
                value={totalEtiquetas}
                hint={
                  isNalin
                    ? `${COUCHE_COLUMNS} colunas · vão ${coucheProfile.columnGapMm} mm`
                    : `${pattern?.geometry.labelWidthMm}×${pattern?.geometry.labelHeightMm} mm`
                }
              />
            </StatGrid>

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-md border border-border bg-background p-2">
                    <Factory className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">
                      {isObjetiva ? 'PDF produção Objetiva' : 'PDF produção Nalin'}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Repete pela quantidade do pedido
                      {isNalin ? ' · rolo 2 colunas 50×30' : ' · uma hangtag por cópia'}.
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => void handleGenerate('production')}
                  disabled={
                    isBusy
                    || selectedRows.length === 0
                    || selecionadasFora.length > 0
                    || productionOverLimit
                    || (isNalin && !coucheConfirmed)
                    || patternDirty
                  }
                >
                  {generating === 'production' ? (
                    <CircleNotch className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FilePdf className="h-4 w-4 mr-2" />
                  )}
                  {generating === 'production'
                    ? 'Gerando…'
                    : `Gerar L42PRO (${totalEtiquetas} etiquetas)`}
                </Button>
              </section>

              <section className="rounded-lg border border-primary/25 bg-primary/5 p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-md border border-primary/20 bg-background p-2 text-primary">
                    <Palette className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">
                      {isObjetiva ? 'Amostra Objetiva' : 'Arquivo para gráfica'}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Uma arte por SKU selecionado (sem repetir quantidade).
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => void handleGenerate('graphic')}
                  disabled={
                    isBusy
                    || selectedRows.length === 0
                    || selecionadasFora.length > 0
                    || (isNalin && selectedSkuAnalysis.conflicts.length > 0)
                    || (isNalin && !coucheConfirmed)
                    || patternDirty
                  }
                >
                  {generating === 'graphic' ? (
                    <CircleNotch className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FilePdf className="h-4 w-4 mr-2" />
                  )}
                  {generating === 'graphic'
                    ? 'Gerando…'
                    : `Gerar gráfica (${selectedSkuKeys.size} ${skuLabel})`}
                </Button>
                {isNalin && (
                  <p className="text-xs text-muted-foreground">
                    {paginasGrafica} linha(s) de {COUCHE_COLUMNS} colunas ·{' '}
                    {BABY_NALIN_DEFAULT_GEOMETRY.labelWidthMm}×{BABY_NALIN_DEFAULT_GEOMETRY.labelHeightMm}{' '}
                    mm
                  </p>
                )}
              </section>
            </div>

            {(foraDoPadrao.length > 0 || (isNalin && selectedSkuAnalysis.conflicts.length > 0)) && (
              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <Warning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  {foraDoPadrao.length > 0 && (
                    <p>{foraDoPadrao.length} código(s) não cabem na etiqueta com o módulo atual.</p>
                  )}
                  {isNalin && selectedSkuAnalysis.conflicts.length > 0 && (
                    <p>
                      {selectedSkuAnalysis.conflicts.length} SKU(s) com dados conflitantes na seleção.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Filtrar referência, cor, tamanho, código…"
                debounceMs={0}
                className="max-w-md"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={visibleSkuKeys.length === 0 || isBusy}
                onClick={() => setVisibleSelected(!allVisibleSelected)}
              >
                {allVisibleSelected ? 'Limpar visíveis' : 'Marcar visíveis'}
                {someVisibleSelected && !allVisibleSelected ? ` (${visibleSelectedCount})` : ''}
              </Button>
              {hiddenSelectedCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {hiddenSelectedCount} selecionado(s) fora do filtro
                </span>
              )}
            </div>

            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="w-10 p-2">
                      <span className="sr-only">Selecionar</span>
                    </th>
                    <th className="p-2">Ref / SKU</th>
                    <th className="p-2">Cor</th>
                    <th className="p-2">Tam.</th>
                    <th className="p-2">Código</th>
                    <th className="p-2 text-right">Qtd pedido</th>
                    <th className="p-2 text-right">Imprimir</th>
                    {fileNames.length > 1 && <th className="p-2">Arquivo</th>}
                    {isNalin && <th className="p-2">OK</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map(({ row, skuKey, barcodeFit, sourceIndex }) => {
                    const selected = selectedSkuKeys.has(skuKey);
                    return (
                      <tr
                        key={`${skuKey}-${sourceIndex}`}
                        className={cn(
                          'border-t border-border',
                          selected && 'bg-primary/5',
                          isNalin && !barcodeFit.fits && 'bg-amber-500/5',
                        )}
                      >
                        <td className="p-2">
                          <Checkbox
                            checked={selected}
                            disabled={isBusy}
                            onCheckedChange={value => setSkuSelected(skuKey, value === true)}
                            aria-label={`Selecionar linha ${sourceIndex + 1}: SKU ${row.referencia}, ${row.cor}, tamanho ${row.tamanho},`}
                          />
                        </td>
                        <td className="p-2 font-medium">
                          {row.referencia || row.codProduto}
                          {row.descricao ? (
                            <span className="block max-w-[14rem] truncate text-xs text-muted-foreground">
                              {row.descricao}
                            </span>
                          ) : null}
                        </td>
                        <td className="p-2">{row.cor}</td>
                        <td className="p-2 font-mono">{row.tamanho}</td>
                        <td className="p-2 font-mono text-xs">{row.codigoBarra}</td>
                        <td className="p-2 text-right font-mono">{row.quantidade}</td>
                        <td className="p-2 text-right">
                          <Input
                            type="number"
                            min={1}
                            max={row.quantidade}
                            className="ml-auto h-8 w-20 font-mono"
                            disabled={isBusy || !selected}
                            value={printQuantities[skuKey] ?? row.quantidade}
                            aria-label={`Quantidade a imprimir do SKU ${row.referencia}, tamanho ${row.tamanho}`}
                            onChange={event =>
                              setPrintQuantity(skuKey, row.quantidade, event.target.value)
                            }
                          />
                        </td>
                        {fileNames.length > 1 && (
                          <td className="max-w-[8rem] truncate p-2 text-xs text-muted-foreground">
                            {row.sourceFile}
                          </td>
                        )}
                        {isNalin && (
                          <td className="p-2">
                            {barcodeFit.fits ? (
                              <CheckCircle className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <Warning className="h-4 w-4 text-amber-600" />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
