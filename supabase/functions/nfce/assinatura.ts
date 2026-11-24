// Leitura do certificado A1 (.pfx) e assinatura XML (XMLDSig, RSA-SHA1, C14N) exigida pela SEFAZ.
import forge from "node-forge";
import { NS_NFE } from "./xml.ts";

const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

export interface Certificado {
  chavePem: string;
  certPem: string;
  certBase64: string;
  titular: string;
  cnpj: string | null;
  validoAte: Date;
  privada: forge.pki.rsa.PrivateKey;
}

export function lerPfx(pfxBase64: string, senha: string): Certificado {
  let p12;
  try {
    const der = forge.util.decode64(pfxBase64);
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), senha);
  } catch {
    throw new Error("Não foi possível abrir o certificado. Verifique o arquivo e a senha.");
  }
  const chaves = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const privada = chaves[0]?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!privada) throw new Error("O certificado não contém a chave privada.");
  // Certificado do titular = o que corresponde à chave privada
  const titularBag = certs.find((b: forge.pkcs12.Bag) => {
    const pub = b.cert?.publicKey as forge.pki.rsa.PublicKey | undefined;
    return pub && pub.n.equals(privada.n);
  }) ?? certs[0];
  const cert = titularBag?.cert;
  if (!cert) throw new Error("O certificado não contém o certificado do titular.");
  const cn = String(cert.subject.getField("CN")?.value ?? "");
  const cnpj = cn.match(/:(\d{14})$/)?.[1] ?? null;
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return {
    chavePem: forge.pki.privateKeyToPem(privada),
    certPem: forge.pki.certificateToPem(cert),
    certBase64: forge.util.encode64(certDer),
    titular: cn,
    cnpj,
    validoAte: cert.validity.notAfter,
    privada,
  };
}

function sha1Base64(texto: string) {
  const md = forge.md.sha1.create();
  md.update(texto, "utf8");
  return forge.util.encode64(md.digest().getBytes());
}

// Assina um elemento gerado em forma canônica.
// elemento: XML do elemento (sem xmlns herdado); id: valor do atributo Id; nsHerdado: namespace do pai.
export function assinar(elemento: string, nomeTag: string, id: string, cert: Certificado, nsHerdado = NS_NFE): string {
  // Forma canônica: o namespace herdado entra como primeiro atributo do elemento
  const canonico = elemento.replace(`<${nomeTag} `, `<${nomeTag} xmlns="${nsHerdado}" `);
  const digest = sha1Base64(canonico);

  const signedInfoCorpo =
    `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${NS_DSIG}rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="${NS_DSIG}enveloped-signature"></Transform>` +
    `<Transform Algorithm="${C14N}"></Transform>` +
    `</Transforms><DigestMethod Algorithm="${NS_DSIG}sha1"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue></Reference>`;
  const signedInfoCanonico = `<SignedInfo xmlns="${NS_DSIG}">${signedInfoCorpo}</SignedInfo>`;

  const md = forge.md.sha1.create();
  md.update(signedInfoCanonico, "utf8");
  const valor = forge.util.encode64(cert.privada.sign(md));

  return `<Signature xmlns="${NS_DSIG}"><SignedInfo>${signedInfoCorpo}</SignedInfo>` +
    `<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${cert.certBase64}</X509Certificate></X509Data></KeyInfo></Signature>`;
}

// Assinatura RSA-SHA1 de um texto qualquer, em base64 (QR Code versão 3 da contingência)
export function assinarTexto(texto: string, cert: Certificado): string {
  const md = forge.md.sha1.create();
  md.update(texto, "utf8");
  return forge.util.encode64(cert.privada.sign(md));
}
