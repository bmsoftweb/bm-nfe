/**
 * Transporte SOAP para os webservices da SEFAZ.
 *
 * O envelope é montado igual ao TDFeWebService.DefinirEnvelopeSoap do ACBr:
 * soap12, corpo em <nfeDadosMsg xmlns="<serviço>">, e o cabeçalho
 * <nfeCabecMsg> só nos serviços que ainda o exigem (a versão 4.00 dispensou).
 *
 * O TLS é mútuo: o certificado A1 do emitente autentica o cliente.
 */
import fs from 'fs';
import https from 'https';
import path from 'path';
import tls from 'tls';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { URL } from 'url';
import type { CertificadoCarregado } from './certificado.js';
import { ServicoResolvido } from './servicos.js';
import { pastaRecursos } from './recursos.js';

/**
 * Autoridades confiáveis para validar o servidor da SEFAZ.
 *
 * Os webservices estaduais ficam sob a Raiz Brasileira da ICP-Brasil, que não
 * está no pacote de CAs do Node nem, em geral, no repositório do Windows. Sem
 * acrescentá-la o handshake morre em "unable to get local issuer certificate".
 * A alternativa seria desligar a verificação do servidor — o que deixaria a
 * conexão (e o XML assinado dentro dela) aberta a interceptação.
 *
 * Basta jogar novos .crt/.pem em recursos/cadeias para que passem a valer.
 */
let cacheAutoridades: string[] | null = null;

function autoridades(): string[] {
  if (cacheAutoridades) return cacheAutoridades;

  const extras: string[] = [];
  const base = pastaRecursos();
  const pasta = base ? path.join(base, 'cadeias') : null;

  if (pasta && fs.existsSync(pasta)) {
    for (const arquivo of fs.readdirSync(pasta)) {
      if (!/\.(crt|pem|cer)$/i.test(arquivo)) continue;
      extras.push(fs.readFileSync(path.join(pasta, arquivo), 'utf8'));
    }
  }

  // As CAs padrão continuam valendo: as extras somam, não substituem
  const padrao =
    typeof (tls as any).getCACertificates === 'function'
      ? ((tls as any).getCACertificates('default') as string[])
      : (tls as any).rootCertificates || [];

  cacheAutoridades = [...padrao, ...extras];
  return cacheAutoridades;
}

export interface OpcoesProxy {
  host?: string;
  porta?: number | string;
  usuario?: string;
  senha?: string;
}

export interface OpcoesEnvio {
  servico: ServicoResolvido;
  /** XML da mensagem, sem declaração e já assinado quando for o caso */
  mensagem: string;
  certificado: CertificadoCarregado;
  /** Nome do elemento do corpo; o padrão serve para quase todos os serviços */
  elementoCorpo?: string;
  /** Preenche <nfeCabecMsg> — só a versão 3.10 e a consulta de cadastro usam */
  cabecalho?: { cUF: number; versaoDados: string };
  timeoutMs?: number;
  proxy?: OpcoesProxy;
}

export interface RespostaEnvio {
  /** Corpo devolvido pelo webservice, já sem o envelope SOAP */
  retorno: string;
  /** Resposta HTTP completa, exibida na aba "Retorno Completo WS" */
  retornoCompleto: string;
  envelope: string;
  status: number;
  duracaoMs: number;
}

const ATRIBUTOS_ENVELOPE =
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
  'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
  'xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"';

export function montarEnvelope(op: OpcoesEnvio): string {
  const corpo = op.elementoCorpo || 'nfeDadosMsg';
  const ns = op.servico.servico;

  const cabecalho = op.cabecalho
    ? `<soap12:Header><nfeCabecMsg xmlns="${ns}">` +
      `<cUF>${op.cabecalho.cUF}</cUF><versaoDados>${op.cabecalho.versaoDados}</versaoDados>` +
      `</nfeCabecMsg></soap12:Header>`
    : '';

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<soap12:Envelope ${ATRIBUTOS_ENVELOPE}>` +
    cabecalho +
    `<soap12:Body><${corpo} xmlns="${ns}">${op.mensagem}</${corpo}></soap12:Body>` +
    '</soap12:Envelope>'
  );
}

/** Tira o envelope SOAP e devolve só o XML de resposta do serviço */
export function desembrulhar(resposta: string): string {
  const corpo = resposta.match(/<(?:\w+:)?Body[^>]*>([\s\S]*?)<\/(?:\w+:)?Body>/i);
  const interno = corpo ? corpo[1].trim() : resposta.trim();

  // O conteúdo vem embrulhado em <nfeXxxResult> ou <nfeXxxResponse><...Result>
  const result = interno.match(/<(?:\w+:)?\w*Result[^>]*>([\s\S]*?)<\/(?:\w+:)?\w*Result>/i);
  if (result) return result[1].trim();

  // Alguns serviços devolvem o XML direto dentro de um elemento de resposta
  const response = interno.match(/<(?:\w+:)?\w*Response[^>]*>([\s\S]*?)<\/(?:\w+:)?\w*Response>/i);
  return (response ? response[1] : interno).trim();
}

/** TLS mútuo com o A1 do emitente, pelo proxy da configuração quando houver */
function opcoesTls(certificado: CertificadoCarregado, proxy?: OpcoesProxy): https.RequestOptions {
  const opcoes: https.RequestOptions = {
    key: certificado.chavePrivadaPem,
    cert: [certificado.certificadoPem, ...certificado.cadeiaPem].join('\n'),
    ca: autoridades(),
    // Vários webservices estaduais ainda negociam com chaves e curvas que o
    // OpenSSL 3 classifica como fracas; sem baixar o nível o handshake falha.
    minVersion: 'TLSv1.2',
    ciphers: 'DEFAULT@SECLEVEL=1',
  };

  if (proxy?.host) {
    const auth = proxy.usuario ? `${proxy.usuario}:${proxy.senha || ''}@` : '';
    opcoes.agent = new HttpsProxyAgent(`http://${auth}${proxy.host}:${proxy.porta || 8080}`, opcoes as any);
  }
  return opcoes;
}

