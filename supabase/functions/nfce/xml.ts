// Montagem do XML da NFC-e (modelo 65, layout 4.00).
// O XML é gerado já na forma canônica (sem espaços, tags vazias expandidas),
// o que permite calcular a assinatura sem biblioteca de canonicalização.

export const NS_NFE = "http://www.portalfiscal.inf.br/nfe";

export const UF_CODIGO: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23",
  RN: "24", PB: "25", PE: "26", AL: "27", SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35",
  PR: "41", SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};

export const TEXTO_HOMOLOGACAO = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

export interface Emitente {
  cnpj: string; ie: string; razao_social: string; nome_fantasia?: string | null; crt: number;
  uf: string; municipio_ibge: string;
  endereco: { logradouro: string; numero: string; bairro: string; municipio: string; cep: string; fone?: string };
}
export interface ItemNota {
  codigo: string; ean?: string | null; descricao: string; ncm: string; cest?: string | null; cfop: string;
  unidade: string; quantidade: number; valor_unitario: number; desconto: number;
  origem: number; csosn?: string | null; cst_icms?: string | null;
}
export interface PagamentoNota { forma: string; valor: number }
export interface DadosNota {
  emitente: Emitente; ambiente: 1 | 2; serie: number; numero: number; codigo_numerico: string;
  emissao: Date; itens: ItemNota[]; pagamentos: PagamentoNota[]; troco: number;
  cpf_cnpj_consumidor?: string | null; informacoes?: string | null;
}

