// Edge Function "nfce": configuração fiscal, emissão, contingência, cancelamento e inutilização da NFC-e.
// Ações (POST JSON):
//   { acao: "testar" }
//   { acao: "emitir", venda_id }
//   { acao: "transmitir" }                         — envia as notas em contingência e confere as pendentes
//   { acao: "cancelar", venda_id, justificativa }   — cancela a NFC-e na SEFAZ e depois a venda
//   { acao: "inutilizar", serie, inicio, fim, justificativa, modelo? }
//   NF-e modelo 55: { acao: "nfe_emitir" | "nfe_consultar", nfe_id } | { acao: "nfe_cancelar", nfe_id, justificativa } | { acao: "nfe_cce", nfe_id, correcao }
import { createClient } from "@supabase/supabase-js";
import { montarInfNFe, montarQrCode, montarInfNFeSupl, ratearDesconto, NS_NFE, UF_CODIGO, type ItemNota } from "./xml.ts";
import { montarInfNFe55, type Destinatario } from "./nfe55.ts";
import { lerPfx, assinar, assinarTexto, type Certificado } from "./assinatura.ts";
import { enviar, statusServico, valor, bloco } from "./sefaz.ts";
import {
  montarCancelamento, montarCartaCorrecao, envelopeEvento, montarInutilizacao, envelopeInutilizacao, consultaProtocolo,
  parametrosQrV3Offline, montarQrCodeV3Offline, validarJustificativa,
  EVENTO_OK, CONSULTA_AUTORIZADA, CONSULTA_INEXISTENTE, SEFAZ_INDISPONIVEL,
} from "./eventos.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class ErroUsuario extends Error {}
class SemComunicacao extends Error {}

const servico = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
type Usuario = { id: string; empresa_id: string; papel: string; token: string };
const GESTORES = ["administrador", "gerente"];

async function usuarioDaRequisicao(req: Request): Promise<Usuario> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const { data, error } = await servico.auth.getUser(token);
  if (error || !data.user) throw new ErroUsuario("Sessão inválida. Entre novamente.");
  const { data: u } = await servico.from("usuarios").select("id, empresa_id, papel, ativo").eq("id", data.user.id).maybeSingle();
  if (!u || !u.ativo) throw new ErroUsuario("Usuário sem empresa vinculada.");
  return { ...(u as { id: string; empresa_id: string; papel: string }), token };
}

async function carregarEmpresa(empresaId: string, modelo: 55 | 65 = 65) {
  const { data: e } = await servico.from("empresas").select("*").eq("id", empresaId).single();
  const faltando: string[] = [];
  const end = e.endereco ?? {};
  if (!e.cnpj) faltando.push("CNPJ");
  if (!e.inscricao_estadual) faltando.push("inscrição estadual");
  if (!e.uf || !UF_CODIGO[e.uf]) faltando.push("UF");
  if (!e.municipio_ibge) faltando.push("código IBGE do município");
  for (const [c, n] of [["logradouro", "logradouro"], ["bairro", "bairro"], ["municipio", "município"], ["cep", "CEP"]]) {
    if (!end[c]) faltando.push(n);
  }
  // CSC e endereços do QR Code só valem para a NFC-e
  if (modelo === 65 && !e.nfce_csc_id) faltando.push("ID do CSC");
  if (modelo === 65 && (!e.nfce_url_qrcode || !e.nfce_url_consulta)) faltando.push("endereços de consulta da NFC-e");
  if (faltando.length) throw new ErroUsuario(`Complete a configuração fiscal: ${faltando.join(", ")}.`);
  return e;
}

async function carregarCertificado(empresa: { id: string; cnpj: string }, exigirCsc = true): Promise<{ cert: Certificado; csc: string }> {
  const { data, error } = await servico.rpc("ler_credenciais_fiscais", { p_empresa: empresa.id });
  if (error) throw error;
  if (!data?.pfx || !data?.senha) throw new ErroUsuario("Envie o certificado digital A1 e a senha na configuração fiscal.");
  if (exigirCsc && !data?.csc) throw new ErroUsuario("Informe o CSC (código de segurança do contribuinte) na configuração fiscal.");
  const cert = lerPfx(data.pfx, data.senha);
  if (cert.validoAte < new Date()) throw new ErroUsuario("O certificado digital está vencido.");
  const cnpj = String(empresa.cnpj).replace(/\D/g, "");
  if (cert.cnpj && cert.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) {
    throw new ErroUsuario("O certificado digital não pertence ao CNPJ da empresa.");
  }
  return { cert, csc: data.csc };
}

// Envia à SEFAZ; falha de rede vira SemComunicacao (gatilho da contingência)
async function falar(servicoSefaz: Parameters<typeof enviar>[0], empresa: { nfce_ambiente: number; uf: string }, corpo: string, cert: Certificado, modelo: 55 | 65 = 65) {
  try {
    return await enviar(servicoSefaz, Number(empresa.nfce_ambiente) as 1 | 2, empresa.uf, corpo, cert, modelo);
  } catch (e) {
    if (String(e).includes("ainda não está disponível")) throw new ErroUsuario(String((e as Error).message));
    throw new SemComunicacao(String(e).slice(0, 250));
  }
}

const urlQrDaEmpresa = (empresa: Record<string, unknown>, ambiente: number) => ambiente === 1
  ? String(empresa.nfce_url_qrcode).replace("portal-homologacao", "portal")
  : String(empresa.nfce_url_qrcode);

