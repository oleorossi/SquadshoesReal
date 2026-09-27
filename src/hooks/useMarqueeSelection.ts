import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Hook de seleção múltipla para listas de OP/PV (batch industrial):
 *
 *  1. **Marquee (caixa de arrasto)**: mousedown+drag sobre a lista (inclusive
 *     em cima das linhas) desenha um retângulo; itens dentro entram na seleção.
 *     Espelha `SelectionMarquee` do estoque: arrasto é **aditivo** (não apaga
 *     o que já estava marcado) e só começa após ~8px de movimento.
 *  2. **Click em item**:
 *     - Click normal → toggle individual (acumula)
 *     - Shift+click → seleciona range entre último clicado e atual
 *  3. **Checkbox** (você renderiza separado): chama `toggle(id)` direto.
 *
 * ⚠ Em tabela densa (Imprimir Fichas) NÃO se pode exigir "espaço vazio" pra
 * iniciar o arrasto — as linhas cobrem o container. Ignorar
 * `[data-marquee-item]` no mousedown fazia o marquee ser no-op e o dono
 * concluir que "não dá pra selecionar vários ao mesmo tempo".
 *
 * Contrato de persistência (2026-09): filtrar/buscar NÃO remove ids
 * selecionados que saíram da lista visível. Limpa só Esc / clear() /
 * desmontar a rota. `hiddenSelectedCount` expõe quantos estão fora da vista;
 * ações em massa devem confirmar antes de agir sobre eles.
 *
 * Uso:
 * ```tsx
 * const sel = useMarqueeSelection(visibleItems, (o) => o.id);
 * <div ref={sel.containerRef} onMouseDown={sel.onContainerMouseDown}>
 *   {visibleItems.map(o => (
 *     <div key={o.id} data-marquee-item data-marquee-id={o.id}
 *       onClick={(e) => sel.toggle(o.id, e)}>
 *       <Checkbox checked={sel.isSelected(o.id)} onCheckedChange={() => sel.toggle(o.id)} />
 *     </div>
 *   ))}
 *   {sel.marqueeRect && <MarqueeOverlay rect={sel.marqueeRect} />}
 * </div>
 * ```
 */
