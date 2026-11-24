// Cadeia de certificados ICP-Brasil (os servidores da SEFAZ usam certificados ICP-Brasil,
// que não estão na lista padrão de autoridades confiáveis).
import { unzipSync } from "fflate";

const URL_ZIP = "https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip";
let cache: string[] | null = null;

function derParaPem(der: Uint8Array) {
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  return `-----BEGIN CERTIFICATE-----\n${btoa(bin).match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----`;
}

export async function cadeiaICP(): Promise<string[]> {
  if (cache) return cache;
  const resp = await fetch(URL_ZIP);
  if (!resp.ok) throw new Error(`Falha ao obter a cadeia ICP-Brasil (${resp.status})`);
  const arquivos = unzipSync(new Uint8Array(await resp.arrayBuffer()));
  const pems: string[] = [];
  for (const [nome, dados] of Object.entries(arquivos)) {
    if (!/\.(crt|cer|pem)$/i.test(nome)) continue;
    const texto = new TextDecoder().decode(dados);
    if (texto.includes("BEGIN CERTIFICATE")) {
      pems.push(...(texto.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []));
    } else {
      pems.push(derParaPem(dados));
    }
  }
  if (!pems.length) throw new Error("Cadeia ICP-Brasil vazia");
  cache = pems;
  return pems;
}