async function testar(empresaId: string) {
  const empresa = await carregarEmpresa(empresaId, 55);
  const { cert } = await carregarCertificado(empresa, false);
  await servico.from("empresas").update({ certificado_titular: cert.titular, certificado_validade: cert.validoAte.toISOString() }).eq("id", empresa.id);
  const ret = await statusServico(empresa.nfce_ambiente, empresa.uf, UF_CODIGO[empresa.uf], cert);
  return {
    titular: cert.titular,
    validade: cert.validoAte.toISOString(),
    sefaz: { codigo: valor(ret, "cStat"), mensagem: valor(ret, "xMotivo") },
  };
}

// ------------------------------------------------------------------ Montagem da nota
interface Montagem { numero: number; codigo: string; emissao: Date; contingencia?: { inicio: Date; justificativa: string } | null }

async function montarNota(empresa: Record<string, any>, venda: Record<string, any>, cert: Certificado, csc: string, m: Montagem) {
  const [{ data: itens }, { data: pagamentos }] = await Promise.all([
    servico.from("venda_itens")
      .select("sequencia, quantidade, preco_unitario, desconto, descricao, cfop, csosn, cst_icms, aliquota_icms, reducao_bc, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, origem, ncm, cest, cbenef, produto:produtos(id, codigo, ean, ncm, cest, cfop, unidade, origem, csosn, cst_icms, aliquota_icms, reducao_bc, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, cbenef)")
      .eq("venda_id", venda.id).order("sequencia"),
    servico.from("venda_pagamentos").select("forma, valor").eq("venda_id", venda.id),
  ]);
  if (!itens?.length) throw new ErroUsuario("Venda sem itens.");
  const descontos = ratearDesconto(
    itens.map((i) => ({ bruto: Math.round(Number(i.quantidade) * Number(i.preco_unitario) * 100) / 100, desconto: Number(i.desconto) })),
    Number(venda.desconto),
  );
  const ambiente = Number(empresa.nfce_ambiente) as 1 | 2;
  const montado = montarInfNFe({
    emitente: {
      cnpj: empresa.cnpj, ie: empresa.inscricao_estadual, razao_social: empresa.razao_social, nome_fantasia: empresa.nome_fantasia,
      crt: empresa.regime_tributario === "normal" ? 3 : empresa.regime_tributario === "mei" ? 4 : empresa.regime_tributario === "simples_excesso" ? 2 : 1,
      uf: empresa.uf, municipio_ibge: empresa.municipio_ibge, endereco: empresa.endereco,
    },
    ambiente, serie: Number(empresa.nfce_serie), numero: m.numero, codigo_numerico: m.codigo, emissao: m.emissao,
    contingencia: m.contingencia ?? null,
    itens: itens.map((i, k) => {
      const p = i.produto as unknown as Record<string, unknown>;
      // Vale a tributação fotografada na venda; o cadastro do produto é só a reserva para vendas antigas
      const f = (campo: string) => ((i as Record<string, unknown>)[campo] ?? p[campo]) as never;
      return {
        codigo: String(p.codigo || String(p.id).slice(0, 8)), ean: p.ean as string, descricao: i.descricao,
        ncm: String(f("ncm") ?? ""), cest: f("cest"), cfop: String(f("cfop") || "5102"), unidade: String(p.unidade || "UN"),
        quantidade: Number(i.quantidade), valor_unitario: Number(i.preco_unitario), desconto: descontos[k],
        origem: Number(f("origem") ?? 0), csosn: f("csosn"), cst_icms: f("cst_icms"),
        aliquota_icms: Number(f("aliquota_icms") ?? 0), reducao_bc: Number(f("reducao_bc") ?? 0), cbenef: f("cbenef"),
        cst_pis: f("cst_pis"), aliquota_pis: Number(f("aliquota_pis") ?? 0), cst_cofins: f("cst_cofins"), aliquota_cofins: Number(f("aliquota_cofins") ?? 0),
      };
    }),
    pagamentos: (pagamentos ?? []).map((p) => ({ forma: p.forma, valor: Number(p.valor) })),
    troco: Number(venda.troco),
    cpf_cnpj_consumidor: venda.cpf_consumidor,
  });
  const urlQr = urlQrDaEmpresa(empresa, ambiente);
  let qrCode: string;
  if (m.contingencia) {
    // Contingência: QR Code versão 3, assinado com o certificado (dispensa o CSC)
    const parametros = parametrosQrV3Offline(montado.chave, ambiente, m.emissao, montado.vNF, montado.documento);
    qrCode = montarQrCodeV3Offline(parametros, assinarTexto(parametros, cert), urlQr);
  } else {
    qrCode = await montarQrCode(montado.chave, ambiente, empresa.nfce_csc_id, csc, urlQr);
  }
  const assinatura = assinar(montado.infNFe, "infNFe", `NFe${montado.chave}`, cert);
  const nfe = `<NFe xmlns="${NS_NFE}">${montado.infNFe}${montarInfNFeSupl(qrCode, empresa.nfce_url_consulta)}${assinatura}</NFe>`;
  return { chave: montado.chave, nfe, qrCode, ambiente };
}

const lote = (nfe: string) => `<enviNFe xmlns="${NS_NFE}" versao="4.00"><idLote>${Date.now()}</idLote><indSinc>1</indSinc>${nfe}</enviNFe>`;

