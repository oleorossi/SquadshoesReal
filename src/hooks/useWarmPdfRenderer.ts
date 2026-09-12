import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Aquece o Chromium de `/api/render-pdf` enquanto o operador ainda está na tela.
 *
 * A partida do browser custa ~2s (medido 10/08/2026) e só vale na instância
 * da MESMA função — por isso o GET bate no mesmo path do POST, não num
 * endpoint irmão. Falha é silenciosa: gerar o PDF continua funcionando,
 * só paga o cold start.
 *
 * Um GET bem-sucedido por aba do ERP. Recarregar a página tenta de novo.
 */
let warmed = false;

export function useWarmPdfRenderer() {
  useEffect(() => {
    if (warmed) return;
    let cancelled = false;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session?.access_token) return;
      const res = await fetch('/api/render-pdf', {
        method: 'GET',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!cancelled && res.ok) warmed = true;
    })().catch(() => { /* aquecimento é best-effort */ });
    return () => { cancelled = true; };
  }, []);
}
