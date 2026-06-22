/**
 * Aba "Escalonamento / CAD" da ficha técnica.
 *
 * Importa o DXF (Shoemaster/AutoCAD) no tamanho base, calcula a área das peças
 * (dxfArea.ts), e escalona o consumo do cabedal e das tiras em TODAS as
 * numerações (gradeScaling.ts). Grava o resultado via `updateField` nas colunas
 * que o motor já consome: `upper_consumption_per_size` (cabedal) e
 * `strap_colors[].consumption_per_size` (tiras), além de `grading_config` (memória
 * dos parâmetros). NÃO faz update direto no banco — segue o form (saveAll persiste).
 *
 * Hoje os specs do solado costumam estar chapados, então a escala usa a grade
 * padrão (ponto francês: cabedal ~área², tira linear). Quando o solado tiver
 * progressão real, gradeScaling passa a usar a razão dele (já suportado).
 */
import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UploadSimple, Ruler, Path, CircleNotch as Loader2, Check, Scan } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { computeDxfAreas, type DxfAreaResult, type DxfLengthUnit } from '@/lib/dxfArea';
import { scaleConsumptionBySize, isNonFlatProgression, type ScaleMode } from '@/lib/gradeScaling';
import { resolveGroupUnit, isAreaUnit } from '@/lib/materialUnit';
import { useSoleSizeMetric } from '@/hooks/useSoleSizeMetric';
import { MoldeCadEditor } from './MoldeCadEditor';

interface GradingCadTabProps {
  form: any;
  updateField: (key: any, value: any) => void;
  /** Numerações da ficha (parseSizesFromRange no parent). */
  sizes: number[];
  /** Grupos de produto (pra resolver a unidade do cabedal). */
  groups: any[];
  /** Produtos (pra resolver a unidade do cabedal). */
  products: any[];
}

const fmt = (v: number, d = 4) => (Number(v) || 0).toFixed(d);
const avg = (obj: Record<string, number>) => {
  const vals = Object.values(obj).filter((v) => Number(v) > 0);
  return vals.length ? vals.reduce((a, b) => a + Number(b), 0) / vals.length : 0;
};