// Resultado da autorização: grava e devolve o documento atualizado
async function registrarRetorno(docId: string, nfe: string, retorno: string) {
  const prot = bloco(retorno, "protNFe");
  const cStat = valor(prot ?? retorno, "cStat");
  const motivo = valor(prot ?? retorno, "xMotivo");
  if (prot && (cStat === "100" || cStat === "150")) {
    const nfeProc = `<nfeProc xmlns="${NS_NFE}" versao="4.00">${nfe}${prot}</nfeProc>`;
    const { data: doc } = await servico.from("nfce_documentos").update({
      status: "autorizada", codigo_status: cStat, motivo, protocolo: valor(prot, "nProt"),
      xml_autorizado: nfeProc, emitida_em: new Date().toISOString(),
    }).eq("id", docId).select("*").single();
    return { ok: true as const, doc, cStat, motivo };
  }
  return { ok: false as const, doc: null, cStat, motivo };
}

// ------------------------------------------------------------------ Emissão
async function emitir(empresaId: string, vendaId: string) {
  const { data: venda } = await servico.from("vendas").select("*").eq("id", vendaId).eq("empresa_id", empresaId).maybeSingle();
  if (!venda) throw new ErroUsuario("Venda não encontrada.");
  if (venda.status !== "concluida") throw new ErroUsuario("Venda cancelada não pode ter NFC-e emitida.");

  const { data: anteriores } = await servico.from("nfce_documentos").select("*").eq("venda_id", vendaId).order("criado_em", { ascending: false });
  const pronta = anteriores?.find((d) => d.status === "autorizada" || d.status === "contingencia");
  if (pronta) return pronta;
  const reaproveitar = anteriores?.find((d) => d.status === "rejeitada" || d.status === "pendente");

  const empresa = await carregarEmpresa(empresaId);
  const { cert, csc } = await carregarCertificado(empresa);
  const ambiente = Number(empresa.nfce_ambiente) as 1 | 2;
  const serie = Number(empresa.nfce_serie);
  // Ficou sem resposta antes: confere se a SEFAZ autorizou, para não gerar duplicidade
  if (reaproveitar?.status === "pendente" && reaproveitar.chave && reaproveitar.xml_enviado) {
    try {
      const ret = await falar("consulta", empresa, consultaProtocolo(reaproveitar.chave, Number(reaproveitar.ambiente) as 1 | 2), cert);
      const prot = bloco(ret, "protNFe");
      if (prot && CONSULTA_AUTORIZADA.has(String(valor(prot, "cStat")))) {
        const r = await registrarRetorno(reaproveitar.id, reaproveitar.xml_enviado, prot);
        if (r.ok) return r.doc;
      }
    } catch (e) {
      if (!(e instanceof SemComunicacao)) throw e;
    }
  }
  const mesmaSerie = reaproveitar && reaproveitar.ambiente === ambiente && reaproveitar.serie === serie;

  // Contingência rejeitada na transmissão: corrige e reenvia com a mesma chave (mesmo número, código e data)
  const eraContingencia = mesmaSerie && Number(reaproveitar.tp_emis) === 9;
  let numero = mesmaSerie ? Number(reaproveitar.numero) : 0;
  if (!numero) {
    const { data: n, error } = await servico.rpc("proximo_numero", { p_empresa: empresaId, p_tipo: `nfce_${ambiente}`, p_serie: serie });
    if (error) throw error;
    numero = Number(n);
  }
  const m: Montagem = eraContingencia
    ? { numero, codigo: reaproveitar.codigo_numerico, emissao: new Date(reaproveitar.dh_emissao),
        contingencia: { inicio: new Date(reaproveitar.dh_contingencia), justificativa: reaproveitar.justificativa_contingencia } }
    : { numero, codigo: String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).padStart(8, "0"), emissao: new Date() };
  const { chave, nfe, qrCode } = await montarNota(empresa, venda, cert, csc, m);

  const registro = {
    empresa_id: empresaId, venda_id: vendaId, ambiente, serie, numero, chave, status: "pendente",
    qrcode_url: qrCode, xml_enviado: nfe, tentativas: (reaproveitar?.tentativas ?? 0) + 1,
    codigo_status: null, motivo: null, tp_emis: m.contingencia ? 9 : 1, codigo_numerico: m.codigo, dh_emissao: m.emissao.toISOString(),
    dh_contingencia: m.contingencia?.inicio.toISOString() ?? null, justificativa_contingencia: m.contingencia?.justificativa ?? null,
  };
  let docId: string;
  if (reaproveitar) {
    await servico.from("nfce_documentos").update(registro).eq("id", reaproveitar.id);
    docId = reaproveitar.id;
  } else {
    const { data: novo, error } = await servico.from("nfce_documentos").insert(registro).select("id").single();
    if (error) throw error;
    docId = novo.id;
  }

  let retorno: string;
  try {
    retorno = await falar("autorizacao", empresa, lote(nfe), cert);
  } catch (e) {
    if (!(e instanceof SemComunicacao)) throw e;
    await servico.from("nfce_documentos").update({ motivo: `Falha de comunicação: ${e.message}` }).eq("id", docId);
    if (empresa.nfce_contingencia && !eraContingencia) return await emitirContingencia(empresa, venda, cert, csc, docId, chave, "Sem comunicação com a SEFAZ (falha de conexão ou tempo esgotado)");
    throw new ErroUsuario("Não foi possível falar com a SEFAZ agora. A nota ficou pendente; tente reenviar.");
  }
  const r = await registrarRetorno(docId, nfe, retorno);
  if (r.ok) return r.doc;
  if (SEFAZ_INDISPONIVEL.has(String(r.cStat)) && empresa.nfce_contingencia && !eraContingencia) {
    return await emitirContingencia(empresa, venda, cert, csc, docId, chave, `SEFAZ indisponível (${r.cStat}: ${r.motivo})`);
  }
  await servico.from("nfce_documentos").update({ status: "rejeitada", codigo_status: r.cStat, motivo: r.motivo }).eq("id", docId);
  throw new ErroUsuario(`NFC-e rejeitada pela SEFAZ (${r.cStat}): ${r.motivo}`);
}

