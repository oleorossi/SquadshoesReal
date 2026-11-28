import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Barcode, Camera, Keyboard, MagnifyingGlass, Warning, CircleNotch as Loader2, User, X } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatFardoCounter, normalizeFichaCartaoCodigo } from '@/lib/etiquetaFardoElgin';

export interface BiparFardoResult {
  id: string;
  codigo: string;
  ficha_index: number;
  total_fichas: number;
  pares: number;
  pv: string;
  op: string;
  modelo: string;
  cor: string;
  grade: Record<string, number>;
  sizes: string[];
  montadorId: string | null;
  montadorNome: string | null;
}

export interface BiparMontadorOption {
  id: string;
  name: string;
  role?: string | null;
  department?: string | null;
  preferred?: boolean;
}

type CameraError = 'camera' | 'nosupport' | null;

export interface BiparFardoViewProps {
  codeInput: string;
  onCodeInput: (value: string) => void;
  onSubmitCode: () => void;
  lookingUp?: boolean;
  scanning: boolean;
  onStartScan: () => void;
  onStopScan: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraError: CameraError;
  result: BiparFardoResult | null;
  notFound: string | null;
  picking: boolean;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  montadores: BiparMontadorOption[];
  montadorQuery: string;
  onMontadorQuery: (value: string) => void;
  onPickMontador: (id: string | null) => void;
  linking?: boolean;
}

function gradeSizes(grade: Record<string, number>): string[] {
  return Object.keys(grade).sort((a, b) => Number(a) - Number(b));
}

