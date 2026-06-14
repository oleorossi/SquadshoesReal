/**
 * Editor CAD de moldes — traça as peças sobre a imagem escaneada (impressora),
 * calcula a área (dm²) pelo DPI e gera o DXF.
 *
 * Fluxo: sobe a imagem do scan → informa o DPI → clica o contorno de cada peça
 * (fecha clicando no 1º ponto ou em "Fechar peça") → vê a área por peça e total
 * → "Baixar DXF" e/ou "Usar no escalonamento" (devolve a área + o DXF gerado).
 *
 * Os vértices vivem em PIXELS da imagem; a conversão p/ mm (e o Y invertido p/ o
 * CAD) só acontece na exportação. Área via cadGeometry; DXF via dxfWriter.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { UploadSimple, ArrowUUpLeft, Trash, Polygon, DownloadSimple, Check, Scan } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { type Pt, polygonAreaDm2, totalAreaDm2, pxToMm } from '@/lib/cadGeometry';
import { polygonsToDxf, downloadDxf, type DxfPolygonMm } from '@/lib/dxfWriter';

const MAX_W = 760; // largura máx de exibição do canvas
const CLOSE_SNAP_PX = 12; // distância (display) pra fechar no 1º ponto

interface MoldeCadEditorProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialDpi?: number;
  /** Nome sugerido do arquivo DXF (ex.: referência). */
  fileBaseName?: string;
  onApply: (r: { totalDm2: number; dpi: number; pieces: { areaDm2: number }[]; dxfText: string }) => void;
}

