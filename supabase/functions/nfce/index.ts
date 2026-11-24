// Edge Function "nfce": testa a configuração fiscal e emite a NFC-e de uma venda.
// Ações (POST JSON): { acao: "testar" } | { acao: "emitir", venda_id }
import { createClient } from "@supabase/supabase-js";
import { montarInfNFe, montarQrCode, montarInfNFeSupl, ratearDesconto, NS_NFE, UF_CODIGO } from "./xml.ts";
import { lerPfx, assinar, type Certificado } from "./assinatura.ts";
import { enviar, statusServico, valor, bloco } from "./sefaz.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class ErroUsuario extends Error {}

const servico = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function usuarioDaRequisicao(req: Request) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const { data, error } = await servico.auth.getUser(token);
  if (error || !data.user) throw new ErroUsuario("Sessão inválida. Entre novamente.");
  const { data: u } = await servico.from("usuarios").select("id, empresa_id, papel, ativo").eq("id", data.user.id).maybeSingle();
  if (!u || !u.ativo) throw new ErroUsuario("Usuário sem empresa vinculada.");
  return u as { id: string; empresa_id: string; papel: string };
}

async function carregarEmpresa(empresaId: string) {
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
  if (!e.nfce_csc_id) faltando.push("ID do CSC");
  if (!e.nfce_url_qrcode || !e.nfce_url_consulta) faltando.push("endereços de consulta da NFC-e");
  if (faltando.length) throw new ErroUsuario(`Complete a configuração fiscal: ${faltando.join(", ")}.`);
  return e;
}

async function carregarCertificado(empresa: { id: string; cnpj: string }): Promise<{ cert: Certificado; csc: string }> {
  const { data, error } = await servico.rpc("ler_credenciais_fiscais", { p_empresa: empresa.id });
  if (error) throw error;
  if (!data?.pfx || !data?.senha) throw new ErroUsuario("Envie o certificado digital A1 e a senha na configuração fiscal.");
  if (!data?.csc) throw new ErroUsuario("Informe o CSC (código de segurança do contribuinte) na configuração fiscal.");
  const cert = lerPfx(data.pfx, data.senha);
  if (cert.validoAte < new Date()) throw new ErroUsuario("O certificado digital está vencido.");
  const cnpj = String(empresa.cnpj).replace(/\D/g, "");
  if (cert.cnpj && cert.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) {
    throw new ErroUsuario("O certificado digital não pertence ao CNPJ da empresa.");
  }
  return { cert, csc: data.csc };
}

async function testar(empresaId: string) {
  const empresa = await carregarEmpresa(empresaId);
  const { cert } = await carregarCertificado(empresa);
  await servico.from("empresas").update({ certificado_titular: cert.titular, certificado_validade: cert.validoAte.toISOString() }).eq("id", empresa.id);
  const ret = await statusServico(empresa.nfce_ambiente, empresa.uf, UF_CODIGO[empresa.uf], cert);
  return {
    titular: cert.titular,
    validade: cert.validoAte.toISOString(),
    sefaz: { codigo: valor(ret, "cStat"), mensagem: valor(ret, "xMotivo") },
  };
}

