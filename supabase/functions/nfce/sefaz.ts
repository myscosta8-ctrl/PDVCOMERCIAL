// Comunicação SOAP com a SEFAZ (NFC-e autorizada pela SVRS para o Pará e demais UFs atendidas).
import { NS_NFE } from "./xml.ts";
import { cadeiaICP } from "./icp.ts";
import type { Certificado } from "./assinatura.ts";

const SVRS = {
  1: "https://nfce.svrs.rs.gov.br/ws",
  2: "https://nfce-homologacao.svrs.rs.gov.br/ws",
} as const;

const SERVICOS = {
  autorizacao: { caminho: "NfeAutorizacao/NFeAutorizacao4.asmx", wsdl: "NFeAutorizacao4" },
  status: { caminho: "NfeStatusServico/NfeStatusServico4.asmx", wsdl: "NFeStatusServico4" },
  evento: { caminho: "recepcaoevento/recepcaoevento4.asmx", wsdl: "NFeRecepcaoEvento4" },
  inutilizacao: { caminho: "nfeinutilizacao/nfeinutilizacao4.asmx", wsdl: "NFeInutilizacao4" },
  consulta: { caminho: "NfeConsulta/NfeConsulta4.asmx", wsdl: "NFeConsultaProtocolo4" },
} as const;

// UFs cuja NFC-e é autorizada pela SVRS (ampliar conforme novos clientes)
const UFS_SVRS = new Set(["PA", "AC", "AL", "AP", "DF", "ES", "PB", "PI", "RJ", "RN", "RO", "RR", "SC", "SE", "TO", "RS", "CE"]);

export async function enviar(
  servico: keyof typeof SERVICOS, ambiente: 1 | 2, uf: string, corpo: string, cert: Certificado,
): Promise<string> {
  if (!UFS_SVRS.has(uf)) throw new Error(`Emissão de NFC-e para a UF ${uf} ainda não está disponível.`);
  const s = SERVICOS[servico];
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${s.wsdl}">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
  // deno-lint-ignore no-explicit-any
  const client = (Deno as any).createHttpClient({ cert: cert.certPem, key: cert.chavePem, caCerts: await cadeiaICP() });
  try {
    const controle = new AbortController();
    const limite = setTimeout(() => controle.abort(), 30000);
    const resp = await fetch(`${SVRS[ambiente]}/${s.caminho}`, {
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
