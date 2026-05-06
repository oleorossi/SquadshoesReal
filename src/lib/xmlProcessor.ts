export const parseNFSeXML = async (file: File) => {
  const text = await file.text();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "text/xml");

  // Busca os itens da nota (tags padrão da NF-e brasileira)
  const detTags = xmlDoc.getElementsByTagName("det");
  const produtos = [];

  for (let i = 0; i < detTags.length; i++) {
    const prod = detTags[i].getElementsByTagName("prod")[0];
    if (prod) {
      produtos.push({
        sku: prod.getElementsByTagName("cProd")[0]?.textContent || "",
        nome: prod.getElementsByTagName("xProd")[0]?.textContent || "",
        ncm: prod.getElementsByTagName("NCM")[0]?.textContent || "",
        quantidade: parseFloat(prod.getElementsByTagName("qCom")[0]?.textContent || "0"),
        valorUnitario: parseFloat(prod.getElementsByTagName("vUnCom")[0]?.textContent || "0"),
        unidade: prod.getElementsByTagName("uCom")[0]?.textContent || "",
      });
    }
  }

  return produtos;
};
