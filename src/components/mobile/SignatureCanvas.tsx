import { useEffect, useRef, useState } from 'react';
import { Eraser, Check } from '@phosphor-icons/react';

interface Props {
  /** Chamado quando user confirma a assinatura (botão "Confirmar"). Recebe
   *  o data URL PNG. */
  onConfirm: (dataUrl: string) => void;
  /** Chamado quando user limpa. */
  onClear?: () => void;
  /** Altura do canvas em px. Default 200. */
  height?: number;
  /** Texto do label superior. */
  label?: string;
}

/**
 * Assinatura digital via canvas — captura pointer events (touch + mouse).
 * Suporta retina via devicePixelRatio. Exporta PNG base64 (data URL) pra
 * armazenar em `sale_orders.client_signature_data_url`.
 *
 * Padrão de manufacturing traveler — vendedor confirma com cliente in
 * loco, foto/assinatura vira evidência caso haja disputa depois.
 */
export const SignatureCanvas = ({ onConfirm, onClear, height = 200, label = 'Assinatura do cliente' }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasStrokes, setHasStrokes] = useState(false);
  const isDrawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Configura canvas (retina-aware) + listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const setup = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#000';
    };
    setup();

    const getPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleDown = (e: PointerEvent) => {
      e.preventDefault();
      isDrawing.current = true;
      last.current = getPos(e);
      canvas.setPointerCapture(e.pointerId);
    };
    const handleMove = (e: PointerEvent) => {
      if (!isDrawing.current || !last.current) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      last.current = pos;
      if (!hasStrokes) setHasStrokes(true);
    };
    const handleUp = (e: PointerEvent) => {
      isDrawing.current = false;
      last.current = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    };

    canvas.addEventListener('pointerdown', handleDown);
    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('pointerup', handleUp);
    canvas.addEventListener('pointercancel', handleUp);
    canvas.addEventListener('pointerleave', handleUp);

    return () => {
      canvas.removeEventListener('pointerdown', handleDown);
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('pointerup', handleUp);
      canvas.removeEventListener('pointercancel', handleUp);
      canvas.removeEventListener('pointerleave', handleUp);
    };
  }, [hasStrokes]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    onClear?.();
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    onConfirm(canvas.toDataURL('image/png'));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
          {label}
        </span>
        <button
          onClick={handleClear}
          disabled={!hasStrokes}
          className="text-xs text-muted-foreground disabled:opacity-30 flex items-center gap-1"
        >
          <Eraser className="h-3.5 w-3.5" />
          Limpar
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ height: `${height}px`, width: '100%', touchAction: 'none', background: '#fff' }}
        className="border-[1.5px] border-dashed border-foreground/30 rounded-lg block cursor-crosshair"
      />
      <button
        onClick={handleConfirm}
        disabled={!hasStrokes}
        className="w-full bg-foreground text-background rounded-lg py-2.5 font-bold uppercase tracking-wide text-sm disabled:opacity-30 flex items-center justify-center gap-2"
      >
        <Check className="h-4 w-4" weight="bold" />
        Confirmar assinatura
      </button>
    </div>
  );
};
