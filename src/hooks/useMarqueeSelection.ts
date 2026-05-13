import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook de seleção múltipla com 3 modos compatíveis com macOS Finder:
 *
 *  1. **Marquee (caixa de arrasto)**: click+drag em espaço vazio do container
 *     desenha um retângulo; itens dentro são selecionados.
 *  2. **Modificadores no click em item**:
 *     - Click normal → seleciona só esse (limpa o resto)
 *     - Ctrl/Cmd+click → toggle individual (mantém demais)
 *     - Shift+click → seleciona range entre último clicado e atual
 *  3. **Checkbox** (você renderiza separado): chama `toggle(id)` direto.
 *
 * Uso:
 * ```tsx
 * const items = orders;
 * const sel = useMarqueeSelection(items, (o) => o.id);
 *
 * <div ref={sel.containerRef} onMouseDown={sel.onContainerMouseDown}>
 *   {items.map(o => (
 *     <div
 *       key={o.id}
 *       data-marquee-item
 *       data-marquee-id={o.id}
 *       onClick={(e) => sel.toggle(o.id, e)}
 *       className={sel.isSelected(o.id) ? 'bg-primary/5' : ''}
 *     >
 *       <Checkbox checked={sel.isSelected(o.id)} onCheckedChange={() => sel.toggle(o.id)} />
 *       {o.name}
 *     </div>
 *   ))}
 *   {sel.marqueeRect && (
 *     <div className="marquee-overlay" style={{...sel.marqueeRect}} />
 *   )}
 * </div>
 * ```
 *
 * Pra desabilitar marquee em mobile (touch): o hook só ativa em mousedown
 * (não em touchstart). Touch continua usando checkbox normalmente.
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

  /**
   * Limpa seleção quando lista de items muda materialmente (filtro,
   * paginação). Comparamos contagem + primeiro item como heurística rápida.
   */
  const itemsKey = items.length > 0 ? `${items.length}:${getId(items[0])}` : '0';
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(items.map(getId));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map(getId)));
  }, [items, getId]);

  /**
   * Toggle de item com suporte a modificadores. Pode ser chamado tanto pelo
   * onClick da linha quanto pelo onCheckedChange do checkbox.
   *   - Sem modificador: seleciona apenas esse item (single-select).
   *   - Ctrl/Cmd: toggle individual.
   *   - Shift: seleciona range entre último clicado e atual.
   */
  const toggle = useCallback(
    (id: string, e?: React.MouseEvent | React.KeyboardEvent) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const isShift = e?.shiftKey;
        const isCtrlMeta = (e as React.MouseEvent)?.ctrlKey || (e as React.MouseEvent)?.metaKey;

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
        } else if (isCtrlMeta) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else if (e === undefined) {
          // Chamada programática (ex.: checkbox controlado) → toggle simples
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          // Click normal: substitui seleção
          next.clear();
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
   * Inicia marquee em mousedown no container, desde que o click NÃO seja
   * num item nem em um botão/input/link. Botão esquerdo apenas.
   */
  const onContainerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // só left click
      const target = e.target as HTMLElement;
      // Ignora clicks em items, botões, inputs, links, labels (interativos)
      // e popovers do Radix (Select trigger/content, Combobox, Dropdown).
      // Sem esses extras, clicar no Select de status de um PV abria marquee
      // que pegava linhas adjacentes ao mover o mouse pra dentro do dropdown.
      if (
        target.closest('[data-marquee-item]') ||
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

      // Guarda seleção inicial pra Ctrl-drag (manter prévia + adicionar)
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        startSelection.current = new Set(selectedIds);
      } else {
        startSelection.current = new Set();
        setSelectedIds(new Set());
      }
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
      // Antes era 4px e isso disparava marquee acidental ao clicar no
      // Select de status de PV (Radix dropdown abrindo + mouse movendo
      // levemente pra dentro selecionava linhas adjacentes).
      if (!isDragging.current && (width > 8 || height > 8)) {
        isDragging.current = true;
      }
      if (!isDragging.current) return;

      setMarqueeRect({ left, top, width, height });

      // Detecta items dentro do retângulo
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
      startPoint.current = null;
      isDragging.current = false;
      setMarqueeRect(null);
    }

    // Anexa só quando drag está iniciando — listeners globais durante
    // toda a vida do componente seria desperdício. Aqui anexamos sempre
    // mas só agem se startPoint.current existir.
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
    isSelected,
    toggle,
    clear,
    selectAll,
    onContainerMouseDown,
    marqueeRect,
  };
}
