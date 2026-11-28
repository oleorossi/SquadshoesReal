import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, CaretRight, DownloadSimple, CircleNotch as Loader2, Warning, Barcode } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useEnsureFichaCartoes } from '@/hooks/useEnsureFichaCartoes';
import { code128Bars } from '@/lib/code128';
import {
  ELGIN_FARDO_GAP_X_DOTS,
  ELGIN_FARDO_LABEL_W_DOTS,
  ELGIN_FARDO_PAGE_H_DOTS,
  ELGIN_FARDO_PAGE_W_DOTS,
  ELGIN_FARDO_SELECTION_EXAMPLE,
  buildFardoBatchZpl,
  elginFardoZplFileName,
  formatFardoCounter,
  formatReprintStamp,
  fardoLabelSizes,
  resolveFardoLabelGrade,
  selectFardoLabels,
  type FardoElginLabel,
} from '@/lib/etiquetaFardoElgin';
import type { FichaCartaoRow } from '@/lib/fichaCartoes';

export interface EtiquetaFardoElginOrderMeta {
  id: string;
  op_number?: string | null;
  sale_order_number?: string | null;
  color?: string | null;
  reference_code?: string | null;
  reference_name?: string | null;
  grade?: Record<string, number> | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: string[];
  orders: EtiquetaFardoElginOrderMeta[];
}

const ZOOM = 2;

function toLabels(
  rows: FichaCartaoRow[],
  orders: EtiquetaFardoElginOrderMeta[],
  isReprint: boolean,
): FardoElginLabel[] {
  const meta = new Map(orders.map((o) => [o.id, o]));
  return rows.map((row) => {
    const order = meta.get(row.order_id);
    const grade = resolveFardoLabelGrade(row.grade_json);
    return {
      codigo: row.codigo,
      ficha_index: row.ficha_index,
      total_fichas: row.total_fichas,
      pares: row.pares,
      is_sobra: row.is_sobra,
      pv: row.sales_order_number || order?.sale_order_number || '',
      op: row.op_number || order?.op_number || '',
      modelo: order?.reference_code || order?.reference_name || '',
      cor: order?.color || '',
      sizes: fardoLabelSizes(grade),
      grade,
      isReprint,
      reprintAt: isReprint ? new Date() : undefined,
    };
  });
}

