import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Printer, Sliders as SlidersHorizontal, Eye, Wrench, ArrowCounterClockwise as RotateCcw, CheckCircle as CheckCircle2, Warning as AlertTriangle, Info, FloppyDisk as Save } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { BarcodeSVG } from '@/components/ui/barcode-svg';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PrinterCalibration = {
  printerPreset: string;
  dpi: number;
  darkness: number;   // 0–30
  printSpeed: number; // 1–5
  offsetXMm: number;  // horizontal shift (-5 to +5)
  offsetYMm: number;  // vertical shift (-5 to +5)
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
};

const STORAGE_KEY = 'label_printer_calibration';

const PRESETS: Record<string, { label: string; dpi: number; darkness: number; speed: number }> = {
  elgin_l42:  { label: 'Elgin L42 Pro',   dpi: 203, darkness: 15, speed: 3 },
  elgin_vox:  { label: 'Elgin VOX',        dpi: 203, darkness: 14, speed: 3 },
  zebra_zd421:{ label: 'Zebra ZD421',      dpi: 300, darkness: 20, speed: 3 },
  brother_ql: { label: 'Brother QL-820',   dpi: 300, darkness: 18, speed: 4 },
  generica:   { label: 'Genérica 203 dpi', dpi: 203, darkness: 12, speed: 3 },
};

const DEFAULT_CALIBRATION: PrinterCalibration = {
  printerPreset: 'elgin_l42',
  dpi: 203,
  darkness: 15,
  printSpeed: 3,
  offsetXMm: 0,
  offsetYMm: 0,
  marginTopMm: 1,
  marginBottomMm: 1,
  marginLeftMm: 1.5,
  marginRightMm: 1.5,
};

function loadCalibration(): PrinterCalibration {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_CALIBRATION, ...JSON.parse(saved) };
  } catch {}
  return { ...DEFAULT_CALIBRATION };
}

export function saveCalibration(cal: PrinterCalibration) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cal));
}

export function loadSavedCalibration(): PrinterCalibration {
  return loadCalibration();
}

// ── Label Miniature Preview ───────────────────────────────────────────────────

const PX_PER_MM = 3.78; // 96 dpi approximation

const SAMPLES = [
  { refCode: 'REF-001', refName: 'Sandália Tiras Finas', color: 'Caramelo', size: '36', barcode: '789123456001', material: 'Sintético' },
  { refCode: 'REF-002', refName: 'Rasteira Laço',        color: 'Preto',    size: '38', barcode: '789123456002', material: 'Couro' },
  { refCode: 'REF-003', refName: 'Mule Salto Bloco',     color: 'Nude',     size: '37', barcode: '789123456003', material: 'Verniz' },
];

type DimOption = { id: string; label: string; width: number; height: number };