async function emitir(empresaId: string, vendaId: string) {
  const { data: venda } = await servico.from("vendas").select("*").eq("id", vendaId).eq("empresa_id", empresaId).maybeSingle();
  if (!venda) throw new ErroUsuario("Venda não encontrada.");
  if (venda.status !== "concluida") throw new ErroUsuario("Venda cancelada não pode ter NFC-e emitida.");

  const { data: anteriores } = await servico.from("nfce_documentos").select("*").eq("venda_id", vendaId).order("criado_em", { ascending: false });
  const autorizada = anteriores?.find((d) => d.status === "autorizada");
  if (autorizada) return autorizada;
  const reaproveitar = anteriores?.find((d) => d.status === "rejeitada" || d.status === "pendente");

  const empresa = await carregarEmpresa(empresaId);
  const { cert, csc } = await carregarCertificado(empresa);

  const [{ data: itens }, { data: pagamentos }] = await Promise.all([
    servico.from("venda_itens")
      .select("sequencia, quantidade, preco_unitario, desconto, descricao, produto:produtos(id, codigo, ean, ncm, cest, cfop, unidade, origem, csosn, cst_icms)")
      .eq("venda_id", vendaId).order("sequencia"),
    servico.from("venda_pagamentos").select("forma, valor").eq("venda_id", vendaId),
  ]);
  if (!itens?.length) throw new ErroUsuario("Venda sem itens.");

  const descontos = ratearDesconto(
    itens.map((i) => ({ bruto: Math.round(Number(i.quantidade) * Number(i.preco_unitario) * 100) / 100, desconto: Number(i.desconto) })),
    Number(venda.desconto),
  );

  const ambiente = Number(empresa.nfce_ambiente) as 1 | 2;
  const serie = Number(empresa.nfce_serie);
  let numero = reaproveitar && reaproveitar.ambiente === ambiente && reaproveitar.serie === serie ? Number(reaproveitar.numero) : 0;
  if (!numero) {
    const { data: n, error } = await servico.rpc("proximo_numero", { p_empresa: empresaId, p_tipo: `nfce_${ambiente}`, p_serie: serie });
    if (error) throw error;
    numero = Number(n);
  }
  const codigo = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).padStart(8, "0");

  const { chave, infNFe } = montarInfNFe({
    emitente: {
      cnpj: empresa.cnpj, ie: empresa.inscricao_estadual, razao_social: empresa.razao_social, nome_fantasia: empresa.nome_fantasia,
      crt: empresa.regime_tributario === "normal" ? 3 : empresa.regime_tributario === "mei" ? 4 : empresa.regime_tributario === "simples_excesso" ? 2 : 1,
      uf: empresa.uf, municipio_ibge: empresa.municipio_ibge, endereco: empresa.endereco,
    },
    ambiente, serie, numero, codigo_numerico: codigo, emissao: new Date(),
    itens: itens.map((i, k) => {
      const p = i.produto as Record<string, unknown>;
      return {
        codigo: String(p.codigo || String(p.id).slice(0, 8)), ean: p.ean as string, descricao: i.descricao,
        ncm: String(p.ncm ?? ""), cest: p.cest as string, cfop: String(p.cfop || "5102"), unidade: String(p.unidade || "UN"),
        quantidade: Number(i.quantidade), valor_unitario: Number(i.preco_unitario), desconto: descontos[k],
        origem: Number(p.origem ?? 0), csosn: p.csosn as string, cst_icms: p.cst_icms as string,
      };
    }),
    pagamentos: (pagamentos ?? []).map((p) => ({ forma: p.forma, valor: Number(p.valor) })),
    troco: Number(venda.troco),
    cpf_cnpj_consumidor: venda.cpf_consumidor,
  });

  const urlQr = ambiente === 1
    ? String(empresa.nfce_url_qrcode).replace("portal-homologacao", "portal")
    : String(empresa.nfce_url_qrcode);
  const qrCode = await montarQrCode(chave, ambiente, empresa.nfce_csc_id, csc, urlQr);
  const assinatura = assinar(infNFe, "infNFe", `NFe${chave}`, cert);
  const nfe = `<NFe xmlns="${NS_NFE}">${infNFe}${montarInfNFeSupl(qrCode, empresa.nfce_url_consulta)}${assinatura}</NFe>`;

  const registro = {
    empresa_id: empresaId, venda_id: vendaId, ambiente, serie, numero, chave, status: "pendente",
    qrcode_url: qrCode, xml_enviado: nfe, tentativas: (reaproveitar?.tentativas ?? 0) + 1,
    codigo_status: null, motivo: null,
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

  const lote = `<enviNFe xmlns="${NS_NFE}" versao="4.00"><idLote>${Date.now()}</idLote><indSinc>1</indSinc>${nfe}</enviNFe>`;
  let retorno: string;
  try {
    retorno = await enviar("autorizacao", ambiente, empresa.uf, lote, cert);
  } catch (e) {
    await servico.from("nfce_documentos").update({ motivo: `Falha de comunicação: ${String(e).slice(0, 250)}` }).eq("id", docId);
    throw new ErroUsuario("Não foi possível falar com a SEFAZ agora. A nota ficou pendente; tente reenviar.");
  }

  const prot = bloco(retorno, "protNFe");
  const cStat = valor(prot ?? retorno, "cStat");
  const motivo = valor(prot ?? retorno, "xMotivo");
  if (prot && (cStat === "100" || cStat === "150")) {
    const nfeProc = `<nfeProc xmlns="${NS_NFE}" versao="4.00">${nfe}${prot}</nfeProc>`;
    const { data: doc } = await servico.from("nfce_documentos").update({
      status: "autorizada", codigo_status: cStat, motivo, protocolo: valor(prot, "nProt"),
      xml_autorizado: nfeProc, emitida_em: new Date().toISOString(),
    }).eq("id", docId).select("*").single();
    return doc;
  }
  await servico.from("nfce_documentos").update({ status: "rejeitada", codigo_status: cStat, motivo }).eq("id", docId);
  throw new ErroUsuario(`NFC-e rejeitada pela SEFAZ (${cStat}): ${motivo}`);
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
      const { xml_enviado: _x, ...semXml } = doc as Record<string, unknown>;
      return resposta(semXml);
    }
    throw new ErroUsuario("Ação desconhecida.");
  } catch (e) {
    if (e instanceof Error) return resposta({ erro: e.message }, 400);
    console.error(e);
    return resposta({ erro: "Erro interno ao processar a NFC-e." }, 500);
  }
});
