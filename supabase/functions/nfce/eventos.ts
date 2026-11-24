// Cancelamento (evento 110111), inutilização de numeração e QR Code da contingência off-line (versão 3).
// Tudo gerado já na forma canônica, como o XML da nota.
import { NS_NFE, UF_CODIGO, dataHoraBrasilia, txt } from "./xml.ts";

const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const tag = (nome: string, valor: string) => `<${nome}>${valor}</${nome}>`;

export function validarJustificativa(texto: string, oque = "a justificativa"): string {
  const j = txt(texto, 255);
  if (j.length < 15) throw new Error(`Escreva ${oque} com pelo menos 15 letras.`);
  return j;
}

// ---------------------------------------------------------------- Cancelamento
export interface DadosCancelamento {
  chave: string; protocolo: string; cnpj: string; uf: string; ambiente: 1 | 2; justificativa: string; quando: Date; sequencia?: number;
}

export function montarCancelamento(d: DadosCancelamento) {
  if (!/^\d{44}$/.test(d.chave)) throw new Error("Chave de acesso inválida.");
  if (!d.protocolo) throw new Error("A nota não tem protocolo de autorização.");
  const cUF = UF_CODIGO[d.uf];
  const seq = d.sequencia ?? 1;
  const id = `ID110111${d.chave}${String(seq).padStart(2, "0")}`;
  const det = `<detEvento versao="1.00">` + tag("descEvento", "Cancelamento") + tag("nProt", so(d.protocolo)) +
    tag("xJust", validarJustificativa(d.justificativa)) + `</detEvento>`;
  const infEvento = `<infEvento Id="${id}">` +
    tag("cOrgao", cUF) + tag("tpAmb", String(d.ambiente)) + tag("CNPJ", so(d.cnpj)) + tag("chNFe", d.chave) +
    tag("dhEvento", dataHoraBrasilia(d.quando)) + tag("tpEvento", "110111") + tag("nSeqEvento", String(seq)) +
    tag("verEvento", "1.00") + det + `</infEvento>`;
  return { id, infEvento };
}

export const envelopeEvento = (infEvento: string, assinatura: string, lote = Date.now()) => {
  const evento = `<evento xmlns="${NS_NFE}" versao="1.00">${infEvento}${assinatura}</evento>`;
  return { evento, lote: `<envEvento xmlns="${NS_NFE}" versao="1.00">${tag("idLote", String(lote).slice(-15))}${evento}</envEvento>` };
};

// ---------------------------------------------------------------- Inutilização
export interface DadosInutilizacao {
  cnpj: string; uf: string; ambiente: 1 | 2; serie: number; inicio: number; fim: number; justificativa: string; ano: number;
}

export function montarInutilizacao(d: DadosInutilizacao) {
  const cUF = UF_CODIGO[d.uf];
  if (!(d.inicio >= 1 && d.fim >= d.inicio && d.fim <= 999999999)) throw new Error("Faixa de números inválida.");
  if (d.fim - d.inicio > 9999) throw new Error("Inutilize no máximo 10.000 números por vez.");
  const aa = String(d.ano % 100).padStart(2, "0");
  const cnpj = so(d.cnpj).padStart(14, "0");
  const id = `ID${cUF}${aa}${cnpj}65${String(d.serie).padStart(3, "0")}${String(d.inicio).padStart(9, "0")}${String(d.fim).padStart(9, "0")}`;
  const infInut = `<infInut Id="${id}">` +
    tag("tpAmb", String(d.ambiente)) + tag("xServ", "INUTILIZAR") + tag("cUF", cUF) + tag("ano", aa) + tag("CNPJ", cnpj) +
    tag("mod", "65") + tag("serie", String(d.serie)) + tag("nNFIni", String(d.inicio)) + tag("nNFFin", String(d.fim)) +
    tag("xJust", validarJustificativa(d.justificativa)) + `</infInut>`;
  return { id, infInut };
}

export const envelopeInutilizacao = (infInut: string, assinatura: string) =>
  `<inutNFe xmlns="${NS_NFE}" versao="4.00">${infInut}${assinatura}</inutNFe>`;

// ---------------------------------------------------------------- Consulta pela chave
export const consultaProtocolo = (chave: string, ambiente: 1 | 2) =>
  `<consSitNFe xmlns="${NS_NFE}" versao="4.00">${tag("tpAmb", String(ambiente))}${tag("xServ", "CONSULTAR")}${tag("chNFe", chave)}</consSitNFe>`;

// ---------------------------------------------------------------- QR Code versão 3 (contingência off-line)
// p=chave|3|tpAmb|dia|vNF|tp_idDest|idDest|assinatura, com assinatura RSA-SHA1 em base64
// dos parâmetros 1 a 7 (mantendo os separadores), feita com o certificado do emitente.
export function parametrosQrV3Offline(chave: string, ambiente: number, emissao: Date, vNF: number, documento?: string | null) {
  const dia = dataHoraBrasilia(emissao).slice(8, 10);
  const doc = so(documento);
  const tp = doc.length === 14 ? "1" : doc.length === 11 ? "2" : "";
  return `${chave}|3|${ambiente}|${dia}|${vNF.toFixed(2)}|${tp}|${tp ? doc : ""}`;
}

export function montarQrCodeV3Offline(parametros: string, assinaturaBase64: string, urlBase: string) {
  return `${urlBase}?p=${parametros}|${assinaturaBase64}`;
}

// Situação devolvida pela SEFAZ num evento (retEvento/infEvento)
export const EVENTO_OK = new Set(["135", "136", "155"]);
// Situações da consulta pela chave em que a nota existe autorizada
export const CONSULTA_AUTORIZADA = new Set(["100", "150"]);
export const CONSULTA_INEXISTENTE = new Set(["217"]);
// SEFAZ fora do ar ou paralisada: autoriza a contingência
export const SEFAZ_INDISPONIVEL = new Set(["108", "109"]);