export function GradingCadTab({ form, updateField, sizes, groups, products }: GradingCadTabProps) {
  const sortedSizes = useMemo(() => [...sizes].sort((a, b) => a - b), [sizes]);
  const defaultBaseSize = sortedSizes.includes(37) ? 37 : sortedSizes[Math.floor(sortedSizes.length / 2)] ?? 37;

  // Unidade do cabedal: napa/couro (área de bobina) → 'dm²' (o DXF mapeia direto).
  const upperUnit = useMemo(
    () => resolveGroupUnit(form?.upper_material, groups, products),
    [form?.upper_material, groups, products],
  );
  const unitIsArea = isAreaUnit(upperUnit);

  // Razão real do solado (dm² por número). Chapado → ignorado (grade padrão).
  const { data: soleMetric = {} } = useSoleSizeMetric(form?.sole_group_id);
  const usingSoleRatio = useMemo(
    () => isNonFlatProgression(soleMetric, sortedSizes),
    [soleMetric, sortedSizes],
  );

  const [baseSize, setBaseSize] = useState<number>(defaultBaseSize);
  const [mode, setMode] = useState<ScaleMode>('area');
  const [unit, setUnit] = useState<DxfLengthUnit>('mm');
  const [dxf, setDxf] = useState<DxfAreaResult | null>(null);
  const [dxfName, setDxfName] = useState<string>('');
  const [reading, setReading] = useState(false);
  const [cadOpen, setCadOpen] = useState(false);

  // Resultado do CAD de moldes (scanner) → vira o consumo base (dm²).
  const onCadApply = (r: { totalDm2: number; dpi: number; pieces: { areaDm2: number }[]; dxfText: string }) => {
    setDxf({
      unit: 'mm',
      unitFromHeader: false,
      pieces: r.pieces.map((p, i) => ({ layer: `Peça ${i + 1}`, type: 'CAD', areaDm2: p.areaDm2, vertices: 0 })),
      totalDm2: r.totalDm2,
    });
    setDxfName(`CAD · ${r.dpi} DPI`);
    if (r.totalDm2 > 0) setBaseValue(Number(r.totalDm2.toFixed(4)));
    toast.success(`${r.pieces.length} peça(s) · ${r.totalDm2.toFixed(2)} dm² do CAD`);
  };

  // Valor base do cabedal (na unidade do grid). Pré-preenche do que já existe na
  // ficha pra aquele número, senão fica vazio até importar/digitar.
  const existingUpper = (form?.upper_consumption_per_size ?? {}) as Record<string, number>;
  const [baseValue, setBaseValue] = useState<number>(Number(existingUpper[String(defaultBaseSize)]) || 0);

  // Se a faixa de numeração mudar (usuário troca a grade da ficha), o tamanho base
  // pode sair da faixa — realinha pro default em vez de escalar sobre um nº inexistente.
  useEffect(() => {
    if (sortedSizes.length > 0 && !sortedSizes.includes(baseSize)) setBaseSize(defaultBaseSize);
  }, [sortedSizes, baseSize, defaultBaseSize]);

  const onPickDxf = async (file: File | null) => {
    if (!file) return;
    setReading(true);
    try {
      const text = await file.text();
      const res = computeDxfAreas(text, { unit });
      setDxf(res);
      setDxfName(file.name);
      if (res.unitFromHeader) setUnit(res.unit);
      if (res.totalDm2 > 0) {
        setBaseValue(Number(res.totalDm2.toFixed(4)));
        toast.success(`${res.pieces.length} peça(s) lida(s) · ${fmt(res.totalDm2, 2)} dm²`);
      } else {
        toast.warning('Nenhuma peça fechada encontrada no DXF — verifique a unidade.');
      }
    } catch (e) {
      toast.error((e as Error)?.message || 'Falha ao ler o DXF');
    } finally {
      setReading(false);
    }
  };

  const reReadWithUnit = (u: DxfLengthUnit) => {
    setUnit(u);
    // Reaproveita o último arquivo só se ainda houver dxf carregado: recálculo
    // exige o texto; aqui ajustamos pela razão de unidades (área escala com mm²).
    if (dxf) {
      const factor = (mm: DxfLengthUnit) => ({ mm: 1, cm: 10, m: 1000, in: 25.4 }[mm]);
      const ratio = (factor(u) / factor(dxf.unit)) ** 2;
      const pieces = dxf.pieces.map((p) => ({ ...p, areaDm2: p.areaDm2 * ratio }));
      const totalDm2 = pieces.reduce((s, p) => s + p.areaDm2, 0);
      setDxf({ ...dxf, unit: u, unitFromHeader: false, pieces, totalDm2 });
      setBaseValue(Number(totalDm2.toFixed(4)));
    }
  };

  const previewCurve = useMemo(
    () => scaleConsumptionBySize({ base: baseValue, baseSize, sizes: sortedSizes, mode, soleMetricPerSize: soleMetric }),
    [baseValue, baseSize, sortedSizes, mode, soleMetric],
  );

  const applyUpper = () => {
    if (!(baseValue > 0)) { toast.error('Defina o valor base (importe o DXF ou digite)'); return; }
    if (!sortedSizes.length) { toast.error('A ficha não tem faixa de numeração'); return; }
    updateField('upper_consumption_per_size', previewCurve);
    updateField('upper_consumption', Math.round(avg(previewCurve) * 10000) / 10000);
    updateField('grading_config', {
      ...(form?.grading_config ?? {}),
      upper: {
        baseSize, baseValue, mode, unit, upperUnit,
        scaleSource: usingSoleRatio ? 'sole_ratio' : 'standard_grade',
        dxfFileName: dxfName || null,
        pieces: dxf?.pieces?.map((p) => ({ layer: p.layer, areaDm2: Number(p.areaDm2.toFixed(4)) })) ?? null,
        sizes: sortedSizes,
      },
    });
    toast.success('Cabedal escalonado por numeração — confira na aba BOM & Custos e salve a ficha.');
  };

  // ── Tiras ──
  const straps: any[] = Array.isArray(form?.strap_colors) ? form.strap_colors : [];
  const [strapBase, setStrapBase] = useState<Record<number, number>>({});

  const applyStrap = (idx: number) => {
    const baseFootCm = Number(strapBase[idx]) || 0;
    if (!(baseFootCm > 0)) { toast.error('Defina o comprimento base (cm/pé) da tira'); return; }
    // Base digitada por PÉ; storage da tira segue por PAR (×2) — igual à ficha.
    const curve = scaleConsumptionBySize({ base: baseFootCm * 2, baseSize, sizes: sortedSizes, mode: 'linear', decimals: 2, soleMetricPerSize: soleMetric });
    const next = straps.map((s, i) =>
      i === idx ? { ...s, consumption_per_size: curve, consumption: Math.round(avg(curve) * 100) / 100 } : s,
    );
    updateField('strap_colors', next);
    toast.success(`Tira "${straps[idx]?.label || idx + 1}" escalonada.`);
  };

  return (
    <div className="space-y-4">
      {/* 1. Importar DXF */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Scan className="h-4 w-4 text-muted-foreground" /> Origem da área (CAD)
          </CardTitle>
          <CardDescription>
            Escaneie o molde na impressora e trace as peças no CAD (calcula a área e gera o DXF), ou importe um DXF pronto do
            Shoemaster/AutoCAD. A área no tamanho base alimenta o escalonamento abaixo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" className="h-9 gap-1.5" onClick={() => setCadOpen(true)}>
              <Scan className="h-4 w-4" /> Escanear molde (CAD)
            </Button>
            <span className="text-xs text-muted-foreground">ou</span>
            <label className="inline-flex">
              <input
                type="file"
                accept=".dxf,application/dxf,image/vnd.dxf"
                className="hidden"
                onChange={(e) => onPickDxf(e.target.files?.[0] ?? null)}
              />
              <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-muted/40">
                {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadSimple className="h-4 w-4" />}
                Importar DXF
              </span>
            </label>
            {dxfName && <span className="text-xs text-muted-foreground truncate max-w-[220px]">{dxfName}</span>}
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Unidade do desenho</Label>
              <Select value={unit} onValueChange={(v) => reReadWithUnit(v as DxfLengthUnit)}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['mm', 'cm', 'm', 'in'] as DxfLengthUnit[]).map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {dxf && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{dxf.pieces.length} peça(s){dxf.unitFromHeader ? ' · unidade do header' : ''}</span>
                <span className="font-semibold tabular-nums">Área total: {fmt(dxf.totalDm2, 2)} dm²</span>
              </div>
              {dxf.pieces.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {dxf.pieces.map((p, i) => (
                    <span key={i} className="rounded bg-background px-2 py-0.5 text-[11px] text-muted-foreground border">
                      {p.layer || p.type}: {fmt(p.areaDm2, 2)} dm²
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Escalonar cabedal */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler className="h-4 w-4 text-muted-foreground" /> Escalonar cabedal por numeração
          </CardTitle>
          <CardDescription>
            Do valor base, o sistema gera o consumo em todas as numerações (grade padrão; usa a razão do solado quando houver progressão real).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Tamanho base</Label>
              <Select value={String(baseSize)} onValueChange={(v) => setBaseSize(Number(v))}>
                <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sortedSizes.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Consumo base</Label>
              <div className="flex items-center gap-1">
                <NumberInput value={baseValue} onChange={(v) => setBaseValue(Number(v) || 0)} step="0.01" min={0} decimals={4} className="h-9 w-28 text-right" />
                <span className="text-xs text-muted-foreground font-mono">{upperUnit || 'dm²'}/par</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Escala</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as ScaleMode)}>
                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="area">Área (cabedal)</SelectItem>
                  <SelectItem value="linear">Linear</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={applyUpper} className="h-9 gap-1.5">
              <Check className="h-4 w-4" /> Aplicar ao cabedal
            </Button>
          </div>

          {/* Prévia da curva */}
          {baseValue > 0 && sortedSizes.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 text-muted-foreground">
                    <th className="px-2 py-1 text-left font-semibold">Nº</th>
                    {sortedSizes.map((s) => <th key={s} className="px-2 py-1 text-right font-mono">{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-2 py-1 text-left font-semibold text-muted-foreground">Consumo</td>
                    {sortedSizes.map((s) => (
                      <td key={s} className={`px-2 py-1 text-right tabular-nums ${s === baseSize ? 'font-bold text-primary' : ''}`}>
                        {fmt(previewCurve[String(s)] ?? 0, 3)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {/* Fonte da escala */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {usingSoleRatio ? (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                Escala pela medida real do solado
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                Escala pela grade padrão (solado sem progressão por número)
              </span>
            )}
          </div>

          {/* Aviso de unidade: o cabedal de área grava dm²/par e o DXF dá dm² → mapeia direto.
              Se a unidade não é de área (ex.: 'un'), o DXF não se aplica e o valor base deve
              ser informado na unidade do material (sem conversão automática — evita inflar 100×). */}
          {unitIsArea ? (
            <p className="text-[11px] text-muted-foreground">
              O cabedal é de <span className="font-mono">{upperUnit}</span> (área de bobina) e o DXF também dá{' '}
              <span className="font-mono">dm²</span> — a área importada vira o consumo base direto. A conversão para metro
              acontece no cálculo, pela largura da ficha de componente.
            </p>
          ) : (
            <p className="text-[11px] text-amber-600">
              ⚠ A unidade do cabedal é <span className="font-mono">{upperUnit || 'un'}</span>, não área — o DXF (dm²) não
              mapeia direto. Informe o consumo base em <span className="font-mono">{upperUnit || 'un'}/par</span> na mão.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 3. Escalonar tiras */}
      {straps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Path className="h-4 w-4 text-muted-foreground" /> Escalonar tiras
            </CardTitle>
            <CardDescription>Comprimento base (cm/pé) por tira no tamanho {baseSize} → escala linear por numeração (o sistema dobra p/ o par).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {straps.map((s, idx) => (
              <div key={s.id || idx} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2">
                <span className="text-sm font-medium min-w-[90px]">{s.label || `Tira ${idx + 1}`}</span>
                {s.group_name && <span className="text-xs text-muted-foreground">({s.group_name})</span>}
                <div className="flex items-center gap-1 ml-auto">
                  <Label className="text-xs text-muted-foreground">Base</Label>
                  <NumberInput
                    // pré-preenche por PÉ (storage é par → ÷2); applyStrap dobra de volta.
                    value={strapBase[idx] ?? (Math.round(((Number((s.consumption_per_size ?? {})[String(baseSize)]) || Number(s.consumption) || 0) / 2) * 100) / 100)}
                    onChange={(v) => setStrapBase((p) => ({ ...p, [idx]: Number(v) || 0 }))}
                    step="0.5" min={0} decimals={2} className="h-8 w-20 text-right"
                  />
                  <span className="text-xs text-muted-foreground">cm/pé</span>
                  <Button size="sm" variant="outline" className="h-8 ml-1" onClick={() => applyStrap(idx)}>Aplicar</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <MoldeCadEditor
        open={cadOpen}
        onOpenChange={setCadOpen}
        initialDpi={300}
        fileBaseName={form?.code || form?.name || 'molde'}
        onApply={onCadApply}
      />
    </div>
  );
}
