// MDF-e modelo 58 (layout 3.00), modal rodoviário, emitente com carga própria (tpEmit 2) levando NF-e.
// Autorização síncrona na SVRS (mensagem compactada), encerramento (110112) e cancelamento (110111).
import { gzipSync } from "fflate";
import { UF_CODIGO, txt, so, n2, tag, arred, digitoChave, dataHoraBrasilia } from "./xml.ts";

export const NS_MDFE = "http://www.portalfiscal.inf.br/mdfe";
export const URL_QR_MDFE = "https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode";

export interface Municipio { codigo: string; nome: string }
export interface Descarga extends Municipio { chaves: string[] }
export interface DadosMDFe {
  emitente: { cnpj: string; ie: string; razao_social: string; nome_fantasia?: string | null; uf: string; municipio_ibge: string;
    endereco: { logradouro: string; numero: string; bairro: string; municipio: string; cep: string; fone?: string } };
  ambiente: 1 | 2; serie: number; numero: number; codigo_numerico: string; emissao: Date;
  ufInicio: string; ufFim: string; percurso: string[];
  carregamento: Municipio[]; descargas: Descarga[];
  veiculo: { placa: string; renavam?: string; tara: number; capKG?: number; tpRod: string; tpCar: string; uf: string };
  condutores: { nome: string; cpf: string }[];
  produto: { tpCarga: string; xProd: string; ncm?: string };
  valorCarga: number; unidade: "01" | "02"; pesoCarga: number;
  informacoes?: string | null;
  respTecnico?: { cnpj: string; contato: string; email: string; fone: string } | null;
}

const PLACA = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;