// Contingência off-line: novo número, tpEmis 9, QR Code versão 3. A tentativa on-line fica registrada
// (chave_original) para ser conferida antes da transmissão: se ela tiver sido autorizada, vale ela.
async function emitirContingencia(empresa: Record<string, any>, venda: Record<string, any>, cert: Certificado, csc: string,
  docOriginal: string, chaveOriginal: string, motivoTexto: string) {
  const ambiente = Number(empresa.nfce_ambiente) as 1 | 2;
  const serie = Number(empresa.nfce_serie);
  await servico.from("nfce_documentos").update({ status: "rejeitada", motivo: `Sem resposta da SEFAZ; substituída por emissão em contingência. ${motivoTexto}`.slice(0, 500) }).eq("id", docOriginal);
  const { data: n, error } = await servico.rpc("proximo_numero", { p_empresa: empresa.id, p_tipo: `nfce_${ambiente}`, p_serie: serie });
  if (error) throw error;
  const agora = new Date();
  const m: Montagem = {
    numero: Number(n), codigo: String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).padStart(8, "0"), emissao: agora,
    contingencia: { inicio: agora, justificativa: motivoTexto.length >= 15 ? motivoTexto.slice(0, 256) : "Sem comunicação com a SEFAZ autorizadora" },
  };
  const { chave, nfe, qrCode } = await montarNota(empresa, venda, cert, csc, m);
  const { data: doc, error: e2 } = await servico.from("nfce_documentos").insert({
    empresa_id: empresa.id, venda_id: venda.id, ambiente, serie, numero: m.numero, chave, status: "contingencia",
    qrcode_url: qrCode, xml_enviado: nfe, tentativas: 0, motivo: "Emitida em contingência; será transmitida quando a SEFAZ responder.",
    tp_emis: 9, codigo_numerico: m.codigo, dh_emissao: agora.toISOString(), dh_contingencia: agora.toISOString(),
    justificativa_contingencia: m.contingencia!.justificativa, chave_original: chaveOriginal, emitida_em: agora.toISOString(),
  }).select("*").single();
  if (e2) throw e2;
  return doc;
}

// ------------------------------------------------------------------ Transmissão das notas em contingência e pendentes
async function transmitir(empresaId: string) {
  const { data: docs } = await servico.from("nfce_documentos").select("*").eq("empresa_id", empresaId)
    .in("status", ["contingencia", "pendente"]).order("numero").limit(50);
  const res = { autorizadas: 0, rejeitadas: 0, sem_comunicacao: false, mensagens: [] as string[] };
  if (!docs?.length) return res;
  const empresa = await carregarEmpresa(empresaId);
  const { cert } = await carregarCertificado(empresa);
  const ambiente = Number(empresa.nfce_ambiente) as 1 | 2;

  const consultar = async (chave: string) => {
    const ret = await falar("consulta", empresa, consultaProtocolo(chave, ambiente), cert);
    return { cStat: valor(ret, "cStat"), prot: bloco(ret, "protNFe") };
  };

  try {
    for (const d of docs) {
      if (d.status === "pendente") {
        // Enviada sem resposta: descobre se chegou
        if (Date.now() - new Date(d.criado_em).getTime() < 120000 || !d.chave) continue;
        const c = await consultar(d.chave);
        if (c.prot && CONSULTA_AUTORIZADA.has(String(valor(c.prot, "cStat")))) {
          await registrarRetorno(d.id, d.xml_enviado, c.prot); res.autorizadas++
        } else if (CONSULTA_INEXISTENTE.has(String(c.cStat))) {
          await servico.from("nfce_documentos").update({ status: "rejeitada", codigo_status: c.cStat, motivo: "A nota não chegou à SEFAZ. Reenvie pela tela Vendas." }).eq("id", d.id);
        }
        continue;
      }
      // Contingência: antes de enviar, confere se a tentativa on-line foi autorizada
      if (d.chave_original) {
        const c = await consultar(d.chave_original);
        if (c.prot && CONSULTA_AUTORIZADA.has(String(valor(c.prot, "cStat")))) {
          const { data: orig } = await servico.from("nfce_documentos").select("id, xml_enviado").eq("empresa_id", empresaId).eq("chave", d.chave_original).maybeSingle();
          await servico.from("nfce_documentos").update({ status: "rejeitada", motivo: `A tentativa on-line foi autorizada; este número (${d.numero}) precisa ser inutilizado.` }).eq("id", d.id);
          if (orig) await registrarRetorno(orig.id, orig.xml_enviado, c.prot);
          res.autorizadas++; res.mensagens.push(`Venda com a nota nº ${d.numero}: valeu a autorização original; inutilize o nº ${d.numero}.`);
          continue;
        }
      }
      const retorno = await falar("autorizacao", empresa, lote(d.xml_enviado), cert);
      const r = await registrarRetorno(d.id, d.xml_enviado, retorno);
      if (r.ok) { res.autorizadas++; continue }
      if (SEFAZ_INDISPONIVEL.has(String(r.cStat))) { res.sem_comunicacao = true; break }
      await servico.from("nfce_documentos").update({ status: "rejeitada", codigo_status: r.cStat, motivo: r.motivo, tentativas: Number(d.tentativas) + 1 }).eq("id", d.id);
      res.rejeitadas++; res.mensagens.push(`Nota nº ${d.numero} rejeitada (${r.cStat}): ${r.motivo}`);
    }
  } catch (e) {
    if (e instanceof SemComunicacao) res.sem_comunicacao = true; else throw e;
  }
  return res;
}

