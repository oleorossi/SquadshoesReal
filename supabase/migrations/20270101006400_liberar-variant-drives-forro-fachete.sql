-- Libera a variante de material para dirigir FORRO e FACHETE nas fichas que
-- ainda não tinham flag nenhuma. Decisão do dono em 20/08/2026.
--
-- CONTEXTO
-- `technical_sheets.variant_drives_*` é o que autoriza o MATERIAL PRINCIPAL de
-- uma variante a substituir o material da ficha em cada componente. Sem
-- nenhuma flag ligada, escolher a variante no PV muda nome/SKU/preço e NÃO muda
-- uma linha do que a produção corta — foi esse no-op silencioso que fez o
-- PV-00141 (EC23) vender NAPA SOFT e a fábrica cortar NAPA SUDANI.
--
-- MEDIÇÃO QUE ORIGINOU ESTA MIGRATION (20/08/2026)
-- Das 57 fichas, 29 tinham alguma flag e 28 não tinham nenhuma. As 29 que
-- possuem variante ativa são EXATAMENTE as 29 com flag — ou seja, ficha sem
-- flag nunca chegou a ter variante funcionando. A convenção nas 29 preparadas:
--   lining=t fachete=t upper=f .... 20 fichas  (o padrão)
--   lining=t fachete=t upper=t ....  7 fichas
--   lining=t fachete=f upper=f ....  2 fichas
-- `lining` está ligado em 29/29; `upper`, em apenas 7/29.
--
-- ⚠ `variant_drives_upper` FICA DE FORA, de propósito. É o cabedal que carrega
-- o material de identidade da referência, e entre as 28 há fichas cujo cabedal
-- NÃO pode ser substituído por napa: CONFORTO (ELÁSTICO SARJA, DUBLAGEM),
-- CONFORTO 03 (ELÁSTICO SARJA), BT01 ×2 e EC12 (Suede EVA + Cacharrel). Ligar
-- upper nelas faria uma variante de napa trocar o elástico/Suede no corte.
-- Quem quiser upper numa ficha específica liga no toggle da tela
-- (`renderVariantDrivesToggle` em `pages/TechnicalSheets.tsx`), caso a caso.
--
-- ⚠ ESCOPO restrito às fichas SEM flag nenhuma. As 29 já preparadas não são
-- tocadas — inclusive as 2 que têm `fachete` desligado de propósito.
--
-- ⚠ Efeito HOJE é nulo em 27 das 28 (elas têm zero variante) e `fachete_material`
-- está vazio nas 28, então o fachete não muda nada agora. Isto é
-- pré-autorização: vale a partir do dia em que a variante for criada.
--
-- Idempotente por construção: o predicado só casa ficha sem flag alguma, então
-- reexecutar não alcança as linhas que esta própria migration acabou de mudar.

do $$
declare
  v_alvo   integer;
  v_depois integer;
begin
  select count(*) into v_alvo
  from technical_sheets
  where not (coalesce(variant_drives_upper,   false)
          or coalesce(variant_drives_lining,  false)
          or coalesce(variant_drives_fachete, false));

  raise notice 'fichas sem flag alguma antes: %', v_alvo;

  update technical_sheets
  set variant_drives_lining  = true,
      variant_drives_fachete = true
  where not (coalesce(variant_drives_upper,   false)
          or coalesce(variant_drives_lining,  false)
          or coalesce(variant_drives_fachete, false));

  select count(*) into v_depois
  from technical_sheets
  where not (coalesce(variant_drives_upper,   false)
          or coalesce(variant_drives_lining,  false)
          or coalesce(variant_drives_fachete, false));

  if v_depois <> 0 then
    raise exception 'restaram % fichas sem flag apos o update', v_depois;
  end if;

  -- O cabedal tem que continuar exatamente onde estava: 7 fichas, as mesmas de
  -- antes. Se este número mudar, alguém ligou upper junto e a decisão do dono
  -- foi desfeita sem ninguém perceber.
  if (select count(*) from technical_sheets where coalesce(variant_drives_upper,false)) <> 7 then
    raise exception 'variant_drives_upper deixou de ser 7 fichas — esta migration nao deve ligar cabedal';
  end if;
end $$;