export function BiparFardoView({
  codeInput, onCodeInput, onSubmitCode, lookingUp, scanning, onStartScan, onStopScan,
  videoRef, cameraError, result, notFound, picking, onOpenPicker, onClosePicker,
  montadores, montadorQuery, onMontadorQuery, onPickMontador, linking,
}: BiparFardoViewProps) {
  const hidRef = useRef<HTMLInputElement | null>(null);
  const counter = result ? formatFardoCounter(result.ficha_index, result.total_fichas) : null;
  const sizes = result ? (result.sizes.length ? result.sizes : gradeSizes(result.grade)) : [];

  useEffect(() => {
    if (!scanning && !picking) hidRef.current?.focus();
  }, [scanning, picking, result]);

  const filtered = useMemo(() => {
    const q = montadorQuery.trim().toLowerCase();
    const list = [...montadores].sort((a, b) => {
      if (Boolean(a.preferred) !== Boolean(b.preferred)) return a.preferred ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    if (!q) return list;
    return list.filter((m) => [m.name, m.role, m.department].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [montadores, montadorQuery]);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col gap-4 px-4 pb-8 pt-4">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Palmilha · Montador</p>
        <h1 className="flex items-center gap-2 text-2xl font-bold leading-tight">
          <Barcode className="h-7 w-7" weight="bold" /> Bipar fardo
        </h1>
        <p className="text-sm text-muted-foreground">
          As duas metades têm o mesmo código. Bipar qualquer uma mostra o pedido, a grade e o montador vinculado.
        </p>
      </header>

      <button
        type="button"
        onClick={onStartScan}
        className="flex h-16 w-full items-center justify-center gap-3 rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-sm active:scale-[0.99]"
      >
        <Camera className="h-7 w-7" weight="bold" /> Bipar
      </button>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmitCode();
        }}
      >
        <label className="flex items-center gap-2 text-sm font-semibold" htmlFor="bipar-codigo">
          <Keyboard className="h-4 w-4" /> Código ou leitor USB
        </label>
        <div className="flex gap-2">
          <input
            ref={hidRef}
            id="bipar-codigo"
            value={codeInput}
            onChange={(e) => onCodeInput(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            inputMode="text"
            placeholder="PM-000001"
            className="h-14 flex-1 rounded-xl border-2 border-border bg-background px-4 font-mono text-xl tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={lookingUp}
            className="h-14 min-w-14 rounded-xl border-2 border-border px-4 font-semibold active:bg-muted"
          >
            {lookingUp ? <Loader2 className="h-5 w-5 animate-spin" /> : 'OK'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          O leitor USB ou Bluetooth entra neste campo. Deixe o cursor aqui e bipar — o Enter confirma.
        </p>
      </form>

      {notFound && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-base">
          <p className="font-semibold">Código não encontrado</p>
          <p className="mt-1 font-mono text-xl">{notFound}</p>
          <p className="mt-2 text-sm text-muted-foreground">Confira se as etiquetas deste fardo já foram geradas na ficha de operador.</p>
        </div>
      )}

      {result && !picking && (
        <section className="space-y-4 rounded-2xl border-2 border-border bg-background p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fardo</p>
              <p className="font-mono text-6xl font-bold leading-none tabular-nums">{counter?.main}</p>
              <p className="font-mono text-2xl text-muted-foreground">{counter?.rest}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Código</p>
              <p className="font-mono text-xl font-bold">{result.codigo}</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-base">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Pedido</dt>
              <dd className="text-2xl font-bold leading-tight">{result.pv || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">OP</dt>
              <dd className="text-lg font-semibold leading-tight">{result.op || '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Modelo e cor</dt>
              <dd className="text-2xl font-bold leading-tight">{[result.modelo, result.cor].filter(Boolean).join(' · ') || '—'}</dd>
            </div>
          </dl>
          {sizes.length > 0 && (
            <table className="w-full table-fixed border-collapse text-center">
              <thead>
                <tr>
                  {sizes.map((s) => (
                    <th key={s} className="border border-border bg-muted/60 py-1 text-xs font-semibold">{s}</th>
                  ))}
                  <th className="border border-border bg-foreground py-1 text-xs font-semibold text-background">T</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {sizes.map((s) => (
                    <td key={s} className="border border-border py-2 font-mono text-xl font-bold tabular-nums">{result.grade[s] ?? 0}</td>
                  ))}
                  <td className="border border-border bg-foreground py-2 font-mono text-xl font-bold tabular-nums text-background">{result.pares}</td>
                </tr>
              </tbody>
            </table>
          )}
          <div className="rounded-xl border border-border p-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <User className="h-4 w-4" /> Montador vinculado
            </p>
            <p className="mt-1 text-2xl font-bold leading-tight">
              {result.montadorNome || 'Ainda não vinculado'}
            </p>
            <button
              type="button"
              onClick={onOpenPicker}
              className="mt-3 flex h-14 w-full items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground"
            >
              {result.montadorId ? 'Trocar montador' : 'Vincular montador'}
            </button>
          </div>
        </section>
      )}

      {scanning && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-base font-semibold">Aponte para o Code128</p>
            <button type="button" onClick={onStopScan} className="flex h-12 items-center gap-2 rounded-lg px-3 text-base font-semibold">
              <X className="h-6 w-6" /> Fechar
            </button>
          </div>
          <div className="relative flex-1">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
            <div className="pointer-events-none absolute inset-x-8 top-1/3 h-24 rounded-lg border-2 border-white/80" />
          </div>
          {cameraError && (
            <div className="m-4 flex gap-2 rounded-lg bg-amber-500/20 p-3 text-sm text-amber-100">
              <Warning className="h-5 w-5 shrink-0" />
              {cameraError === 'nosupport'
                ? 'Não deu pra carregar o leitor da câmera. Use o campo de código ou um leitor USB.'
                : 'Sem acesso à câmera. Libere a permissão do navegador ou use o campo de código.'}
            </div>
          )}
        </div>
      )}

      {picking && result && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <button type="button" onClick={onClosePicker} className="flex h-12 w-12 items-center justify-center rounded-lg">
              <X className="h-6 w-6" />
            </button>
            <h2 className="text-lg font-bold">Escolher montador</h2>
          </div>
          <div className="px-4 pt-3">
            <label className="sr-only" htmlFor="busca-montador">Buscar montador</label>
            <div className="relative">
              <MagnifyingGlass className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                id="busca-montador"
                value={montadorQuery}
                onChange={(e) => onMontadorQuery(e.target.value)}
                placeholder="Buscar pelo nome"
                className="h-14 w-full rounded-xl border-2 border-border bg-background pl-11 pr-3 text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                autoFocus
              />
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto px-4 py-3">
            <li>
              <button
                type="button"
                disabled={linking}
                onClick={() => onPickMontador(null)}
                className="flex min-h-14 w-full items-center rounded-xl px-3 text-left text-base text-muted-foreground active:bg-muted"
              >
                Remover vínculo
              </button>
            </li>
            {filtered.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={linking}
                  onClick={() => onPickMontador(m.id)}
                  className={`flex min-h-16 w-full flex-col justify-center rounded-xl px-3 text-left active:bg-muted ${m.id === result.montadorId ? 'bg-primary/10' : ''}`}
                >
                  <span className="text-xl font-semibold leading-tight">{m.name}</span>
                  {(m.role || m.department) && (
                    <span className="text-sm text-muted-foreground">{[m.role, m.department].filter(Boolean).join(' · ')}</span>
                  )}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-muted-foreground">Nenhum montador com esse nome.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

type DetectorCtor = new (opts: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue?: string }>> };

async function startCameraScan(
  video: HTMLVideoElement,
  onDetect: (raw: string) => void,
  onError: (err: CameraError) => void,
): Promise<() => void> {
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let zxingReset: (() => void) | null = null;
  const fire = (raw: string) => {
    const text = raw.trim();
    if (!text || stopped) return;
    stopped = true;
    onDetect(text);
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch {
    onError('camera');
    return () => undefined;
  }

  const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  let detector: InstanceType<DetectorCtor> | null = null;
  if (Detector) {
    try { detector = new Detector({ formats: ['code_128'] }); } catch { detector = null; }
  }

  if (detector) {
    timer = setInterval(async () => {
      if (stopped || !video) return;
      try {
        const codes = await detector!.detect(video);
        const raw = codes?.[0]?.rawValue;
        if (raw) fire(raw);
      } catch { /* frame ainda não pronto */ }
    }, 250);
  } else {
    try {
      const zxing = await import('@zxing/browser');
      const library = await import('@zxing/library');
      const hints = new Map();
      hints.set(library.DecodeHintType.POSSIBLE_FORMATS, [zxing.BarcodeFormat.CODE_128]);
      const reader = new zxing.BrowserMultiFormatReader(hints);
      const controls = await reader.decodeFromVideoElement(video, (res) => {
        const text = res?.getText?.();
        if (text) fire(text);
      });
      zxingReset = () => {
        try { controls?.stop(); } catch { /* already stopped */ }
        try { reader.reset(); } catch { /* already reset */ }
      };
    } catch {
      onError('nosupport');
    }
  }

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    zxingReset?.();
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

type CartaoLookup = {
  id: string;
  codigo: string;
  order_id: string;
  op_number: string | null;
  sales_order_number: string | null;
  ficha_index: number;
  total_fichas: number;
  pares: number;
  grade_json: Record<string, number> | null;
  montador_id: string | null;
};

async function lookupCartao(codigo: string): Promise<BiparFardoResult | null> {
  const db = supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
      update?: (vals: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
  const { data, error } = await db.from('ficha_cartoes').select(
    'id, codigo, order_id, op_number, sales_order_number, ficha_index, total_fichas, pares, grade_json, montador_id',
  ).eq('codigo', codigo).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as CartaoLookup;

  let pv = row.sales_order_number || '';
  let op = row.op_number || '';
  let modelo = '';
  let cor = '';
  let grade = row.grade_json && Object.keys(row.grade_json).length > 0 ? row.grade_json : {};
  let montadorNome: string | null = null;

  const { data: order } = await (supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
        };
      };
    };
  }).from('orders').select('order_number, color, grade, sale_order_id, reference_id').eq('id', row.order_id).maybeSingle();

  if (order) {
    op = op || String(order.order_number || '');
    cor = String(order.color || '');
    if ((!grade || Object.keys(grade).length === 0) && order.grade && typeof order.grade === 'object') {
      grade = order.grade as Record<string, number>;
    }
    if (order.sale_order_id) {
      const { data: so } = await (supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: { order_number?: string } | null; error: unknown }>;
            };
          };
        };
      }).from('sale_orders').select('order_number').eq('id', String(order.sale_order_id)).maybeSingle();
      pv = pv || so?.order_number || '';
    }
    if (order.reference_id) {
      const { data: ts } = await (supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: { code?: string; name?: string } | null; error: unknown }>;
            };
          };
        };
      }).from('technical_sheets').select('code, name').eq('id', String(order.reference_id)).maybeSingle();
      modelo = ts?.code || ts?.name || '';
    }
  }

  if (row.montador_id) {
    const { data: emp } = await (supabase as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: { name?: string } | null; error: unknown }>;
          };
        };
      };
    }).from('employees').select('name').eq('id', row.montador_id).maybeSingle();
    montadorNome = emp?.name || null;
  }

  return {
    id: row.id,
    codigo: row.codigo,
    ficha_index: row.ficha_index,
    total_fichas: row.total_fichas,
    pares: row.pares,
    pv,
    op,
    modelo,
    cor,
    grade,
    sizes: gradeSizes(grade),
    montadorId: row.montador_id,
    montadorNome,
  };
}

