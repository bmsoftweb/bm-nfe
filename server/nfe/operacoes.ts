/**
 * Operações com a SEFAZ: os botões das abas Consultas, Eventos, Inutilização,
 * Envios e Distribuição DF-e do exemplo Delphi.
 *
 * Cada função monta a mensagem XML do layout 4.00, assina quando é exigido,
 * transmite pelo SOAP e devolve um retorno já digerido (cStat, xMotivo, XML).
 */
import zlib from 'zlib';
import { Contexto, emitenteSemIE, registrarLog } from './contexto.js';
import { assinar } from './assinatura.js';
import { enviarSoap } from './soap.js';
import {
  Ambiente,
  CODIGO_UF,
  NomeServico,
  resolverDistribuicaoDFe,
  resolverServico,
  VERSAO_LAYOUT,
  ufPorCodigo,
} from './servicos.js';
import { DECLARACAO, NS_NFE, escapar, grupoObrigatorio, lerXml, limparTexto, num, recortarElemento, semDeclaracao, tag, valorTag } from './xml.js';
import { dataHoraDFe, agora } from './datas.js';
import { acharTipoEvento, COND_USO_CCE, EVENTOS_CANCELAVEIS } from './eventos.js';
import { chaveValida, lerChave } from './chave.js';
import { exigirValido, validarEvento, validarInutilizacao, validarNFe } from './validacao.js';

export interface Retorno {
  sucesso: boolean;
  cStat: number;
  xMotivo: string;
  /** XML de resposta do serviço, já sem o envelope SOAP */
  xml: string;
  /** Envelope enviado, exibido na aba "Dados" */
  envio: string;
  /** Resposta HTTP completa, exibida na aba "Retorno Completo WS" */
  retornoCompleto: string;
  url: string;
  duracaoMs: number;
  /** Campos extras específicos de cada operação */
  dados?: Record<string, any>;
}

/** A forma de emissão redireciona para as SEFAZ virtuais (ACBrNFe.LerServicoDeParams) */
function ufDoServico(ctx: Contexto): string {
  switch (ctx.config.geral.formaEmissao) {
    case 6:
      return 'SVC-AN';
    case 7:
      return 'SVC-RS';
    default:
      // NT 2026.007: a NF-e de contribuinte exclusivo do IBS/CBS (sem IE) é autorizada só na SVRS
      return ctx.modelo === 'NFe' && emitenteSemIE(ctx.emitente) ? 'SVRS' : ctx.config.webservice.uf;
  }
}

/**
 * UF que atende uma nota pela chave. Nota do próprio emitente sem IE foi autorizada
 * na SVRS, e as consultas e os eventos dela vão para lá também (NT 2026.007, RV 1P10-40);
 * a NF-e avulsa (série 890-919) fica de fora.
 */
export function ufDaNota(ctx: Contexto, chave: string): string {
  const c = lerChave(chave);
  const propria = c.cnpj === ctx.emitente.cnpj.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const avulsa = c.serie >= 890 && c.serie <= 919;
  if (c.modelo === '55' && propria && !avulsa && emitenteSemIE(ctx.emitente)) return 'SVRS';
  return ufPorCodigo(c.cUF);
}

function proxy(ctx: Contexto) {
  const w = ctx.config.webservice;
  return w.proxyHost
    ? { host: w.proxyHost, porta: w.proxyPorta, usuario: w.proxyUsuario, senha: w.proxySenha }
    : undefined;
}

