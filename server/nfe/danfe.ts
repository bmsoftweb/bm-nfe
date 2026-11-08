/**
 * DANFE em PDF, gerado com pdfkit.
 *
 * O exemplo Delphi delega para o FortesReport (ACBrNFeDANFeRL); aqui o desenho é
 * feito direto, seguindo o Manual de Integração: o mesmo conjunto de quadros
 * obrigatórios, canhoto, código de barras CODE128C da chave e tabela de itens.
 * O formato do modelo 55 segue o tpImp (retrato, paisagem ou DANFE simplificado);
 * para a NFC-e sai o DANFE NFC-e em bobina, com o QR-Code.
 */
import fs from 'node:fs/promises';
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js/node';
import { lerXml, valorTag } from './xml.js';
import { paraBR } from './datas.js';
import { situacaoPeloStatus } from './concentrador.js';

const MM = 2.834645669; // 1 mm em pontos
const CINZA = '#444444';
/** Espessura das bordas: 0,25 pt é cerca de um ponto de impressora a 300 dpi (linha bem fina) */
const LINHA = 0.25;
/** Raio dos cantos arredondados dos quadros */
const RAIO = 2;
/** Altura das maiúsculas e dígitos em relação ao tamanho da fonte (Helvetica): base da centralização vertical */
const ALTURA_MAIUSCULA = 0.72;

/** Valor com casas fixas; zero ou ausente sai "0,00", como pede o quadro do DANFE */
function moeda(valor: any, casas = 2): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function chaveFormatada(chave: string): string {
  return (chave.match(/.{1,4}/g) || []).join(' ');
}

function comoLista<T>(valor: T | T[] | undefined): T[] {
  if (!valor) return [];
  return Array.isArray(valor) ? valor : [valor];
}

async function codigoDeBarras(texto: string, largura: number, altura: number): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: texto,
    scale: 3,
    height: altura,
    includetext: false,
    width: largura,
  });
}

async function qrcode(texto: string): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid: 'qrcode', text: texto, scale: 4, includetext: false });
}

/** Imagem da logomarca (URL, data: URI ou caminho no servidor); sem ela o DANFE sai só com o texto */
async function carregarLogo(origem?: string): Promise<Buffer | null> {
  const s = origem?.trim();
  if (!s) return null;
  try {
    if (s.startsWith('data:')) return Buffer.from(s.slice(s.indexOf(',') + 1), 'base64');
    if (/^https?:\/\//i.test(s)) {
      const r = await fetch(s, { signal: AbortSignal.timeout(10000) });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    }
    return await fs.readFile(s);
  } catch {
    return null;
  }
}

/** modFrete no quadro do transportador */
const MODALIDADE_FRETE: Record<string, string> = {
  '0': '0 - Remetente (CIF)',
  '1': '1 - Destinatário (FOB)',
  '2': '2 - Terceiros',
  '3': '3 - Próprio Remetente',
  '4': '4 - Próprio Destinatário',
  '9': '9 - Sem Frete',
};

export interface OpcoesDanfe {
  /** URL, data: URI ou caminho de imagem da logomarca (PNG ou JPEG) */
  logo?: string;
  /** A logomarca já traz nome e endereço: ocupa o quadro do emitente inteiro, sem os dados dele */
  expandirLogo?: boolean;
  /** Imprime a tarja de homologação */
  homologacao?: boolean;
  /** Formato atual da série (1 retrato, 2 paisagem, 3 simplificado); sem ele vale o tpImp do XML */
  formato?: number;
}

/**
 * @param xml nfeProc (NF-e + protocolo) ou a própria NFe, quando ainda não autorizada
 */
export async function gerarDanfe(xml: string, opcoes: OpcoesDanfe = {}): Promise<Buffer> {
  const doc = lerXml(xml);
  const nfe = doc?.nfeProc?.NFe || doc?.NFe;
  if (!nfe?.infNFe) throw new Error('O XML informado não contém uma NF-e.');

  const inf = nfe.infNFe;
  const chave = String(inf['@Id'] || '').replace(/\D/g, '');
  const modelo = String(inf.ide?.mod || '55');

  if (modelo === '65') return danfceBobina(inf, chave, xml, opcoes);
  // Formato atual da série ou, sem ele, o tpImp gravado na emissão: 1 retrato, 2 paisagem, 3 simplificado
  const tpImp = String(opcoes.formato ?? inf.ide?.tpImp ?? '1');
  return tpImp === '3' ? danfeSimplificado(inf, chave, xml, opcoes) : danfeRetrato(inf, chave, xml, opcoes, tpImp === '2');
}

// ---------------------------------------------------------------------------
// DANFE modelo 55
// ---------------------------------------------------------------------------