export async function enviarSoap(op: OpcoesEnvio): Promise<RespostaEnvio> {
  const envelope = montarEnvelope(op);
  const inicio = Date.now();
  const alvo = new URL(op.servico.url);

  const corpo = Buffer.from(envelope, 'utf8');

  return new Promise<RespostaEnvio>((resolve, reject) => {
    const req = https.request(
      {
        ...opcoesTls(op.certificado, op.proxy),
        host: alvo.hostname,
        port: alvo.port || 443,
        path: alvo.pathname + alvo.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': corpo.length,
          SOAPAction: op.servico.soapAction,
          Accept: 'application/soap+xml, text/xml, */*',
        },
      },
      (res) => {
        const pedacos: Buffer[] = [];
        res.on('data', (d) => pedacos.push(d));
        res.on('end', () => {
          const retornoCompleto = Buffer.concat(pedacos).toString('utf8');
          resolve({
            retorno: desembrulhar(retornoCompleto),
            retornoCompleto,
            envelope,
            status: res.statusCode || 0,
            duracaoMs: Date.now() - inicio,
          });
        });
      },
    );

    req.setTimeout(op.timeoutMs || 30000, () => {
      req.destroy(new Error(`O webservice não respondeu em ${(op.timeoutMs || 30000) / 1000}s.`));
    });

    req.on('error', (err: any) => {
      reject(traduzirErro(err, op.servico.url));
    });

    req.write(corpo);
    req.end();
  });
}

/**
 * GET com o mesmo TLS mútuo, para os serviços REST que pedem o certificado
 * (as tabelas da reforma tributária no Conformidade Fácil da SVRS)
 */
export function obterComCertificado(
  url: string,
  certificado: CertificadoCarregado,
  proxy?: OpcoesProxy,
  timeoutMs = 60000,
): Promise<{ status: number; corpo: string }> {
  const alvo = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        ...opcoesTls(certificado, proxy),
        host: alvo.hostname,
        port: alvo.port || 443,
        path: alvo.pathname + alvo.search,
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      (res) => {
        const pedacos: Buffer[] = [];
        res.on('data', (d) => pedacos.push(d));
        res.on('end', () => resolve({ status: res.statusCode || 0, corpo: Buffer.concat(pedacos).toString('utf8') }));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`O serviço não respondeu em ${timeoutMs / 1000}s.`)));
    req.on('error', (err) => reject(traduzirErro(err, url)));
    req.end();
  });
}

/** Mensagens de rede/TLS com a causa provável, em vez do código cru do OpenSSL */
function traduzirErro(err: any, url: string): Error {
  const codigo = err?.code || '';
  const mapa: Record<string, string> = {
    ENOTFOUND: 'Servidor da SEFAZ não encontrado (DNS). Verifique a conexão e a UF configurada.',
    ECONNREFUSED: 'A SEFAZ recusou a conexão.',
    ETIMEDOUT: 'Tempo esgotado aguardando a SEFAZ.',
    EPROTO: 'Falha no handshake TLS com a SEFAZ. Geralmente é certificado vencido ou sem cadeia completa.',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
      'Não foi possível validar o certificado do servidor da SEFAZ: falta a autoridade raiz. ' +
      'Coloque o .crt da raiz em recursos/cadeias.',
    SELF_SIGNED_CERT_IN_CHAIN:
      'A cadeia apresentada pela SEFAZ tem um certificado não confiável. ' +
      'Se houver proxy ou antivírus inspecionando HTTPS, a raiz dele precisa entrar em recursos/cadeias.',
    ERR_TLS_CERT_ALTNAME_INVALID: 'O certificado apresentado pela SEFAZ não confere com o endereço.',
    CERT_HAS_EXPIRED: 'O certificado usado na conexão está vencido.',
  };

  const detalhe = mapa[codigo] || err?.message || String(err);
  const e = new Error(`${detalhe} (${url})`);
  (e as any).code = codigo;
  return e;
}
