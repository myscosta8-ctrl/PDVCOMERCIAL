// Distribuição de documentos (NFeDistribuicaoDFe) e manifestação do destinatário, no Ambiente Nacional.
// Traz as NF-e emitidas contra o CNPJ da empresa (resumo ou XML completo) e registra
// ciência, confirmação, desconhecimento ou operação não realizada.
import { gunzipSync } from "fflate";
import { NS_NFE, dataHoraBrasilia, txt } from "./xml.ts";

const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const tag = (nome: string, valor: string) => `<${nome}>${valor}</${nome}>`;
const nsu15 = (v: unknown) => so(v || "0").padStart(15, "0").slice(-15);

// ---------------------------------------------------------------- Pedido de distribuição
export function pedidoDistribuicao(ambiente: 1 | 2, cUFAutor: string, cnpj: string, ultNSU: string) {
  return `<distDFeInt xmlns="${NS_NFE}" versao="1.01">${tag("tpAmb", String(ambiente))}${tag("cUFAutor", cUFAutor)}` +
    `${tag("CNPJ", so(cnpj))}${tag("distNSU", tag("ultNSU", nsu15(ultNSU)))}</distDFeInt>`;
}

export function pedidoPorChave(ambiente: 1 | 2, cUFAutor: string, cnpj: string, chave: string) {
  if (!/^\d{44}$/.test(chave)) throw new Error("Chave de acesso inválida.");
  return `<distDFeInt xmlns="${NS_NFE}" versao="1.01">${tag("tpAmb", String(ambiente))}${tag("cUFAutor", cUFAutor)}` +
    `${tag("CNPJ", so(cnpj))}${tag("consChNFe", tag("chNFe", chave))}</distDFeInt>`;
}

