/**
 * Endereços dos webservices da SEFAZ.
 *
 * A fonte é o próprio `recursos/ACBrNFeServicos.ini`, copiado do ACBr
 * (Fontes/ACBrDFe/ACBrNFe). Mantê-lo como arquivo, em vez de transcrever as
 * URLs para código, deixa a atualização resumida a trocar o .ini quando o ACBr
 * publicar uma revisão.
 *
 * A resolução reproduz o TACBrDFe.LerServicoDeParams: monta a sessão
 * `<Modelo>_<UF>_<P|H>`, procura a chave `<Servico>_<versão>` e segue o
 * redirecionamento `Usar=` quando a UF delega para um SVRS/SVAN da vida.
 *
 * Só a versão 4.00 do layout é atendida — é a única em vigor.
 */
import fs from 'fs';
import { arquivoRecurso } from './recursos.js';

export type Ambiente = 1 | 2; // 1=Produção, 2=Homologação
export type ModeloDFe = 'NFe' | 'NFCe';

/** Nomes de serviço como aparecem no .ini */
export type NomeServico =
  | 'NFeStatusServico'
  | 'NFeConsultaProtocolo'
  | 'NFeAutorizacao'
  | 'NFeRetAutorizacao'
  | 'NfeInutilizacao'
  | 'RecepcaoEvento'
  | 'CadConsultaCadastro'
  | 'NFeDistribuicaoDFe';

export const VERSAO_LAYOUT = '4.00';
/** Versão do QR-Code da NFC-e, que também escolhe a URL de consulta no .ini */
export const VERSAO_QRCODE = 2;
const NS_WSDL = 'http://www.portalfiscal.inf.br/nfe/wsdl/';

export interface ServicoResolvido {
  /** Endereço do webservice */
  url: string;
  /** Namespace do elemento nfeDadosMsg */
  servico: string;
  /** Cabeçalho SOAPAction do POST */
  soapAction: string;
  /** Sessão do .ini de onde a URL saiu, útil no log */
  sessao: string;
  versao: string;
}

// ---------------------------------------------------------------------------
// Leitura do .ini
// ---------------------------------------------------------------------------

type Secoes = Record<string, Record<string, string>>;

let cacheSecoes: Secoes | null = null;

function arquivoIni(): string {
  const achado = arquivoRecurso('ACBrNFeServicos.ini');
  if (!achado) {
    throw new Error(
      'recursos/ACBrNFeServicos.ini não encontrado. Ele vem do ACBr e é a fonte das URLs da SEFAZ. ' +
        'Em deploy serverless, confira o includeFiles do vercel.json.',
    );
  }
  return achado;
}

function lerSecoes(): Secoes {
  if (cacheSecoes) return cacheSecoes;

  const texto = fs.readFileSync(arquivoIni(), 'latin1');
  const secoes: Secoes = {};
  let atual = '';

  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha || linha.startsWith(';')) continue;

    const cab = linha.match(/^\[(.+)\]$/);
    if (cab) {
      atual = cab[1];
      secoes[atual] = secoes[atual] || {};
      continue;
    }

    const sep = linha.indexOf('=');
    if (sep < 0 || !atual) continue;
    secoes[atual][linha.slice(0, sep).trim()] = linha.slice(sep + 1).trim();
  }

  cacheSecoes = secoes;
  return secoes;
}

