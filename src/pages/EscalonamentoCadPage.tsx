/**
 * Escalonamento / CAD — calculadora INDEPENDENTE (menu lateral).
 *
 * Saiu da ficha técnica (2026-06-28, pedido do dono): em vez de gravar na ficha,
 * é um workbench: escaneia o molde (MoldeCadEditor) ou importa um DXF
 * (Shoemaster/AutoCAD), calcula a área (dxfArea.ts) e gera a curva de consumo por
 * numeração (gradeScaling.ts). O resultado é COPIADO/EXPORTADO — o usuário cola na
 * grade do cabedal da ficha. Sem amarra a nenhuma ficha (faixa de numeração manual).
 */
import { useMemo, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UploadSimple, Ruler, CircleNotch as Loader2, Scan, Copy, DownloadSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { computeDxfAreas, type DxfAreaResult, type DxfLengthUnit } from '@/lib/dxfArea';
import { scaleConsumptionBySize, type ScaleMode } from '@/lib/gradeScaling';
import { MoldeCadEditor } from '@/components/technical-sheets/MoldeCadEditor';

const fmt = (v: number, d = 4) => (Number(v) || 0).toFixed(d);
const avg = (obj: Record<string, number>) => {
  const vals = Object.values(obj).filter((v) => Number(v) > 0);
  return vals.length ? vals.reduce((a, b) => a + Number(b), 0) / vals.length : 0;
};

// "34-40" ou "34,35,36" ou "34-37, 39" → [34,35,36,37,39]. Cap defensivo de 60.
function parseRange(input: string): number[] {
  const out = new Set<number>();
  for (const part of (input || '').split(',')) {
    const p = part.trim();
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10); let b = parseInt(m[2], 10);
      if (a > b) { const t = a; a = b; b = t; }
      for (let i = a; i <= b && i - a < 60; i++) out.add(i);
    } else if (/^\d+$/.test(p)) {
      out.add(parseInt(p, 10));
    }
  }
  return [...out].sort((a, b) => a - b);
}

