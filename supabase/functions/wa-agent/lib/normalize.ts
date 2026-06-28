// Normalização canônica para casar nomes/números.
//
// `suppliers.search_norm` (coluna mantida no banco) é gerada como:
//   lower-case → sem acentos → só [a-z0-9] (sem espaço/pontuação).
// Ex.: "Celina Armarinho" → "celinaarmarinho".
// Replicamos EXATAMENTE essa forma aqui para comparar o nome extraído da
// foto/texto contra `search_norm` sem falso-negativo por grafia.

export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos (acentos combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // só letras/dígitos
}

// CNPJ → só dígitos (o banco às vezes guarda formatado "07.391.925/0001-50",
// às vezes só dígitos). Comparamos sempre por dígitos.
export function normalizeCnpj(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

// Número de WhatsApp → só dígitos (E.164 sem "+"). Tira o sufixo de JID
// (@s.whatsapp.net) e qualquer máscara.
export function normalizePhone(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