// ------------------------------------------------------------------ Cancelamento
async function cancelar(usuario: Usuario, vendaId: string, justificativa: string) {
  if (!GESTORES.includes(usuario.papel)) throw new ErroUsuario("Cancelamento exige gerente ou administrador.");
  const just = validarJustificativa(justificativa ?? "", "o motivo do cancelamento");
  const { data: venda } = await servico.from("vendas").select("*").eq("id", vendaId).eq("empresa_id", usuario.empresa_id).maybeSingle();
  if (!venda || venda.status !== "concluida") throw new ErroUsuario("Venda não encontrada ou já cancelada.");
  // As mesmas travas do cancelamento da venda, conferidas antes de ir à SEFAZ
  const [{ count: recebidas }, { count: devolucoes }] = await Promise.all([
    servico.from("contas_receber").select("id", { count: "exact", head: true }).eq("venda_id", vendaId).gt("valor_pago", 0),
    servico.from("devolucoes").select("id", { count: "exact", head: true }).eq("venda_id", vendaId),
  ]);
  if (recebidas) throw new ErroUsuario("A venda tem parcelas já recebidas; faça uma devolução em vez de cancelar.");
  if (devolucoes) throw new ErroUsuario("A venda já tem devolução registrada.");

  const { data: doc } = await servico.from("nfce_documentos").select("*").eq("venda_id", vendaId).eq("status", "autorizada").maybeSingle();
  if (!doc) throw new ErroUsuario("Esta venda não tem NFC-e autorizada para cancelar.");
  const empresa = await carregarEmpresa(usuario.empresa_id);
  const { cert } = await carregarCertificado(empresa);
  const { infEvento } = montarCancelamento({
    chave: doc.chave, protocolo: doc.protocolo, cnpj: empresa.cnpj, uf: empresa.uf, ambiente: Number(doc.ambiente) as 1 | 2,
    justificativa: just, quando: new Date(),
  });
  const id = infEvento.match(/Id="([^"]+)"/)![1];
  const { evento, lote: loteEvento } = envelopeEvento(infEvento, assinar(infEvento, "infEvento", id, cert));
  let retorno: string;
  try {
    retorno = await falar("evento", empresa, loteEvento, cert);
  } catch (e) {
    if (e instanceof SemComunicacao) throw new ErroUsuario("Sem comunicação com a SEFAZ. Tente cancelar de novo em alguns minutos.");
    throw e;
  }
  const ret = bloco(retorno, "retEvento");
  const cStat = valor(ret ?? retorno, "cStat");
  const motivo = valor(ret ?? retorno, "xMotivo");
  if (!ret || !EVENTO_OK.has(String(cStat))) throw new ErroUsuario(`Cancelamento recusado pela SEFAZ (${cStat}): ${motivo}`);

  await servico.from("nfce_documentos").update({
    status: "cancelada", protocolo_cancelamento: valor(ret, "nProt"), cancelada_em: new Date().toISOString(),
    justificativa_cancelamento: just, codigo_status: cStat, motivo,
    xml_cancelamento: `<procEventoNFe xmlns="${NS_NFE}" versao="1.00">${evento}${ret}</procEventoNFe>`,
  }).eq("id", doc.id);

  // A venda é cancelada com a sessão do próprio usuário (estoque volta, auditoria registra quem foi)
  const { error } = await comoUsuario(usuario).rpc("cancelar_venda", { p_venda: vendaId, p_motivo: just });
  if (error) {
    return { cancelada_sefaz: true, venda_cancelada: false, aviso: `A NFC-e foi cancelada, mas a venda não: ${error.message}. Cancele a venda pela tela Vendas.`, codigo: cStat };
  }
  return { cancelada_sefaz: true, venda_cancelada: true, codigo: cStat, motivo };
}