export function cpfValido(c: string) {
  const d = so(c);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function montarChaveMDFe(d: Pick<DadosMDFe, "emitente" | "emissao" | "serie" | "numero" | "codigo_numerico">) {
  const cUF = UF_CODIGO[d.emitente.uf];
  if (!cUF) throw new Error("UF do emitente inválida");
  const aamm = dataHoraBrasilia(d.emissao).slice(2, 7).replace("-", "");
  const base = cUF + aamm + so(d.emitente.cnpj).padStart(14, "0") + "58" +
    String(d.serie).padStart(3, "0") + String(d.numero).padStart(9, "0") + "1" + d.codigo_numerico.padStart(8, "0");
  if (base.length !== 43) throw new Error("Chave de acesso com tamanho inválido");
  const dv = digitoChave(base);
  return { chave: base + dv, dv, cUF };
}

export function montarInfMDFe(d: DadosMDFe) {
  const e = d.emitente;
  if (!UF_CODIGO[d.ufInicio] || !UF_CODIGO[d.ufFim]) throw new Error("Informe as UFs de início e fim do percurso.");
  if (d.percurso.some((u) => !UF_CODIGO[u] || u === d.ufInicio || u === d.ufFim)) throw new Error("As UFs de percurso não podem repetir a UF de início ou de fim.");
  if (d.percurso.length > 25) throw new Error("No máximo 25 UFs de percurso.");
  if (!d.carregamento.length || d.carregamento.some((m) => so(m.codigo).length !== 7)) throw new Error("Informe o município de carregamento (código IBGE).");
  const chaves = d.descargas.flatMap((x) => x.chaves.map(so));
  if (!d.descargas.length || !chaves.length) throw new Error("Inclua pelo menos uma NF-e na descarga.");
  if (d.descargas.some((m) => so(m.codigo).length !== 7)) throw new Error("Informe o código IBGE de cada município de descarga.");
  if (chaves.some((c) => !/^\d{44}$/.test(c) || c.slice(20, 22) !== "55")) throw new Error("Há chave de NF-e inválida na descarga.");
  if (new Set(chaves).size !== chaves.length) throw new Error("A mesma NF-e foi incluída duas vezes.");
  const placa = String(d.veiculo.placa || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!PLACA.test(placa)) throw new Error("Placa do veículo inválida.");
  if (!(Number(d.veiculo.tara) > 0)) throw new Error("Informe a tara do veículo (kg).");
  if (!d.condutores.length || d.condutores.length > 10) throw new Error("Informe de 1 a 10 condutores.");
  if (d.condutores.some((c) => !cpfValido(c.cpf) || txt(c.nome, 60).length < 2)) throw new Error("Confira o nome e o CPF dos condutores.");
  if (new Set(d.condutores.map((c) => so(c.cpf))).size !== d.condutores.length) throw new Error("Condutor repetido.");
  if (!/^(0[1-9]|1[01])$/.test(d.produto.tpCarga) || txt(d.produto.xProd, 120).length < 2) throw new Error("Informe o tipo e a descrição do produto predominante.");
  if (!(d.valorCarga > 0) || !(d.pesoCarga > 0)) throw new Error("Informe o valor e o peso da carga.");

  const { chave, dv, cUF } = montarChaveMDFe(d);
  const ide =
    tag("cUF", cUF) + tag("tpAmb", String(d.ambiente)) + tag("tpEmit", "2") + tag("mod", "58") + tag("serie", String(d.serie)) +
    tag("nMDF", String(d.numero)) + tag("cMDF", d.codigo_numerico.padStart(8, "0")) + tag("cDV", String(dv)) + tag("modal", "1") +
    tag("dhEmi", dataHoraBrasilia(d.emissao)) + tag("tpEmis", "1") + tag("procEmi", "0") + tag("verProc", "PDV Comercial 1.0") +
    tag("UFIni", d.ufInicio) + tag("UFFim", d.ufFim) +
    d.carregamento.map((m) => tag("infMunCarrega", tag("cMunCarrega", so(m.codigo)) + tag("xMunCarrega", txt(m.nome, 60)))).join("") +
    d.percurso.map((u) => tag("infPercurso", tag("UFPer", u))).join("");

  const fone = so(e.endereco.fone);
  const emit = tag("CNPJ", so(e.cnpj)) + tag("IE", so(e.ie)) + tag("xNome", txt(e.razao_social, 60)) +
    (e.nome_fantasia ? tag("xFant", txt(e.nome_fantasia, 60)) : "") +
    tag("enderEmit", tag("xLgr", txt(e.endereco.logradouro, 60)) + tag("nro", txt(e.endereco.numero || "SN", 60)) +
      tag("xBairro", txt(e.endereco.bairro, 60)) + tag("cMun", so(e.municipio_ibge)) + tag("xMun", txt(e.endereco.municipio, 60)) +
      (so(e.endereco.cep).length === 8 ? tag("CEP", so(e.endereco.cep)) : "") + tag("UF", e.uf) + (fone.length >= 7 ? tag("fone", fone) : ""));

  const v = d.veiculo;
  const rodo = tag("rodo", tag("veicTracao",
    tag("placa", placa) + (so(v.renavam).length >= 9 ? tag("RENAVAM", so(v.renavam)) : "") + tag("tara", String(Math.round(v.tara))) +
    (Number(v.capKG) > 0 ? tag("capKG", String(Math.round(Number(v.capKG)))) : "") +
    d.condutores.map((c) => tag("condutor", tag("xNome", txt(c.nome, 60)) + tag("CPF", so(c.cpf)))).join("") +
    tag("tpRod", v.tpRod) + tag("tpCar", v.tpCar) + (UF_CODIGO[v.uf] ? tag("UF", v.uf) : "")));
  const infModal = `<infModal versaoModal="3.00">${rodo}</infModal>`;

  const infDoc = tag("infDoc", d.descargas.filter((x) => x.chaves.length).map((m) => tag("infMunDescarga",
    tag("cMunDescarga", so(m.codigo)) + tag("xMunDescarga", txt(m.nome, 60)) + m.chaves.map((c) => tag("infNFe", tag("chNFe", so(c)))).join(""))).join(""));

  const prodPred = tag("prodPred", tag("tpCarga", d.produto.tpCarga) + tag("xProd", txt(d.produto.xProd, 120)) +
    (so(d.produto.ncm).length >= 2 ? tag("NCM", so(d.produto.ncm)) : ""));
  const tot = tag("tot", tag("qNFe", String(chaves.length)) + tag("vCarga", n2(arred(d.valorCarga))) + tag("cUnid", d.unidade) +
    tag("qCarga", Number(d.pesoCarga).toFixed(4)));
  const infAdic = d.informacoes ? tag("infAdic", tag("infCpl", txt(d.informacoes, 5000))) : "";
  const rt = d.respTecnico && so(d.respTecnico.cnpj).length === 14
    ? tag("infRespTec", tag("CNPJ", so(d.respTecnico.cnpj)) + tag("xContato", txt(d.respTecnico.contato, 60)) +
        tag("email", txt(d.respTecnico.email, 60)) + tag("fone", so(d.respTecnico.fone)))
    : "";

  const infMDFe = `<infMDFe Id="MDFe${chave}" versao="3.00">` + tag("ide", ide) + tag("emit", emit) + infModal + infDoc +
    prodPred + tot + infAdic + rt + `</infMDFe>`;
  const qrCode = `${URL_QR_MDFE}?chMDFe=${chave}&tpAmb=${d.ambiente}`;
  return { chave, infMDFe, qrCode, placa, qNFe: chaves.length };
}

export const montarMDFe = (infMDFe: string, assinatura: string, qrCode: string) =>
  `<MDFe xmlns="${NS_MDFE}">${infMDFe}<infMDFeSupl><qrCodMDFe><![CDATA[${qrCode}]]></qrCodMDFe></infMDFeSupl>${assinatura}</MDFe>`;

// A autorização síncrona recebe o XML compactado (gzip) em base64
export function compactar(xml: string) {
  const bytes = gzipSync(new TextEncoder().encode(xml));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ---------------------------------------------------------------- Eventos
function evento(tipo: "110112" | "110111", d: { chave: string; cnpj: string; ambiente: 1 | 2; quando: Date }, det: string) {
  if (!/^\d{44}$/.test(d.chave) || d.chave.slice(20, 22) !== "58") throw new Error("Chave do MDF-e inválida.");
  const id = `ID${tipo}${d.chave}01`;
  const infEvento = `<infEvento Id="${id}">` + tag("cOrgao", d.chave.slice(0, 2)) + tag("tpAmb", String(d.ambiente)) +
    tag("CNPJ", so(d.cnpj)) + tag("chMDFe", d.chave) + tag("dhEvento", dataHoraBrasilia(d.quando)) + tag("tpEvento", tipo) +
    tag("nSeqEvento", "1") + `<detEvento versaoEvento="3.00">${det}</detEvento></infEvento>`;
  return { id, infEvento };
}

export function montarEncerramento(d: { chave: string; cnpj: string; ambiente: 1 | 2; quando: Date; protocolo: string; uf: string; municipio: string }) {
  if (!d.protocolo) throw new Error("O MDF-e não tem protocolo de autorização.");
  if (!UF_CODIGO[d.uf] || so(d.municipio).length !== 7) throw new Error("Informe a UF e o município (código IBGE) do encerramento.");
  return evento("110112", d, tag("evEncMDFe", tag("descEvento", "Encerramento") + tag("nProt", so(d.protocolo)) +
    tag("dtEnc", dataHoraBrasilia(d.quando).slice(0, 10)) + tag("cUF", UF_CODIGO[d.uf]) + tag("cMun", so(d.municipio))));
}

export function montarCancelamentoMDFe(d: { chave: string; cnpj: string; ambiente: 1 | 2; quando: Date; protocolo: string; justificativa: string }) {
  if (!d.protocolo) throw new Error("O MDF-e não tem protocolo de autorização.");
  const j = txt(d.justificativa, 255);
  if (j.length < 15) throw new Error("Escreva o motivo do cancelamento com pelo menos 15 letras.");
  return evento("110111", d, tag("evCancMDFe", tag("descEvento", "Cancelamento") + tag("nProt", so(d.protocolo)) + tag("xJust", j)));
}

export const envelopeEventoMDFe = (infEvento: string, assinatura: string) =>
  `<eventoMDFe xmlns="${NS_MDFE}" versao="3.00">${infEvento}${assinatura}</eventoMDFe>`;

export const consultaMDFe = (chave: string, ambiente: 1 | 2) =>
  `<consSitMDFe xmlns="${NS_MDFE}" versao="3.00">${tag("tpAmb", String(ambiente))}${tag("xServ", "CONSULTAR")}${tag("chMDFe", chave)}</consSitMDFe>`;