async function danfeRetrato(inf: any, chave: string, xml: string, opcoes: OpcoesDanfe, paisagem: boolean): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    layout: paisagem ? 'landscape' : 'portrait',
    margin: 5 * MM,
    info: { Title: `DANFE ${inf.ide?.nNF || ''}`, Author: inf.emit?.xNome || '' },
  });

  const pedacos: Buffer[] = [];
  pdf.on('data', (d) => pedacos.push(d));
  const pronto = new Promise<Buffer>((resolve) => pdf.on('end', () => resolve(Buffer.concat(pedacos))));

  const esq = pdf.page.margins.left;
  const larg = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const protocolo = valorTag(xml, 'nProt');
  const dataProtocolo = valorTag(xml, 'dhRecbto');

  const quadro = (x: number, y: number, w: number, h: number) => {
    pdf.lineWidth(LINHA).strokeColor(CINZA).roundedRect(x, y, w, h, RAIO).stroke();
  };

  /** Topo do texto para as maiúsculas ficarem no meio do espaço entre `de` e `ate` */
  const centroVertical = (de: number, ate: number, tamanho: number) => de + (ate - de - tamanho * ALTURA_MAIUSCULA) / 2;

  const campo = (x: number, y: number, w: number, h: number, rotulo: string, valor: string, opts: { tamanho?: number; centro?: boolean; direita?: boolean } = {}) => {
    quadro(x, y, w, h);
    const tamRotulo = 4.6;
    pdf.fontSize(tamRotulo).fillColor(CINZA).font('Helvetica').text(rotulo.toUpperCase(), x + 2, y + 1.5, { width: w - 4, lineBreak: false });
    // O valor fica centrado no espaço que sobra abaixo do rótulo
    const tamanho = opts.tamanho ?? 7;
    pdf.fontSize(tamanho).fillColor('#000').font('Helvetica-Bold').text(valor || '', x + 2, centroVertical(y + 1.5 + tamRotulo * ALTURA_MAIUSCULA, y + h, tamanho), {
      width: w - 4,
      align: opts.centro ? 'center' : opts.direita ? 'right' : 'left',
      lineBreak: false,
    });
  };

  let y = pdf.page.margins.top;

  // ---- Canhoto ----
  const alturaCanhoto = 12 * MM;
  quadro(esq, y, larg - 35 * MM, alturaCanhoto);
  pdf.fontSize(5.5).font('Helvetica').fillColor('#000')
    .text(
      `RECEBEMOS DE ${inf.emit?.xNome || ''} OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`,
      esq + 2, y + 2, { width: larg - 39 * MM },
    );
  pdf.fontSize(5).text('DATA DE RECEBIMENTO', esq + 2, y + alturaCanhoto - 7 * MM);
  pdf.text('IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', esq + 30 * MM, y + alturaCanhoto - 7 * MM);
  pdf.moveTo(esq + 2, y + alturaCanhoto - 2 * MM).lineTo(esq + larg - 37 * MM, y + alturaCanhoto - 2 * MM).stroke();

  quadro(esq + larg - 35 * MM, y, 35 * MM, alturaCanhoto);
  pdf.fontSize(8).font('Helvetica-Bold').text('NF-e', esq + larg - 35 * MM, y + 2, { width: 35 * MM, align: 'center' });
  pdf.fontSize(7).text(
    `Nº ${String(inf.ide?.nNF || '').padStart(9, '0')}\nSÉRIE ${String(inf.ide?.serie || '').padStart(3, '0')}`,
    esq + larg - 35 * MM, y + 12, { width: 35 * MM, align: 'center' },
  );

  y += alturaCanhoto + 2 * MM;

  // ---- Identificação do emitente / chave ----
  const alturaCab = 28 * MM;
  const largEmit = larg * 0.42;
  const largDanfe = larg * 0.22;

  quadro(esq, y, largEmit, alturaCab);
  // Logomarca: ou ocupa o quadro inteiro (já traz nome e endereço), ou fica à esquerda dos dados do emitente
  const logo = await carregarLogo(opcoes.logo);
  let larguraLogo = 0;
  if (logo) {
    const expandir = !!opcoes.expandirLogo;
    const caixa: [number, number] = expandir ? [largEmit - 6, alturaCab - 6] : [alturaCab - 6, alturaCab - 6];
    try {
      pdf.image(logo, esq + 3, y + 3, { fit: caixa, align: 'center', valign: 'center' });
      larguraLogo = expandir ? largEmit : caixa[0] + 3;
    } catch {
      // Não é PNG nem JPEG: sai só o texto
    }
  }
  if (larguraLogo < largEmit) {
    const xTexto = esq + 3 + larguraLogo;
    const largTexto = largEmit - 6 - larguraLogo;
    pdf.fontSize(9).font('Helvetica-Bold').fillColor('#000')
      .text(inf.emit?.xNome || '', xTexto, y + 3, { width: largTexto });
    const ender = inf.emit?.enderEmit || {};
    pdf.fontSize(6).font('Helvetica').text(
      [
        `${ender.xLgr || ''}, ${ender.nro || ''} ${ender.xCpl || ''}`.trim(),
        `${ender.xBairro || ''} - ${ender.xMun || ''}/${ender.UF || ''}`,
        `CEP ${ender.CEP || ''}   Fone ${ender.fone || ''}`,
        `CNPJ ${inf.emit?.CNPJ || ''}   IE ${inf.emit?.IE || ''}`,
      ].join('\n'),
      xTexto, pdf.y + 4, { width: largTexto },
    );
  }

  quadro(esq + largEmit, y, largDanfe, alturaCab);
  pdf.fontSize(12).font('Helvetica-Bold').text('DANFE', esq + largEmit, y + 3, { width: largDanfe, align: 'center' });
  pdf.fontSize(5.5).font('Helvetica').text(
    'Documento Auxiliar da Nota Fiscal Eletrônica',
    esq + largEmit, y + 18, { width: largDanfe, align: 'center' },
  );
  pdf.fontSize(6).font('Helvetica-Bold').text(
    `${inf.ide?.tpNF === '0' ? '0 - ENTRADA' : '1 - SAÍDA'}`,
    esq + largEmit, y + 30, { width: largDanfe, align: 'center' },
  );
  pdf.fontSize(8).text(
    `Nº ${String(inf.ide?.nNF || '').padStart(9, '0')}\nSÉRIE ${String(inf.ide?.serie || '').padStart(3, '0')}`,
    esq + largEmit, y + 42, { width: largDanfe, align: 'center' },
  );

  // Código de barras da chave
  const xBarras = esq + largEmit + largDanfe;
  const largBarras = larg - largEmit - largDanfe;
  quadro(xBarras, y, largBarras, alturaCab * 0.45);
  try {
    const barras = await codigoDeBarras(chave, 90, 10);
    pdf.image(barras, xBarras + 4, y + 3, { width: largBarras - 8, height: alturaCab * 0.45 - 8 });
  } catch {
    pdf.fontSize(6).text(chave, xBarras + 4, y + 10, { width: largBarras - 8 });
  }

  campo(xBarras, y + alturaCab * 0.45, largBarras, alturaCab * 0.27, 'Chave de Acesso', chaveFormatada(chave), { tamanho: 6, centro: true });
  campo(xBarras, y + alturaCab * 0.72, largBarras, alturaCab * 0.28, 'Protocolo de Autorização de Uso',
    protocolo ? `${protocolo} - ${paraBR(dataProtocolo)}` : 'NÃO AUTORIZADA', { tamanho: 6, centro: true });

  y += alturaCab;

  campo(esq, y, larg, 7 * MM, 'Natureza da Operação', inf.ide?.natOp || '');
  y += 7 * MM;

  campo(esq, y, larg / 3, 7 * MM, 'Inscrição Estadual', inf.emit?.IE || '');
  campo(esq + larg / 3, y, larg / 3, 7 * MM, 'Inscr. Estadual do Subst. Tributário', inf.emit?.IEST || '');
  campo(esq + (2 * larg) / 3, y, larg / 3, 7 * MM, 'CNPJ', inf.emit?.CNPJ || '');
  y += 7 * MM + 2 * MM;

  // ---- Destinatário ----
  pdf.fontSize(6).font('Helvetica-Bold').fillColor('#000').text('DESTINATÁRIO / REMETENTE', esq, y + 1);
  y += 5 * MM;

  const dest = inf.dest || {};
  const enderDest = dest.enderDest || {};
  campo(esq, y, larg * 0.6, 7 * MM, 'Nome / Razão Social', dest.xNome || '');
  campo(esq + larg * 0.6, y, larg * 0.22, 7 * MM, 'CNPJ / CPF', dest.CNPJ || dest.CPF || dest.idEstrangeiro || '');
  campo(esq + larg * 0.82, y, larg * 0.18, 7 * MM, 'Data de Emissão', paraBR(inf.ide?.dhEmi, false), { centro: true });
  y += 7 * MM;

  campo(esq, y, larg * 0.45, 7 * MM, 'Endereço', `${enderDest.xLgr || ''}, ${enderDest.nro || ''}`);
  campo(esq + larg * 0.45, y, larg * 0.2, 7 * MM, 'Bairro', enderDest.xBairro || '');
  campo(esq + larg * 0.65, y, larg * 0.17, 7 * MM, 'CEP', enderDest.CEP || '');
  campo(esq + larg * 0.82, y, larg * 0.18, 7 * MM, 'Data Saída/Entrada', paraBR(inf.ide?.dhSaiEnt, false), { centro: true });
  y += 7 * MM;

  campo(esq, y, larg * 0.45, 7 * MM, 'Município', `${enderDest.xMun || ''}`);
  campo(esq + larg * 0.45, y, larg * 0.1, 7 * MM, 'UF', enderDest.UF || '', { centro: true });
  campo(esq + larg * 0.55, y, larg * 0.27, 7 * MM, 'Inscrição Estadual', dest.IE || '');
  campo(esq + larg * 0.82, y, larg * 0.18, 7 * MM, 'Fone', enderDest.fone || '', { centro: true });
  y += 7 * MM + 2 * MM;

  // ---- Totais ----
  pdf.fontSize(6).font('Helvetica-Bold').fillColor('#000').text('CÁLCULO DO IMPOSTO', esq, y + 1);
  y += 5 * MM;

  const tot = inf.total?.ICMSTot || {};
  // Três linhas de seis, como no quadro "Cálculo do Imposto" do MOC
  const colunas: [string, string][][] = [
    [
      ['Base de Cálculo do ICMS', moeda(tot.vBC)],
      ['Valor do ICMS', moeda(tot.vICMS)],
      ['Base de Cálculo do ICMS ST', moeda(tot.vBCST)],
      ['Valor do ICMS ST', moeda(tot.vST)],
      ['Valor do FCP', moeda(tot.vFCP)],
      ['Valor do FCP ST', moeda(tot.vFCPST)],
    ],
    [
      ['Valor do Imp. Importação', moeda(tot.vII)],
      ['Valor Total do IPI', moeda(tot.vIPI)],
      ['V. ICMS UF Destino', moeda(tot.vICMSUFDest)],
      ['V. FCP UF Destino', moeda(tot.vFCPUFDest)],
      ['Valor do ICMS Desonerado', moeda(tot.vICMSDeson)],
      ['V. Aprox. dos Tributos', moeda(tot.vTotTrib)],
    ],
    [
      ['Valor Total dos Produtos', moeda(tot.vProd)],
      ['Valor do Frete', moeda(tot.vFrete)],
      ['Valor do Seguro', moeda(tot.vSeg)],
      ['Desconto', moeda(tot.vDesc)],
      ['Outras Despesas', moeda(tot.vOutro)],
      ['Valor Total da Nota', moeda(tot.vNF)],
    ],
  ];

  const linhaDeCampos = (linha: [string, string][]) => {
    const largCampo = larg / linha.length;
    linha.forEach(([rotulo, valor], i) => {
      campo(esq + i * largCampo, y, largCampo, 7 * MM, rotulo, valor, { direita: true });
    });
    y += 7 * MM;
  };

  colunas.forEach(linhaDeCampos);
  y += 2 * MM;

  // ---- ICMS monofásico (combustíveis) ----
  // As tags só existem no XML quando algum item é monofásico
  if (tot.qBCMono !== undefined) {
    pdf.fontSize(6).font('Helvetica-Bold').fillColor('#000').text('ICMS MONOFÁSICO — COMBUSTÍVEIS', esq, y + 1);
    y += 5 * MM;
    linhaDeCampos([
      ['Quantidade Tributada', moeda(tot.qBCMono)],
      ['Valor do ICMS Monofásico', moeda(tot.vICMSMono)],
      ['Qtd. Tributada c/ Retenção', moeda(tot.qBCMonoReten)],
      ['ICMS Monofásico Retido', moeda(tot.vICMSMonoReten)],
      ['Qtd. Retida Anteriormente', moeda(tot.qBCMonoRet)],
      ['ICMS Retido Anteriormente', moeda(tot.vICMSMonoRet)],
    ]);
    y += 2 * MM;
  }

  // ---- IBS / CBS / IS (reforma tributária) ----
  const ibscbs = inf.total?.IBSCBSTot;
  const seletivo = inf.total?.ISTot;
  if (ibscbs || seletivo) {
    pdf.fontSize(6).font('Helvetica-Bold').fillColor('#000').text('IBS / CBS / IS — REFORMA TRIBUTÁRIA', esq, y + 1);
    y += 5 * MM;
    const ibs = ibscbs?.gIBS || {};
    linhaDeCampos([
      ['Base de Cálculo IBS/CBS', moeda(ibscbs?.vBCIBSCBS)],
      ['Valor do IBS UF', moeda(ibs.gIBSUF?.vIBSUF)],
      ['Valor do IBS Município', moeda(ibs.gIBSMun?.vIBSMun)],
      ['Valor Total do IBS', moeda(ibs.vIBS)],
      ['Valor da CBS', moeda(ibscbs?.gCBS?.vCBS)],
      ['Valor do Imposto Seletivo', moeda(seletivo?.vIS)],
    ]);
    y += 2 * MM;
  }

  // ---- Transportador / volumes ----
  const transp = inf.transp || {};
  const transporta = transp.transporta || {};
  const veiculo = transp.veicTransp || {};
  const volumes = comoLista<any>(transp.vol);
  // Vários grupos de volume viram uma linha: quantidades e pesos somados, textos diferentes juntados
  const somaVolumes = (tag: string) => volumes.reduce((s, v) => s + Number(v[tag] || 0), 0);
  const textoVolumes = (tag: string) => [...new Set(volumes.map((v) => v[tag]).filter(Boolean))].join(' / ');

  pdf.fontSize(6).font('Helvetica-Bold').fillColor('#000').text('TRANSPORTADOR / VOLUMES TRANSPORTADOS', esq, y + 1);
  y += 5 * MM;
  const linhaTransp = (linha: [string, string, number, ('centro' | 'direita')?][]) => {
    let x = esq;
    for (const [rotulo, valor, fracao, alinhar] of linha) {
      campo(x, y, larg * fracao, 7 * MM, rotulo, valor, { centro: alinhar === 'centro', direita: alinhar === 'direita' });
      x += larg * fracao;
    }
    y += 7 * MM;
  };
  linhaTransp([
    ['Nome / Razão Social', transporta.xNome || '', 0.3],
    ['Frete por Conta', MODALIDADE_FRETE[String(transp.modFrete ?? '')] || String(transp.modFrete ?? ''), 0.16],
    ['Código ANTT', veiculo.RNTC || '', 0.11],
    ['Placa do Veículo', veiculo.placa || '', 0.11, 'centro'],
    ['UF', veiculo.UF || '', 0.05, 'centro'],
    ['CNPJ / CPF', transporta.CNPJ || transporta.CPF || '', 0.27],
  ]);
  linhaTransp([
    ['Endereço', transporta.xEnder || '', 0.41],
    ['Município', transporta.xMun || '', 0.27],
    ['UF', transporta.UF || '', 0.05, 'centro'],
    ['Inscrição Estadual', transporta.IE || '', 0.27],
  ]);
  linhaTransp([
    ['Quantidade', volumes.length ? String(somaVolumes('qVol')) : '', 0.12, 'direita'],
    ['Espécie', textoVolumes('esp'), 0.18],
    ['Marca', textoVolumes('marca'), 0.18],
    ['Numeração', textoVolumes('nVol'), 0.18],
    ['Peso Bruto', volumes.length ? moeda(somaVolumes('pesoB'), 3) : '', 0.17, 'direita'],
    ['Peso Líquido', volumes.length ? moeda(somaVolumes('pesoL'), 3) : '', 0.17, 'direita'],
  ]);
  y += 2 * MM;

  // ---- Itens ----
  pdf.fontSize(6).font('Helvetica-Bold').fillColor('#000').text('DADOS DOS PRODUTOS / SERVIÇOS', esq, y + 1);
  y += 5 * MM;

  // Colunas do quadro de produtos do MOC; `icms` é o grupo variável (ICMS00, ICMSSN102...)
  const ipiDe = (imp: any) => imp?.IPI?.IPITrib;
  const cols = [
    { titulo: 'CÓDIGO', largura: 0.07, campo: (p: any) => p.cProd },
    { titulo: 'DESCRIÇÃO', largura: 0.255, campo: (p: any) => p.xProd },
    { titulo: 'NCM/SH', largura: 0.06, campo: (p: any) => p.NCM },
    { titulo: 'O/CST', largura: 0.045, campo: (_p: any, icms: any) => (icms ? `${icms.orig ?? ''}${icms.CST ?? icms.CSOSN ?? ''}` : '') },
    { titulo: 'CFOP', largura: 0.04, campo: (p: any) => p.CFOP },
    { titulo: 'UN', largura: 0.035, campo: (p: any) => p.uCom },
    { titulo: 'QTD', largura: 0.065, campo: (p: any) => moeda(p.qCom, 4), direita: true },
    { titulo: 'VL. UNIT.', largura: 0.075, campo: (p: any) => moeda(p.vUnCom), direita: true },
    { titulo: 'VL. TOTAL', largura: 0.075, campo: (p: any) => moeda(p.vProd), direita: true },
    { titulo: 'BC ICMS', largura: 0.07, campo: (_p: any, icms: any) => moeda(icms?.vBC), direita: true },
    { titulo: 'VL. ICMS', largura: 0.065, campo: (_p: any, icms: any) => moeda(icms?.vICMS), direita: true },
    { titulo: 'VL. IPI', largura: 0.06, campo: (_p: any, _i: any, imp: any) => moeda(ipiDe(imp)?.vIPI), direita: true },
    { titulo: '% ICMS', largura: 0.045, campo: (_p: any, icms: any) => moeda(icms?.pICMS), direita: true },
    { titulo: '% IPI', largura: 0.04, campo: (_p: any, _i: any, imp: any) => moeda(ipiDe(imp)?.pIPI), direita: true },
  ];

  const alturaLinha = 4.5 * MM;
  const desenharCabecalhoItens = () => {
    quadro(esq, y, larg, alturaLinha);
    let x = esq;
    for (const c of cols) {
      const w = larg * c.largura;
      pdf.fontSize(5).font('Helvetica-Bold').fillColor(CINZA).text(c.titulo, x + 1, centroVertical(y, y + alturaLinha, 5), { width: w - 2, lineBreak: false });
      if (x > esq) pdf.moveTo(x, y).lineTo(x, y + alturaLinha).stroke();
      x += w;
    }
    y += alturaLinha;
  };

  desenharCabecalhoItens();

  for (const det of comoLista(inf.det)) {
    if (y > pdf.page.height - pdf.page.margins.bottom - 30 * MM) {
      pdf.addPage();
      y = pdf.page.margins.top;
      desenharCabecalhoItens();
    }

    const prod = det.prod || {};
    // O ICMS vem dentro de um grupo variável (ICMS00, ICMSSN102, ...)
    const icms = Object.values(det.imposto?.ICMS || {})[0] as any;

    // A descrição quebra em quantas linhas precisar e a linha do item cresce junto;
    // as outras colunas ficam na altura da primeira linha da descrição
    pdf.fontSize(5.2).font('Helvetica');
    const larguraDescricao = larg * cols[1].largura - 2;
    const descricao = String(prod.xProd ?? '');
    const altura = alturaLinha + pdf.heightOfString(descricao, { width: larguraDescricao }) - pdf.heightOfString('X', { width: larguraDescricao });
    const topoTexto = centroVertical(y, y + alturaLinha, 5.2);

    quadro(esq, y, larg, altura);
    let x = esq;
    for (const c of cols) {
      const w = larg * c.largura;
      const quebra = c === cols[1];
      pdf.fontSize(5.2).font('Helvetica').fillColor('#000')
        .text(String(c.campo(prod, icms, det.imposto) ?? ''), x + 1, topoTexto, {
          width: w - 2,
          align: (c as any).direita ? 'right' : 'left',
          lineBreak: quebra,
        });
      if (x > esq) pdf.moveTo(x, y).lineTo(x, y + altura).stroke();
      x += w;
    }
    y += altura;
  }

  y += 2 * MM;

  // ---- ISSQN (NF-e conjugada) ----
  const issqn = inf.total?.ISSQNtot;
  if (issqn) {
    pdf.fontSize(6).font('Helvetica-Bold').fillColor('#000').text('CÁLCULO DO ISSQN', esq, y + 1);
    y += 5 * MM;
    campo(esq, y, larg / 4, 7 * MM, 'Inscrição Municipal', inf.emit?.IM || '');
    campo(esq + larg / 4, y, larg / 4, 7 * MM, 'Valor Total dos Serviços', moeda(issqn.vServ), { direita: true });
    campo(esq + larg / 2, y, larg / 4, 7 * MM, 'Base de Cálculo do ISSQN', moeda(issqn.vBC), { direita: true });
    campo(esq + (3 * larg) / 4, y, larg / 4, 7 * MM, 'Valor do ISSQN', moeda(issqn.vISS), { direita: true });
    y += 9 * MM;
  }

  // ---- Informações complementares ----
  const complemento = [inf.infAdic?.infCpl, inf.infAdic?.infAdFisco].filter(Boolean).join(' | ');
  const alturaInfo = Math.max(14 * MM, pdf.page.height - pdf.page.margins.bottom - y);
  quadro(esq, y, larg, alturaInfo);
  pdf.fontSize(5).font('Helvetica').fillColor(CINZA).text('DADOS ADICIONAIS', esq + 2, y + 1.5);
  pdf.fontSize(6).fillColor('#000').text(complemento, esq + 2, y + 7, { width: larg - 4, height: alturaInfo - 10 });

  if (opcoes.homologacao) {
    pdf.save()
      .fontSize(28)
      .fillColor('#d92d20')
      .opacity(0.25)
      .rotate(-35, { origin: [pdf.page.width / 2, pdf.page.height / 2] })
      .text('SEM VALOR FISCAL', 0, pdf.page.height / 2, { width: pdf.page.width, align: 'center' })
      .restore();
  }

  pdf.end();
  return pronto;
}