export function MoldeCadEditor({ open, onOpenChange, initialDpi = 300, fileBaseName = 'molde', onApply }: MoldeCadEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [dpi, setDpi] = useState<number>(initialDpi);
  const [polygons, setPolygons] = useState<Pt[][]>([]); // peças fechadas (px da imagem)
  const [current, setCurrent] = useState<Pt[]>([]); // peça em traçado (px da imagem)

  // Escala de exibição: imagem cabe em MAX_W, nunca amplia além do natural.
  const displayScale = useMemo(() => (img ? Math.min(1, MAX_W / img.naturalWidth) : 1), [img]);
  const dispW = img ? Math.round(img.naturalWidth * displayScale) : 0;
  const dispH = img ? Math.round(img.naturalHeight * displayScale) : 0;

  const reset = () => { setPolygons([]); setCurrent([]); };

  const onPickImage = (file: File | null) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { setImg(im); reset(); URL.revokeObjectURL(url); };
    im.onerror = () => { toast.error('Não consegui abrir a imagem'); URL.revokeObjectURL(url); };
    im.src = url;
  };

  // ── Desenho ──
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, dispW, dispH);

    const toDisp = (p: Pt) => ({ x: p.x * displayScale, y: p.y * displayScale });

    // peças fechadas
    ctx.lineWidth = 2;
    for (const poly of polygons) {
      if (poly.length < 2) continue;
      ctx.beginPath();
      poly.forEach((p, i) => { const d = toDisp(p); i ? ctx.lineTo(d.x, d.y) : ctx.moveTo(d.x, d.y); });
      ctx.closePath();
      ctx.fillStyle = 'rgba(220,38,38,0.18)';
      ctx.strokeStyle = 'rgba(220,38,38,0.9)';
      ctx.fill();
      ctx.stroke();
    }

    // peça em traçado
    if (current.length > 0) {
      ctx.beginPath();
      current.forEach((p, i) => { const d = toDisp(p); i ? ctx.lineTo(d.x, d.y) : ctx.moveTo(d.x, d.y); });
      ctx.strokeStyle = 'rgba(37,99,235,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
      current.forEach((p) => {
        const d = toDisp(p);
        ctx.beginPath();
        ctx.arc(d.x, d.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#2563eb';
        ctx.fill();
      });
    }
  }, [img, dispW, dispH, displayScale, polygons, current]);

  useEffect(() => { redraw(); }, [redraw]);

  const closeCurrent = useCallback(() => {
    if (current.length < 3) { toast.error('Marque ao menos 3 pontos pra fechar a peça'); return; }
    setPolygons((p) => [...p, current]);
    setCurrent([]);
  }, [current]);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!img) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    // fecha se clicar perto do 1º ponto
    if (current.length >= 3) {
      const first = current[0];
      const fdx = first.x * displayScale - dx;
      const fdy = first.y * displayScale - dy;
      if (Math.hypot(fdx, fdy) <= CLOSE_SNAP_PX) { closeCurrent(); return; }
    }
    const pt = { x: dx / displayScale, y: dy / displayScale };
    setCurrent((c) => [...c, pt]);
  };

  const undoPoint = () => {
    if (current.length > 0) setCurrent((c) => c.slice(0, -1));
    else if (polygons.length > 0) setPolygons((p) => p.slice(0, -1));
  };

  // ── Áreas ──
  const pieceAreas = useMemo(() => polygons.map((poly) => polygonAreaDm2(poly, dpi)), [polygons, dpi]);
  const totalDm2 = useMemo(() => totalAreaDm2(polygons, dpi), [polygons, dpi]);

  const buildDxf = useCallback((): string => {
    if (!img) return '';
    const polys: DxfPolygonMm[] = polygons.map((poly, i) => ({
      layer: `MOLDE_${i + 1}`,
      points: poly.map((p) => pxToMm(p, dpi, img.naturalHeight)), // Y invertido p/ CAD
    }));
    return polygonsToDxf(polys);
  }, [img, polygons, dpi]);

  const handleDownload = () => {
    if (polygons.length === 0) { toast.error('Trace ao menos uma peça'); return; }
    downloadDxf(buildDxf(), fileBaseName);
    toast.success('DXF gerado');
  };

  const handleApply = () => {
    if (polygons.length === 0) { toast.error('Trace ao menos uma peça'); return; }
    onApply({ totalDm2, dpi, pieces: pieceAreas.map((a) => ({ areaDm2: a })), dxfText: buildDxf() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[860px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Scan className="h-5 w-5" /> CAD de moldes</DialogTitle>
          <DialogDescription>
            Suba a imagem do molde escaneado, informe o DPI e trace o contorno de cada peça. O sistema calcula a área e gera o DXF.
          </DialogDescription>
        </DialogHeader>

        {/* Controles */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex">
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onPickImage(e.target.files?.[0] ?? null)} />
            <span className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-muted/40">
              <UploadSimple className="h-4 w-4" /> {img ? 'Trocar imagem' : 'Imagem do scan'}
            </span>
          </label>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">DPI do scanner</Label>
            <NumberInput value={dpi} onChange={(v) => setDpi(Number(v) || 0)} step="1" min={1} decimals={0} className="h-9 w-20 text-right" />
          </div>
          {img && (
            <>
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={closeCurrent} disabled={current.length < 3}>
                <Polygon className="h-4 w-4" /> Fechar peça
              </Button>
              <Button size="sm" variant="ghost" className="h-9 gap-1.5" onClick={undoPoint} disabled={!current.length && !polygons.length}>
                <ArrowUUpLeft className="h-4 w-4" /> Desfazer
              </Button>
              <Button size="sm" variant="ghost" className="h-9 gap-1.5 text-destructive" onClick={reset} disabled={!current.length && !polygons.length}>
                <Trash className="h-4 w-4" /> Limpar
              </Button>
            </>
          )}
        </div>

        {/* Canvas */}
        {img ? (
          <div className="overflow-auto rounded-lg border bg-muted/20 p-2">
            <canvas
              ref={canvasRef}
              width={dispW}
              height={dispH}
              onClick={onCanvasClick}
              className="cursor-crosshair block"
              style={{ width: dispW, height: dispH, maxWidth: '100%' }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-muted-foreground">
            <Scan className="h-8 w-8 opacity-40" />
            <p className="text-sm">Suba a imagem do molde escaneado para começar.</p>
          </div>
        )}

        {/* Peças + áreas */}
        {polygons.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {pieceAreas.map((a, i) => (
                <span key={i} className="rounded bg-muted px-2 py-0.5 text-[11px] tabular-nums">
                  Peça {i + 1}: {a.toFixed(2)} dm²
                </span>
              ))}
            </div>
            <p className="text-sm font-semibold">Área total: <span className="tabular-nums text-primary">{totalDm2.toFixed(2)} dm²</span></p>
          </div>
        )}

        {img && (
          <p className="text-[11px] text-muted-foreground">
            Clique pra marcar o contorno; feche clicando no 1º ponto ou em <span className="font-medium">Fechar peça</span>.
            Trace uma peça por contorno (várias peças somam na área total).
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="gap-1.5" onClick={handleDownload} disabled={polygons.length === 0}>
            <DownloadSimple className="h-4 w-4" /> Baixar DXF
          </Button>
          <Button className="gap-1.5" onClick={handleApply} disabled={polygons.length === 0}>
            <Check className="h-4 w-4" /> Usar no escalonamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