// ---------------------------------------------------------------- Leitura da resposta
const v = (xml: string, nome: string) => xml.match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`))?.[1] ?? null;

export interface DocumentoDistribuido { nsu: string; schema: string; xml: string }
export interface RespostaDistribuicao { cStat: string; motivo: string; ultNSU: string; maxNSU: string; docs: DocumentoDistribuido[] }

function descompactar(base64: string): string {
  const bin = atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(gunzipSync(bytes));
}

export function lerDistribuicao(resposta: string): RespostaDistribuicao {
  const ret = resposta.match(/<retDistDFeInt[\s\S]*?<\/retDistDFeInt>/)?.[0] ?? resposta;
  const docs: DocumentoDistribuido[] = [];
  for (const m of ret.matchAll(/<docZip\s+([^>]*)>([^<]+)<\/docZip>/g)) {
    const atributos = m[1];
    const nsu = atributos.match(/NSU="(\d+)"/)?.[1] ?? "";
    const schema = atributos.match(/schema="([^"]+)"/)?.[1] ?? "";
    docs.push({ nsu: nsu15(nsu), schema, xml: descompactar(m[2]) });
  }
  return {
    cStat: v(ret, "cStat") ?? "", motivo: v(ret, "xMotivo") ?? "",
    ultNSU: nsu15(v(ret, "ultNSU")), maxNSU: nsu15(v(ret, "maxNSU")), docs,
  };
}

export interface NotaRecebida {
  chave: string; cnpj_emitente: string | null; nome_emitente: string | null; ie_emitente: string | null;
  emissao: string | null; valor: number | null; tipo_nf: number | null; situacao: number; protocolo: string | null;
  xml: string | null; resumo: boolean;
}
export interface EventoRecebido { chave: string; tpEvento: string }

// Interpreta um documento distribuído: resumo da NF-e, NF-e completa ou evento (ex.: cancelamento pelo emitente)
export function interpretar(doc: DocumentoDistribuido): { nota?: NotaRecebida; evento?: EventoRecebido } {
  const x = doc.xml;
  if (doc.schema.startsWith("resNFe")) {
    return { nota: {
      chave: v(x, "chNFe") ?? "", cnpj_emitente: v(x, "CNPJ") ?? v(x, "CPF"), nome_emitente: v(x, "xNome"), ie_emitente: v(x, "IE"),
      emissao: v(x, "dhEmi"), valor: Number(v(x, "vNF") ?? 0), tipo_nf: Number(v(x, "tpNF") ?? 1),
      situacao: Number(v(x, "cSitNFe") ?? 1), protocolo: v(x, "nProt"), xml: null, resumo: true,
    } };
  }
  if (doc.schema.startsWith("procNFe")) {
    const emit = x.match(/<emit>[\s\S]*?<\/emit>/)?.[0] ?? "";
    const prot = x.match(/<infProt[\s\S]*?<\/infProt>/)?.[0] ?? "";
    const ide = x.match(/<ide>[\s\S]*?<\/ide>/)?.[0] ?? "";
    const tot = x.match(/<ICMSTot>[\s\S]*?<\/ICMSTot>/)?.[0] ?? "";
    return { nota: {
      chave: v(prot, "chNFe") ?? (x.match(/Id="NFe(\d{44})"/)?.[1] ?? ""), cnpj_emitente: v(emit, "CNPJ") ?? v(emit, "CPF"),
      nome_emitente: v(emit, "xNome"), ie_emitente: v(emit, "IE"), emissao: v(ide, "dhEmi"), valor: Number(v(tot, "vNF") ?? 0),
      tipo_nf: Number(v(ide, "tpNF") ?? 1), situacao: 1, protocolo: v(prot, "nProt"), xml: x, resumo: false,
    } };
  }
  if (doc.schema.startsWith("resEvento") || doc.schema.startsWith("procEventoNFe")) {
    return { evento: { chave: v(x, "chNFe") ?? "", tpEvento: v(x, "tpEvento") ?? "" } };
  }
  return {};
}

// ---------------------------------------------------------------- Manifestação do destinatário
export const MANIFESTACOES = {
  ciencia: { codigo: "210210", descricao: "Ciencia da Operacao" },
  confirmada: { codigo: "210200", descricao: "Confirmacao da Operacao" },
  desconhecida: { codigo: "210220", descricao: "Desconhecimento da Operacao" },
  nao_realizada: { codigo: "210240", descricao: "Operacao nao Realizada" },
} as const;
export type TipoManifestacao = keyof typeof MANIFESTACOES;

export function montarManifestacao(d: { chave: string; cnpj: string; ambiente: 1 | 2; tipo: TipoManifestacao; justificativa?: string; quando: Date }) {
  if (!/^\d{44}$/.test(d.chave)) throw new Error("Chave de acesso inválida.");
  const m = MANIFESTACOES[d.tipo];
  if (!m) throw new Error("Tipo de manifestação inválido.");
  let just = "";
  if (d.tipo === "nao_realizada") {
    const j = txt(d.justificativa ?? "", 255);
    if (j.length < 15) throw new Error("Explique com pelo menos 15 letras por que a operação não foi realizada.");
    just = tag("xJust", j);
  }
  const id = `ID${m.codigo}${d.chave}01`;
  const infEvento = `<infEvento Id="${id}">` +
    tag("cOrgao", "91") + tag("tpAmb", String(d.ambiente)) + tag("CNPJ", so(d.cnpj)) + tag("chNFe", d.chave) +
    tag("dhEvento", dataHoraBrasilia(d.quando)) + tag("tpEvento", m.codigo) + tag("nSeqEvento", "1") + tag("verEvento", "1.00") +
    `<detEvento versao="1.00">${tag("descEvento", m.descricao)}${just}</detEvento></infEvento>`;
  return { id, infEvento };
}

// Situações da distribuição
export const DIST_COM_DOCUMENTOS = "138";
export const DIST_SEM_DOCUMENTOS = "137";
export const DIST_CONSUMO_INDEVIDO = "656";
// Evento já registrado antes (manifestação repetida): vale como feito
export const EVENTO_DUPLICADO = "573";
