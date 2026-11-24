// Gera uma NFC-e assinada com certificado de teste (uso local: node --experimental-strip-types)
import { readFileSync, writeFileSync } from "node:fs";
import { montarInfNFe, montarQrCode, montarInfNFeSupl, ratearDesconto, NS_NFE, digitoChave } from "../functions/nfce/xml.ts";
import { lerPfx, assinar } from "../functions/nfce/assinatura.ts";

const cert = lerPfx(readFileSync(process.argv[2], "utf8").trim(), "1234");
console.log("titular:", cert.titular, "cnpj:", cert.cnpj, "validade:", cert.validoAte.toISOString().slice(0, 10));

// DV conhecido de chave pública de exemplo do manual (43 dígitos + DV)
const exemplo = "3511031029073900013955001000000001105112804";
console.log("dv exemplo:", digitoChave(exemplo));

const descontos = ratearDesconto([{ bruto: 30, desconto: 0 }, { bruto: 10, desconto: 1 }], 3.9);
console.log("rateio:", descontos);

const { chave, infNFe, vNF } = montarInfNFe({
  emitente: {
    cnpj: "12345678000195", ie: "151234567", razao_social: "Empresa Teste & Cia <Ltda>", nome_fantasia: "Teste",
    crt: 1, uf: "PA", municipio_ibge: "1501808",
    endereco: { logradouro: "Rua Um", numero: "10", bairro: "Centro", municipio: "Breves", cep: "68800-000", fone: "(91) 99999-0000" },
  },
  ambiente: 2, serie: 1, numero: 42, codigo_numerico: "12345678", emissao: new Date("2026-11-24T15:00:00Z"),
  itens: [
    { codigo: "1", ean: "7891234567895", descricao: "Dipirona 500mg", ncm: "30049099", cfop: "5102", unidade: "UN", quantidade: 3, valor_unitario: 10, desconto: descontos[0], origem: 0, csosn: "102" },
    { codigo: "2", ean: null, descricao: "Álcool 70%", ncm: "22071090", cfop: "5102", unidade: "FR", quantidade: 1, valor_unitario: 10, desconto: descontos[1], origem: 0, csosn: "102" },
  ],
  pagamentos: [{ forma: "pix", valor: 20 }, { forma: "dinheiro", valor: 20 }], troco: 4.9,
  cpf_cnpj_consumidor: "123.456.789-09",
});
const assinatura = assinar(infNFe, "infNFe", `NFe${chave}`, cert);
const qr = await montarQrCode(chave, 2, "000001", "CSC-TESTE", "https://exemplo/qrcode");
const nfe = `<NFe xmlns="${NS_NFE}">${infNFe}${montarInfNFeSupl(qr, "www.exemplo.gov.br/nfce/consulta")}${assinatura}</NFe>`;
writeFileSync("/tmp/nfce_teste.xml", nfe);
console.log("chave:", chave, "vNF:", vNF);
console.log("qr:", qr);