export default function BiparFardo() {
  const queryClient = useQueryClient();
  const [codeInput, setCodeInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<CameraError>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [result, setResult] = useState<BiparFardoResult | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [montadorQuery, setMontadorQuery] = useState('');
  const [linking, setLinking] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const montadoresQuery = useQuery({
    queryKey: ['bipar-fardo', 'montadores'],
    queryFn: async (): Promise<BiparMontadorOption[]> => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, role, department, payment_type, active')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []).map((e) => {
        const blob = `${e.role || ''} ${e.department || ''}`.toLowerCase();
        const preferred = e.payment_type === 'producao' || /montag/.test(blob);
        return { id: e.id, name: e.name, role: e.role, department: e.department, preferred };
      });
    },
  });

  const stopScan = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setScanning(false);
  }, []);

  const lookup = useCallback(async (raw: string) => {
    const codigo = normalizeFichaCartaoCodigo(raw);
    if (!codigo) {
      toast.error('Esse código não parece um PM. Ex.: PM-000001');
      return;
    }
    setLookingUp(true);
    setNotFound(null);
    try {
      const found = await lookupCartao(codigo);
      if (!found) {
        setResult(null);
        setNotFound(codigo);
        return;
      }
      setResult(found);
      setCodeInput(found.codigo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao consultar o código');
    } finally {
      setLookingUp(false);
    }
  }, []);

  const startScan = useCallback(async () => {
    setCameraError(null);
    setScanning(true);
    // o vídeo só existe depois do render do overlay
    requestAnimationFrame(async () => {
      const video = videoRef.current;
      if (!video) {
        setCameraError('nosupport');
        return;
      }
      stopRef.current = await startCameraScan(
        video,
        (raw) => {
          stopScan();
          setCodeInput(raw);
          void lookup(raw);
        },
        (err) => setCameraError(err),
      );
    });
  }, [lookup, stopScan]);

  useEffect(() => () => { stopRef.current?.(); }, []);

  const pickMontador = useCallback(async (id: string | null) => {
    if (!result) return;
    setLinking(true);
    try {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          update: (values: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
          };
        };
      }).from('ficha_cartoes').update({ montador_id: id }).eq('id', result.id);
      if (error) throw error;
      const nome = id ? (montadoresQuery.data || []).find((m) => m.id === id)?.name || null : null;
      setResult({ ...result, montadorId: id, montadorNome: nome });
      setPicking(false);
      toast.success(id ? `Montador vinculado: ${nome}` : 'Vínculo removido');
      void queryClient.invalidateQueries({ queryKey: ['ficha_cartoes'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não deu pra vincular o montador');
    } finally {
      setLinking(false);
    }
  }, [result, montadoresQuery.data, queryClient]);

  return (
    <BiparFardoView
      codeInput={codeInput}
      onCodeInput={setCodeInput}
      onSubmitCode={() => { void lookup(codeInput); }}
      lookingUp={lookingUp}
      scanning={scanning}
      onStartScan={() => { void startScan(); }}
      onStopScan={stopScan}
      videoRef={videoRef}
      cameraError={cameraError}
      result={result}
      notFound={notFound}
      picking={picking}
      onOpenPicker={() => { setMontadorQuery(''); setPicking(true); }}
      onClosePicker={() => setPicking(false)}
      montadores={montadoresQuery.data || []}
      montadorQuery={montadorQuery}
      onMontadorQuery={setMontadorQuery}
      onPickMontador={(id) => { void pickMontador(id); }}
      linking={linking}
    />
  );
}