function drawPair(canvas: HTMLCanvasElement, label: FardoElginLabel) {
  const W = ELGIN_FARDO_PAGE_W_DOTS;
  const H = ELGIN_FARDO_PAGE_H_DOTS;
  const work = document.createElement('canvas');
  work.width = W;
  work.height = H;
  const ctx = work.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  const { main, rest } = formatFardoCounter(label.ficha_index, label.total_fichas);
  const stamp = label.isReprint ? `2ª VIA ${formatReprintStamp(label.reprintAt)}` : '';

  // Palmilha header
  ctx.fillRect(0, 0, ELGIN_FARDO_LABEL_W_DOTS, 28);
  ctx.fillStyle = '#fff';
  ctx.font = '16px Arial, sans-serif';
  ctx.fillText('PALMILHA', 10, 6);
  if (stamp) {
    ctx.font = '12px Arial, sans-serif';
    ctx.fillText(stamp, 230, 8);
  }
  ctx.fillStyle = '#000';
  ctx.font = 'bold 70px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(main, 196, 32);
  ctx.textAlign = 'left';
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText(rest, 204, 70);
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.fillText(`${label.pv}  ${label.modelo}  ${label.cor}`, ELGIN_FARDO_LABEL_W_DOTS / 2, 118);
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText(`${label.op}  ${label.pares} PAR`, ELGIN_FARDO_LABEL_W_DOTS / 2, 134);
  ctx.textAlign = 'left';

  const sizes = label.sizes.length ? label.sizes : fardoLabelSizes(label.grade);
  const cols = [...sizes, 'T'];
  const vals = [...sizes.map((s) => String(label.grade[s] ?? 0)), String(label.pares)];
  const cell = Math.floor((ELGIN_FARDO_LABEL_W_DOTS - 20) / Math.max(1, cols.length));
  cols.forEach((c, i) => {
    const x = 10 + i * cell;
    const tot = c === 'T';
    ctx.fillStyle = tot ? '#000' : '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.fillRect(x, 140, cell, 14);
    ctx.strokeRect(x, 140, cell, 14);
    ctx.fillStyle = tot ? '#fff' : '#000';
    ctx.font = '10px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c, x + cell / 2, 142);
    ctx.fillStyle = tot ? '#000' : '#fff';
    ctx.fillRect(x, 154, cell, 22);
    ctx.strokeRect(x, 154, cell, 22);
    ctx.fillStyle = tot ? '#fff' : '#000';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText(vals[i], x + cell / 2, 157);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = '#000';
  drawBarcode(ctx, 10, 182, ELGIN_FARDO_LABEL_W_DOTS - 20, 36, label.codigo);
  ctx.font = '14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label.codigo, ELGIN_FARDO_LABEL_W_DOTS / 2, 222);
  ctx.textAlign = 'left';

  // Montador
  const o = ELGIN_FARDO_LABEL_W_DOTS + ELGIN_FARDO_GAP_X_DOTS;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.strokeRect(o, 0, ELGIN_FARDO_LABEL_W_DOTS, 28);
  ctx.font = '16px Arial, sans-serif';
  ctx.fillText('MONTADOR', o + 10, 6);
  ctx.fillRect(o + ELGIN_FARDO_LABEL_W_DOTS - 34, 0, 34, 28);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('M', o + ELGIN_FARDO_LABEL_W_DOTS - 17, 5);
  ctx.fillStyle = '#000';
  if (stamp) {
    ctx.font = '12px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(stamp, o + 180, 8);
  }
  ctx.font = 'bold 64px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(main, o + 196, 32);
  ctx.textAlign = 'left';
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.fillText(rest, o + 204, 66);
  drawBarcode(ctx, o + 10, 112, ELGIN_FARDO_LABEL_W_DOTS - 20, 36, label.codigo);
  ctx.font = '14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label.codigo, o + ELGIN_FARDO_LABEL_W_DOTS / 2, 152);
  ctx.strokeRect(o + 10, 172, ELGIN_FARDO_LABEL_W_DOTS - 20, 48);
  ctx.textAlign = 'left';
  ctx.font = '12px Arial, sans-serif';
  ctx.fillStyle = '#444';
  ctx.fillText('MONTADOR', o + 16, 176);
  ctx.fillStyle = '#000';
  ctx.fillRect(o + 16, 206, ELGIN_FARDO_LABEL_W_DOTS - 32, 1);
  ctx.font = '12px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#444';
  ctx.fillText(`${label.pv}  ${label.modelo}  ${label.cor}  ${label.pares} PAR`, o + ELGIN_FARDO_LABEL_W_DOTS / 2, 224);

  // Outline of each die
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, ELGIN_FARDO_LABEL_W_DOTS - 2, H - 2);
  ctx.strokeRect(o + 1, 1, ELGIN_FARDO_LABEL_W_DOTS - 2, H - 2);

  canvas.width = W * ZOOM;
  canvas.height = H * ZOOM;
  const out = canvas.getContext('2d');
  if (!out) return;
  out.imageSmoothingEnabled = false;
  out.fillStyle = '#ece8de';
  out.fillRect(0, 0, canvas.width, canvas.height);
  out.drawImage(work, 0, 0, canvas.width, canvas.height);
}

function drawBarcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, data: string) {
  try {
    const bars = code128Bars(data);
    const last = bars[bars.length - 1];
    const modules = last ? last.start + last.width : 0;
    if (!modules) return;
    const module = 2;
    const barW = modules * module;
    const ox = x + Math.max(0, Math.floor((w - barW) / 2));
    ctx.fillStyle = '#000';
    for (const bar of bars) {
      ctx.fillRect(ox + bar.start * module, y, bar.width * module, h);
    }
  } catch {
    /* conteúdo vazio — a prévia segue sem o código */
  }
}