async function transmitir(
  ctx: Contexto,
  operacao: string,
  servico: NomeServico,
  mensagem: string,
  opcoes: {
    uf?: string;
    chave?: string;
    elementoCorpo?: string;
    cabecalho?: { cUF: number; versaoDados: string };
    versaoServico?: string;
    ambienteNacional?: boolean;
  } = {},
): Promise<Retorno> {
  const ambiente = ctx.config.webservice.ambiente as Ambiente;
  const resolvido = opcoes.ambienteNacional
    ? resolverServico('NFe', 'AN', ambiente, servico, opcoes.versaoServico)
    : resolverServico(
        ctx.modelo,
        opcoes.uf || ufDoServico(ctx),
        ambiente,
        servico,
        opcoes.versaoServico,
      );

  const resposta = await enviarSoap({
    servico: resolvido,
    mensagem,
    certificado: ctx.certificado,
    elementoCorpo: opcoes.elementoCorpo,
    cabecalho: opcoes.cabecalho,
    timeoutMs: (ctx.config.webservice.timeout || 30) * 1000,
    proxy: proxy(ctx),
  });

  const cStat = Number(valorTag(resposta.retorno, 'cStat') || 0);
  const xMotivo = valorTag(resposta.retorno, 'xMotivo');

  const retorno: Retorno = {
    // Um cStat na faixa 100-199 é aceitação; o resto é rejeição ou aviso
    sucesso: cStat >= 100 && cStat < 200,
    cStat,
    xMotivo,
    xml: resposta.retorno,
    envio: resposta.envelope,
    retornoCompleto: resposta.retornoCompleto,
    url: resolvido.url,
    duracaoMs: resposta.duracaoMs,
  };

  await registrarLog(ctx.empresaId, {
    operacao,
    url: resolvido.url,
    chave: opcoes.chave,
    sucesso: retorno.sucesso,
    codigoStatus: cStat,
    motivo: xMotivo,
    duracaoMs: resposta.duracaoMs,
    envio: resposta.envelope,
    retorno: resposta.retornoCompleto,
  });

  return retorno;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/** Status do serviço na SEFAZ da UF configurada */
export async function statusServico(ctx: Contexto): Promise<Retorno> {
  const uf = ufDoServico(ctx);
  const cUF = CODIGO_UF[uf.toUpperCase()] ?? CODIGO_UF[ctx.emitente.uf];

  const mensagem =
    `<consStatServ versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    tag('cUF', cUF) +
    '<xServ>STATUS</xServ>' +
    '</consStatServ>';

  const ret = await transmitir(ctx, 'statusServico', 'NFeStatusServico', mensagem, { uf });

  ret.dados = {
    ambiente: Number(valorTag(ret.xml, 'tpAmb')),
    uf: ufPorCodigo(valorTag(ret.xml, 'cUF')),
    versaoAplicacao: valorTag(ret.xml, 'verAplic'),
    dataHoraRetorno: valorTag(ret.xml, 'dhRecbto'),
    tempoMedioResposta: valorTag(ret.xml, 'tMed'),
    dataHoraRetorno2: valorTag(ret.xml, 'dhRetorno'),
    observacao: valorTag(ret.xml, 'xObs'),
  };
  return ret;
}

/** Situação de uma NF-e pela chave de acesso */
export async function consultarChave(ctx: Contexto, chave: string): Promise<Retorno> {
  const limpa = chave.replace(/\D/g, '');
  if (!chaveValida(limpa)) throw new Error('Chave de acesso inválida (44 dígitos e dígito verificador).');

  const mensagem =
    `<consSitNFe versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    '<xServ>CONSULTAR</xServ>' +
    tag('chNFe', limpa) +
    '</consSitNFe>';

  const ret = await transmitir(ctx, 'consultarChave', 'NFeConsultaProtocolo', mensagem, {
    chave: limpa,
    // A consulta vai para a UF que emitiu a nota, que pode não ser a configurada
    uf: ufDaNota(ctx, limpa) || undefined,
  });

  ret.dados = {
    chave: limpa,
    protocolo: valorTag(ret.xml, 'nProt'),
    dataAutorizacao: valorTag(ret.xml, 'dhRecbto'),
    digestValue: valorTag(ret.xml, 'digVal'),
    protNFe: recortarElemento(ret.xml, 'protNFe'),
    eventos: recortarElemento(ret.xml, 'procEventoNFe'),
  };
  return ret;
}

/** Consulta cadastro de contribuinte. A mensagem continua na versão 2.00. */
export async function consultarCadastro(
  ctx: Contexto,
  uf: string,
  documento: { cnpj?: string; cpf?: string; ie?: string },
): Promise<Retorno> {
  const alvo =
    tag('IE', documento.ie?.replace(/\D/g, '')) ||
    tag('CNPJ', documento.cnpj?.replace(/\D/g, '')) ||
    tag('CPF', documento.cpf?.replace(/\D/g, ''));

  if (!alvo) throw new Error('Informe a Inscrição Estadual, o CNPJ ou o CPF a consultar.');

  const mensagem =
    `<ConsCad versao="2.00" xmlns="${NS_NFE}">` +
    '<infCons><xServ>CONS-CAD</xServ>' +
    tag('UF', uf.toUpperCase()) +
    alvo +
    '</infCons></ConsCad>';

  const ret = await transmitir(ctx, 'consultarCadastro', 'CadConsultaCadastro', mensagem, {
    uf,
    cabecalho: { cUF: CODIGO_UF[uf.toUpperCase()], versaoDados: '2.00' },
  });

  // O retorno da consulta de cadastro usa cStat 111/112 para "encontrado"
  ret.sucesso = [111, 112].includes(ret.cStat);
  const bloco = lerXml(ret.xml);
  ret.dados = { retConsCad: bloco?.retConsCad ?? null };
  return ret;
}

// ---------------------------------------------------------------------------
// Inutilização
// ---------------------------------------------------------------------------

export interface PedidoInutilizacao {
  ano: number;
  modelo: string;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
}

/** Monta e assina o <inutNFe>, sem transmitir. Separado para o autoteste validar o XML real. */
export function montarInutilizacao(ctx: Contexto, p: PedidoInutilizacao): { id: string; assinado: string } {
  const justificativa = limparTexto(p.justificativa);
  if (justificativa.length < 15) {
    throw new Error('A justificativa da inutilização precisa ter ao menos 15 caracteres.');
  }
  if (p.numeroFinal < p.numeroInicial) {
    throw new Error('O número final precisa ser maior ou igual ao inicial.');
  }

  const cUF = CODIGO_UF[ctx.config.webservice.uf.toUpperCase()];
  const id =
    'ID' +
    String(cUF).padStart(2, '0') +
    String(p.ano).slice(-2) +
    ctx.emitente.cnpj.padStart(14, '0') +
    String(p.modelo).padStart(2, '0') +
    String(p.serie).padStart(3, '0') +
    String(p.numeroInicial).padStart(9, '0') +
    String(p.numeroFinal).padStart(9, '0');

  const corpo =
    `<inutNFe versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    `<infInut Id="${id}">` +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    '<xServ>INUTILIZAR</xServ>' +
    tag('cUF', cUF) +
    tag('ano', String(p.ano).slice(-2)) +
    tag('CNPJ', ctx.emitente.cnpj) +
    tag('mod', p.modelo) +
    tag('serie', p.serie) +
    tag('nNFIni', p.numeroInicial) +
    tag('nNFFin', p.numeroFinal) +
    tag('xJust', justificativa) +
    '</infInut></inutNFe>';

  return { id, assinado: assinar(corpo, 'infInut', id, ctx.certificado) };
}

export async function inutilizar(ctx: Contexto, p: PedidoInutilizacao): Promise<Retorno> {
  const { id, assinado } = montarInutilizacao(ctx, p);

  exigirValido(
    await validarInutilizacao(assinado),
    'Falha na validação dos dados da inutilização.',
    ctx.config.geral.exibirErroSchema,
  );

  const ret = await transmitir(ctx, 'inutilizar', 'NfeInutilizacao', assinado);

  ret.dados = {
    id,
    protocolo: valorTag(ret.xml, 'nProt'),
    dataRecebimento: valorTag(ret.xml, 'dhRecbto'),
    xmlEnvio: assinado,
    /** Arquivo de distribuição, que é o que se guarda */
    procInutNFe:
      ret.cStat === 102
        ? `${DECLARACAO}<ProcInutNFe versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
          `${semDeclaracao(assinado)}${recortarElemento(ret.xml, 'retInutNFe') || ''}</ProcInutNFe>`
        : null,
  };
  return ret;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export interface PedidoEvento {
  chave: string;
  tipoEvento: string;
  sequencia?: number;
  justificativa?: string;
  protocolo?: string;
  correcao?: string;
  /** 112150: nova data de previsão de entrega (aaaa-mm-dd) */
  dataPrevisaoEntrega?: string;
  /** 112140: itens da nota de pagamento antecipado que não foram fornecidos */
  itensNaoFornecidos?: {
    item: number;
    valorIBS: number;
    valorCBS: number;
    quantidade: number;
    unidade: string;
  }[];
  /** 110300: transação financeira a vincular à nota */
  vinculoPagamento?: {
    idTransacao: string;
    /** Código do meio de pagamento (Informe Técnico 2026.001) */
    meioPagamento: string;
    cnpjRecebedor: string;
    /** CNPJ base (8 posições) da instituição de pagamento do recebedor */
    cnpjBasePSP: string;
  };
  /** 110001: código do evento a cancelar; o protocolo dele vai em `protocolo` */
  eventoCancelado?: string;
  /** Campos livres de eventos que não têm campo dedicado (ex.: ator interessado) */
  extras?: Record<string, string>;
}

/** 110001: o evento cancelado, conferido contra os que o nfeWeb emite */
function eventoACancelar(p: PedidoEvento) {
  if (!EVENTOS_CANCELAVEIS.includes(String(p.eventoCancelado))) {
    throw new Error(`Informe o evento a cancelar: ${EVENTOS_CANCELAVEIS.join(', ')}.`);
  }
  return acharTipoEvento(String(p.eventoCancelado));
}

function montarDetEvento(tipo: ReturnType<typeof acharTipoEvento>, p: PedidoEvento): string {
  const partes: string[] = [tag('descEvento', tipo.descEvento)];

  // 110001 tem leiaute próprio: sem tpAutor, com o tipo e o protocolo do evento cancelado
  if (tipo.cancelaEvento) {
    const alvo = eventoACancelar(p);
    if (!/^\d{15}$/.test(p.protocolo || '')) throw new Error('Informe o protocolo (15 dígitos) do evento a cancelar.');
    partes.push(
      tag('cOrgaoAutor', lerChave(p.chave).cUF),
      tag('verAplic', 'nfeWeb'),
      tag('tpEventoAut', alvo.codigo),
      tag('nProtEvento', p.protocolo),
    );
    return `<detEvento versao="1.00">${partes.join('')}</detEvento>`;
  }

  // Os eventos da reforma têm um preâmbulo próprio: autor, tipo de autor e aplicativo
  if (tipo.grupo === 'reforma') {
    partes.push(
      tag('cOrgaoAutor', lerChave(p.chave).cUF),
      tag('tpAutor', 1),
      tag('verAplic', 'nfeWeb'),
    );
  }

  if (tipo.exigeDataPrevisao) {
    const data = String(p.dataPrevisaoEntrega || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      throw new Error('Informe a nova data de previsão de entrega.');
    }
    partes.push(tag('dPrevEntrega', data));
  }

  if (tipo.exigeItemNaoFornecido) {
    const itens = p.itensNaoFornecidos || [];
    if (!itens.length) {
      throw new Error('Informe ao menos um item da nota de pagamento antecipado que não foi fornecido.');
    }
    for (const i of itens) {
      if (!i.unidade?.trim()) throw new Error('Informe a unidade da quantidade não fornecida.');
      partes.push(
        `<gItemNaoFornecido nItem="${Number(i.item) || 1}">` +
          tag('vIBS', num(i.valorIBS)) +
          tag('vCBS', num(i.valorCBS)) +
          grupoObrigatorio('gControleEstoque',
            tag('qNaoFornecida', num(i.quantidade, 4)),
            tag('uNaoFornecida', limparTexto(i.unidade, 6))) +
          '</gItemNaoFornecido>',
      );
    }
  }

  if (tipo.exigeProtocolo) {
    if (!p.protocolo) throw new Error('Informe o número do protocolo de autorização da NF-e.');
    partes.push(tag('nProt', p.protocolo));
  }

  if (tipo.exigeVinculoPagamento) {
    const vp = p.vinculoPagamento;
    const id = String(vp?.idTransacao || '').trim();
    if (id.length < 2) throw new Error('Informe o identificador da transação de pagamento (2 a 35 caracteres).');
    const meio = String(vp?.meioPagamento || '').replace(/\D/g, '');
    if (!meio) throw new Error('Informe o código do meio de pagamento.');
    partes.push(
      `<gPgto idTransacao="${escapar(id.slice(0, 35))}">` +
        tag('tpMeioPgto', meio.padStart(2, '0')) +
        tag('CNPJReceb', String(vp?.cnpjRecebedor || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()) +
        tag('CNPJBasePSP', String(vp?.cnpjBasePSP || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()) +
        '</gPgto>',
    );
  }

  if (tipo.exigeCorrecao) {
    const correcao = limparTexto(p.correcao || '');
    if (correcao.length < 15) throw new Error('O texto da correção precisa ter ao menos 15 caracteres.');
    partes.push(tag('xCorrecao', correcao), tag('xCondUso', COND_USO_CCE));
  }

  if (tipo.exigeJustificativa && !tipo.exigeCorrecao) {
    const justificativa = limparTexto(p.justificativa || '');
    if (justificativa.length < 15) throw new Error('A justificativa precisa ter ao menos 15 caracteres.');
    partes.push(tag('xJust', justificativa));
  }

  for (const [nome, valor] of Object.entries(p.extras || {})) {
    partes.push(tag(nome, limparTexto(valor)));
  }

  return `<detEvento versao="1.00">${partes.join('')}</detEvento>`;
}

/** Monta e assina o lote <envEvento>, sem transmitir. Separado para o autoteste validar o XML real. */
export function montarEvento(ctx: Contexto, p: PedidoEvento) {
  const chave = p.chave.replace(/\D/g, '');
  if (!chaveValida(chave)) throw new Error('Chave de acesso inválida.');

  const tipo = acharTipoEvento(p.tipoEvento);
  const sequencia = p.sequencia || 1;
  const id = `ID${tipo.codigo}${chave}${String(sequencia).padStart(2, '0')}`;
  const cOrgao = tipo.orgaoNacional ? 91 : lerChave(chave).cUF;

  const infEvento =
    `<infEvento Id="${id}">` +
    tag('cOrgao', cOrgao) +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    tag('CNPJ', ctx.emitente.cnpj) +
    tag('chNFe', chave) +
    tag('dhEvento', dataHoraDFe()) +
    tag('tpEvento', tipo.codigo) +
    tag('nSeqEvento', sequencia) +
    '<verEvento>1.00</verEvento>' +
    montarDetEvento(tipo, p) +
    '</infEvento>';

  const evento = `<evento versao="1.00" xmlns="${NS_NFE}">${infEvento}</evento>`;
  const eventoAssinado = assinar(evento, 'infEvento', id, ctx.certificado);

  const mensagem =
    `<envEvento versao="1.00" xmlns="${NS_NFE}">` +
    tag('idLote', '1') +
    semDeclaracao(eventoAssinado).replace(` xmlns="${NS_NFE}"`, '') +
    '</envEvento>';

  return { chave, tipo, sequencia, id, cOrgao, eventoAssinado, mensagem };
}

export async function enviarEvento(ctx: Contexto, p: PedidoEvento): Promise<Retorno> {
  const { chave, tipo, sequencia, id, cOrgao, eventoAssinado, mensagem } = montarEvento(ctx, p);

  exigirValido(
    await validarEvento(mensagem, tipo.codigo),
    `Falha na validação dos dados do evento (${tipo.descricao}).`,
    ctx.config.geral.exibirErroSchema,
  );

  const ret = await transmitir(ctx, `evento_${tipo.codigo}`, 'RecepcaoEvento', mensagem, {
    chave,
    // Os eventos da reforma tributária são recebidos pela SVRS para todas as UFs; o
    // cancelamento genérico (110001) vai para onde foi o evento que ele cancela
    uf: tipo.orgaoNacional ? 'AN'
      : (tipo.cancelaEvento ? eventoACancelar(p) : tipo).orgaoSVRS ? 'SVRS'
      : ufDaNota(ctx, chave) || undefined,
    ambienteNacional: tipo.orgaoNacional,
  });

  const retEvento = recortarElemento(ret.xml, 'retEvento') || '';
  const cStatEvento = Number(valorTag(retEvento, 'cStat') || ret.cStat);

  // O lote pode ser aceito (128) com o evento dentro rejeitado: vale o de dentro
  ret.cStat = cStatEvento || ret.cStat;
  ret.xMotivo = valorTag(retEvento, 'xMotivo') || ret.xMotivo;
  ret.sucesso = [135, 136, 155].includes(ret.cStat);

  ret.dados = {
    id,
    tipoEvento: tipo.codigo,
    descricao: tipo.descricao,
    sequencia,
    protocolo: valorTag(retEvento, 'nProt'),
    dataRegistro: valorTag(retEvento, 'dhRegEvento'),
    xmlEnvio: eventoAssinado,
    procEventoNFe: ret.sucesso
      ? `${DECLARACAO}<procEventoNFe versao="1.00" xmlns="${NS_NFE}">` +
        `${semDeclaracao(eventoAssinado).replace(` xmlns="${NS_NFE}"`, '')}${retEvento}</procEventoNFe>`
      : null,
  };
  return ret;
}

// ---------------------------------------------------------------------------
// Autorização
// ---------------------------------------------------------------------------

/**
 * Envia a NF-e já assinada. Em modo síncrono (indSinc=1) o protocolo vem na
 * mesma resposta; em assíncrono a SEFAZ devolve um recibo a consultar depois.
 */
export async function autorizar(
  ctx: Contexto,
  xmlNFe: string,
  opcoes: { idLote?: string; sincrono?: boolean } = {},
): Promise<Retorno> {
  const sincrono = opcoes.sincrono !== false;
  const chave = (xmlNFe.match(/Id="NFe(\d{44})"/) || [])[1];

  // Também cobre XML importado ou editado fora do sistema: nada sai sem passar no schema
  exigirValido(
    await validarNFe(xmlNFe),
    `Falha na validação dos dados da nota: ${Number(valorTag(xmlNFe, 'nNF')) || ''}`.trim(),
    ctx.config.geral.exibirErroSchema,
  );

  const mensagem =
    `<enviNFe versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    tag('idLote', opcoes.idLote || String(Date.now()).slice(-15)) +
    tag('indSinc', sincrono ? 1 : 0) +
    semDeclaracao(xmlNFe).replace(` xmlns="${NS_NFE}"`, ` xmlns="${NS_NFE}"`) +
    '</enviNFe>';

  const ret = await transmitir(ctx, 'autorizar', 'NFeAutorizacao', mensagem, { chave });

  const protNFe = recortarElemento(ret.xml, 'protNFe');
  const cStatNota = protNFe ? Number(valorTag(protNFe, 'cStat')) : 0;

  ret.dados = {
    chave,
    recibo: valorTag(ret.xml, 'nRec'),
    // 103 = lote recebido (assíncrono); 104 = lote processado (síncrono)
    loteProcessado: ret.cStat === 104,
    cStatNota,
    motivoNota: protNFe ? valorTag(protNFe, 'xMotivo') : '',
    protocolo: protNFe ? valorTag(protNFe, 'nProt') : '',
    protNFe,
    autorizada: cStatNota === 100 || cStatNota === 150,
  };
  return ret;
}

/** Consulta o recibo de um lote enviado em modo assíncrono */
export async function consultarRecibo(ctx: Contexto, recibo: string): Promise<Retorno> {
  const mensagem =
    `<consReciNFe versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    tag('nRec', recibo.replace(/\D/g, '')) +
    '</consReciNFe>';

  const ret = await transmitir(ctx, 'consultarRecibo', 'NFeRetAutorizacao', mensagem);

  const protNFe = recortarElemento(ret.xml, 'protNFe');
  ret.dados = {
    recibo,
    // 105 = lote em processamento; vale tentar de novo
    emProcessamento: ret.cStat === 105,
    protNFe,
    cStatNota: protNFe ? Number(valorTag(protNFe, 'cStat')) : 0,
    motivoNota: protNFe ? valorTag(protNFe, 'xMotivo') : '',
    protocolo: protNFe ? valorTag(protNFe, 'nProt') : '',
    chave: protNFe ? valorTag(protNFe, 'chNFe') : '',
  };
  return ret;
}

// ---------------------------------------------------------------------------
// Distribuição DF-e
// ---------------------------------------------------------------------------

export interface DocumentoDistribuido {
  nsu: string;
  schema: string;
  xml: string;
  chave: string;
  tipo: string;
  emitente: string;
  valor: number | null;
  data: string;
}

export async function distribuicaoDFe(
  ctx: Contexto,
  filtro: { ultNSU?: string; nsu?: string; chave?: string },
): Promise<Retorno> {
  let consulta: string;
  if (filtro.chave) {
    const chave = filtro.chave.replace(/\D/g, '');
    if (!chaveValida(chave)) throw new Error('Chave de acesso inválida.');
    consulta = `<consChNFe>${tag('chNFe', chave)}</consChNFe>`;
  } else if (filtro.nsu) {
    consulta = `<consNSU>${tag('NSU', String(filtro.nsu).padStart(15, '0'))}</consNSU>`;
  } else {
    consulta = `<distNSU>${tag('ultNSU', String(filtro.ultNSU || '0').padStart(15, '0'))}</distNSU>`;
  }

  const mensagem =
    `<distDFeInt versao="1.01" xmlns="${NS_NFE}">` +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    tag('cUFAutor', CODIGO_UF[ctx.emitente.uf?.toUpperCase()] || CODIGO_UF[ctx.config.webservice.uf]) +
    tag('CNPJ', ctx.emitente.cnpj) +
    consulta +
    '</distDFeInt>';

  const servico = resolverDistribuicaoDFe(ctx.config.webservice.ambiente as Ambiente);
  const resposta = await enviarSoap({
    servico,
    mensagem,
    certificado: ctx.certificado,
    elementoCorpo: 'nfeDistDFeInteresse',
    timeoutMs: (ctx.config.webservice.timeout || 30) * 1000,
    proxy: proxy(ctx),
  });

  const cStat = Number(valorTag(resposta.retorno, 'cStat') || 0);
  const ret: Retorno = {
    // 138 = documento(s) localizado(s); 137 = nenhum documento novo
    sucesso: cStat === 138 || cStat === 137,
    cStat,
    xMotivo: valorTag(resposta.retorno, 'xMotivo'),
    xml: resposta.retorno,
    envio: resposta.envelope,
    retornoCompleto: resposta.retornoCompleto,
    url: servico.url,
    duracaoMs: resposta.duracaoMs,
  };

  ret.dados = {
    ultNSU: valorTag(ret.xml, 'ultNSU'),
    maxNSU: valorTag(ret.xml, 'maxNSU'),
    dataHoraResposta: valorTag(ret.xml, 'dhResp'),
    documentos: descompactarDocumentos(ret.xml),
  };

  await registrarLog(ctx.empresaId, {
    operacao: 'distribuicaoDFe',
    url: servico.url,
    sucesso: ret.sucesso,
    codigoStatus: cStat,
    motivo: ret.xMotivo,
    duracaoMs: resposta.duracaoMs,
    envio: resposta.envelope,
    retorno: resposta.retornoCompleto,
  });

  return ret;
}

/** Cada <docZip> vem em base64 de um gzip — é assim que o AN devolve os XMLs */
function descompactarDocumentos(xml: string): DocumentoDistribuido[] {
  const documentos: DocumentoDistribuido[] = [];
  const regex = /<docZip\s+NSU="(\d+)"\s+schema="([^"]+)"\s*>([\s\S]*?)<\/docZip>/gi;

  for (const m of xml.matchAll(regex)) {
    let conteudo = '';
    try {
      conteudo = zlib.gunzipSync(Buffer.from(m[3].replace(/\s+/g, ''), 'base64')).toString('utf8');
    } catch (err) {
      conteudo = `<!-- Falha ao descompactar o NSU ${m[1]}: ${String(err)} -->`;
    }

    documentos.push({
      nsu: m[1],
      schema: m[2],
      xml: conteudo,
      chave: valorTag(conteudo, 'chNFe') || (conteudo.match(/Id="NFe(\d{44})"/) || [])[1] || '',
      tipo: m[2].split('_')[0],
      emitente: valorTag(conteudo, 'xNome'),
      valor: Number(valorTag(conteudo, 'vNF')) || null,
      data: valorTag(conteudo, 'dhEmi') || valorTag(conteudo, 'dEmi') || valorTag(conteudo, 'dhRecbto') || '',
    });
  }

  return documentos;
}

/** Junta a NF-e assinada ao protocolo de autorização: é o XML que vale como documento */
export function montarProcNFe(xmlNFe: string, protNFe: string): string {
  return (
    `${DECLARACAO}<nfeProc versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    semDeclaracao(xmlNFe).replace(` xmlns="${NS_NFE}"`, ` xmlns="${NS_NFE}"`) +
    protNFe +
    '</nfeProc>'
  );
}

/** Data/hora atual no formato do layout — reexportada para as rotas */
export { dataHoraDFe, agora };
