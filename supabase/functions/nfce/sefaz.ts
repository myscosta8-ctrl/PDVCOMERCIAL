// Comunicação SOAP com a SEFAZ (NFC-e autorizada pela SVRS para o Pará e demais UFs atendidas).
import { NS_NFE } from "./xml.ts";
import { cadeiaICP } from "./icp.ts";
import type { Certificado } from "./assinatura.ts";

const SVRS = {
  65: { 1: "https://nfce.svrs.rs.gov.br/ws", 2: "https://nfce-homologacao.svrs.rs.gov.br/ws" },
  55: { 1: "https://nfe.svrs.rs.gov.br/ws", 2: "https://nfe-homologacao.svrs.rs.gov.br/ws" },
} as const;

const SERVICOS = {
  autorizacao: { caminho: "NfeAutorizacao/NFeAutorizacao4.asmx", wsdl: "NFeAutorizacao4" },
  status: { caminho: "NfeStatusServico/NfeStatusServico4.asmx", wsdl: "NFeStatusServico4" },
  evento: { caminho: "recepcaoevento/recepcaoevento4.asmx", wsdl: "NFeRecepcaoEvento4" },
  inutilizacao: { caminho: "nfeinutilizacao/nfeinutilizacao4.asmx", wsdl: "NFeInutilizacao4" },
  consulta: { caminho: "NfeConsulta/NfeConsulta4.asmx", wsdl: "NFeConsultaProtocolo4" },
} as const;

// UFs autorizadas pela SVRS (ampliar conforme novos clientes): NFC-e e NF-e
const UFS_SVRS = {
  65: new Set(["PA", "AC", "AL", "AP", "DF", "ES", "PB", "PI", "RJ", "RN", "RO", "RR", "SC", "SE", "TO", "RS", "CE"]),
  55: new Set(["PA", "AC", "AL", "AP", "DF", "ES", "PB", "PI", "RJ", "RN", "RO", "RR", "SC", "SE", "TO"]),
} as const;

export async function enviar(
  servico: keyof typeof SERVICOS, ambiente: 1 | 2, uf: string, corpo: string, cert: Certificado, modelo: 55 | 65 = 65,
): Promise<string> {
  if (!UFS_SVRS[modelo].has(uf)) throw new Error(`Emissão de ${modelo === 55 ? "NF-e" : "NFC-e"} para a UF ${uf} ainda não está disponível.`);
  const s = SERVICOS[servico];
  return await postar(`${SVRS[modelo][ambiente]}/${s.caminho}`,
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${s.wsdl}">${corpo}</nfeDadosMsg>`, cert);
}

// Ambiente Nacional: distribuição de documentos e eventos do destinatário (manifestação)
const AN = {
  distribuicao: { 1: "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx", 2: "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx" },
  evento: { 1: "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx", 2: "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx" },
} as const;

export async function enviarAN(servico: keyof typeof AN, ambiente: 1 | 2, corpo: string, cert: Certificado): Promise<string> {
  const corpoSoap = servico === "distribuicao"
    ? `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>${corpo}</nfeDadosMsg></nfeDistDFeInteresse>`
    : `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${corpo}</nfeDadosMsg>`;
  return await postar(AN[servico][ambiente], corpoSoap, cert);
}

// MDF-e: autorizado pela SVRS para todas as UFs
const MDFE = { 1: "https://mdfe.svrs.rs.gov.br/ws", 2: "https://mdfe-homologacao.svrs.rs.gov.br/ws" } as const;
const SERVICOS_MDFE = {
  recepcao: "MDFeRecepcaoSinc", evento: "MDFeRecepcaoEvento", consulta: "MDFeConsulta", status: "MDFeStatusServico",
} as const;

// corpo: XML do pedido (na recepção síncrona, já compactado em base64)
export async function enviarMDFe(servico: keyof typeof SERVICOS_MDFE, ambiente: 1 | 2, corpo: string, cert: Certificado): Promise<string> {
  const w = SERVICOS_MDFE[servico];
  return await postar(`${MDFE[ambiente]}/${w}/${w}.asmx`,
    `<mdfeDadosMsg xmlns="http://www.portalfiscal.inf.br/mdfe/wsdl/${w}">${corpo}</mdfeDadosMsg>`, cert);
}

async function postar(url: string, corpoSoap: string, cert: Certificado): Promise<string> {
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>${corpoSoap}</soap12:Body></soap12:Envelope>`;
  // deno-lint-ignore no-explicit-any
  const client = (Deno as any).createHttpClient({ cert: cert.certPem, key: cert.chavePem, caCerts: await cadeiaICP() });
  try {
    const controle = new AbortController();
    const limite = setTimeout(() => controle.abort(), 30000);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body: envelope,
      client,
      signal: controle.signal,
    } as RequestInit);
    clearTimeout(limite);
    const texto = await resp.text();
    if (!resp.ok) throw new Error(`SEFAZ respondeu HTTP ${resp.status}: ${texto.slice(0, 300)}`);
    return texto;
  } finally {
    client.close();
  }
}

// Extrai o conteúdo de uma tag (primeira ocorrência)
export function valor(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`));
  return m ? m[1] : null;
}

export function bloco(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<${nome}[\\s>][\\s\\S]*?</${nome}>`));
  return m ? m[0] : null;
}

export const statusServico = (ambiente: 1 | 2, uf: string, cUF: string, cert: Certificado) =>
  enviar("status", ambiente, uf,
    `<consStatServ xmlns="${NS_NFE}" versao="4.00"><tpAmb>${ambiente}</tpAmb><cUF>${cUF}</cUF><xServ>STATUS</xServ></consStatServ>`,
    cert);