/** Busca sem diferenciar maiúsculas: o .ini alterna NfeInutilizacao/NFeInutilizacao */
function valorChave(secao: Record<string, string>, chave: string): string | undefined {
  const alvo = chave.toLowerCase();
  for (const k of Object.keys(secao)) {
    if (k.toLowerCase() === alvo) return secao[k];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Resolução
// ---------------------------------------------------------------------------

/**
 * @param uf UF do emitente, ou um ambiente nacional/virtual ("AN", "SVRS", "SVAN", "SVC-AN", "SVC-RS")
 */
export function resolverServico(
  modelo: ModeloDFe,
  uf: string,
  ambiente: Ambiente,
  servico: NomeServico,
  versao: string = VERSAO_LAYOUT,
): ServicoResolvido {
  const secoes = lerSecoes();
  const sufixo = ambiente === 1 ? 'P' : 'H';
  const chave = `${servico}_${versao}`;

  let sessao = `${modelo}_${uf.toUpperCase()}_${sufixo}`;
  const visitadas: string[] = [];
  let url: string | undefined;

  while (!url) {
    if (visitadas.includes(sessao)) {
      throw new Error(`Redirecionamento circular no ACBrNFeServicos.ini a partir de "${sessao}".`);
    }
    visitadas.push(sessao);

    const secao = secoes[sessao];
    if (!secao) {
      throw new Error(`Sessão "${sessao}" não existe no ACBrNFeServicos.ini.`);
    }

    url = valorChave(secao, chave);
    if (url) break;

    const usar = valorChave(secao, 'Usar');
    if (!usar) {
      throw new Error(
        `O serviço "${chave}" não está publicado para "${sessao}" no ACBrNFeServicos.ini. ` +
          'Verifique a UF, o ambiente e a forma de emissão.',
      );
    }
    sessao = usar;
  }

  // Namespace e SOAPAction: SP e BA usam grafias próprias, registradas no .ini
  const ufNorm = uf.toUpperCase();
  const sufixoNs = ufNorm === 'SP' ? '_SP' : '';
  const nsSecao = secoes[`WSDL_V4${sufixoNs}`] || {};
  const actionSecao =
    (ufNorm === 'BA' ? secoes['SOAP_V4_BA'] : secoes[`SOAP_V4${sufixoNs}`]) || {};

  const servicoNs = valorChave(nsSecao, chave) || `${NS_WSDL}${servico}4`;
  const soapAction = valorChave(actionSecao, chave) || servicoNs;

  return { url, servico: servicoNs, soapAction, sessao: visitadas[visitadas.length - 1], versao };
}

/** Distribuição DF-e roda sempre no Ambiente Nacional, na versão 1.01 */
export function resolverDistribuicaoDFe(ambiente: Ambiente): ServicoResolvido {
  const resolvido = resolverServico('NFe', 'AN', ambiente, 'NFeDistribuicaoDFe', '1.01');
  return {
    ...resolvido,
    servico: `${NS_WSDL}NFeDistribuicaoDFe`,
    soapAction: `${NS_WSDL}NFeDistribuicaoDFe/nfeDistDFeInteresse`,
  };
}

// ---------------------------------------------------------------------------
// UFs
// ---------------------------------------------------------------------------

/** Código do IBGE de cada UF: os dois primeiros dígitos da chave de acesso */
export const CODIGO_UF: Record<string, number> = {
  AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
  MA: 21, MT: 51, MS: 50, MG: 31, PA: 15, PB: 25, PR: 41, PE: 26, PI: 22,
  RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42, SP: 35, SE: 28, TO: 17,
  AN: 91,
};

export const UFS = Object.keys(CODIGO_UF).filter((u) => u !== 'AN').sort();

export function ufPorCodigo(codigo: number | string): string {
  const n = Number(codigo);
  return Object.keys(CODIGO_UF).find((uf) => CODIGO_UF[uf] === n) || '';
}

/**
 * Mesma regra do LerServicoChaveDeParams do ACBr: procura a chave na versão
 * pedida, cai para a maior versão inferior publicada e só usa a chave sem
 * sufixo quando não existe nenhuma versionada. Em SP, por exemplo, a chave sem
 * sufixo ainda aponta para as páginas .aspx antigas e só a _1.00 traz a URL
 * curta — que é a única que cabe no limite de 85 caracteres do urlChave.
 */
function valorChaveVersionada(
  secao: Record<string, string>,
  chave: string,
  versao: number,
): string | undefined {
  const base = `${chave.toLowerCase()}_`;
  let melhor = 0;
  let achada: string | undefined;

  for (const k of Object.keys(secao)) {
    if (!k.toLowerCase().startsWith(base)) continue;
    const v = Number(k.slice(base.length));
    if (v > melhor && v <= versao) {
      melhor = v;
      achada = secao[k];
    }
  }

  return achada ?? valorChave(secao, chave);
}

/** URL de consulta pública da NF-e/NFC-e e do QR-Code, usadas no DANFE */
export function urlsConsulta(
  modelo: ModeloDFe,
  uf: string,
  ambiente: Ambiente,
  versaoQrCode = VERSAO_QRCODE,
) {
  const secoes = lerSecoes();
  const sufixo = ambiente === 1 ? 'P' : 'H';
  let sessao = `${modelo}_${uf.toUpperCase()}_${sufixo}`;
  const visitadas: string[] = [];

  while (secoes[sessao] && !visitadas.includes(sessao)) {
    visitadas.push(sessao);
    const secao = secoes[sessao];
    const chaveConsulta = modelo === 'NFe' ? 'URL-ConsultaNFe' : 'URL-ConsultaNFCe';
    const qrCode = valorChaveVersionada(secao, 'URL-QRCode', versaoQrCode);
    const consulta = valorChaveVersionada(secao, chaveConsulta, versaoQrCode);
    if (qrCode || consulta) return { qrCode: qrCode || '', consulta: consulta || '' };
    const usar = valorChave(secao, 'Usar');
    if (!usar) break;
    sessao = usar;
  }

  return { qrCode: '', consulta: '' };
}