export default function EscalonamentoCadPage() {
  const [rangeText, setRangeText] = useState('34-40');
  const sizes = useMemo(() => parseRange(rangeText), [rangeText]);
  const defaultBaseSize = sizes.includes(37) ? 37 : (sizes[Math.floor(sizes.length / 2)] ?? 37);

  const [baseSize, setBaseSize] = useState<number>(37);
  const effectiveBase = sizes.includes(baseSize) ? baseSize : defaultBaseSize;

  const [baseValue, setBaseValue] = useState<number>(0);
  const [unitLabel, setUnitLabel] = useState<string>('dm²');
  const [mode, setMode] = useState<ScaleMode>('area');
  const [unit, setUnit] = useState<DxfLengthUnit>('mm');
  const [dxf, setDxf] = useState<DxfAreaResult | null>(null);
  const [dxfName, setDxfName] = useState<string>('');
  const [reading, setReading] = useState(false);
  const [cadOpen, setCadOpen] = useState(false);

  const curve = useMemo(
    () => (baseValue > 0 && sizes.length > 0
      ? scaleConsumptionBySize({ base: baseValue, baseSize: effectiveBase, sizes, mode })
      : {}),
    [baseValue, effectiveBase, sizes, mode],
  );
  const hasCurve = Object.keys(curve).length > 0;

  const onCadApply = (r: { totalDm2: number; dpi: number; pieces: { areaDm2: number }[]; dxfText: string }) => {
    setDxf({
      unit: 'mm', unitFromHeader: false,
      pieces: r.pieces.map((p, i) => ({ layer: `Peça ${i + 1}`, type: 'CAD', areaDm2: p.areaDm2, vertices: 0 })),
      totalDm2: r.totalDm2,
    });
    setDxfName(`CAD · ${r.dpi} DPI`);
    if (r.totalDm2 > 0) { setBaseValue(Number(r.totalDm2.toFixed(4))); setUnitLabel('dm²'); }
    toast.success(`${r.pieces.length} peça(s) · ${r.totalDm2.toFixed(2)} dm² do CAD`);
  };

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
        setUnitLabel('dm²');
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
    if (dxf) {
      const factor = (mm: DxfLengthUnit) => ({ mm: 1, cm: 10, m: 1000, in: 25.4 }[mm]);
      const ratio = (factor(u) / factor(dxf.unit)) ** 2;
      const pieces = dxf.pieces.map((p) => ({ ...p, areaDm2: p.areaDm2 * ratio }));
      const totalDm2 = pieces.reduce((s, p) => s + p.areaDm2, 0);
      setDxf({ ...dxf, unit: u, unitFromHeader: false, pieces, totalDm2 });
      setBaseValue(Number(totalDm2.toFixed(4)));
    }
  };

  const copyCurve = () => {
    if (!hasCurve) { toast.error('Sem curva — defina a faixa, o consumo base e a escala.'); return; }
    const text = sizes.map((s) => `${s}\t${fmt(curve[String(s)] ?? 0, 4)}`).join('\n');
    navigator.clipboard?.writeText(text);
    toast.success('Curva copiada (Nº ⇥ consumo) — cole na grade do cabedal da ficha.');
  };

  const exportCsv = () => {
    if (!hasCurve) { toast.error('Sem curva pra exportar.'); return; }
    const rows = ['numeracao,consumo', ...sizes.map((s) => `${s},${fmt(curve[String(s)] ?? 0, 4)}`)];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `escalonamento_base${effectiveBase}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="editorial-container editorial-stagger space-y-5 pb-12">
        <EditorialPageHeader
          sectionLabel="ENGENHARIA · CAD"
          title="Escalonamento"
          description="Escaneie o molde ou importe o DXF, calcule a área e gere a curva de consumo por numeração. Ferramenta independente — copie/exporte o resultado pra usar na grade do cabedal da ficha."
        />

        {/* 1. Origem da área (CAD) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scan className="h-4 w-4 text-muted-foreground" /> Origem da área (CAD)
            </CardTitle>
            <CardDescription>
              Escaneie o molde na impressora e trace as peças no CAD (calcula a área e gera o DXF), ou importe um DXF
              pronto do Shoemaster/AutoCAD. A área no tamanho base alimenta o escalonamento abaixo.
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

        {/* 2. Escalonar por numeração */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ruler className="h-4 w-4 text-muted-foreground" /> Escalonar por numeração
            </CardTitle>
            <CardDescription>
              Do valor base, o sistema gera o consumo em todas as numerações da faixa (grade padrão do ponto francês:
              área para cabedal, linear para tiras).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Faixa de numeração</Label>
                <Input value={rangeText} onChange={(e) => setRangeText(e.target.value)} placeholder="34-40" className="h-9 w-32" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Tamanho base</Label>
                <Select value={String(effectiveBase)} onValueChange={(v) => setBaseSize(Number(v))} disabled={sizes.length === 0}>
                  <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sizes.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Consumo base</Label>
                <div className="flex items-center gap-1">
                  <NumberInput value={baseValue} onChange={(v) => setBaseValue(Number(v) || 0)} step="0.01" min={0} decimals={4} className="h-9 w-28 text-right" />
                  <Input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} className="h-9 w-16 text-xs" />
                  <span className="text-xs text-muted-foreground font-mono">/par</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Escala</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as ScaleMode)}>
                  <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="area">Área (cabedal)</SelectItem>
                    <SelectItem value="linear">Linear (tira)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" className="h-9 gap-1.5" onClick={copyCurve} disabled={!hasCurve}>
                  <Copy className="h-4 w-4" /> Copiar
                </Button>
                <Button variant="outline" className="h-9 gap-1.5" onClick={exportCsv} disabled={!hasCurve}>
                  <DownloadSimple className="h-4 w-4" /> Exportar CSV
                </Button>
              </div>
            </div>

            {hasCurve ? (
              <>
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 text-muted-foreground">
                        <th className="px-2 py-1 text-left font-semibold">Nº</th>
                        {sizes.map((s) => <th key={s} className="px-2 py-1 text-right font-mono">{s}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-2 py-1 text-left font-semibold text-muted-foreground">Consumo</td>
                        {sizes.map((s) => (
                          <td key={s} className={`px-2 py-1 text-right tabular-nums ${s === effectiveBase ? 'font-bold text-primary' : ''}`}>
                            {fmt(curve[String(s)] ?? 0, 3)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Média <strong className="tabular-nums text-foreground">{fmt(avg(curve), 4)}</strong> {unitLabel}/par ·
                  base no nº <strong>{effectiveBase}</strong>. Copie a curva e cole na grade <em>Consumo de Cabedal por
                  Numeração</em> da ficha.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Defina a <strong>faixa de numeração</strong> e o <strong>consumo base</strong> (importe o DXF/escaneie o
                molde ou digite) pra gerar a curva.
              </p>
            )}
          </CardContent>
        </Card>

        <MoldeCadEditor
          open={cadOpen}
          onOpenChange={setCadOpen}
          initialDpi={300}
          fileBaseName="molde"
          onApply={onCadApply}
        />
      </div>
    </AppLayout>
  );
}
