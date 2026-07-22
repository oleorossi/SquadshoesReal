-- ============================================================================
-- Fase 2 da auditoria de motores — Pacote P6 (LANÇAMENTO/RECEBIMENTO/NF)
--
-- F5-09 (baixo): fechar as portas de entrada de grafia NÃO-canônica de unidade
-- que sobreviveram à normalização em massa de 2026-05-30 (mig 20260702120000):
--
--   1) tg_sync_insole_consumption_unit gravava o DEFAULT como 'dm2' (grafia
--      proibida — canônico é 'dm²'; 46 technical_sheets vivas carregam 'dm2').
--      Passa a gravar 'dm²' e a normalizar 'dm2'→'dm²' quando o valor vem do
--      cliente. (Backfill das fichas existentes NÃO é feito aqui — reparo de
--      dados fica fora de migration por regra da Fase 2; a coluna é inerte
--      hoje, nenhum motor a lê além do próprio trigger.)
--
--   2) normalize_product_unit só reescrevia SINÔNIMOS ('metros'→'m', 'chapa'→
--      'placa'…); variantes CAIXA-ALTA da própria grafia canônica passavam
--      intactas ('KG' ficava 'KG': v_norm='kg' não casa nenhum ramo e o valor
--      original era mantido — products.unit='KG' quebra comparações SQL diretas
--      unit = 'kg'). Agora TODA forma canônica casada é reescrita na grafia
--      canônica (identidade case-insensitive incluída; 'l'/'L' vira 'L').
--
--   (3ª perna do F5-09 é no frontend: UNITS sem pc/cx/rolo/chapa e
--    AddToStockDialog inicializando com unidade canonizada.)
--
-- Diff mínimo sobre as definições VIVAS (2026-07-22). Idempotente
-- (CREATE OR REPLACE), sem DML.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) tg_sync_insole_consumption_unit — default e normalização em 'dm²'
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_sync_insole_consumption_unit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_class text;
BEGIN
  IF NEW.insole_ready_made = true THEN
    NEW.insole_consumption_unit := 'un';
    RETURN NEW;
  END IF;

  IF NEW.sole_group_id IS NOT NULL THEN
    SELECT MAX(sole_classification::text) INTO v_sole_class
      FROM public.products
     WHERE category = 'Solado' AND group_id = NEW.sole_group_id;

    IF v_sole_class = 'palmilha_pronta' THEN
      NEW.insole_consumption_unit := 'un';
      IF NEW.insole_ready_made IS NULL OR NEW.insole_ready_made = false THEN
        NEW.insole_ready_made := true;
      END IF;
    ELSE
      -- F5-09: grafia CANÔNICA ('dm²', nunca 'dm2') tanto no default quanto
      -- num valor 'dm2' vindo do cliente.
      NEW.insole_consumption_unit := CASE lower(trim(COALESCE(NEW.insole_consumption_unit, '')))
        WHEN ''    THEN 'dm²'
        WHEN 'dm2' THEN 'dm²'
        ELSE NEW.insole_consumption_unit
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2) normalize_product_unit — identidade case-insensitive pro canônico
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_product_unit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
BEGIN
  IF NEW.unit IS NULL OR trim(NEW.unit) = '' THEN
    RETURN NEW;
  END IF;

  v_norm := lower(trim(NEW.unit));

  IF v_norm IN ('metros','metro','mt','mts','mtl','m linear','m. linear','m.linear','lin','m lin') THEN
    NEW.unit := 'm';
  ELSIF v_norm IN ('centimetro','centímetro','centimetros','centímetros','cm linear','cm. linear') THEN
    NEW.unit := 'cm';
  ELSIF v_norm IN ('milimetro','milímetro','milimetros','milímetros') THEN
    NEW.unit := 'mm';
  ELSIF v_norm IN ('kilo','kilos','quilo','quilos','quilograma','kilograma','quilogramas','kilogramas') THEN
    NEW.unit := 'kg';
  ELSIF v_norm IN ('grama','gramas','gr','grs') THEN
    NEW.unit := 'g';
  ELSIF v_norm IN ('litro','litros','lt','lts') THEN
    NEW.unit := 'L';
  ELSIF v_norm IN ('mililitro','mililitros') THEN
    NEW.unit := 'ml';
  ELSIF v_norm IN ('unidade','unidades','unid','unids','und','unds') THEN
    NEW.unit := 'un';
  ELSIF v_norm = 'pares' THEN
    NEW.unit := 'par';
  ELSIF v_norm IN ('milheiro','milheiros','mil') THEN
    NEW.unit := 'mil';
  ELSIF v_norm IN ('cento','centos') THEN
    NEW.unit := 'cento';
  ELSIF v_norm IN ('duzia','dúzia','duzias','dúzias','dz','dzs') THEN
    NEW.unit := 'dz';
  ELSIF v_norm IN ('m2','m^2','metro2','metros2') THEN
    NEW.unit := 'm²';
  ELSIF v_norm IN ('dm2','dm^2','decimetro2') THEN
    NEW.unit := 'dm²';
  ELSIF v_norm IN ('cm2','cm^2','centimetro2') THEN
    NEW.unit := 'cm²';
  ELSIF v_norm IN ('chapa','chapas','placas') THEN
    NEW.unit := 'placa';
  END IF;

  -- F5-09 (auditoria 2026-07): identidade CASE-INSENSITIVE — variantes de
  -- caixa da própria grafia canônica passavam intactas ('KG' ficava 'KG',
  -- 'UN' ficava 'UN'), furando o CHECK/comparações que assumem o canônico.
  -- Reescreve sempre com a forma canônica casada; unidades desconhecidas
  -- (ex.: 'CN') seguem intactas pro operador revisar — não se inventa unidade.
  v_norm := lower(trim(NEW.unit));
  IF v_norm IN ('m','cm','mm','kg','g','mg','ml','un','par','mil','cento','dz',
                'pc','cx','rl','fh','jg','m²','dm²','cm²','m³','placa') THEN
    NEW.unit := v_norm;
  ELSIF v_norm = 'l' THEN
    NEW.unit := 'L';
  END IF;

  IF NEW.purchase_order_unit IS NULL OR trim(NEW.purchase_order_unit) = '' THEN
    NEW.purchase_order_unit := NEW.unit;
  END IF;

  RETURN NEW;
END;
$function$;