function LabelMiniature({
  sample, widthMm, heightMm, cal, scale,
}: {
  sample: typeof SAMPLES[0];
  widthMm: number;
  heightMm: number;
  cal: PrinterCalibration;
  scale: number;
}) {
  const W = widthMm * PX_PER_MM * scale;
  const H = heightMm * PX_PER_MM * scale;
  const mmToPx = PX_PER_MM * scale;

  const marginL = (cal.marginLeftMm  + Math.max(0, cal.offsetXMm)) * mmToPx;
  const marginR = (cal.marginRightMm + Math.max(0, -cal.offsetXMm)) * mmToPx;
  const marginT = (cal.marginTopMm   + Math.max(0, cal.offsetYMm)) * mmToPx;
  const marginB = (cal.marginBottomMm + Math.max(0, -cal.offsetYMm)) * mmToPx;

  const leftColW  = 22 * mmToPx;
  const rightColW = 26 * mmToPx;
  const centerW   = W - marginL - marginR - leftColW - rightColW;
  const innerH    = H - marginT - marginB;

  const fontSize = {
    name:    Math.max(5, 11 * scale),
    code:    Math.max(3, 5.5 * scale),
    color:   Math.max(3, 6.5 * scale),
    size:    Math.max(7, 15 * scale),
    barcode: Math.max(3, 6 * scale),
  };

  return (
    <div
      style={{
        width: W, height: H,
        border: '1px solid #333',
        borderRadius: 2,
        background: '#fff',
        overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        flexShrink: 0,
      }}
    >
      {/* Content area with calibrated margins */}
      <div style={{
        position: 'absolute',
        left: marginL, top: marginT,
        width: W - marginL - marginR,
        height: innerH,
        display: 'flex',
        overflow: 'hidden',
      }}>
        {/* Left: size box */}
        <div style={{
          width: leftColW, height: innerH,
          background: '#111', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: fontSize.size, fontWeight: 900, fontFamily: 'Arial', lineHeight: 1 }}>
            {sample.size}
          </span>
        </div>

        {/* Center: info */}
        <div style={{
          width: centerW, height: innerH,
          padding: `${2 * scale}px ${3 * scale}px`,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1,
          overflow: 'hidden',
        }}>
          <div style={{ fontSize: fontSize.name, fontWeight: 800, fontFamily: 'Arial', lineHeight: 1.1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {sample.refName}
          </div>
          <div style={{ fontSize: fontSize.code, color: '#444', fontFamily: 'Arial', lineHeight: 1 }}>
            {sample.refCode}
          </div>
          <div style={{ fontSize: fontSize.color, fontWeight: 700, fontFamily: 'Arial', lineHeight: 1.1, marginTop: 1 }}>
            {sample.color} · {sample.material}
          </div>
        </div>

        {/* Right: barcode */}
        <div style={{
          width: rightColW, height: innerH,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          paddingRight: 2 * scale,
        }}>
          <BarcodeSVG
            value={sample.barcode}
            height={Math.max(12, innerH * 0.65)}
            fontSize={fontSize.barcode}
          />
        </div>
      </div>

      {/* Margin guides overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        borderLeft:   `${marginL}px solid rgba(59,130,246,0.12)`,
        borderRight:  `${marginR}px solid rgba(59,130,246,0.12)`,
        borderTop:    `${marginT}px solid rgba(59,130,246,0.12)`,
        borderBottom: `${marginB}px solid rgba(59,130,246,0.12)`,
      }} />
    </div>
  );
}

// ── Slider row helper ─────────────────────────────────────────────────────────

function SliderRow({
  label, value, min, max, step, unit, onChange, color,
}: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; onChange: (v: number) => void; color?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Badge variant="outline" className={`text-xs font-mono h-5 px-2 ${color || ''}`}>
          {value > 0 && max > 0 ? '+' : ''}{value}{unit}
        </Badge>
      </div>
      <Slider
        value={[value]} onValueChange={([v]) => onChange(v)}
        min={min} max={max} step={step} className="py-1"
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const LABEL_SIZES: DimOption[] = [
  { id: '100x30', label: '100 × 30 mm', width: 100, height: 30 },
  { id: '110x30', label: '110 × 30 mm', width: 110, height: 30 },
  { id: '100x40', label: '100 × 40 mm', width: 100, height: 40 },
  { id: '100x50', label: '100 × 50 mm', width: 100, height: 50 },
  { id: '80x30',  label: '80 × 30 mm',  width: 80,  height: 30 },
  { id: '60x30',  label: '60 × 30 mm',  width: 60,  height: 30 },
];

const GUIDE_ISSUES = [
  {
    id: 'cortada',
    title: 'Etiqueta cortada nas bordas',
    icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    steps: [
      'Aumente a Margem Esquerda e Direita (+0.5 mm de cada vez) até o texto aparecer completo.',
      'Verifique se o tamanho selecionado (100×30mm) bate com o papel carregado na impressora.',
      'No diálogo de impressão do Chrome: Margens → Nenhuma (0) e Escala → 100%.',
      'Desmarque "Cabeçalhos e rodapés" nas configurações avançadas.',
    ],
  },
  {
    id: 'clara',
    title: 'Impressão muito clara / apagada',
    icon: <AlertTriangle className="h-4 w-4 text-orange-500" />,
    steps: [
      'Aumente a Escuridão (Darkness) — experimente valores entre 18 e 22.',
      'Reduza a Velocidade de Impressão para 1 ou 2 (mais lento = mais escuro).',
      'Limpe o cabeçote de impressão com álcool isopropílico em um cotonete.',
      'Se persistir, o papel térmico pode estar com a face errada — vire o rolo.',
    ],
  },
  {
    id: 'torta',
    title: 'Etiqueta saindo torta / desalinhada',
    icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
    steps: [
      'Use o Offset X para compensar deslocamento horizontal (-mm para esquerda, +mm para direita).',
      'Use o Offset Y para deslocamento vertical (-mm para cima, +mm para baixo).',
      'Verifique se as guias laterais de papel estão bem encostadas no rolo.',
      'Recalibre o sensor de mídia: segure o botão Feed por 5s até piscar 2x (Elgin L42).',
    ],
  },
  {
    id: 'barcode',
    title: 'Código de barras ilegível / não scanneia',
    icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
    steps: [
      'Aumente a Escuridão para 18–22 para garantir contraste adequado.',
      'Reduza a Velocidade para 1 ou 2 — velocidade alta borra linhas finas.',
      'Verifique se a Coluna Direita tem espaço suficiente (mínimo 22mm para CODE128).',
      'Teste com o scanner a 10–15cm de distância em ângulo ligeiramente oblíquo.',
    ],
  },
  {
    id: 'pulando',
    title: 'Impressora pulando etiquetas em branco',
    icon: <Info className="h-4 w-4 text-blue-500" />,
    steps: [
      'O sensor de gap está mal calibrado para o espaçamento do seu rolo.',
      'Elgin L42: pressione Feed com a tampa aberta por 3s para recalibrar o sensor de gap.',
      'Verifique se o tipo de mídia está configurado corretamente (gap vs. contínuo vs. marca preta).',
      'Confira se o tamanho da etiqueta na impressora bate com o tamanho real do papel.',
    ],
  },
  {
    id: 'manchas',
    title: 'Manchas ou listras verticais na impressão',
    icon: <Info className="h-4 w-4 text-blue-500" />,
    steps: [
      'Limpe o cabeçote térmico com álcool isopropílico 70% e cotonete seco.',
      'Verifique se há sujeira ou etiqueta grudada no rolo de pressão (platen roller).',
      'Experimente reduzir a Escuridão — excesso de calor pode causar manchas.',
      'Se as listras forem sempre no mesmo ponto, o cabeçote pode ter um elemento danificado.',
    ],
  },
];

export function LabelCalibrationTab() {
  const [cal, setCal] = useState<PrinterCalibration>(loadCalibration);
  const [labelSizeId, setLabelSizeId] = useState('100x30');
  const [saved, setSaved] = useState(false);

  const dim = LABEL_SIZES.find(s => s.id === labelSizeId) ?? LABEL_SIZES[0];

  const update = useCallback((patch: Partial<PrinterCalibration>) => {
    setCal(prev => ({ ...prev, ...patch }));
    setSaved(false);
  }, []);

  const applyPreset = (presetId: string) => {
    const p = PRESETS[presetId];
    if (!p) return;
    update({ printerPreset: presetId, dpi: p.dpi, darkness: p.darkness, printSpeed: p.speed });
  };

  const handleSave = () => {
    saveCalibration(cal);
    setSaved(true);
    toast.success('Calibração salva! As configurações serão usadas nas próximas impressões.');
  };

  const handleReset = () => {
    setCal({ ...DEFAULT_CALIBRATION });
    setSaved(false);
    toast.info('Configurações restauradas para o padrão.');
  };

  const handleTestPrint = () => {
    const { width: W, height: H } = dim;
    const mL = cal.marginLeftMm  + Math.max(0,  cal.offsetXMm);
    const mR = cal.marginRightMm + Math.max(0, -cal.offsetXMm);
    const mT = cal.marginTopMm   + Math.max(0,  cal.offsetYMm);
    const mB = cal.marginBottomMm + Math.max(0, -cal.offsetYMm);

    const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<style>
  @page { size: ${W}mm ${H}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: ${W}mm; height: ${H}mm; background: #fff; }
  .lbl {
    width: ${W}mm; height: ${H}mm;
    padding: ${mT}mm ${mR}mm ${mB}mm ${mL}mm;
    display: flex; flex-direction: column;
    justify-content: space-between;
    font-family: Arial, sans-serif;
    border: 0.3mm solid #000;
  }
  .ruler-h { display: flex; align-items: flex-end; gap: 0; height: 5mm; }
  .tick { display: flex; flex-direction: column; align-items: flex-start; font-size: 4pt; color: #666; }
  .tick-line { width: 0.2mm; background: #999; }
  .center { text-align: center; font-size: 7pt; color: #333; line-height: 1.4; }
  .info { font-size: 5pt; color: #888; text-align: center; }
  .corners { display: flex; justify-content: space-between; }
  .corner { width: 3mm; height: 3mm; }
  .tl { border-left: 0.4mm solid #000; border-top: 0.4mm solid #000; }
  .tr { border-right: 0.4mm solid #000; border-top: 0.4mm solid #000; }
  .bl { border-left: 0.4mm solid #000; border-bottom: 0.4mm solid #000; }
  .br { border-right: 0.4mm solid #000; border-bottom: 0.4mm solid #000; }
</style>
</head><body>
<div class="lbl">
  <div class="corners"><div class="corner tl"></div><div class="corner tr"></div></div>
  <div class="center">
    <strong>★ ETIQUETA DE CALIBRAÇÃO ★</strong><br/>
    ${dim.label} · ${PRESETS[cal.printerPreset]?.label ?? cal.printerPreset}<br/>
    DPI: ${cal.dpi} · Escuridão: ${cal.darkness} · Velocidade: ${cal.printSpeed}
  </div>
  <div class="info">
    Margens: T${mT.toFixed(1)} B${mB.toFixed(1)} L${mL.toFixed(1)} R${mR.toFixed(1)} mm
    &nbsp;|&nbsp; Offset X:${cal.offsetXMm>0?'+':''}${cal.offsetXMm} Y:${cal.offsetYMm>0?'+':''}${cal.offsetYMm}
  </div>
  <div class="corners"><div class="corner bl"></div><div class="corner br"></div></div>
</div>
</body></html>`;

    const w = window.open('', '_blank', `width=${W * 5 + 40},height=${H * 5 + 120}`);
    if (w) {
      w.document.write(html);
      w.document.close();
      w.onload = () => setTimeout(() => w.print(), 400);
      setTimeout(() => { try { w.print(); } catch {} }, 2000);
    } else {
      toast.error('Popup bloqueado — permita popups para este site.');
    }
  };

  // Scale so 3 labels fit side-by-side in ~900px container (each ~260px wide)
  const previewScale = Math.min(0.85, 260 / (dim.width * PX_PER_MM));

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            Calibração da Impressora Térmica
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ajuste margens, offset e parâmetros de impressão. As configurações são salvas localmente e aplicadas em todas as impressões.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5 text-xs h-8">
            <RotateCcw className="h-3.5 w-3.5" /> Restaurar padrão
          </Button>
          <Button size="sm" onClick={handleSave} className="gap-1.5 text-xs h-8" variant={saved ? 'outline' : 'default'}>
            {saved ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Save className="h-3.5 w-3.5" />}
            {saved ? 'Salvo' : 'Salvar calibração'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left column: settings ── */}
        <div className="space-y-4">
          {/* Printer + size */}
          <Card>
            <CardHeader className="py-3 bg-muted/40">
              <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase tracking-wide">
                <Printer className="h-3.5 w-3.5" /> Impressora
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Modelo</Label>
                  <Select value={cal.printerPreset} onValueChange={v => { update({ printerPreset: v }); applyPreset(v); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRESETS).map(([id, p]) => (
                        <SelectItem key={id} value={id} className="text-xs">{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tamanho da etiqueta</Label>
                  <Select value={labelSizeId} onValueChange={setLabelSizeId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LABEL_SIZES.map(s => (
                        <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                <Badge variant="secondary" className="text-xs font-mono">{cal.dpi} DPI</Badge>
                <span>{dim.width} × {dim.height} mm</span>
              </div>
            </CardContent>
          </Card>

          {/* Print parameters */}
          <Card>
            <CardHeader className="py-3 bg-muted/40">
              <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase tracking-wide">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Parâmetros de Impressão
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-5">
              <SliderRow
                label="Escuridão (Darkness)"
                value={cal.darkness} min={0} max={30} step={1} unit=""
                onChange={v => update({ darkness: v })}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground -mt-3">
                <span>Claro</span><span>Médio</span><span>Escuro</span>
              </div>

              <SliderRow
                label="Velocidade de Impressão"
                value={cal.printSpeed} min={1} max={5} step={1} unit=""
                onChange={v => update({ printSpeed: v })}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground -mt-3">
                <span>Lenta (mais escura)</span><span>Rápida</span>
              </div>
            </CardContent>
          </Card>

          {/* Offset */}
          <Card>
            <CardHeader className="py-3 bg-muted/40">
              <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase tracking-wide">
                <SlidersHorizontal className="h-3.5 w-3.5 rotate-90" /> Correção de Offset
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-5">
              <SliderRow
                label="Offset Horizontal (X)"
                value={cal.offsetXMm} min={-5} max={5} step={0.5} unit=" mm"
                onChange={v => update({ offsetXMm: v })}
                color={cal.offsetXMm !== 0 ? 'text-blue-600 border-blue-300' : ''}
              />
              <SliderRow
                label="Offset Vertical (Y)"
                value={cal.offsetYMm} min={-5} max={5} step={0.5} unit=" mm"
                onChange={v => update({ offsetYMm: v })}
                color={cal.offsetYMm !== 0 ? 'text-blue-600 border-blue-300' : ''}
              />
            </CardContent>
          </Card>

          {/* Margins */}
          <Card>
            <CardHeader className="py-3 bg-muted/40">
              <CardTitle className="text-xs font-bold uppercase tracking-wide">Margens Finas (mm)</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <SliderRow label="Superior"  value={cal.marginTopMm}    min={0} max={6} step={0.5} unit=" mm" onChange={v => update({ marginTopMm: v })} />
                <SliderRow label="Inferior"  value={cal.marginBottomMm} min={0} max={6} step={0.5} unit=" mm" onChange={v => update({ marginBottomMm: v })} />
                <SliderRow label="Esquerda"  value={cal.marginLeftMm}   min={0} max={8} step={0.5} unit=" mm" onChange={v => update({ marginLeftMm: v })} />
                <SliderRow label="Direita"   value={cal.marginRightMm}  min={0} max={8} step={0.5} unit=" mm" onChange={v => update({ marginRightMm: v })} />
              </div>
            </CardContent>
          </Card>

          {/* Test print */}
          <Button onClick={handleTestPrint} className="w-full gap-2" variant="outline">
            <Printer className="h-4 w-4" /> Imprimir Etiqueta de Teste
          </Button>
        </div>

        {/* ── Right column: preview + guide ── */}
        <div className="space-y-4">
          {/* Preview */}
          <Card>
            <CardHeader className="py-3 bg-muted/40">
              <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase tracking-wide">
                <Eye className="h-3.5 w-3.5" /> Prévia das Etiquetas
                <Badge variant="secondary" className="text-[10px] ml-auto normal-case font-normal">
                  {dim.label}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <p className="text-[10px] text-muted-foreground mb-3">
                As faixas azuis claras representam as margens configuradas. Ajuste os controles à esquerda e veja o impacto em tempo real.
              </p>
              <div className="flex flex-col gap-4 items-start overflow-x-auto pb-2">
                {SAMPLES.map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-[10px] text-muted-foreground w-4 text-right flex-shrink-0">{i + 1}</span>
                    <LabelMiniature
                      sample={s}
                      widthMm={dim.width}
                      heightMm={dim.height}
                      cal={cal}
                      scale={previewScale}
                    />
                    <div className="text-[10px] text-muted-foreground leading-tight">
                      <div className="font-semibold">{s.refName}</div>
                      <div>{s.color} · Tam. {s.size}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 p-2 rounded bg-muted/30 text-[10px] text-muted-foreground">
                Tamanho real: <strong>{dim.width} × {dim.height} mm</strong> · Prévia em escala reduzida (~{Math.round(previewScale * 100)}%)
              </div>
            </CardContent>
          </Card>

          {/* Calibration guide */}
          <Card>
            <CardHeader className="py-3 bg-muted/40">
              <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase tracking-wide">
                <Wrench className="h-3.5 w-3.5" /> Guia de Calibração
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2 pb-2">
              <Accordion type="multiple" className="w-full">
                {GUIDE_ISSUES.map(issue => (
                  <AccordionItem key={issue.id} value={issue.id} className="border-b border-border/50 last:border-0">
                    <AccordionTrigger className="text-xs py-3 hover:no-underline gap-2">
                      <span className="flex items-center gap-2">
                        {issue.icon}
                        {issue.title}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3">
                      <ol className="space-y-1.5 list-decimal list-inside">
                        {issue.steps.map((step, i) => (
                          <li key={i} className="text-xs text-muted-foreground leading-relaxed pl-1">
                            {step}
                          </li>
                        ))}
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
