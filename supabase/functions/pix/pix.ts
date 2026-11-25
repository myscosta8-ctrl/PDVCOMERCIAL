// PIX dinâmico pela API Pix do Banco Central (mesmo padrão em todos os bancos):
// autenticação OAuth2 com certificado (mTLS), cobrança imediata (PUT /cob/{txid}) e consulta (GET /cob/{txid}).

export interface ConfigPix { url_api: string; url_token: string; chave: string; expiracao?: number }

const semAcento = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .\-/]/g, "").trim();
const campo = (id: string, valor: string) => id + String(valor.length).padStart(2, "0") + valor;

export function crc16(texto: string) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// txid da cobrança imediata: 26 a 35 letras e números
export function gerarTxid(bytes = crypto.getRandomValues(new Uint8Array(30))) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("").slice(0, 30);
}

// BR Code dinâmico (quando o banco devolve só o endereço "location" da cobrança)
export function brCodeDinamico(location: string, nome: string, cidade: string) {
  const url = location.replace(/^https?:\/\//i, "");
  const p = campo("00", "01") + campo("01", "12") + campo("26", campo("00", "br.gov.bcb.pix") + campo("25", url)) +
    campo("52", "0000") + campo("53", "986") + campo("58", "BR") + campo("59", (semAcento(nome) || "LOJA").slice(0, 25)) +
    campo("60", (semAcento(cidade) || "BRASIL").slice(0, 15)) + campo("62", campo("05", "***")) + "6304";
  return p + crc16(p);
}

export function validarConfig(c: Partial<ConfigPix> | null): ConfigPix {
  const erros: string[] = [];
  if (!c?.url_api || !/^https:\/\//.test(c.url_api)) erros.push("endereço da API Pix do banco");
  if (!c?.url_token || !/^https:\/\//.test(c.url_token)) erros.push("endereço de autenticação (token)");
  if (!c?.chave) erros.push("chave PIX da conta");
  if (erros.length) throw new Error(`Complete o PIX dinâmico em Configurações: ${erros.join(", ")}.`);
  return { url_api: c!.url_api!.replace(/\/+$/, ""), url_token: c!.url_token!, chave: c!.chave!, expiracao: Math.min(86400, Math.max(60, Number(c!.expiracao) || 600)) };
}

export function corpoCobranca(valor: number, chave: string, expiracao: number, texto?: string) {
  if (!(valor > 0)) throw new Error("Valor da cobrança inválido.");
  return {
    calendario: { expiracao },
    valor: { original: valor.toFixed(2) },
    chave,
    ...(texto ? { solicitacaoPagador: semAcento(texto).slice(0, 140) } : {}),
  };
}

// Situação da cobrança no banco -> situação no sistema
export function situacao(status: string): "ativa" | "concluida" | "cancelada" {
  if (status === "CONCLUIDA") return "concluida";
  if (status === "REMOVIDA_PELO_USUARIO_RECEBEDOR" || status === "REMOVIDA_PELO_PSP") return "cancelada";
  return "ativa";
}
