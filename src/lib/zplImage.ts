/**
 * Foto → bitmap 1 bit → ZPL, e o MESMO bitmap de volta pra prévia.
 *
 * Por que 1 bit: a Elgin L42 Pro Full é térmica direta. A agulha queima ou não
 * queima — não existe cinza. A foto que hoje sai pela rota HTML JÁ é reduzida a
 * preto-e-branco pelo driver na hora de imprimir; a prévia colorida da tela
 * nunca foi o que o papel recebe. Fazendo a redução aqui, o resultado físico é
 * o mesmo e a prévia passa a mostrar exatamente os pixels que serão queimados.
 *
 * Por que ~DG + ^XG e não ^GFA por etiqueta: em 203 dpi uma moldura de 20×22 mm
 * dá 160×176 dots = 3.520 bytes crus, ~6,9 KB em hex. Repetir isso em cada
 * etiqueta poria 7,6 MB num lote de 1.136 — pior que o HTML que se quer
 * substituir. Com ~DG a imagem é gravada UMA vez na memória da impressora e
 * cada etiqueta só a chama com ^XG: 48 KB para as 7 fotos distintas do lote.
 *
 * O núcleo aqui é puro (recebe pixels, devolve bytes) justamente pra ser
 * testável sem DOM; só `loadImageAsMonochrome` toca canvas.
 */

/** Bitmap 1 bit no formato que o ZPL espera: linhas alinhadas em byte, bit 1 = ponto queimado. */
export interface MonoBitmap {
  widthDots: number;
  heightDots: number;
  /** Bytes por linha — ZPL exige linha alinhada em byte, com o resto preenchido de zero. */
  rowBytes: number;
  bits: Uint8Array;
}

/** Só o que precisamos de um ImageData — permite montar o caso de teste na mão. */
export interface RgbaPixels {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

const LUM_R = 0.299, LUM_G = 0.587, LUM_B = 0.114;

/**
 * Floyd–Steinberg. Sem difusão de erro uma foto de calçado em 1 bit vira uma
 * silhueta chapada — o dithering é o que preserva volume e textura no tamanho
 * de 20 mm.
 *
 * `threshold` = 128 no meio da escala. Pixel transparente conta como BRANCO
 * (não queima): PNG de produto costuma vir com fundo alpha 0, e tratá-lo como
 * preto encheria a etiqueta de tinta.
 */
export function ditherToMonochrome(
  pixels: RgbaPixels,
  { threshold = 128 }: { threshold?: number } = {},
): MonoBitmap {
  const { width, height, data } = pixels;
  if (width <= 0 || height <= 0) {
    return { widthDots: 0, heightDots: 0, rowBytes: 0, bits: new Uint8Array(0) };
  }

  // Escala de cinza em Float32 pra difundir o erro sem estourar em 0..255.
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const a = data[i * 4 + 3] / 255;
    const lum = LUM_R * r + LUM_G * g + LUM_B * b;
    gray[i] = lum * a + 255 * (1 - a); // alpha 0 → branco
  }

  const rowBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(rowBytes * height);

  const spill = (idx: number, err: number, factor: number) => {
    gray[idx] += (err * factor) / 16;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = gray[i];
      const isBlack = old < threshold;
      const next = isBlack ? 0 : 255;
      const err = old - next;

      if (isBlack) {
        // bit mais significativo = pixel mais à esquerda (convenção do ZPL)
        bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }

      if (x + 1 < width) spill(i + 1, err, 7);
      if (y + 1 < height) {
        if (x > 0) spill(i + width - 1, err, 3);
        spill(i + width, err, 5);
        if (x + 1 < width) spill(i + width + 1, err, 1);
      }
    }
  }

  return { widthDots: width, heightDots: height, rowBytes, bits };
}

/**
 * Comando ~DG: grava o bitmap na RAM da impressora sob `R:<nome>.GRF`.
 *
 * ⚠ O nome vai numa allow-list de A–Z e 0–9, no máximo 8 caracteres. É o
 * identificador de um comando ZPL — caractere fora disso não é "nome feio",
 * é comando malformado que faz a impressora engasgar no lote inteiro.
 */
export function zplGraphicName(raw: string): string {
  const clean = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (clean || 'IMG').slice(0, 8);
}

export function monoToZplDownloadGraphic(name: string, mono: MonoBitmap): string {
  if (mono.widthDots <= 0 || mono.heightDots <= 0) return '';
  const total = mono.rowBytes * mono.heightDots;
  let hex = '';
  for (let i = 0; i < mono.bits.length; i++) {
    hex += mono.bits[i].toString(16).padStart(2, '0').toUpperCase();
  }
  return `~DGR:${zplGraphicName(name)}.GRF,${total},${mono.rowBytes},${hex}`;
}

/** Chamada da imagem já gravada, posicionada em dots. */
export function zplRecallGraphic(name: string, x: number, y: number): string {
  return `^FO${Math.round(x)},${Math.round(y)}^XGR:${zplGraphicName(name)}.GRF,1,1^FS`;
}

/**
 * Bitmap → RGBA, pra prévia desenhar no canvas os MESMOS pontos que o ~DG
 * carrega. É esta função que faz a prévia ser prova, e não ilustração.
 */
export function monoToRgba(mono: MonoBitmap): { data: Uint8ClampedArray; width: number; height: number } {
  const { widthDots: w, heightDots: h, rowBytes, bits } = mono;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = (bits[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
      const v = on ? 0 : 255;
      const o = (y * w + x) * 4;
      out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** mm → dots na resolução da etiquetadora (203 dpi nas Elgin L42/VOX). */
export function mmToDots(mm: number, dpi = 203): number {
  return Math.round((mm * dpi) / 25.4);
}

/**
 * Carrega a URL, encaixa em widthDots×heightDots preservando proporção (fundo
 * branco) e devolve o bitmap 1 bit. Devolve null quando a imagem não carrega ou
 * o canvas fica tainted.
 *
 * ⚠ `crossOrigin = 'anonymous'` é obrigatório: sem ele o canvas é marcado como
 * tainted e `getImageData` estoura em SecurityError. As fotos vêm do storage do
 * Supabase, que responde `access-control-allow-origin: *` (verificado
 * 22/08/2026), então a leitura é permitida — mas a flag precisa estar lá antes
 * do `src`, senão o navegador nem pede CORS.
 *
 * Devolver null em vez de estourar é deliberado: uma foto que não carrega deve
 * gerar etiqueta SEM foto e um aviso, nunca derrubar o lote inteiro.
 */
export async function loadImageAsMonochrome(
  url: string,
  widthDots: number,
  heightDots: number,
): Promise<MonoBitmap | null> {
  if (!url || widthDots <= 0 || heightDots <= 0) return null;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('load'));
      el.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = widthDots;
    canvas.height = heightDots;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, widthDots, heightDots);

    // "contain": a foto inteira cabe na moldura, sem cortar nem distorcer.
    const scale = Math.min(widthDots / img.naturalWidth, heightDots / img.naturalHeight);
    const dw = Math.max(1, Math.round(img.naturalWidth * scale));
    const dh = Math.max(1, Math.round(img.naturalHeight * scale));
    ctx.drawImage(img, Math.round((widthDots - dw) / 2), Math.round((heightDots - dh) / 2), dw, dh);

    return ditherToMonochrome(ctx.getImageData(0, 0, widthDots, heightDots));
  } catch {
    return null; // rede, 404 ou canvas tainted — o chamador emite sem foto
  }
}