// ------------------------------------------------------------------ Inutilização
async function inutilizar(usuario: Usuario, corpo: { serie?: number; inicio?: number; fim?: number; justificativa?: string; modelo?: number }) {
  if (!GESTORES.includes(usuario.papel)) throw new ErroUsuario("Inutilização exige gerente ou administrador.");
  const modelo = Number(corpo.modelo) === 55 ? 55 : 65;
  const tabela = modelo === 55 ? "nfe_documentos" : "nfce_documentos";
  const empresa = await carregarEmpresa(usuario.empresa_id, modelo);
  const ambiente = Number(empresa.nfce_ambiente) as 1 | 2;
  const serie = Number(corpo.serie ?? (modelo === 55 ? empresa.nfe_serie : empresa.nfce_serie));
  const inicio = Number(corpo.inicio), fim = Number(corpo.fim);
  const just = validarJustificativa(corpo.justificativa ?? "");
  const { data: usados } = await servico.from(tabela).select("numero, status").eq("empresa_id", usuario.empresa_id)
    .eq("ambiente", ambiente).eq("serie", serie).gte("numero", inicio).lte("numero", fim)
    .in("status", ["autorizada", "cancelada", "contingencia", "pendente"]);
  if (usados?.length) throw new ErroUsuario(`O nº ${usados[0].numero} está ${usados[0].status === "pendente" ? "pendente de resposta" : usados[0].status} e não pode ser inutilizado.`);
  const { cert } = await carregarCertificado(empresa, modelo === 65);
  const { id, infInut } = montarInutilizacao({ cnpj: empresa.cnpj, uf: empresa.uf, ambiente, serie, inicio, fim, justificativa: just, ano: new Date().getFullYear(), modelo });
  const xml = envelopeInutilizacao(infInut, assinar(infInut, "infInut", id, cert));
  let retorno: string;
  try {
    retorno = await falar("inutilizacao", empresa, xml, cert, modelo);
  } catch (e) {
    if (e instanceof SemComunicacao) throw new ErroUsuario("Sem comunicação com a SEFAZ. Tente de novo em alguns minutos.");
    throw e;
  }
  const ret = bloco(retorno, "retInutNFe") ?? retorno;
  const cStat = valor(ret, "cStat"), motivo = valor(ret, "xMotivo");
  if (cStat !== "102") throw new ErroUsuario(`Inutilização recusada pela SEFAZ (${cStat}): ${motivo}`);
  await servico.from("nfce_inutilizacoes").insert({
    empresa_id: usuario.empresa_id, modelo, ambiente, serie, inicio, fim, justificativa: just, protocolo: valor(ret, "nProt"),
    codigo_status: cStat, motivo, xml: `<ProcInutNFe xmlns="${NS_NFE}" versao="4.00">${xml}${ret}</ProcInutNFe>`, usuario_id: usuario.id,
  });
  await servico.from(tabela).update({ status: "inutilizada", motivo: `Número inutilizado (protocolo ${valor(ret, "nProt")}).` })
    .eq("empresa_id", usuario.empresa_id).eq("ambiente", ambiente).eq("serie", serie).gte("numero", inicio).lte("numero", fim).eq("status", "rejeitada");
  return { protocolo: valor(ret, "nProt"), codigo: cStat, motivo };
}