// ---------------------------------------------------------------------------
// DANFE Simplificado (tpImp 3): faixa de 80 mm com os blocos do
// ACBrNFeDANFeRLSimplificado — chave e protocolo, emitente, número/série,
// destinatário, itens, totais, duplicatas, tributos e dados adicionais.
// ---------------------------------------------------------------------------

async function danfeSimplificado(inf: any, chave: string, xml: string, opcoes: OpcoesDanfe): Promise<Buffer> {
  const largura = 80 * MM;
  const margem = 3 * MM;
  const barras = await codigoDeBarras(chave, 90, 10).catch(() => null);
  const logo = await carregarLogo(opcoes.logo);

  // A faixa tem a altura do conteúdo: a 1ª passada só mede, a 2ª desenha na página do tamanho certo
  const rascunho = new PDFDocument({ size: [largura, 3000 * MM], margin: margem });
  const fim = desenharSimplificado(rascunho, inf, chave, xml, opcoes, barras, logo);
  rascunho.end();

  const pdf = new PDFDocument({
    size: [largura, fim + margem + 2],
    margin: margem,
    info: { Title: `DANFE ${inf.ide?.nNF || ''}`, Author: inf.emit?.xNome || '' },
  });
  const pedacos: Buffer[] = [];
  pdf.on('data', (d) => pedacos.push(d));
  const pronto = new Promise<Buffer>((resolve) => pdf.on('end', () => resolve(Buffer.concat(pedacos))));
  desenharSimplificado(pdf, inf, chave, xml, opcoes, barras, logo);
  pdf.end();
  return pronto;
}