export function EtiquetaFardoElginDialog({ open, onOpenChange, orderIds, orders }: Props) {
  const ids = useMemo(() => Array.from(new Set(orderIds.filter(Boolean))), [orderIds]);
  const { data: rows = [], isLoading, isError, error, refetch } = useEnsureFichaCartoes(ids, open && ids.length > 0);
  const [selection, setSelection] = useState('');
  const [index, setIndex] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const picked = useMemo(() => selectFardoLabels(rows as FichaCartaoRow[], selection), [rows, selection]);
  const isReprint = picked.isPartial;
  const labels = useMemo(() => toLabels(picked.selected, orders, isReprint), [picked.selected, orders, isReprint]);
  const current = labels[Math.min(index, Math.max(0, labels.length - 1))];

  useEffect(() => {
    if (open) {
      setSelection('');
      setIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [selection, rows]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !current || !open) return;
    drawPair(canvas, current);
  }, [current, open]);

  const download = () => {
    if (labels.length === 0) {
      toast.error('Nenhum fardo nessa seleção.');
      return;
    }
    const zpl = buildFardoBatchZpl(labels);
    const blob = new Blob([zpl], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = elginFardoZplFileName(labels[0]?.pv || labels[0]?.op || 'OP');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${labels.length} par${labels.length === 1 ? '' : 'es'} · ${a.download}`);
  };

  const hasSelectionError = picked.isPartial && labels.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Barcode className="h-5 w-5" /> Etiquetas do fardo (Elgin)
          </DialogTitle>
          <DialogDescription>
            Par 50×30 mm (vão 6 mm, página 106×30) para a L42 Pro. Um avanço = palmilha à esquerda e montador à direita, com o mesmo código PM.
            Baixe o .zpl e envie no Gerenciador / DirectPrint. Mídia 106×30, 1 coluna, sensor GAP — não use o perfil 100×30 da etiqueta individual.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Garantindo os códigos PM desta OP…
          </p>
        )}
        {isError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <Warning className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Não deu pra gerar os códigos.{' '}
              <button type="button" className="underline" onClick={() => { void refetch(); }}>Tentar de novo</button>
              <div className="mt-1 text-xs opacity-80">{(error as Error | undefined)?.message}</div>
            </div>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-semibold">
                Reimpressão (ficha)
                <input
                  value={selection}
                  onChange={(e) => setSelection(e.target.value)}
                  placeholder={`Todos, ou ${ELGIN_FARDO_SELECTION_EXAMPLE}`}
                  className="h-10 rounded-md border border-border bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {isReprint
                  ? `${labels.length} fardo(s) com selo 2ª VIA ${formatReprintStamp()}.`
                  : `${labels.length} fardo(s) · impressão completa, sem selo.`}
              </p>
            </div>
            {hasSelectionError && (
              <p className="text-sm text-destructive">Nenhum fardo corresponde a essa seleção. Use 1,5,10:15 com os números da ficha.</p>
            )}

            {current && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 px-2 disabled:opacity-40"
                    disabled={index <= 0}
                    onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  >
                    <CaretLeft className="h-4 w-4" /> Anterior
                  </button>
                  <span className="font-mono tabular-nums">
                    {Math.min(index + 1, labels.length)} / {labels.length}
                    {' · '}
                    {current.codigo}
                    {' · '}
                    {formatFardoCounter(current.ficha_index, current.total_fichas).label}
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 px-2 disabled:opacity-40"
                    disabled={index >= labels.length - 1}
                    onClick={() => setIndex((i) => Math.min(labels.length - 1, i + 1))}
                  >
                    Próximo <CaretRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="overflow-x-auto rounded-md border border-border bg-[#ece8de] p-2">
                  <canvas
                    ref={canvasRef}
                    className="mx-auto block max-w-full"
                    style={{ imageRendering: 'pixelated' }}
                    aria-label={`Prévia do par ${current.codigo}`}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
              <Button onClick={download} disabled={labels.length === 0} className="gap-2">
                <DownloadSimple className="h-4 w-4" /> Baixar .zpl
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default EtiquetaFardoElginDialog;