// ------------------------------------------------------------------ NF-e modelo 55
const comoUsuario = (usuario: Usuario) => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
  auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${usuario.token}` } },
});

async function carregarNfe(usuario: Usuario, id: string) {
  if (!GESTORES.includes(usuario.papel)) throw new ErroUsuario("NF-e exige gerente ou administrador.");
  const { data: d } = await servico.from("nfe_documentos").select("*").eq("id", id).eq("empresa_id", usuario.empresa_id).maybeSingle();
  if (!d) throw new ErroUsuario("NF-e não encontrada.");
  return d;
}

// Rateia o frete entre os itens pelo valor de cada um (a sobra fica no maior)
function ratearFrete(itens: { bruto: number }[], frete: number): number[] {
  const soma = itens.reduce((s, i) => s + i.bruto, 0);
  if (!(frete > 0) || soma <= 0) return itens.map(() => 0);
  const partes = itens.map((i) => Math.floor((frete * i.bruto / soma) * 100) / 100);
  const maior = itens.map((i) => i.bruto).indexOf(Math.max(...itens.map((i) => i.bruto)));
  partes[maior] = Math.round((partes[maior] + frete - partes.reduce((s, v) => s + v, 0)) * 100) / 100;
  return partes;
}

async function finalizarNfe(usuario: Usuario, docId: string, nfe: string, prot: string, cStat: string, motivo: string | null) {
  const nfeProc = `<nfeProc xmlns="${NS_NFE}" versao="4.00">${nfe}${prot}</nfeProc>`;
  const { data: doc } = await servico.from("nfe_documentos").update({
    status: "autorizada", codigo_status: cStat, motivo, protocolo: valor(prot, "nProt"), xml_autorizado: nfeProc, emitida_em: new Date().toISOString(),
  }).eq("id", docId).select("*").single();
  let aviso: string | null = null;
  if (doc?.mover_estoque) {
    const { error } = await comoUsuario(usuario).rpc("movimentar_estoque_nfe", { p_nfe: docId });
    if (error) aviso = `NF-e autorizada, mas o estoque não foi baixado: ${error.message}`;
  }
  return { ...doc, aviso };
}

async function emitirNfe(usuario: Usuario, id: string) {
  const d = await carregarNfe(usuario, id);
  if (d.status === "autorizada") return d;
  if (!["rascunho", "rejeitada", "pendente"].includes(d.status)) throw new ErroUsuario("Esta NF-e não pode ser emitida.");
  if (d.status === "pendente") return await consultarNfe(usuario, id);
  const itensDoc = (d.itens ?? []) as Record<string, any>[];
  if (!itensDoc.length) throw new ErroUsuario("Inclua pelo menos um produto.");
  const empresa = await carregarEmpresa(usuario.empresa_id, 55);
  const { cert } = await carregarCertificado(empresa, false);
  const ambiente = Number(empresa.nfce_ambiente) as 1 | 2;
  const serie = Number(empresa.nfe_serie ?? 1);
  let numero = d.numero && d.ambiente === ambiente && d.serie === serie ? Number(d.numero) : 0;
  if (!numero) {
    const { data: n, error } = await servico.rpc("proximo_numero", { p_empresa: empresa.id, p_tipo: `nfe_${ambiente}`, p_serie: serie });
    if (error) throw error;
    numero = Number(n);
  }
  const codigo = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).padStart(8, "0");
  const brutos = itensDoc.map((i) => ({ bruto: Math.round(Number(i.quantidade) * Number(i.valor_unitario) * 100) / 100 }));
  const fretes = ratearFrete(brutos, Number(d.frete?.valor ?? 0));
  const itens: ItemNota[] = itensDoc.map((i, k) => ({
    codigo: String(i.codigo || String(i.produto_id ?? k + 1).slice(0, 8)), ean: i.ean ?? null, descricao: i.descricao, ncm: String(i.ncm ?? ""),
    cest: i.cest ?? null, cfop: String(i.cfop || "5102"), unidade: String(i.unidade || "UN"), quantidade: Number(i.quantidade),
    valor_unitario: Number(i.valor_unitario), desconto: Number(i.desconto || 0), origem: Number(i.origem ?? 0),
    csosn: i.csosn ?? null, cst_icms: i.cst_icms ?? null, aliquota_icms: Number(i.aliquota_icms ?? 0), reducao_bc: Number(i.reducao_bc ?? 0),
    cbenef: i.cbenef ?? null, cst_pis: i.cst_pis ?? null, aliquota_pis: Number(i.aliquota_pis ?? 0), cst_cofins: i.cst_cofins ?? null,
    aliquota_cofins: Number(i.aliquota_cofins ?? 0), frete: fretes[k], xPed: i.pedido ?? null,
  }));
  let montado;
  try {
    montado = montarInfNFe55({
      emitente: {
        cnpj: empresa.cnpj, ie: empresa.inscricao_estadual, razao_social: empresa.razao_social, nome_fantasia: empresa.nome_fantasia,
        crt: empresa.regime_tributario === "normal" ? 3 : empresa.regime_tributario === "mei" ? 4 : empresa.regime_tributario === "simples_excesso" ? 2 : 1,
        uf: empresa.uf, municipio_ibge: empresa.municipio_ibge, endereco: empresa.endereco,
      },
      ambiente, serie, numero, codigo_numerico: codigo, emissao: new Date(),
      natureza: d.natureza, finalidade: d.finalidade, presenca: d.presenca, consumidorFinal: d.consumidor_final,
      destinatario: d.destinatario as Destinatario, itens,
      frete: { modalidade: Number(d.frete?.modalidade ?? 9) as 0 | 1 | 2 | 9, volumes: d.frete?.volumes ?? null },
      pagamentos: (d.pagamentos ?? []).map((p: Record<string, unknown>) => ({ forma: String(p.forma), valor: Number(p.valor) })),
      referencias: d.referencias ?? [], informacoes: d.informacoes, respTecnico: empresa.resp_tecnico,
    });
  } catch (e) {
    throw new ErroUsuario((e as Error).message);
  }
  const assinatura = assinar(montado.infNFe, "infNFe", `NFe${montado.chave}`, cert);
  const nfe = `<NFe xmlns="${NS_NFE}">${montado.infNFe}${assinatura}</NFe>`;
  await servico.from("nfe_documentos").update({
    status: "pendente", ambiente, serie, numero, chave: montado.chave, codigo_numerico: codigo, xml_enviado: nfe,
    valor_total: montado.vNF, codigo_status: null, motivo: null,
  }).eq("id", d.id);
  let retorno: string;
  try {
    retorno = await falar("autorizacao", empresa, lote(nfe), cert, 55);
  } catch (e) {
    if (!(e instanceof SemComunicacao)) throw e;
    await servico.from("nfe_documentos").update({ motivo: `Sem resposta da SEFAZ: ${e.message}` }).eq("id", d.id);
    throw new ErroUsuario("A SEFAZ não respondeu. A NF-e ficou pendente; use Consultar em alguns minutos.");
  }
  const prot = bloco(retorno, "protNFe");
  const cStat = valor(prot ?? retorno, "cStat");
  const motivo = valor(prot ?? retorno, "xMotivo");
  if (prot && (cStat === "100" || cStat === "150")) return await finalizarNfe(usuario, d.id, nfe, prot, cStat, motivo);
  await servico.from("nfe_documentos").update({ status: "rejeitada", codigo_status: cStat, motivo }).eq("id", d.id);
  throw new ErroUsuario(`NF-e rejeitada pela SEFAZ (${cStat}): ${motivo}`);
}

async function consultarNfe(usuario: Usuario, id: string) {
  const d = await carregarNfe(usuario, id);
  if (d.status !== "pendente" || !d.chave) return d;
  const empresa = await carregarEmpresa(usuario.empresa_id, 55);
  const { cert } = await carregarCertificado(empresa, false);
  let ret: string;
  try {
    ret = await falar("consulta", empresa, consultaProtocolo(d.chave, Number(d.ambiente) as 1 | 2), cert, 55);
  } catch (e) {
    if (e instanceof SemComunicacao) throw new ErroUsuario("A SEFAZ continua sem responder. Tente de novo em alguns minutos.");
    throw e;
  }
  const prot = bloco(ret, "protNFe");
  if (prot && CONSULTA_AUTORIZADA.has(String(valor(prot, "cStat")))) return await finalizarNfe(usuario, d.id, d.xml_enviado, prot, String(valor(prot, "cStat")), valor(prot, "xMotivo"));
  const cStat = valor(ret, "cStat");
  if (CONSULTA_INEXISTENTE.has(String(cStat))) {
    const { data } = await servico.from("nfe_documentos").update({ status: "rejeitada", codigo_status: cStat, motivo: "A nota não chegou à SEFAZ. Emita de novo." }).eq("id", d.id).select("*").single();
    return data;
  }
  throw new ErroUsuario(`Situação na SEFAZ (${cStat}): ${valor(ret, "xMotivo")}`);
}

async function eventoNfe(empresa: { nfce_ambiente: number; uf: string }, cert: Certificado, infEvento: string) {
  const id = infEvento.match(/Id="([^"]+)"/)![1];
  const { evento, lote: loteEvento } = envelopeEvento(infEvento, assinar(infEvento, "infEvento", id, cert));
  let retorno: string;
  try {
    retorno = await falar("evento", empresa, loteEvento, cert, 55);
  } catch (e) {
    if (e instanceof SemComunicacao) throw new ErroUsuario("Sem comunicação com a SEFAZ. Tente de novo em alguns minutos.");
    throw e;
  }
  const ret = bloco(retorno, "retEvento");
  const cStat = valor(ret ?? retorno, "cStat");
  const motivo = valor(ret ?? retorno, "xMotivo");
  if (!ret || !EVENTO_OK.has(String(cStat))) throw new ErroUsuario(`Evento recusado pela SEFAZ (${cStat}): ${motivo}`);
  return { ret, cStat, motivo, protocolo: valor(ret, "nProt"), xml: `<procEventoNFe xmlns="${NS_NFE}" versao="1.00">${evento}${ret}</procEventoNFe>` };
}

async function cancelarNfe(usuario: Usuario, id: string, justificativa: string) {
  const d = await carregarNfe(usuario, id);
  if (d.status !== "autorizada") throw new ErroUsuario("Só NF-e autorizada pode ser cancelada.");
  const just = validarJustificativa(justificativa ?? "", "o motivo do cancelamento");
  const empresa = await carregarEmpresa(usuario.empresa_id, 55);
  const { cert } = await carregarCertificado(empresa, false);
  const { infEvento } = montarCancelamento({ chave: d.chave, protocolo: d.protocolo, cnpj: empresa.cnpj, uf: empresa.uf, ambiente: Number(d.ambiente) as 1 | 2, justificativa: just, quando: new Date() });
  const r = await eventoNfe(empresa, cert, infEvento);
  await servico.from("nfe_documentos").update({
    status: "cancelada", cancelada_em: new Date().toISOString(), protocolo_cancelamento: r.protocolo, justificativa_cancelamento: just,
    codigo_status: r.cStat, motivo: r.motivo, xml_cancelamento: r.xml,
  }).eq("id", d.id);
  let aviso: string | null = null;
  if (d.estoque_movido) {
    const { error } = await comoUsuario(usuario).rpc("movimentar_estoque_nfe", { p_nfe: d.id, p_estornar: true });
    if (error) aviso = `A NF-e foi cancelada, mas o estoque não voltou: ${error.message}`;
  }
  return { cancelada: true, protocolo: r.protocolo, aviso };
}

async function cartaCorrecao(usuario: Usuario, id: string, correcao: string) {
  const d = await carregarNfe(usuario, id);
  if (d.status !== "autorizada") throw new ErroUsuario("A carta de correção vale só para NF-e autorizada.");
  const empresa = await carregarEmpresa(usuario.empresa_id, 55);
  const { cert } = await carregarCertificado(empresa, false);
  const sequencia = (d.cces ?? []).length + 1;
  let infEvento: string;
  try {
    ({ infEvento } = montarCartaCorrecao({ chave: d.chave, cnpj: empresa.cnpj, uf: empresa.uf, ambiente: Number(d.ambiente) as 1 | 2, correcao, quando: new Date(), sequencia }));
  } catch (e) {
    throw new ErroUsuario((e as Error).message);
  }
  const r = await eventoNfe(empresa, cert, infEvento);
  const cces = [...(d.cces ?? []), { sequencia, correcao: correcao.trim(), protocolo: r.protocolo, quando: new Date().toISOString(), xml: r.xml }];
  await servico.from("nfe_documentos").update({ cces }).eq("id", d.id);
  return { sequencia, protocolo: r.protocolo };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const usuario = await usuarioDaRequisicao(req);
    const corpo = await req.json().catch(() => ({}));
    if (corpo.acao === "testar") {
      if (usuario.papel !== "administrador") throw new ErroUsuario("Somente o administrador.");
      return resposta(await testar(usuario.empresa_id));
    }
    if (corpo.acao === "emitir") {
      if (!corpo.venda_id) throw new ErroUsuario("Informe a venda.");
      const doc = await emitir(usuario.empresa_id, corpo.venda_id);
      const { xml_enviado: _x, xml_autorizado: _y, ...semXml } = doc as Record<string, unknown>;
      return resposta(semXml);
    }
    if (corpo.acao === "transmitir") return resposta(await transmitir(usuario.empresa_id));
    if (corpo.acao === "cancelar") return resposta(await cancelar(usuario, corpo.venda_id, corpo.justificativa));
    if (corpo.acao === "inutilizar") return resposta(await inutilizar(usuario, corpo));
    if (corpo.acao === "nfe_emitir") {
      const doc = await emitirNfe(usuario, corpo.nfe_id);
      const { xml_enviado: _x, xml_autorizado: _y, ...semXml } = doc as Record<string, unknown>;
      return resposta(semXml);
    }
    if (corpo.acao === "nfe_consultar") {
      const doc = await consultarNfe(usuario, corpo.nfe_id);
      const { xml_enviado: _x, xml_autorizado: _y, ...semXml } = doc as Record<string, unknown>;
      return resposta(semXml);
    }
    if (corpo.acao === "nfe_cancelar") return resposta(await cancelarNfe(usuario, corpo.nfe_id, corpo.justificativa));
    if (corpo.acao === "nfe_cce") return resposta(await cartaCorrecao(usuario, corpo.nfe_id, corpo.correcao));
    throw new ErroUsuario("Ação desconhecida.");
  } catch (e) {
    if (e instanceof Error) return resposta({ erro: e.message }, 400);
    console.error(e);
    return resposta({ erro: "Erro interno ao processar a NFC-e." }, 500);
  }
});