/** Desenha a faixa e devolve onde ela termina */
function desenharSimplificado(
  pdf: PDFKit.PDFDocument, inf: any, chave: string, xml: string, opcoes: OpcoesDanfe,
  barras: Buffer | null, logo: Buffer | null,
): number {
  const esq = pdf.page.margins.left;
  const w = pdf.page.width - esq - pdf.page.margins.right;
  let y = pdf.page.margins.top;

  const texto = (s: string, o: { tamanho?: number; negrito?: boolean; alinhar?: 'left' | 'center' | 'right'; cor?: string } = {}) => {
    pdf.fontSize(o.tamanho ?? 7).font(o.negrito ? 'Helvetica-Bold' : 'Helvetica').fillColor(o.cor ?? '#000')
      .text(s, esq, y, { width: w, align: o.alinhar ?? 'left' });
    y = pdf.y;
  };
  const separador = () => {
    y += 3;
    pdf.lineWidth(LINHA).strokeColor(CINZA).moveTo(esq, y).lineTo(esq + w, y).stroke();
    y += 3;
  };
  /** Uma linha de colunas fixas: [texto, fração da largura, alinhamento] */
  const colunas = (cols: [string, number, ('left' | 'right' | 'center')?][], tamanho = 6.5, negrito = false) => {
    pdf.fontSize(tamanho).font(negrito ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000');
    let x = esq;
    for (const [s, fracao, alinhar] of cols) {
      pdf.text(s, x, y, { width: w * fracao - 2, align: alinhar ?? 'left', lineBreak: false });
      x += w * fracao;
    }
    y += pdf.currentLineHeight(true) + 1;
  };

  // ---- Chave de acesso e protocolo ----
  texto('DANFE Simplificado da NF-e', { tamanho: 9, negrito: true, alinhar: 'center' });
  y += 2;
  texto('CHAVE DE ACESSO', { tamanho: 6.5, negrito: true, alinhar: 'center' });
  texto(chaveFormatada(chave), { tamanho: 7, alinhar: 'center' });
  y += 2;
  if (barras) {
    pdf.image(barras, esq + w * 0.05, y, { width: w * 0.9, height: 11 * MM });
    y += 11 * MM + 2;
  }
  const cStat = Number(valorTag(xml, 'cStat'));
  const protocolo = valorTag(xml, 'nProt');
  const situacao = cStat ? situacaoPeloStatus(cStat) : null;
  texto(
    situacao === 'cancelada' ? 'Protocolo de Homologação de Cancelamento'
      : situacao === 'denegada' ? 'Protocolo de Denegação de Uso'
      : 'Protocolo de Autorização',
    { tamanho: 6.5, negrito: true, alinhar: 'center' },
  );
  texto(protocolo ? `${protocolo} - ${paraBR(valorTag(xml, 'dhRecbto'))}` : 'NÃO AUTORIZADA', { alinhar: 'center' });

  // ---- Emitente ----
  separador();
  const expandir = !!opcoes.expandirLogo;
  let comLogo = false;
  if (logo) {
    const alto = expandir ? 28 * MM : 16 * MM;
    try {
      pdf.image(logo, esq, y, { fit: [w, alto], align: 'center', valign: 'center' });
      y += alto + 2;
      comLogo = true;
    } catch {
      // Não é PNG nem JPEG: sai só o texto
    }
  }
  // A logomarca expandida já traz nome e endereço
  if (!(comLogo && expandir)) {
    const emit = inf.emit || {};
    const ender = emit.enderEmit || {};
    texto(emit.xNome || '', { tamanho: 8, negrito: true, alinhar: 'center' });
    texto(
      [ender.xLgr, ender.nro, ender.xCpl, ender.xBairro].filter(Boolean).join(', ') + ` - ${ender.xMun || ''}/${ender.UF || ''}`,
      { tamanho: 6.5, alinhar: 'center' },
    );
    texto(`CNPJ: ${emit.CNPJ || emit.CPF || ''}   IE: ${emit.IE || ''}`, { tamanho: 6.5, alinhar: 'center' });
  }

  // ---- Dados gerais ----
  separador();
  const tpEmis = String(inf.ide?.tpEmis ?? '1');
  texto(tpEmis === '1' ? 'EMISSÃO NORMAL' : 'EMISSÃO EM CONTINGÊNCIA', { tamanho: 8, negrito: true, alinhar: 'center' });
  y += 2;
  // Quadrinho com o tipo da operação, como no DANFE: 0 entrada, 1 saída
  const lado = 5 * MM;
  const legenda = '0 - ENTRADA / 1 - SAÍDA';
  pdf.fontSize(6.5).font('Helvetica');
  const xCaixa = esq + (w - lado - 3 - pdf.widthOfString(legenda)) / 2;
  pdf.lineWidth(LINHA).strokeColor(CINZA).roundedRect(xCaixa, y, lado, lado, 1).stroke();
  pdf.fontSize(9).font('Helvetica-Bold').fillColor('#000')
    .text(String(inf.ide?.tpNF ?? ''), xCaixa, y + (lado - 9 * ALTURA_MAIUSCULA) / 2, { width: lado, align: 'center', lineBreak: false });
  pdf.fontSize(6.5).font('Helvetica')
    .text(legenda, xCaixa + lado + 3, y + (lado - 6.5 * ALTURA_MAIUSCULA) / 2, { lineBreak: false });
  y += lado + 3;
  texto(
    `Número: ${String(inf.ide?.nNF || '').padStart(9, '0')} - Série: ${String(inf.ide?.serie ?? '').padStart(3, '0')}`,
    { tamanho: 7.5, negrito: true, alinhar: 'center' },
  );
  texto(`Emissão: ${paraBR(inf.ide?.dhEmi)}`, { alinhar: 'center' });

  // ---- Destinatário ----
  separador();
  texto('DESTINATÁRIO', { tamanho: 7.5, negrito: true, alinhar: 'center' });
  const aviso = situacao === 'cancelada' ? 'NF-e CANCELADA'
    : situacao === 'denegada' ? 'NF-e DENEGADA'
    : opcoes.homologacao ? 'EMITIDA EM HOMOLOGAÇÃO - SEM VALOR FISCAL'
    : '';
  if (aviso) texto(aviso, { tamanho: 7, negrito: true, alinhar: 'center', cor: '#d92d20' });
  const dest = inf.dest || {};
  const enderDest = dest.enderDest || {};
  if (dest.xNome) texto(dest.xNome, { tamanho: 7, negrito: true });
  if (enderDest.xLgr) {
    texto(
      [enderDest.xLgr, enderDest.nro, enderDest.xCpl, enderDest.xBairro].filter(Boolean).join(', ') +
        ` - ${enderDest.xMun || ''}/${enderDest.UF || ''}`,
      { tamanho: 6.5 },
    );
  }
  texto(`CPF/CNPJ: ${dest.CNPJ || dest.CPF || dest.idEstrangeiro || ''}   IE: ${dest.IE || ''}`, { tamanho: 6.5 });

  // ---- Itens ----
  separador();
  colunas([['Item', 0.1], ['Código', 0.22], ['Descrição do Produto', 0.68]], 6, true);
  colunas([['CFOP', 0.11], ['CST', 0.11], ['Qtd', 0.18, 'right'], ['Und', 0.12, 'center'], ['V.Unit. (R$)', 0.23, 'right'], ['V.Item (R$)', 0.25, 'right']], 6, true);
  for (const det of comoLista<any>(inf.det)) {
    const p = det.prod || {};
    const icms = Object.values(det.imposto?.ICMS || {})[0] as any;
    y += 1;
    const topo = y;
    pdf.fontSize(6.5).font('Helvetica').fillColor('#000');
    pdf.text(String(det['@nItem'] ?? ''), esq, topo, { width: w * 0.1 - 2, lineBreak: false });
    pdf.text(String(p.cProd ?? ''), esq + w * 0.1, topo, { width: w * 0.22 - 2, lineBreak: false, ellipsis: true });
    pdf.text(String(p.xProd ?? ''), esq + w * 0.32, topo, { width: w * 0.68 });
    y = Math.max(pdf.y, topo + pdf.currentLineHeight(true));
    colunas([
      [String(p.CFOP ?? ''), 0.11],
      [icms ? `${icms.orig ?? ''}${icms.CST ?? icms.CSOSN ?? ''}` : '', 0.11],
      [moeda(p.qCom, 4), 0.18, 'right'],
      [String(p.uCom ?? ''), 0.12, 'center'],
      [moeda(p.vUnCom), 0.23, 'right'],
      [moeda(p.vProd), 0.25, 'right'],
    ]);
  }

  // ---- Totais ----
  separador();
  const tot = inf.total?.ICMSTot || {};
  colunas([['Qtde Total de Itens', 0.6], [String(comoLista(inf.det).length), 0.4, 'right']], 7);
  colunas([['Desconto', 0.6], [moeda(tot.vDesc), 0.4, 'right']], 7);
  colunas([['Valor Total', 0.6], [moeda(tot.vNF), 0.4, 'right']], 8, true);

  // ---- Fatura / duplicatas ----
  const cobr = inf.cobr || {};
  const duplicatas = comoLista<any>(cobr.dup);
  if (cobr.fat || duplicatas.length) {
    separador();
    texto('FATURA / DUPLICATAS', { tamanho: 6.5, negrito: true });
    if (cobr.fat?.nFat) {
      colunas([['Fatura', 0.25], [String(cobr.fat.nFat), 0.3], ['Valor líquido', 0.25], [moeda(cobr.fat.vLiq), 0.2, 'right']]);
    }
    for (const d of duplicatas) {
      colunas([[String(d.nDup ?? ''), 0.3], [paraBR(d.dVenc, false), 0.35, 'center'], [moeda(d.vDup), 0.35, 'right']]);
    }
  }

  // ---- Tributos (Lei 12.741/2012) ----
  if (Number(tot.vTotTrib) > 0) {
    separador();
    const perc = Number(tot.vNF) > 0 ? (Number(tot.vTotTrib) / Number(tot.vNF)) * 100 : 0;
    texto(`Valor aproximado dos tributos: R$ ${moeda(tot.vTotTrib)} (${moeda(perc)}%)`, { tamanho: 6.5 });
  }

  // ---- Dados adicionais ----
  const complemento = [inf.infAdic?.infAdFisco, inf.infAdic?.infCpl].filter(Boolean).join(' | ');
  if (complemento) {
    separador();
    texto('DADOS ADICIONAIS', { tamanho: 6.5, negrito: true });
    texto(complemento, { tamanho: 6 });
  }

  return y;
}

// ---------------------------------------------------------------------------
// DANFE NFC-e (bobina 80mm)
// ---------------------------------------------------------------------------

async function danfceBobina(inf: any, chave: string, xml: string, opcoes: OpcoesDanfe): Promise<Buffer> {
  const largura = 80 * MM;
  const pdf = new PDFDocument({ size: [largura, 297 * MM], margin: 3 * MM });

  const pedacos: Buffer[] = [];
  pdf.on('data', (d) => pedacos.push(d));
  const pronto = new Promise<Buffer>((resolve) => pdf.on('end', () => resolve(Buffer.concat(pedacos))));

  const w = largura - 6 * MM;
  const centro = { width: w, align: 'center' as const };
  const ender = inf.emit?.enderEmit || {};

  pdf.fontSize(8).font('Helvetica-Bold').text(inf.emit?.xNome || '', centro);
  pdf.fontSize(6).font('Helvetica').text(
    `CNPJ ${inf.emit?.CNPJ || ''}\n${ender.xLgr || ''}, ${ender.nro || ''} - ${ender.xBairro || ''}\n${ender.xMun || ''}/${ender.UF || ''}`,
    centro,
  );
  pdf.moveDown(0.4);
  pdf.fontSize(7).font('Helvetica-Bold').text('DANFE NFC-e - Documento Auxiliar da NFC-e', centro);
  pdf.moveDown(0.3);

  pdf.fontSize(6).font('Helvetica-Bold').text('CÓD   DESCRIÇÃO                QTD   UN   VL UN   TOTAL', { width: w });
  pdf.font('Helvetica');

  for (const det of comoLista(inf.det)) {
    const p = det.prod || {};
    pdf.fontSize(6).text(
      `${p.cProd} ${p.xProd}`.slice(0, 46) +
        `\n     ${moeda(p.qCom, 3)} ${p.uCom} x ${moeda(p.vUnCom)} = ${moeda(p.vProd)}`,
      { width: w },
    );
  }

  const tot = inf.total?.ICMSTot || {};
  pdf.moveDown(0.3);
  pdf.fontSize(7).font('Helvetica-Bold').text(`TOTAL R$ ${moeda(tot.vNF)}`, { width: w, align: 'right' });

  for (const pagamento of comoLista(inf.pag?.detPag)) {
    pdf.fontSize(6).font('Helvetica').text(`Pagamento ${pagamento.tPag}: ${moeda(pagamento.vPag)}`, { width: w, align: 'right' });
  }

  // Lei 12.741/2012 e reforma tributária
  if (Number(tot.vTotTrib) > 0) {
    pdf.fontSize(5.5).text(`Tributos totais incidentes (Lei 12.741/2012): R$ ${moeda(tot.vTotTrib)}`, { width: w, align: 'right' });
  }
  const monofasico = Number(tot.vICMSMono || 0) + Number(tot.vICMSMonoReten || 0);
  const retidoAntes = Number(tot.vICMSMonoRet || 0);
  if (monofasico || retidoAntes) {
    pdf.fontSize(5.5).text(
      `ICMS monofásico R$ ${moeda(monofasico)}` +
        (retidoAntes ? `   retido anteriormente R$ ${moeda(retidoAntes)}` : ''),
      { width: w, align: 'right' },
    );
  }
  const ibscbs = inf.total?.IBSCBSTot;
  if (ibscbs) {
    pdf.fontSize(5.5).text(
      `IBS R$ ${moeda(ibscbs.gIBS?.vIBS)}   CBS R$ ${moeda(ibscbs.gCBS?.vCBS)}`,
      { width: w, align: 'right' },
    );
  }

  pdf.moveDown(0.4);
  pdf.fontSize(5.5).font('Helvetica').text(`Consulte pela chave de acesso em ${valorTag(xml, 'urlChave')}`, centro);
  pdf.fontSize(6).text(chaveFormatada(chave), centro);

  const qr = valorTag(xml, 'qrCode');
  if (qr) {
    try {
      const imagem = await qrcode(qr);
      // O texto seguinte começa abaixo da imagem (moveDown dependia do tamanho da fonte e ficava curto)
      const topo = pdf.y + 4;
      pdf.image(imagem, (largura - 30 * MM) / 2, topo, { width: 30 * MM });
      pdf.x = pdf.page.margins.left;
      pdf.y = topo + 30 * MM + 4;
    } catch {
      /* sem QR-Code o cupom ainda sai, só perde a consulta pelo celular */
    }
  }

  const protocolo = valorTag(xml, 'nProt');
  pdf.fontSize(5.5).text(
    protocolo ? `Protocolo de autorização: ${protocolo} — ${paraBR(valorTag(xml, 'dhRecbto'))}` : 'NÃO AUTORIZADA',
    centro,
  );

  if (opcoes.homologacao) {
    pdf.moveDown(0.3);
    pdf.fontSize(7).fillColor('#d92d20').font('Helvetica-Bold').text('EMITIDA EM HOMOLOGAÇÃO - SEM VALOR FISCAL', centro);
  }

  pdf.end();
  return pronto;
}