// Texto seguro para XML (forma canônica)
export function txt(v: unknown, max = 120): string {
  const s = String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const n2 = (v: number) => v.toFixed(2);
const n4 = (v: number) => v.toFixed(4);
const n10 = (v: number) => v.toFixed(10);
const tag = (nome: string, valor: string) => `<${nome}>${valor}</${nome}>`;
const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function digitoChave(chave43: string): number {
  let peso = 2, soma = 0;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

// Data no formato AAAA-MM-DDThh:mm:ss-03:00 (horário de Brasília)
export function dataHoraBrasilia(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3600 * 1000);
  return local.toISOString().slice(0, 19) + "-03:00";
}

export function montarChave(d: DadosNota, tpEmis = 1) {
  const cUF = UF_CODIGO[d.emitente.uf];
  if (!cUF) throw new Error("UF do emitente inválida");
  const aamm = dataHoraBrasilia(d.emissao).slice(2, 7).replace("-", "");
  const base = cUF + aamm + so(d.emitente.cnpj).padStart(14, "0") + "65" +
    String(d.serie).padStart(3, "0") + String(d.numero).padStart(9, "0") + String(tpEmis) +
    d.codigo_numerico.padStart(8, "0");
  if (base.length !== 43) throw new Error("Chave de acesso com tamanho inválido");
  const dv = digitoChave(base);
  return { chave: base + dv, dv, cUF };
}

// Código do meio de pagamento (tabela tPag)
const T_PAG: Record<string, string> = { dinheiro: "01", credito: "03", debito: "04", crediario: "05", pix: "17", outro: "99" };

export function montarInfNFe(d: DadosNota) {
  const { chave, dv, cUF } = montarChave(d);
  const e = d.emitente;
  const homolog = d.ambiente === 2;

  const ide =
    tag("cUF", cUF) + tag("cNF", d.codigo_numerico.padStart(8, "0")) + tag("natOp", "VENDA") +
    tag("mod", "65") + tag("serie", String(d.serie)) + tag("nNF", String(d.numero)) +
    tag("dhEmi", dataHoraBrasilia(d.emissao)) + tag("tpNF", "1") + tag("idDest", "1") +
    tag("cMunFG", so(e.municipio_ibge)) + tag("tpImp", "4") + tag("tpEmis", "1") + tag("cDV", String(dv)) +
    tag("tpAmb", String(d.ambiente)) + tag("finNFe", "1") + tag("indFinal", "1") + tag("indPres", "1") +
    tag("procEmi", "0") + tag("verProc", "PDV Comercial 1.0");

  const fone = so(e.endereco.fone);
  const emit =
    tag("CNPJ", so(e.cnpj)) + tag("xNome", txt(e.razao_social, 60)) +
    (e.nome_fantasia ? tag("xFant", txt(e.nome_fantasia, 60)) : "") +
    tag("enderEmit",
      tag("xLgr", txt(e.endereco.logradouro, 60)) + tag("nro", txt(e.endereco.numero || "SN", 60)) +
      tag("xBairro", txt(e.endereco.bairro, 60)) + tag("cMun", so(e.municipio_ibge)) +
      tag("xMun", txt(e.endereco.municipio, 60)) + tag("UF", e.uf) + tag("CEP", so(e.endereco.cep)) +
      tag("cPais", "1058") + tag("xPais", "BRASIL") + (fone.length >= 6 ? tag("fone", fone) : "")) +
    tag("IE", so(e.ie)) + tag("CRT", String(e.crt));

  let dest = "";
  const doc = so(d.cpf_cnpj_consumidor);
  if (doc.length === 11 || doc.length === 14) {
    dest = tag("dest",
      tag(doc.length === 11 ? "CPF" : "CNPJ", doc) +
      (homolog ? tag("xNome", TEXTO_HOMOLOGACAO) : "") +
      tag("indIEDest", "9"));
  }

  let vProd = 0, vDesc = 0;
  const dets = d.itens.map((it, i) => {
    const bruto = arred(it.quantidade * it.valor_unitario);
    vProd += bruto; vDesc += it.desconto;
    const gtin = /^\d{8}$|^\d{12,14}$/.test(it.ean ?? "") ? it.ean! : "SEM GTIN";
    const descricao = homolog && i === 0 ? TEXTO_HOMOLOGACAO : txt(it.descricao, 120);
    const ncm = so(it.ncm);
    if (ncm.length !== 8) throw new Error(`NCM inválido no produto "${it.descricao}"`);
    const prod =
      tag("cProd", txt(it.codigo, 60)) + tag("cEAN", gtin) + tag("xProd", descricao) + tag("NCM", ncm) +
      (it.cest ? tag("CEST", so(it.cest)) : "") + tag("CFOP", so(it.cfop)) + tag("uCom", txt(it.unidade, 6)) +
      tag("qCom", n4(it.quantidade)) + tag("vUnCom", n10(it.valor_unitario)) + tag("vProd", n2(bruto)) +
      tag("cEANTrib", gtin) + tag("uTrib", txt(it.unidade, 6)) + tag("qTrib", n4(it.quantidade)) +
      tag("vUnTrib", n10(it.valor_unitario)) + (it.desconto > 0 ? tag("vDesc", n2(it.desconto)) : "") +
      tag("indTot", "1");

    let icms: string;
    if (e.crt === 1 || e.crt === 4) {
      const csosn = it.csosn || "102";
      if (!["102", "103", "300", "400", "500"].includes(csosn)) throw new Error(`CSOSN ${csosn} ainda não suportado na NFC-e`);
      const grupo = csosn === "500" ? "ICMSSN500" : "ICMSSN102";
      icms = tag(grupo, tag("orig", String(it.origem)) + tag("CSOSN", csosn));
    } else {
      const cst = it.cst_icms || "41";
      if (!["40", "41", "50", "60"].includes(cst)) throw new Error(`CST ${cst} ainda não suportado na NFC-e`);
      icms = tag(cst === "60" ? "ICMS60" : "ICMS40", tag("orig", String(it.origem)) + tag("CST", cst));
    }
    const pis = tag("PIS", tag("PISOutr", tag("CST", "99") + tag("vBC", "0.00") + tag("pPIS", "0.0000") + tag("vPIS", "0.00")));
    const cofins = tag("COFINS", tag("COFINSOutr", tag("CST", "99") + tag("vBC", "0.00") + tag("pCOFINS", "0.0000") + tag("vCOFINS", "0.00")));
    return `<det nItem="${i + 1}">` + tag("prod", prod) + tag("imposto", tag("ICMS", icms) + pis + cofins) + `</det>`;
  }).join("");

  vProd = arred(vProd); vDesc = arred(vDesc);
  const vNF = arred(vProd - vDesc);
  const z = "0.00";
  const total = tag("total", tag("ICMSTot",
    tag("vBC", z) + tag("vICMS", z) + tag("vICMSDeson", z) + tag("vFCP", z) + tag("vBCST", z) + tag("vST", z) +
    tag("vFCPST", z) + tag("vFCPSTRet", z) + tag("vProd", n2(vProd)) + tag("vFrete", z) + tag("vSeg", z) +
    tag("vDesc", n2(vDesc)) + tag("vII", z) + tag("vIPI", z) + tag("vIPIDevol", z) + tag("vPIS", z) +
    tag("vCOFINS", z) + tag("vOutro", z) + tag("vNF", n2(vNF))));

  const pag = tag("pag", d.pagamentos.map((p) => {
    const t = T_PAG[p.forma] ?? "99";
    return tag("detPag",
      tag("tPag", t) + (t === "99" ? tag("xPag", "Outros") : "") + tag("vPag", n2(p.valor)) +
      (t === "03" || t === "04" ? tag("card", tag("tpIntegra", "2")) : ""));
  }).join("") + (d.troco > 0 ? tag("vTroco", n2(d.troco)) : ""));

  const infAdic = d.informacoes ? tag("infAdic", tag("infCpl", txt(d.informacoes, 2000))) : "";

  const corpo = tag("ide", ide) + tag("emit", emit) + dest + dets + total +
    tag("transp", tag("modFrete", "9")) + pag + infAdic;

  // Atributos em ordem canônica: Id antes de versao
  const infNFe = `<infNFe Id="NFe${chave}" versao="4.00">${corpo}</infNFe>`;
  return { chave, infNFe, vNF, vProd, vDesc };
}

// Distribui o desconto da venda entre os itens (proporcional; sobra no maior item)
export function ratearDesconto(itens: { bruto: number; desconto: number }[], descontoGeral: number): number[] {
  const base = itens.map((i) => arred(i.bruto - i.desconto));
  const soma = base.reduce((s, v) => s + v, 0);
  if (descontoGeral <= 0 || soma <= 0) return itens.map((i) => i.desconto);
  const partes = base.map((b) => Math.floor((descontoGeral * b / soma) * 100) / 100);
  let resto = arred(descontoGeral - partes.reduce((s, v) => s + v, 0));
  const maior = base.indexOf(Math.max(...base));
  partes[maior] = arred(partes[maior] + resto);
  return itens.map((i, k) => arred(i.desconto + partes[k]));
}

// QR Code versão 2 (emissão normal)
export async function montarQrCode(chave: string, ambiente: number, cscId: string, csc: string, urlBase: string) {
  const id = String(Number(cscId));
  const parametros = `${chave}|2|${ambiente}|${id}`;
  const dados = new TextEncoder().encode(parametros + csc);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", dados)))
    .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${urlBase}?p=${parametros}|${hash}`;
}

export function montarInfNFeSupl(qrCode: string, urlChave: string) {
  return `<infNFeSupl><qrCode><![CDATA[${qrCode}]]></qrCode><urlChave>${txt(urlChave, 85)}</urlChave></infNFeSupl>`;
}