export function useMarqueeSelection<T>(
  items: T[],
  getId: (item: T) => string,
) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [marqueeRect, setMarqueeRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const startSelection = useRef<Set<string>>(new Set());
  const lastClickedId = useRef<string | null>(null);
  const isDragging = useRef(false);
  /** Após um arrasto real, o click sintético do browser não deve toggle-ar a linha. */
  const suppressClickRef = useRef(false);

  const visibleIdSet = useMemo(
    () => new Set(items.map(getId)),
    // items identity + length; getId is stable in practice (inline arrow
    // per render would thrash — callers pass (o) => o.id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );

  const visibleSelectedCount = useMemo(() => {
    let n = 0;
    selectedIds.forEach((id) => {
      if (visibleIdSet.has(id)) n += 1;
    });
    return n;
  }, [selectedIds, visibleIdSet]);

  const hiddenSelectedCount = selectedIds.size - visibleSelectedCount;

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const selectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of items) next.add(getId(item));
      return next;
    });
  }, [items, getId]);

  /** Remove da seleção só os ids atualmente visíveis (mantém os ocultos). */
  const deselectVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of items) next.delete(getId(item));
      return next;
    });
  }, [items, getId]);

  /** Soma ids à seleção sem limpar o que já estava marcado. */
  const selectMatchingIds = useCallback((ids: Iterable<string>) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  /**
   * Toggle de item com suporte a modificadores. Pode ser chamado tanto pelo
   * onClick da linha quanto pelo onCheckedChange do checkbox.
   *   - Sem modificador / Ctrl/Cmd / chamada sem evento: toggle individual
   *     (acumula — nunca limpa o resto).
   *   - Shift: seleciona range entre último clicado e atual.
   */
  const toggle = useCallback(
    (id: string, e?: React.MouseEvent | React.KeyboardEvent) => {
      // Click que fecha um arrasto de marquee — não é intenção de toggle.
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const isShift = e?.shiftKey;

        if (isShift && lastClickedId.current) {
          const allIds = items.map(getId);
          const lastIdx = allIds.indexOf(lastClickedId.current);
          const curIdx = allIds.indexOf(id);
          if (lastIdx !== -1 && curIdx !== -1) {
            const [from, to] = lastIdx <= curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
            for (let i = from; i <= to; i++) next.add(allIds[i]);
          } else {
            next.add(id);
          }
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      lastClickedId.current = id;
    },
    [items, getId],
  );

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  /**
   * Inicia potencial marquee em mousedown no container.
   * Pode começar EM CIMA de uma linha (tabela densa) — só ignora controles
   * interativos (checkbox, botão, select…). Não limpa a seleção no mousedown:
   * o arrasto é aditivo (igual estoque / SelectionMarquee).
   */
  const onContainerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // só left click
      const target = e.target as HTMLElement;
      // Ignora só controles interativos e popovers do Radix — NÃO ignore
      // [data-marquee-item]: em Imprimir Fichas as linhas cobrem o container
      // e o arrasto tem que poder nascer em cima delas.
      if (
        target.closest(
          'button, input, select, textarea, a, label, [role="button"], [role="checkbox"], [role="combobox"], [role="listbox"], [role="option"], [role="menuitem"], [data-radix-popper-content-wrapper], [data-state="open"]',
        )
      ) {
        return;
      }
      // Skip se qualquer popover/dropdown Radix está aberto no documento
      if (typeof document !== 'undefined' && document.querySelector('[data-state="open"][role="dialog"], [data-radix-popper-content-wrapper]')) {
        return;
      }
      if (!containerRef.current) return;

      const cRect = containerRef.current.getBoundingClientRect();
      const scrollLeft = containerRef.current.scrollLeft;
      const scrollTop = containerRef.current.scrollTop;
      startPoint.current = {
        x: e.clientX - cRect.left + scrollLeft,
        y: e.clientY - cRect.top + scrollTop,
      };
      isDragging.current = false;
      suppressClickRef.current = false;
      // Aditivo: preserva o que já estava marcado (padrão do estoque).
      startSelection.current = new Set(selectedIds);
    },
    [selectedIds],
  );

  // Listeners de mousemove/mouseup ativos só durante drag, anexados ao
  // document pra não perder o tracking quando cursor sai do container.
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!startPoint.current || !containerRef.current) return;
      const cRect = containerRef.current.getBoundingClientRect();
      const scrollLeft = containerRef.current.scrollLeft;
      const scrollTop = containerRef.current.scrollTop;
      const curX = e.clientX - cRect.left + scrollLeft;
      const curY = e.clientY - cRect.top + scrollTop;

      const left = Math.min(startPoint.current.x, curX);
      const top = Math.min(startPoint.current.y, curY);
      const width = Math.abs(curX - startPoint.current.x);
      const height = Math.abs(curY - startPoint.current.y);

      // Só ativa "modo drag" depois de movimento mínimo (8px) — evita
      // tratar single-clicks acidentais ou jitter da mão como drag.
      if (!isDragging.current && (width > 8 || height > 8)) {
        isDragging.current = true;
        suppressClickRef.current = true;
      }
      if (!isDragging.current) return;

      // Evita selecionar texto da tabela enquanto arrasta.
      e.preventDefault();

      setMarqueeRect({ left, top, width, height });

      // Detecta items dentro do retângulo (união com seleção do mousedown)
      const newSelected = new Set(startSelection.current);
      const itemEls = containerRef.current.querySelectorAll<HTMLElement>(
        '[data-marquee-item]',
      );
      const right = left + width;
      const bottom = top + height;
      itemEls.forEach((el) => {
        const id = el.getAttribute('data-marquee-id');
        if (!id) return;
        const rect = el.getBoundingClientRect();
        const elTop = rect.top - cRect.top + scrollTop;
        const elLeft = rect.left - cRect.left + scrollLeft;
        const elRight = elLeft + rect.width;
        const elBottom = elTop + rect.height;
        const intersects = !(
          right < elLeft ||
          left > elRight ||
          bottom < elTop ||
          top > elBottom
        );
        if (intersects) newSelected.add(id);
      });
      setSelectedIds(newSelected);
    }

    function handleMouseUp() {
      const wasDragging = isDragging.current;
      startPoint.current = null;
      isDragging.current = false;
      setMarqueeRect(null);
      // O click sintético do browser chega logo após o mouseup. Mantém a
      // trava só o suficiente pra esse click; se ele não vier (arrasto
      // saiu da janela), libera no timeout pra não engolir o próximo clique.
      if (wasDragging) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 80);
      }
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Escuta Esc → limpa seleção
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && selectedIds.size > 0) {
        clear();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds.size, clear]);

  return {
    containerRef,
    selectedIds,
    count: selectedIds.size,
    visibleSelectedCount,
    hiddenSelectedCount,
    isSelected,
    toggle,
    clear,
    selectAll,
    deselectVisible,
    selectMatchingIds,
    onContainerMouseDown,
    marqueeRect,
  };
}
