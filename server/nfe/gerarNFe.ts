/**
 * Geração do XML da NF-e / NFC-e no layout 4.00.
 *
 * Substitui o TNotaFiscal.GerarXML do ACBr. A ordem das tags é a do schema
 * (procNFe_v4.00.xsd / leiauteNFe_v4.00.xsd, em recursos/Schemas) e é
 * obrigatória: XML fora de ordem é rejeitado antes de qualquer validação de
 * conteúdo. Os totais são sempre recalculados a partir dos itens — deixar o
 * chamador informar total já rendeu rejeição 610 demais vezes.
 */
import crypto from 'crypto';
import { Contexto, emitenteSemIE } from './contexto.js';
import { montarChave } from './chave.js';
import { CODIGO_UF, VERSAO_QRCODE, urlsConsulta } from './servicos.js';
import { dataDoDocumento, dataHoraDFe, dataISO } from './datas.js';
import { escapar, DECLARACAO, NS_NFE, grupo, grupoObrigatorio, limparTexto, num, tag } from './xml.js';

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export interface Endereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  codigoMunicipio: string;
  municipio: string;
  uf: string;
  cep: string;
  fone?: string;
  codigoPais?: string;
  pais?: string;
}

export interface Destinatario {
  cnpj?: string;
  cpf?: string;
  idEstrangeiro?: string;
  nome: string;
  inscricaoEstadual?: string;
  /** 1=Contribuinte ICMS, 2=Isento, 9=Não contribuinte */
  indIEDest?: number;
  suframa?: string;
  email?: string;
  endereco?: Endereco;
}

type TributoPisCofins = { cst: string; base?: number; aliquota?: number; valor?: number };

/**
 * Tributos do item. Bases e valores que não vierem informados são calculados a
 * partir do valor da operação e das alíquotas — o chamador só manda valores
 * quando quiser impor um número diferente do cálculo.
 */
export interface ImpostoItem {
  /** Origem da mercadoria, 0 a 8 */
  origem: number;
  /** CST do ICMS (regime normal) — 00, 10, 20, 30, 40, 41, 50, 51, 60, 70, 90 */
  cst?: string;
  /** CSOSN (Simples Nacional) — 101, 102, 103, 201, 202, 203, 300, 400, 500, 900 */
  csosn?: string;
  modBC?: number;
  baseCalculo?: number;
  /**
   * Alíquota do ICMS próprio. Nos CST/CSOSN só de ST (30, 201, 202, 203) é a
   * alíquota interna do remetente, usada para deduzir o ICMS próprio da ST.
   */
  aliquota?: number;
  valor?: number;
  reducaoBC?: number;
  /** Fundo de Combate à Pobreza, sobre a base do ICMS */
  aliquotaFCP?: number;
  /** Diferimento (CST 51 e 90), em % do ICMS da operação */
  percentualDiferimento?: number;
  /** Substituição tributária (CST 10, 30, 70, 90; CSOSN 201, 202, 203, 900) */
  modBCST?: number;
  mvaST?: number;
  reducaoBCST?: number;
  baseCalculoST?: number;
  aliquotaST?: number;
  valorST?: number;
  aliquotaFCPST?: number;
  /** ST cobrada anteriormente (CST 60 e CSOSN 500) */
  baseSTRetido?: number;
  aliquotaSTRetido?: number;
  valorSubstituto?: number;
  valorSTRetido?: number;
  /** ICMS desonerado (CST 20, 30, 40, 41, 50, 70, 90) */
  valorDesonerado?: number;
  motivoDesoneracao?: number;
  /** O desonerado é abatido do total da nota (indDeduzDeson) */
  deduzDesoneracao?: boolean;
  /**
   * Monofasia de combustíveis (CST 02, 15, 53, 61), em R$ por unidade tributável.
   * A quantidade da base é a do item.
   */
  adRemICMS?: number;
  /** CST 15: ad rem do ICMS com retenção */
  adRemICMSReten?: number;
  /** CST 15: % de redução da ad rem e motivo (1=Transporte coletivo, 9=Outros) */
  reducaoAdRem?: number;
  motivoReducaoAdRem?: number;
  /** CST 61: ad rem do ICMS retido anteriormente */
  adRemICMSRet?: number;
  /** Crédito do Simples Nacional (CSOSN 101, 201, 900) */
  aliquotaCredito?: number;
  valorCredito?: number;
  pis: TributoPisCofins;
  cofins: TributoPisCofins;
  ipi?: { cst: string; codigoEnquadramento?: string; base?: number; aliquota?: number; valor?: number };
  /** Imposto de importação (CFOP 3xxx) */
  ii?: { base: number; despesasAduaneiras?: number; valor: number; iof?: number };
  /** Item de serviço (NF-e conjugada): o ISSQN entra no lugar do ICMS */
  issqn?: {
    aliquota: number;
    base?: number;
    valor?: number;
    /** Item da lista da LC 116, no formato "01.01" */
    codigoServico: string;
    /** Município de ocorrência; sem ele, o do emitente */
    municipio?: string;
    /** indISS: 1=Exigível, 2=Não incidência, 3=Isenção, 4=Exportação, 5=Imunidade, 6/7=Exigibilidade suspensa */
    exigibilidade?: number;
    incentivo?: boolean;
    valorRetido?: number;
  };
  /** Partilha do ICMS (DIFAL): venda interestadual a consumidor final não contribuinte */
  difal?: { aliquotaInterna: number; aliquotaFCP?: number; aliquotaInterestadual?: number; base?: number };
  /** Reforma tributária (LC 214/2025, NT 2025.002) */
  ibscbs?: {
    cst: string;
    /** cClassTrib, 6 dígitos */
    classificacao: string;
    /** 1 = doação (indDoacao) */
    indDoacao?: boolean;
    base?: number;
    aliquotaIBSUF?: number;
    aliquotaIBSMun?: number;
    aliquotaCBS?: number;
    /** % de redução das alíquotas (gRed) */
    reducao?: number;
    /** % diferido (gDif) */
    diferimento?: number;
    /**
     * Devolução de tributos (gDevTrib) — energia, água, esgoto e gás
     * (LC 214/2025, art. 118), em % do tributo de cada esfera
     */
    devolucaoIBSUF?: number;
    devolucaoIBSMun?: number;
    devolucaoCBS?: number;
    /** Tributação regular (gTribRegular): o que seria devido sem o tratamento diferenciado */
    tribRegular?: {
      cst: string;
      classificacao: string;
      aliquotaIBSUF?: number;
      aliquotaIBSMun?: number;
      aliquotaCBS?: number;
    };
    /** Crédito presumido (gCredPresOper); código da tabela cCredPres (Anexo IV da NT) */
    credPres?: {
      codigo: string;
      /** Sem base, vale a do IBS/CBS do item */
      base?: number;
      aliquotaIBS?: number;
      aliquotaCBS?: number;
      /** Crédito em condição suspensiva (vCredPresCondSus no lugar de vCredPres) */
      suspensivo?: boolean;
    };
    /** Estorno de crédito (gEstornoCred), valores diretos */
    estornoIBS?: number;
    estornoCBS?: number;
    /** CST 800 — transferência de crédito */
    transferencia?: { ibs: number; cbs: number };
    /** CST 810 — ajuste de competência; competência no formato AAAA-MM */
    ajuste?: { competencia: string; ibs: number; cbs: number };
    /** CST 620 — monofasia ad rem, em R$ por unidade tributável */
    monofasia?: {
      adRemIBS?: number;
      adRemCBS?: number;
      adRemIBSReten?: number;
      adRemCBSReten?: number;
      /** Valores já retidos anteriormente (gMonoRet) */
      valorIBSRetido?: number;
      valorCBSRetido?: number;
      /** Ad valorem: informar a base e as alíquotas % no lugar do ad rem */
      baseAdValorem?: number;
      aliquotaAdValoremIBSUF?: number;
      aliquotaAdValoremIBSMun?: number;
      aliquotaAdValoremCBS?: number;
      baseRetencaoAdValorem?: number;
      aliquotaRetencaoIBS?: number;
      aliquotaRetencaoCBS?: number;
      /** Mistura de biocombustível fora do obrigatório (cClassTrib 620004/620005) */
      quantidadeBio?: number;
      valorIBSDiferenca?: number;
      valorCBSDiferenca?: number;
    };
  };
  /** Imposto Seletivo (grupo IS) — produtos do Anexo I da NT 2025.002 */
  seletivo?: {
    /** CST do IS, tabela própria */
    cst: string;
    /** cClassTribIS, 6 dígitos */
    classificacao: string;
    /** Sem base, vale o valor da operação */
    base?: number;
    /** Alíquota percentual (pIS) */
    aliquota?: number;
    /** Alíquota por unidade de medida (adRemIS), em R$ */
    adRem?: number;
    /** Unidade e quantidade tributáveis; sem elas, as comerciais do item */
    unidadeTributavel?: string;
    quantidadeTributavel?: number;
  };
  /** Valor aproximado dos tributos (Lei 12.741/2012) */
  valorAproximadoTributos?: number;
}

export interface ItemNFe {
  codigo: string;
  ean?: string;
  descricao: string;
  ncm: string;
  cest?: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  /** Quando ausente, vira quantidade × valorUnitario */
  valorTotal?: number;
  valorDesconto?: number;
  valorFrete?: number;
  valorSeguro?: number;
  valorOutros?: number;
  /** 1 = o valor do item entra no total da nota (padrão) */
  compoeTotal?: boolean;
  informacoesAdicionais?: string;
  /** Declaração de Importação (CFOP 3xxx) */
  di?: DeclaracaoImportacao;
  /** Grupo de combustível: obrigatório na monofasia do ICMS */
  combustivel?: {
    codigoANP: string;
    descricaoANP: string;
    /** UF de consumo; sem ela, a do destinatário (ou a do emitente) */
    ufConsumo?: string;
    percentualBio?: number;
  };
  imposto: ImpostoItem;
}

// ponytail: um DI por item; o schema aceita até 100, entra quando alguém precisar
export interface DeclaracaoImportacao {
  numero: string;
  /** Datas no formato aaaa-mm-dd */
  data: string;
  localDesembaraco: string;
  ufDesembaraco: string;
  dataDesembaraco: string;
  /** tpViaTransp: 1=Marítima, 2=Fluvial, 3=Lacustre, 4=Aérea, 5=Postal, 6=Ferroviária, 7=Rodoviária, 8=Conduto, 9=Meios próprios, 10=Entrada/saída ficta, 11=Courier, 12=Em mãos, 13=Por reboque */
  viaTransporte: number;
  /** AFRMM, obrigatório na via marítima */
  afrmm?: number;
  /** tpIntermedio: 1=Por conta própria, 2=Por conta e ordem, 3=Por encomenda */
  intermedio: number;
  /** Adquirente ou encomendante, nos tipos 2 e 3 */
  cnpjAdquirente?: string;
  ufTerceiro?: string;
  codigoExportador: string;
  adicoes: { numero?: number; sequencia: number; fabricante: string; desconto?: number; drawback?: string }[];
}

export interface Volume {
  quantidade?: number;
  especie?: string;
  marca?: string;
  numeracao?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
}

export interface Pagamento {
  /** 01=Dinheiro, 02=Cheque, 03=Crédito, 04=Débito, 15=Boleto, 90=Sem pagamento, 99=Outros */
  forma: string;
  /** Sem valor, o pagamento é o total da nota */
  valor?: number;
  /** 0=À vista, 1=A prazo */
  indPag?: number;
  descricao?: string;
}

export interface DocumentoNFe {
  ide: {
    naturezaOperacao: string;
    serie: number;
    numero: number;
    dataEmissao?: string;
    dataSaida?: string;
    /** Data de previsão de entrega (dPrevEntrega, só modelo 55); formato aaaa-mm-dd */
    dataPrevisaoEntrega?: string;
    /** 0=Entrada, 1=Saída */
    tipoDocumento: number;
    /** 1=Interna, 2=Interestadual, 3=Exterior */
    idDestino?: number;
    /** 1=Normal, 2=Complementar, 3=Ajuste, 4=Devolução */
    finalidade?: number;
    /** 1=Consumidor final */
    consumidorFinal?: number;
    /** 0=Não se aplica, 1=Presencial, 2=Internet, 4=Entrega a domicílio, 9=Outros */
    presencial?: number;
    codigoMunicipioFG?: string;
    tipoEmissao?: number;
    codigoNumerico?: number;
    /** tpImp do modelo 55, vindo do cadastro da série: 1=Retrato, 2=Paisagem, 3=DANFE simplificado */
    formatoImpressao?: number;
  };
  destinatario?: Destinatario;
  itens: ItemNFe[];
  transporte?: {
    /** 0=Emitente, 1=Destinatário, 2=Terceiros, 3/4=Próprio, 9=Sem frete */
    modalidadeFrete: number;
    transportadora?: { cnpj?: string; cpf?: string; nome?: string; ie?: string; endereco?: string; municipio?: string; uf?: string };
    veiculo?: { placa: string; uf: string; rntc?: string };
    volumes?: Volume[];
  };
  pagamentos?: Pagamento[];
  /**
   * Vinculação com a transação de pagamento (gPgtoVinc, IT DFe 2026.001):
   * liga cada pagamento eletrônico da nota à transação na instituição financeira
   */
  vinculosPagamento?: {
    /** nPag: número sequencial do pagamento na nota (1..99) */
    numero: number;
    /** Identificador da transação financeira */
    idTransacao: string;
    /** Código do meio de pagamento (IT DFe 2026.001) */
    meioPagamento: string;
    /** CNPJ do recebedor do pagamento */
    cnpjRecebedor: string;
    /** CNPJ base (8 posições) da instituição financeira ou de pagamento */
    cnpjBasePSP: string;
  }[];
  informacoesAdicionais?: { fisco?: string; contribuinte?: string };
  responsavelTecnico?: { cnpj: string; contato: string; email: string; fone: string; idCSRT?: string; csrt?: string };
}

export interface NFeGerada {
  xml: string;
  chave: string;
  numero: number;
  serie: number;
  modelo: string;
  totais: Totais;
}

/** O que cada item contribui para os totais — exatamente o que foi para o XML */
const CAMPOS_TOTAL = [
  'vProd', 'vServ', 'vDesc', 'vFrete', 'vSeg', 'vOutro',
  'vBC', 'vICMS', 'vICMSDeson', 'vICMSDesonDeduzido', 'vFCP', 'vBCST', 'vST', 'vFCPST',
  'vII', 'vIPI', 'vPIS', 'vCOFINS', 'vPISServ', 'vCOFINSServ',
  'vBCISS', 'vISS', 'vISSRet', 'vFCPUFDest', 'vICMSUFDest',
  'vBCIBSCBS', 'vIBSUF', 'vDifIBSUF', 'vIBSMun', 'vDifIBSMun', 'vCBS', 'vDifCBS', 'vTotTrib',
  'vIS', 'vDevTribIBSUF', 'vDevTribIBSMun', 'vDevTribCBS',
  'vCredPresIBS', 'vCredPresCondSusIBS', 'vCredPresCBS', 'vCredPresCondSusCBS',
  'vIBSEstCred', 'vCBSEstCred',
  'qBCMono', 'vICMSMono', 'qBCMonoReten', 'vICMSMonoReten', 'qBCMonoRet', 'vICMSMonoRet',
  'vIBSMono', 'vCBSMono', 'vIBSMonoReten', 'vCBSMonoReten', 'vIBSMonoRet', 'vCBSMonoRet',
] as const;

type Valores = Record<(typeof CAMPOS_TOTAL)[number], number>;

export interface Totais extends Valores {
  vNF: number;
  temServico: boolean;
  temDifal: boolean;
  temIBSCBS: boolean;
  temIS: boolean;
  temMonoICMS: boolean;
  temMonoIBSCBS: boolean;
}

/** Condições da nota que mudam o cálculo do item */
interface Operacao {
  simples: boolean;
  /** Consumidor final: o IPI entra na base do ICMS */
  consumidorFinal: boolean;
  /** Interestadual para não contribuinte: o item leva o DIFAL */
  difal: boolean;
  municipioEmitente: string;
  /** Emitente sem IE (NT 2026.007): o item não leva ICMS e exige IBS/CBS */
  semICMS?: boolean;
}

interface ItemCalculado {
  imposto: string;
  valores: Valores;
  servico: boolean;
  difal: boolean;
  ibscbs: boolean;
  seletivo: boolean;
  monoICMS: boolean;
  monoIBSCBS: boolean;
}

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

/** Mesmo arredondamento de `num`, para os totais fecharem com os itens */
function arred(v: number, casas = 2): number {
  return Number(num(v, casas));
}

/** `p`% de `base`, arredondado como no XML */
const pct = (base: number, p?: number) => arred((base * (p || 0)) / 100);

/** Campos "Opc" do schema não aceitam zero: sem valor, a tag some */
const opcional = (v: number) => (v > 0 ? num(v) : undefined);

const zerados = () => Object.fromEntries(CAMPOS_TOTAL.map((k) => [k, 0])) as Valores;

function totalizar(itens: ItemCalculado[]): Totais {
  const t = zerados();
  for (const { valores } of itens) {
    for (const k of CAMPOS_TOTAL) t[k] += valores[k];
  }
  for (const k of CAMPOS_TOTAL) t[k] = arred(t[k]);

  const vNF = arred(
    t.vProd + t.vServ - t.vDesc - t.vICMSDesonDeduzido + t.vST + t.vFCPST +
      t.vFrete + t.vSeg + t.vOutro + t.vII + t.vIPI,
  );

  return {
    ...t,
    vNF,
    temServico: itens.some((i) => i.servico),
    temDifal: itens.some((i) => i.difal),
    temIBSCBS: itens.some((i) => i.ibscbs),
    temIS: itens.some((i) => i.seletivo),
    temMonoICMS: itens.some((i) => i.monoICMS),
    temMonoIBSCBS: itens.some((i) => i.monoIBSCBS),
  };
}

/** Totais de uma lista de itens, sem gerar a nota */
function somarTotais(itens: ItemNFe[], operacao: Partial<Operacao> = {}): Totais {
  const op: Operacao = { simples: false, consumidorFinal: false, difal: false, municipioEmitente: '', ...operacao };
  return totalizar(itens.map((item, n) => calcularItem(item, n, op)));
}

// ---------------------------------------------------------------------------
// Impostos do item
// ---------------------------------------------------------------------------

/** CST do IBS/CBS sem o grupo de valores: isenção (400) e imunidade/não incidência (410) */
const CST_IBSCBS_SEM_VALORES = ['400', '410'];
// ponytail: transferência de crédito (800) e ajuste de competência (810) têm grupos

/** CST do ICMS da monofasia de combustíveis (LC 192/2022) */
const CST_MONOFASIA = ['02', '15', '53', '61'];

function calcularItem(item: ItemNFe, indice: number, op: Operacao): ItemCalculado {
  const v = zerados();
  const i = item.imposto;
  const servico = !!i.issqn;

  // Arredondado como o vProd do item no XML: o total é a soma deles (rejeição 564)
  const bruto = arred(item.valorTotal ?? item.quantidade * item.valorUnitario);
  if (item.compoeTotal !== false) v[servico ? 'vServ' : 'vProd'] = bruto;
  v.vDesc = item.valorDesconto || 0;
  v.vFrete = item.valorFrete || 0;
  v.vSeg = item.valorSeguro || 0;
  v.vOutro = item.valorOutros || 0;

  // Valor da operação: base padrão de ICMS, IPI, ISSQN e PIS/COFINS
  const operacao = arred(bruto + v.vFrete + v.vSeg + v.vOutro - v.vDesc);

  const ipi = gerarIPI(i.ipi, operacao, v);
  const ii = gerarII(i.ii, v);

  let principal: string;
  let difal = '';
  if (servico) {
    principal = ipi + gerarISSQN(i.issqn!, operacao, op.municipioEmitente, v);
  } else if (op.semICMS) {
    // RV N01-10 da NT 2026.007: contribuinte exclusivo do IBS/CBS não informa ICMS
    principal = ipi + ii;
  } else {
    const baseICMS = arred(operacao + (op.consumidorFinal ? v.vIPI : 0));
    if (CST_MONOFASIA.includes(i.cst || '') && !item.combustivel?.codigoANP) {
      throw new Error(`Item ${indice + 1}: o CST ${i.cst} do ICMS é de combustível e exige o código ANP do produto.`);
    }
    principal = grupoObrigatorio('ICMS', gerarICMS(i, op.simples, baseICMS, item.quantidade, v)) + ipi + ii;

    if (op.difal) {
      if (!i.difal?.aliquotaInterna) {
        throw new Error(
          `Item ${indice + 1}: venda interestadual a consumidor final não contribuinte exige o DIFAL ` +
            '(rejeição 694). Informe a alíquota interna da UF de destino.',
        );
      }
      difal = gerarDIFAL(i.difal, baseICMS, i.aliquota, v);
    }
  }

  // PIS/COFINS com o ICMS fora da base (Tema 69 do STF)
  const basePisCofins = arred(operacao - v.vICMS);
  const pis = gerarPisCofins('PIS', i.pis, basePisCofins, v, servico ? 'vPISServ' : 'vPIS');
  const cofins = gerarPisCofins('COFINS', i.cofins, basePisCofins, v, servico ? 'vCOFINSServ' : 'vCOFINS');

  // Base do IBS/CBS (NT 2025.002): a operação sem os tributos que ainda coexistem
  const baseIBSCBS = arred(
    operacao + v.vII - v.vPIS - v.vPISServ - v.vCOFINS - v.vCOFINSServ -
      v.vICMS - v.vFCP - v.vICMSUFDest - v.vFCPUFDest - v.vICMSMono - v.vISS,
  );
  const ibscbs = gerarIBSCBS(i.ibscbs, baseIBSCBS, item.quantidade, v);
  const seletivo = gerarIS(i.seletivo, operacao, item, v);
  if (op.semICMS && !ibscbs) {
    throw new Error(
      `Item ${indice + 1}: emitente sem IE (contribuinte exclusivo do IBS/CBS) exige o grupo IBS/CBS ` +
        'em todos os itens (NT 2026.007, rejeição 162).',
    );
  }

  v.vTotTrib = i.valorAproximadoTributos || 0;

  const imposto = grupoObrigatorio('imposto',
    tag('vTotTrib', opcional(v.vTotTrib)),
    principal, pis, cofins, difal, seletivo, ibscbs,
  );

  return {
    imposto, valores: v, servico, difal: !!difal, ibscbs: !!ibscbs, seletivo: !!seletivo,
    monoICMS: !servico && !op.semICMS && CST_MONOFASIA.includes(i.cst || ''),
    monoIBSCBS: i.ibscbs?.cst === '620',
  };
}

function gerarICMS(i: ImpostoItem, simples: boolean, operacao: number, quantidade: number, v: Valores): string {
  const origem = tag('orig', i.origem ?? 0);
  const base = i.baseCalculo ?? arred(operacao * (1 - (i.reducaoBC || 0) / 100));
  const icmsOperacao = i.valor ?? pct(base, i.aliquota);

  const modBC = tag('modBC', i.modBC ?? 3);
  const pRedBC = tag('pRedBC', num(i.reducaoBC, 4));
  const pRedBCOpcional = tag('pRedBC', i.reducaoBC ? num(i.reducaoBC, 4) : undefined);

  /** vBC, pICMS e vICMS, já lançando nos totais */
  const proprio = (valor = icmsOperacao, meio = '') => {
    v.vBC = base;
    v.vICMS = valor;
    return tag('vBC', num(base)) + meio + tag('pICMS', num(i.aliquota, 4));
  };

  const fcp = (comBase: boolean) => {
    if (!i.aliquotaFCP) return '';
    v.vFCP = pct(base, i.aliquotaFCP);
    return (comBase ? tag('vBCFCP', num(base)) : '') + tag('pFCP', num(i.aliquotaFCP, 4)) + tag('vFCP', num(v.vFCP));
  };

  // ST: (operação + IPI) com MVA e redução; o imposto é o da ST menos o ICMS próprio
  const st = (icmsProprio: number) => {
    const baseST = i.baseCalculoST ?? arred(
      (operacao + v.vIPI) * (1 + (i.mvaST || 0) / 100) * (1 - (i.reducaoBCST || 0) / 100),
    );
    v.vBCST = baseST;
    v.vST = i.valorST ?? Math.max(0, arred(pct(baseST, i.aliquotaST) - icmsProprio));
    let xml =
      tag('modBCST', i.modBCST ?? 4) +
      tag('pMVAST', i.mvaST ? num(i.mvaST, 4) : undefined) +
      tag('pRedBCST', i.reducaoBCST ? num(i.reducaoBCST, 4) : undefined) +
      tag('vBCST', num(baseST)) + tag('pICMSST', num(i.aliquotaST, 4)) + tag('vICMSST', num(v.vST));
    if (i.aliquotaFCPST) {
      v.vFCPST = pct(baseST, i.aliquotaFCPST);
      xml += tag('vBCFCPST', num(baseST)) + tag('pFCPST', num(i.aliquotaFCPST, 4)) + tag('vFCPST', num(v.vFCPST));
    }
    return xml;
  };

  const desonerado = () => {
    if (!i.valorDesonerado) return '';
    v.vICMSDeson = arred(i.valorDesonerado);
    if (i.deduzDesoneracao) v.vICMSDesonDeduzido = v.vICMSDeson;
    return tag('vICMSDeson', num(i.valorDesonerado)) + tag('motDesICMS', i.motivoDesoneracao ?? 9) +
      tag('indDeduzDeson', i.deduzDesoneracao ? 1 : 0);
  };

  const retido = () =>
    i.baseSTRetido === undefined && i.valorSTRetido === undefined
      ? ''
      : tag('vBCSTRet', num(i.baseSTRetido)) + tag('pST', num(i.aliquotaSTRetido, 4)) +
        tag('vICMSSubstituto', i.valorSubstituto !== undefined ? num(i.valorSubstituto) : undefined) +
        tag('vICMSSTRet', num(i.valorSTRetido));

  const credito = () =>
    tag('pCredSN', num(i.aliquotaCredito, 4)) +
    tag('vCredICMSSN', num(i.valorCredito ?? pct(operacao, i.aliquotaCredito)));

  /** ICMS da nota com diferimento: o da operação menos a parte diferida */
  const comDiferimento = () => {
    if (!i.percentualDiferimento) return { valor: icmsOperacao, xml: '' };
    const diferido = pct(icmsOperacao, i.percentualDiferimento);
    return {
      valor: arred(icmsOperacao - diferido),
      xml: tag('vICMSOp', num(icmsOperacao)) + tag('pDif', num(i.percentualDiferimento, 4)) + tag('vICMSDif', num(diferido)),
    };
  };

  if (simples && i.csosn) {
    const csosn = tag('CSOSN', i.csosn);
    switch (i.csosn) {
      case '101':
        return grupoObrigatorio('ICMSSN101', origem, csosn, credito());
      case '102':
      case '103':
      case '300':
      case '400':
        return grupoObrigatorio('ICMSSN102', origem, csosn);
      case '201':
        return grupoObrigatorio('ICMSSN201', origem, csosn, st(icmsOperacao), credito());
      case '202':
      case '203':
        return grupoObrigatorio('ICMSSN202', origem, csosn, st(icmsOperacao));
      case '500':
        return grupoObrigatorio('ICMSSN500', origem, csosn, retido());
      case '900': {
        const icmsProprio = i.aliquota
          ? modBC + proprio(icmsOperacao, pRedBCOpcional) + tag('vICMS', num(icmsOperacao))
          : '';
        return grupoObrigatorio('ICMSSN900', origem, csosn, icmsProprio,
          i.aliquotaST ? st(v.vICMS) : '',
          i.aliquotaCredito ? credito() : '',
        );
      }
      default:
        throw new Error(`CSOSN ${i.csosn} não é tratado.`);
    }
  }

  const cst = i.cst || '00';
  const cstTag = tag('CST', cst);
  const vICMS = () => tag('vICMS', num(v.vICMS));

  switch (cst) {
    case '00':
      return grupoObrigatorio('ICMS00', origem, cstTag, modBC, proprio(), vICMS(), fcp(false));
    case '10':
      return grupoObrigatorio('ICMS10', origem, cstTag, modBC, proprio(), vICMS(), fcp(true), st(icmsOperacao));
    case '20':
      return grupoObrigatorio('ICMS20', origem, cstTag, modBC, pRedBC, proprio(), vICMS(), fcp(true), desonerado());
    case '30':
      return grupoObrigatorio('ICMS30', origem, cstTag, st(icmsOperacao), desonerado());
    case '40':
    case '41':
    case '50':
      return grupoObrigatorio('ICMS40', origem, cstTag, desonerado());
    case '51': {
      if (!i.aliquota) return grupoObrigatorio('ICMS51', origem, cstTag);
      const d = comDiferimento();
      return grupoObrigatorio('ICMS51', origem, cstTag, modBC, pRedBCOpcional,
        proprio(d.valor), d.xml, vICMS(), fcp(true));
    }
    case '60':
      return grupoObrigatorio('ICMS60', origem, cstTag, retido());
    // Monofasia: quantidade × alíquota ad rem (R$ por unidade)
    case '02':
      v.qBCMono = quantidade;
      v.vICMSMono = arred(quantidade * (i.adRemICMS || 0));
      return grupoObrigatorio('ICMS02', origem, cstTag,
        tag('qBCMono', num(quantidade, 4)), tag('adRemICMS', num(i.adRemICMS, 4)), tag('vICMSMono', num(v.vICMSMono)));
    case '15':
      v.qBCMono = quantidade;
      v.vICMSMono = arred(quantidade * (i.adRemICMS || 0));
      v.qBCMonoReten = quantidade;
      v.vICMSMonoReten = arred(quantidade * (i.adRemICMSReten || 0));
      return grupoObrigatorio('ICMS15', origem, cstTag,
        tag('qBCMono', num(quantidade, 4)), tag('adRemICMS', num(i.adRemICMS, 4)), tag('vICMSMono', num(v.vICMSMono)),
        tag('qBCMonoReten', num(quantidade, 4)), tag('adRemICMSReten', num(i.adRemICMSReten, 4)),
        tag('vICMSMonoReten', num(v.vICMSMonoReten)),
        i.reducaoAdRem ? tag('pRedAdRem', num(i.reducaoAdRem)) + tag('motRedAdRem', i.motivoReducaoAdRem ?? 9) : '');
    case '53': {
      const operacaoMono = arred(quantidade * (i.adRemICMS || 0));
      const diferido = pct(operacaoMono, i.percentualDiferimento);
      v.qBCMono = quantidade;
      v.vICMSMono = arred(operacaoMono - diferido);
      return grupoObrigatorio('ICMS53', origem, cstTag,
        tag('qBCMono', num(quantidade, 4)), tag('adRemICMS', num(i.adRemICMS, 4)),
        tag('vICMSMonoOp', num(operacaoMono)),
        i.percentualDiferimento ? tag('pDif', num(i.percentualDiferimento, 4)) + tag('vICMSMonoDif', num(diferido)) : '',
        tag('vICMSMono', num(v.vICMSMono)));
    }
    case '61':
      v.qBCMonoRet = quantidade;
      v.vICMSMonoRet = arred(quantidade * (i.adRemICMSRet || 0));
      return grupoObrigatorio('ICMS61', origem, cstTag,
        tag('qBCMonoRet', num(quantidade, 4)), tag('adRemICMSRet', num(i.adRemICMSRet, 4)),
        tag('vICMSMonoRet', num(v.vICMSMonoRet)));
    case '70':
      return grupoObrigatorio('ICMS70', origem, cstTag, modBC, pRedBC, proprio(), vICMS(), fcp(true),
        st(icmsOperacao), desonerado());
    case '90': {
      let icmsProprio = '';
      if (i.aliquota) {
        const d = comDiferimento();
        icmsProprio = modBC + proprio(d.valor, pRedBCOpcional) + d.xml + vICMS() + fcp(true);
      }
      return grupoObrigatorio('ICMS90', origem, cstTag, icmsProprio,
        i.aliquotaST ? st(v.vICMS) : '', desonerado());
    }
    default:
      throw new Error(`CST ${cst} do ICMS não é tratado.`);
  }
}

function gerarPisCofins(
  nome: 'PIS' | 'COFINS',
  d: TributoPisCofins,
  base: number,
  v: Valores,
  campo: 'vPIS' | 'vCOFINS' | 'vPISServ' | 'vCOFINSServ',
): string {
  const cst = d?.cst || '07';
  const aliquota = nome === 'PIS' ? 'pPIS' : 'pCOFINS';
  const valorTag = nome === 'PIS' ? 'vPIS' : 'vCOFINS';

  // 01/02 = tributado por alíquota; 04 a 09 = sem cálculo; 49+ = outras
  const outras = ['49', '50', '51', '52', '53', '54', '55', '56', '60', '61', '62', '63', '64', '65', '66', '67', '70', '71', '72', '73', '74', '75', '98', '99'];
  if (['01', '02'].includes(cst) || outras.includes(cst)) {
    const b = d.base ?? base;
    v[campo] = d.valor ?? pct(b, d.aliquota);
    return grupoObrigatorio(nome, grupoObrigatorio(`${nome}${outras.includes(cst) ? 'Outr' : 'Aliq'}`,
      tag('CST', cst), tag('vBC', num(b)), tag(aliquota, num(d.aliquota, 4)), tag(valorTag, num(v[campo]))));
  }
  return grupoObrigatorio(nome, grupoObrigatorio(`${nome}NT`, tag('CST', cst)));
}

function gerarIPI(ipi: ImpostoItem['ipi'], operacao: number, v: Valores): string {
  if (!ipi?.cst) return '';
  const tributado = ['00', '49', '50', '99'].includes(ipi.cst);
  const cEnq = tag('cEnq', ipi.codigoEnquadramento || '999');
  if (!tributado) return grupoObrigatorio('IPI', cEnq, grupoObrigatorio('IPINT', tag('CST', ipi.cst)));

  const base = ipi.base ?? operacao;
  v.vIPI = ipi.valor ?? pct(base, ipi.aliquota);
  return grupoObrigatorio('IPI', cEnq,
    grupoObrigatorio('IPITrib', tag('CST', ipi.cst), tag('vBC', num(base)),
      tag('pIPI', num(ipi.aliquota, 4)), tag('vIPI', num(v.vIPI))));
}

function gerarII(ii: ImpostoItem['ii'], v: Valores): string {
  if (!ii) return '';
  v.vII = arred(ii.valor || 0);
  return grupoObrigatorio('II',
    tag('vBC', num(ii.base)), tag('vDespAdu', num(ii.despesasAduaneiras)),
    tag('vII', num(ii.valor)), tag('vIOF', num(ii.iof)));
}

function gerarISSQN(s: NonNullable<ImpostoItem['issqn']>, operacao: number, municipio: string, v: Valores): string {
  v.vBCISS = s.base ?? operacao;
  v.vISS = s.valor ?? pct(v.vBCISS, s.aliquota);
  v.vISSRet = s.valorRetido || 0;
  return grupoObrigatorio('ISSQN',
    tag('vBC', num(v.vBCISS)),
    tag('vAliq', num(s.aliquota, 4)),
    tag('vISSQN', num(v.vISS)),
    tag('cMunFG', s.municipio || municipio),
    tag('cListServ', s.codigoServico),
    tag('vISSRet', opcional(v.vISSRet)),
    tag('indISS', s.exigibilidade ?? 1),
    tag('indIncentivo', s.incentivo ? 1 : 2),
  );
}

function gerarDIFAL(
  d: NonNullable<ImpostoItem['difal']>,
  operacao: number,
  aliquotaICMS: number | undefined,
  v: Valores,
): string {
  const base = d.base ?? operacao;
  const interestadual = Number(d.aliquotaInterestadual ?? aliquotaICMS);
  if (![4, 7, 12].includes(interestadual)) {
    throw new Error('DIFAL: a alíquota interestadual do item precisa ser 4, 7 ou 12%.');
  }
  v.vICMSUFDest = pct(base, Math.max(0, d.aliquotaInterna - interestadual));
  v.vFCPUFDest = pct(base, d.aliquotaFCP);
  // Desde 2019 a partilha é 100% da UF de destino
  return grupoObrigatorio('ICMSUFDest',
    tag('vBCUFDest', num(base)),
    d.aliquotaFCP ? tag('vBCFCPUFDest', num(base)) + tag('pFCPUFDest', num(d.aliquotaFCP, 4)) : '',
    tag('pICMSUFDest', num(d.aliquotaInterna, 4)),
    tag('pICMSInter', num(interestadual)),
    tag('pICMSInterPart', num(100, 4)),
    d.aliquotaFCP ? tag('vFCPUFDest', num(v.vFCPUFDest)) : '',
    tag('vICMSUFDest', num(v.vICMSUFDest)),
    tag('vICMSUFRemet', num(0)),
  );
}

function gerarIBSCBS(t: ImpostoItem['ibscbs'], base: number, quantidade: number, v: Valores): string {
  if (!t?.cst) return '';
  const cabecalho =
    tag('CST', t.cst) + tag('cClassTrib', t.classificacao) + (t.indDoacao ? tag('indDoacao', 1) : '');

  // O corpo é uma escolha do schema: valores, monofasia, transferência ou ajuste
  let corpo = '';
  if (t.cst === '800') {
    if (!t.transferencia) {
      throw new Error('CST 800 do IBS/CBS é transferência de crédito: informe os valores de IBS e CBS a transferir.');
    }
    corpo = grupoObrigatorio('gTransfCred',
      tag('vIBS', num(t.transferencia.ibs)), tag('vCBS', num(t.transferencia.cbs)));
  } else if (t.cst === '810') {
    if (!t.ajuste) {
      throw new Error('CST 810 do IBS/CBS é ajuste de competência: informe a competência (AAAA-MM) e os valores.');
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(t.ajuste.competencia)) {
      throw new Error('A competência do ajuste (CST 810) deve estar no formato AAAA-MM.');
    }
    corpo = grupoObrigatorio('gAjusteCompet',
      tag('competApur', t.ajuste.competencia), tag('vIBS', num(t.ajuste.ibs)), tag('vCBS', num(t.ajuste.cbs)));
  } else if (t.cst === '620') {
    corpo = gerarIBSCBSMono(t.monofasia || {}, quantidade, v);
  } else if (!CST_IBSCBS_SEM_VALORES.includes(t.cst)) {
    corpo = gerarGrupoIBSCBS(t, base, v);
  }

  // Estorno e crédito presumido ficam fora da escolha: valem para qualquer CST
  const estorno = t.estornoIBS || t.estornoCBS
    ? grupoObrigatorio('gEstornoCred',
        tag('vIBSEstCred', num(t.estornoIBS || 0)), tag('vCBSEstCred', num(t.estornoCBS || 0)))
    : '';
  if (estorno) {
    v.vIBSEstCred = arred(t.estornoIBS || 0);
    v.vCBSEstCred = arred(t.estornoCBS || 0);
  }

  return grupoObrigatorio('IBSCBS', cabecalho, corpo, estorno, gerarCredPres(t.credPres, t.base ?? base, v));
}

/** gIBSCBS: os valores por esfera, com diferimento, devolução, redução e a tributação regular */
function gerarGrupoIBSCBS(t: NonNullable<ImpostoItem['ibscbs']>, base: number, v: Valores): string {
  const b = t.base ?? base;
  v.vBCIBSCBS = b;

  // Cada esfera: alíquota, parte diferida, devolução, redução e valor, na ordem do schema
  const esfera = (sufixo: 'IBSUF' | 'IBSMun' | 'CBS', aliquota = 0, devolucao = 0) => {
    const efetiva = t.reducao ? arred(aliquota * (1 - t.reducao / 100), 4) : aliquota;
    const cheio = pct(b, efetiva);
    const diferido = t.diferimento ? pct(cheio, t.diferimento) : 0;
    const valor = arred(cheio - diferido);
    // Devolução (art. 118 da LC 214): informativa, não abate o tributo devido
    const devolvido = devolucao ? pct(valor, devolucao) : 0;
    const xml =
      tag(`p${sufixo}`, num(aliquota, 4)) +
      (t.diferimento ? grupoObrigatorio('gDif', tag('pDif', num(t.diferimento, 4)), tag('vDif', num(diferido))) : '') +
      (devolucao ? grupoObrigatorio('gDevTrib', tag('pDevTrib', num(devolucao, 4)), tag('vDevTrib', num(devolvido))) : '') +
      (t.reducao ? grupoObrigatorio('gRed', tag('pRedAliq', num(t.reducao, 4)), tag('pAliqEfet', num(efetiva, 4))) : '') +
      tag(`v${sufixo}`, num(valor));
    return { valor, diferido, devolvido, xml };
  };

  const uf = esfera('IBSUF', t.aliquotaIBSUF, t.devolucaoIBSUF);
  const mun = esfera('IBSMun', t.aliquotaIBSMun, t.devolucaoIBSMun);
  const cbs = esfera('CBS', t.aliquotaCBS, t.devolucaoCBS);
  v.vIBSUF = uf.valor;
  v.vDifIBSUF = uf.diferido;
  v.vDevTribIBSUF = uf.devolvido;
  v.vIBSMun = mun.valor;
  v.vDifIBSMun = mun.diferido;
  v.vDevTribIBSMun = mun.devolvido;
  v.vCBS = cbs.valor;
  v.vDifCBS = cbs.diferido;
  v.vDevTribCBS = cbs.devolvido;

  // Tributação regular: quanto seria devido sem o tratamento diferenciado do cClassTrib
  const r = t.tribRegular;
  const regular = r?.cst
    ? grupoObrigatorio('gTribRegular',
        tag('CSTReg', r.cst),
        tag('cClassTribReg', r.classificacao),
        tag('pAliqEfetRegIBSUF', num(r.aliquotaIBSUF || 0, 4)), tag('vTribRegIBSUF', num(pct(b, r.aliquotaIBSUF))),
        tag('pAliqEfetRegIBSMun', num(r.aliquotaIBSMun || 0, 4)), tag('vTribRegIBSMun', num(pct(b, r.aliquotaIBSMun))),
        tag('pAliqEfetRegCBS', num(r.aliquotaCBS || 0, 4)), tag('vTribRegCBS', num(pct(b, r.aliquotaCBS))),
      )
    : '';

  return grupoObrigatorio('gIBSCBS',
    tag('vBC', num(b)),
    grupoObrigatorio('gIBSUF', uf.xml),
    grupoObrigatorio('gIBSMun', mun.xml),
    tag('vIBS', num(uf.valor + mun.valor)),
    grupoObrigatorio('gCBS', cbs.xml),
    regular,
  );
}

/** gCredPresOper: crédito presumido do emitente, por alíquota sobre a base própria */
function gerarCredPres(cp: NonNullable<ImpostoItem['ibscbs']>['credPres'], base: number, v: Valores): string {
  if (!cp?.codigo) return '';
  const b = cp.base ?? base;

  const ramo = (nome: 'IBS' | 'CBS', aliquota?: number) => {
    if (aliquota === undefined) return '';
    const valor = pct(b, aliquota);
    if (cp.suspensivo) v[`vCredPresCondSus${nome}`] = valor;
    else v[`vCredPres${nome}`] = valor;
    return grupoObrigatorio(`g${nome}CredPres`,
      tag('pCredPres', num(aliquota, 4)),
      tag(cp.suspensivo ? 'vCredPresCondSus' : 'vCredPres', num(valor)),
    );
  };

  return grupoObrigatorio('gCredPresOper',
    tag('vBCCredPres', num(b)),
    tag('cCredPres', cp.codigo.replace(/\D/g, '').padStart(2, '0')),
    ramo('IBS', cp.aliquotaIBS),
    ramo('CBS', cp.aliquotaCBS),
  );
}

type Monofasia = NonNullable<NonNullable<ImpostoItem['ibscbs']>['monofasia']>;

/**
 * gIBSCBSMono (CST 620). Cada tributo sai em um de dois ramos do schema:
 * ad rem (R$ por unidade, o caso dos combustíveis) ou ad valorem (% sobre o
 * valor) — informar alguma alíquota ad valorem escolhe o segundo. A diferença
 * de mistura do biocombustível (gpBioDiferenca) entra no ramo que estiver ativo.
 */
function gerarIBSCBSMono(m: Monofasia, q: number, v: Valores): string {
  const bio = (nome: 'IBS' | 'CBS', valorDiferenca?: number) =>
    m.quantidadeBio && valorDiferenca !== undefined
      ? grupoObrigatorio('gpBioDiferenca',
          tag('qBCBioComb', num(m.quantidadeBio, 4)), tag(`v${nome}Diferenca`, num(valorDiferenca)))
      : '';

  const adRem = (nome: 'IBS' | 'CBS', aliquota?: number, aliquotaReten?: number, retido?: number) => {
    const valor = aliquota !== undefined ? arred(q * aliquota) : 0;
    const reten = aliquotaReten !== undefined ? arred(q * aliquotaReten) : 0;
    const xml = grupo(`g${nome}MonoAdRem`,
      aliquota !== undefined
        ? grupoObrigatorio('gMonoPadrao',
            tag('qBCMono', num(q, 4)), tag(`adRem${nome}`, num(aliquota, 4)), tag(`v${nome}Mono`, num(valor)))
        : '',
      aliquotaReten !== undefined
        ? grupoObrigatorio('gMonoReten',
            tag('qBCMonoReten', num(q, 4)), tag(`adRem${nome}Reten`, num(aliquotaReten, 4)),
            tag(`v${nome}MonoReten`, num(reten)))
        : '',
      retido ? grupoObrigatorio('gMonoRet', tag(`v${nome}MonoRet`, num(retido))) : '',
      bio(nome, nome === 'IBS' ? m.valorIBSDiferenca : m.valorCBSDiferenca),
    );
    return { xml, valor, reten };
  };

  const adValoremIBS = () => {
    const b = m.baseAdValorem || 0;
    const vUF = pct(b, m.aliquotaAdValoremIBSUF);
    const vMun = pct(b, m.aliquotaAdValoremIBSMun);
    const valor = arred(vUF + vMun);
    const bReten = m.baseRetencaoAdValorem || 0;
    const reten = m.aliquotaRetencaoIBS !== undefined ? pct(bReten, m.aliquotaRetencaoIBS) : 0;
    const xml = grupoObrigatorio('gIBSMonoAdValorem',
      grupoObrigatorio('gMonoPadrao',
        tag('vBCMono', num(b)),
        tag('pAliqMonoUF', num(m.aliquotaAdValoremIBSUF || 0, 4)), tag('vIBSMonoUF', num(vUF)),
        tag('pAliqMonoMun', num(m.aliquotaAdValoremIBSMun || 0, 4)), tag('vIBSMonoMun', num(vMun)),
        tag('vIBSMono', num(valor)),
      ),
      m.aliquotaRetencaoIBS !== undefined
        ? grupoObrigatorio('gMonoReten',
            tag('vBCMonoReten', num(bReten)), tag('pAliqMonoReten', num(m.aliquotaRetencaoIBS, 4)),
            tag('vIBSMonoReten', num(reten)))
        : '',
      m.valorIBSRetido ? grupoObrigatorio('gMonoRet', tag('vIBSMonoRet', num(m.valorIBSRetido))) : '',
      bio('IBS', m.valorIBSDiferenca),
    );
    return { xml, valor, reten };
  };

  const adValoremCBS = () => {
    const b = m.baseAdValorem || 0;
    const valor = pct(b, m.aliquotaAdValoremCBS);
    const bReten = m.baseRetencaoAdValorem || 0;
    const reten = m.aliquotaRetencaoCBS !== undefined ? pct(bReten, m.aliquotaRetencaoCBS) : 0;
    const xml = grupoObrigatorio('gCBSMonoAdValorem',
      grupoObrigatorio('gMonoPadrao',
        tag('vBCMono', num(b)),
        tag('pAliqMonoCBS', num(m.aliquotaAdValoremCBS || 0, 4)), tag('vCBSMono', num(valor)),
      ),
      m.aliquotaRetencaoCBS !== undefined
        ? grupoObrigatorio('gMonoReten',
            tag('vBCMonoReten', num(bReten)), tag('pAliqMonoReten', num(m.aliquotaRetencaoCBS, 4)),
            tag('vCBSMonoReten', num(reten)))
        : '',
      m.valorCBSRetido ? grupoObrigatorio('gMonoRet', tag('vCBSMonoRet', num(m.valorCBSRetido))) : '',
      bio('CBS', m.valorCBSDiferenca),
    );
    return { xml, valor, reten };
  };

  const ibsAdValorem = m.aliquotaAdValoremIBSUF !== undefined || m.aliquotaAdValoremIBSMun !== undefined;
  const ibs = ibsAdValorem ? adValoremIBS() : adRem('IBS', m.adRemIBS, m.adRemIBSReten, m.valorIBSRetido);
  const cbs = m.aliquotaAdValoremCBS !== undefined
    ? adValoremCBS()
    : adRem('CBS', m.adRemCBS, m.adRemCBSReten, m.valorCBSRetido);

  v.vIBSMono = ibs.valor;
  v.vIBSMonoReten = ibs.reten;
  v.vIBSMonoRet = m.valorIBSRetido || 0;
  v.vCBSMono = cbs.valor;
  v.vCBSMonoReten = cbs.reten;
  v.vCBSMonoRet = m.valorCBSRetido || 0;

  return grupoObrigatorio('gIBSCBSMono', ibs.xml, cbs.xml,
    tag('vTotIBSMonoItem', num(arred(ibs.valor + ibs.reten))),
    tag('vTotCBSMonoItem', num(arred(cbs.valor + cbs.reten))));
}

/** Grupo IS do item: Imposto Seletivo sobre os produtos do Anexo I da NT 2025.002 */
function gerarIS(t: ImpostoItem['seletivo'], operacao: number, item: ItemNFe, v: Valores): string {
  if (!t?.cst) return '';
  if (!t.classificacao) {
    throw new Error('O Imposto Seletivo exige o código de classificação tributária (cClassTribIS).');
  }

  const base = t.base ?? operacao;
  const quantidade = t.quantidadeTributavel ?? item.quantidade;
  // vIS = BC × alíquota percentual + quantidade × alíquota por unidade (NT 2025.002, RV UB11-10)
  const valor = arred(pct(base, t.aliquota) + (t.adRem !== undefined ? arred(quantidade * t.adRem) : 0));
  v.vIS = valor;

  return grupoObrigatorio('IS',
    tag('CSTIS', t.cst),
    tag('cClassTribIS', t.classificacao),
    tag('vBCIS', num(base)),
    tag('pIS', num(t.aliquota || 0, 4)),
    t.adRem !== undefined ? tag('adRemIS', num(t.adRem, 4)) : '',
    tag('uTrib', limparTexto(t.unidadeTributavel || item.unidade, 6)),
    tag('qTrib', num(quantidade, 4)),
    tag('vIS', num(valor)),
  );
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

export function gerarNFe(ctx: Contexto, doc: DocumentoNFe): NFeGerada {
  const emit = ctx.emitente;
  const cfg = ctx.config;
  const modelo = cfg.geral.modeloDF;
  const nfce = modelo === '65';
  const simples = [1, 2, 4].includes(Number(emit.crt));
  const ambiente = cfg.webservice.ambiente;
  const semIE = emitenteSemIE(emit);

  if (!doc.itens?.length) throw new Error('A nota precisa de ao menos um item.');
  if (!emit.cnpj) throw new Error('O CNPJ do emitente não está preenchido em Configurações › Emitente.');
  if (semIE && nfce) {
    throw new Error(
      'NFC-e exige a Inscrição Estadual do emitente. Sem IE (contribuinte exclusivo do IBS/CBS) ' +
        'só é possível emitir NF-e, modelo 55 (NT 2026.007). Para IE isenta, informe ISENTO.',
    );
  }

  const emissao = dataDoDocumento(doc.ide.dataEmissao);
  const tipoEmissao = doc.ide.tipoEmissao ?? (cfg.geral.formaEmissao === 1 ? 1 : cfg.geral.formaEmissao);

  const { chave, codigoNumerico } = montarChave({
    uf: emit.uf,
    emissao,
    cnpj: emit.cnpj,
    modelo,
    serie: doc.ide.serie,
    numero: doc.ide.numero,
    tipoEmissao,
    codigoNumerico: doc.ide.codigoNumerico,
  });

  // Em homologação a razão social do destinatário é obrigatoriamente esta frase
  const homologacao = ambiente === 2;
  const dest = doc.destinatario;

  // Indicadores calculados uma vez só: a regra abaixo e o XML usam os mesmos valores
  // Sem indicação, o destino sai da UF do destinatário: EX = exterior, outra UF = interestadual
  const ufDestino = dest?.endereco?.uf?.toUpperCase();
  const idDest = doc.ide.idDestino ?? (nfce || !ufDestino ? 1 : ufDestino === 'EX' ? 3 : ufDestino !== emit.uf.toUpperCase() ? 2 : 1);
  const indFinal = doc.ide.consumidorFinal ?? (nfce ? 1 : 0);
  const indIEDest = dest ? dest.indIEDest ?? (dest.inscricaoEstadual ? 1 : 9) : undefined;

  // Rejeição 696 (MOC 4.00): não contribuinte, fora de operação com o exterior, é
  // sempre consumidor final. O ACBr não confere essa regra; a SEFAZ confere, e a nota
  // voltava rejeitada. Não corrigimos sozinhos porque é dado fiscal escolhido por quem
  // emite — a mensagem diz o que mudar.
  if (indIEDest === 9 && idDest !== 3 && indFinal !== 1) {
    throw new Error(
      'Destinatário não contribuinte (indicador de IE = 9) exige "Consumidor final = Sim" ' +
        '(rejeição 696 da SEFAZ). A exceção é a operação com o exterior.',
    );
  }

  const calculados = doc.itens.map((item, n) =>
    calcularItem(item, n, {
      simples,
      consumidorFinal: indFinal === 1,
      difal: idDest === 2 && indFinal === 1 && indIEDest === 9,
      municipioEmitente: emit.codigo_municipio,
      semICMS: semIE,
    }),
  );
  const totais = totalizar(calculados);

  const inscricaoMunicipal = (cfg.geral.inscricaoMunicipal || '').replace(/\s/g, '');
  if (totais.temServico && !inscricaoMunicipal) {
    throw new Error('Item de serviço (ISSQN) exige a inscrição municipal do emitente em Configurações › Geral.');
  }

  // ----- ide -----
  const ide = grupoObrigatorio('ide',
    tag('cUF', CODIGO_UF[emit.uf.toUpperCase()]),
    tag('cNF', codigoNumerico),
    tag('natOp', limparTexto(doc.ide.naturezaOperacao, 60)),
    tag('mod', modelo),
    tag('serie', doc.ide.serie),
    tag('nNF', doc.ide.numero),
    tag('dhEmi', dataHoraDFe(emissao)),
    doc.ide.dataSaida ? tag('dhSaiEnt', dataHoraDFe(dataDoDocumento(doc.ide.dataSaida))) : '',
    doc.ide.dataPrevisaoEntrega ? tag('dPrevEntrega', dataISO(dataDoDocumento(doc.ide.dataPrevisaoEntrega))) : '',
    tag('tpNF', doc.ide.tipoDocumento),
    tag('idDest', idDest),
    tag('cMunFG', doc.ide.codigoMunicipioFG || emit.codigo_municipio),
    tag('tpImp', nfce ? 4 : [1, 2, 3].includes(Number(doc.ide.formatoImpressao)) ? Number(doc.ide.formatoImpressao) : 1),
    tag('tpEmis', tipoEmissao),
    tag('cDV', chave.slice(-1)),
    tag('tpAmb', ambiente),
    tag('finNFe', doc.ide.finalidade ?? 1),
    tag('indFinal', indFinal),
    tag('indPres', doc.ide.presencial ?? (nfce ? 1 : 0)),
    tag('procEmi', 0),
    tag('verProc', 'BMNFe 0.1.0'),
  );

  // ----- emit -----
  const emitente = grupoObrigatorio('emit',
    tag('CNPJ', emit.cnpj),
    tag('xNome', limparTexto(emit.razao_social, 60)),
    tag('xFant', limparTexto(emit.nome_fantasia || '', 60)),
    grupoObrigatorio('enderEmit',
      tag('xLgr', limparTexto(emit.logradouro, 60)),
      tag('nro', limparTexto(emit.numero || 'S/N', 60)),
      tag('xCpl', limparTexto(emit.complemento || '', 60)),
      tag('xBairro', limparTexto(emit.bairro, 60)),
      tag('cMun', emit.codigo_municipio),
      tag('xMun', limparTexto(emit.municipio, 60)),
      tag('UF', emit.uf),
      tag('CEP', (emit.cep || '').replace(/\D/g, '')),
      tag('cPais', '1058'),
      tag('xPais', 'BRASIL'),
      tag('fone', (emit.fone || '').replace(/\D/g, '')),
    ),
    // Sem IE: contribuinte exclusivo do IBS/CBS, a tag não vai (NT 2026.007)
    tag('IE', /ISENTO/i.test(emit.inscricao_estadual || '') ? 'ISENTO' : (emit.inscricao_estadual || '').replace(/\D/g, '')),
    inscricaoMunicipal ? tag('IM', inscricaoMunicipal) + tag('CNAE', cfg.geral.cnae?.replace(/\D/g, '')) : '',
    tag('CRT', emit.crt),
  );

  // ----- dest -----
  let destinatario = '';
  if (dest) {
    const documento =
      tag('CNPJ', dest.cnpj?.replace(/\D/g, '')) ||
      tag('CPF', dest.cpf?.replace(/\D/g, '')) ||
      tag('idEstrangeiro', dest.idEstrangeiro);

    const e = dest.endereco;
    destinatario = grupoObrigatorio('dest',
      documento,
      tag('xNome', homologacao
        ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
        : limparTexto(dest.nome, 60)),
      e
        ? grupoObrigatorio('enderDest',
            tag('xLgr', limparTexto(e.logradouro, 60)),
            tag('nro', limparTexto(e.numero || 'S/N', 60)),
            tag('xCpl', limparTexto(e.complemento || '', 60)),
            tag('xBairro', limparTexto(e.bairro, 60)),
            tag('cMun', e.codigoMunicipio),
            tag('xMun', limparTexto(e.municipio, 60)),
            tag('UF', e.uf),
            tag('CEP', (e.cep || '').replace(/\D/g, '')),
            tag('cPais', e.codigoPais || '1058'),
            tag('xPais', e.pais || 'BRASIL'),
            tag('fone', (e.fone || '').replace(/\D/g, '')),
          )
        : '',
      tag('indIEDest', indIEDest),
      indIEDest === 1 ? tag('IE', (dest.inscricaoEstadual || '').replace(/\D/g, '')) : '',
      tag('ISUF', dest.suframa),
      tag('email', dest.email),
    );
  }

  // ----- det -----
  const itens = doc.itens
    .map((item, indice) => {
      const valorTotal = item.valorTotal ?? item.quantidade * item.valorUnitario;
      const ean = item.ean?.trim() || 'SEM GTIN';

      const prod = grupoObrigatorio('prod',
        tag('cProd', limparTexto(item.codigo, 60)),
        tag('cEAN', ean),
        tag('xProd', homologacao && indice === 0 && nfce
          ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
          : limparTexto(item.descricao, 120)),
        tag('NCM', (item.ncm || '').replace(/\D/g, '')),
        tag('CEST', item.cest?.replace(/\D/g, '')),
        tag('CFOP', item.cfop),
        tag('uCom', limparTexto(item.unidade, 6)),
        tag('qCom', num(item.quantidade, 4)),
        tag('vUnCom', num(item.valorUnitario, 10)),
        tag('vProd', num(valorTotal)),
        tag('cEANTrib', ean),
        tag('uTrib', limparTexto(item.unidade, 6)),
        tag('qTrib', num(item.quantidade, 4)),
        tag('vUnTrib', num(item.valorUnitario, 10)),
        item.valorFrete ? tag('vFrete', num(item.valorFrete)) : '',
        item.valorSeguro ? tag('vSeg', num(item.valorSeguro)) : '',
        item.valorDesconto ? tag('vDesc', num(item.valorDesconto)) : '',
        item.valorOutros ? tag('vOutro', num(item.valorOutros)) : '',
        tag('indTot', item.compoeTotal === false ? 0 : 1),
        gerarDI(item.di),
        item.combustivel
          ? grupoObrigatorio('comb',
              tag('cProdANP', item.combustivel.codigoANP),
              tag('descANP', limparTexto(item.combustivel.descricaoANP, 95)),
              tag('UFCons', item.combustivel.ufConsumo || dest?.endereco?.uf || emit.uf),
              tag('pBio', item.combustivel.percentualBio ? num(item.combustivel.percentualBio, 4) : undefined),
            )
          : '',
      );

      const { imposto } = calculados[indice];

      return `<det nItem="${indice + 1}">${prod}${imposto}${
        tag('infAdProd', limparTexto(item.informacoesAdicionais || '', 500))
      }</det>`;
    })
    .join('');

  // ----- total -----
  const temDifal = totais.temDifal;
  const total = grupoObrigatorio('total',
    grupoObrigatorio('ICMSTot',
      tag('vBC', num(totais.vBC)),
      tag('vICMS', num(totais.vICMS)),
      tag('vICMSDeson', num(totais.vICMSDeson)),
      temDifal ? tag('vFCPUFDest', num(totais.vFCPUFDest)) : '',
      temDifal ? tag('vICMSUFDest', num(totais.vICMSUFDest)) : '',
      temDifal ? tag('vICMSUFRemet', num(0)) : '',
      tag('vFCP', num(totais.vFCP)),
      tag('vBCST', num(totais.vBCST)),
      tag('vST', num(totais.vST)),
      tag('vFCPST', num(totais.vFCPST)),
      tag('vFCPSTRet', num(0)),
      ...(totais.temMonoICMS
        ? [
            tag('qBCMono', num(totais.qBCMono)), tag('vICMSMono', num(totais.vICMSMono)),
            tag('qBCMonoReten', num(totais.qBCMonoReten)), tag('vICMSMonoReten', num(totais.vICMSMonoReten)),
            tag('qBCMonoRet', num(totais.qBCMonoRet)), tag('vICMSMonoRet', num(totais.vICMSMonoRet)),
          ]
        : []),
      tag('vProd', num(totais.vProd)),
      tag('vFrete', num(totais.vFrete)),
      tag('vSeg', num(totais.vSeg)),
      tag('vDesc', num(totais.vDesc)),
      tag('vII', num(totais.vII)),
      tag('vIPI', num(totais.vIPI)),
      tag('vIPIDevol', num(0)),
      tag('vPIS', num(totais.vPIS)),
      tag('vCOFINS', num(totais.vCOFINS)),
      tag('vOutro', num(totais.vOutro)),
      tag('vNF', num(totais.vNF)),
      tag('vTotTrib', opcional(totais.vTotTrib)),
    ),
    totais.temServico
      ? grupoObrigatorio('ISSQNtot',
          tag('vServ', opcional(totais.vServ)),
          tag('vBC', opcional(totais.vBCISS)),
          tag('vISS', opcional(totais.vISS)),
          tag('vPIS', opcional(totais.vPISServ)),
          tag('vCOFINS', opcional(totais.vCOFINSServ)),
          tag('dCompet', dataISO(emissao)),
          tag('vISSRet', opcional(totais.vISSRet)),
        )
      : '',
    totais.temIS ? grupoObrigatorio('ISTot', tag('vIS', num(totais.vIS))) : '',
    totais.temIBSCBS
      ? grupoObrigatorio('IBSCBSTot',
          tag('vBCIBSCBS', num(totais.vBCIBSCBS)),
          grupoObrigatorio('gIBS',
            grupoObrigatorio('gIBSUF',
              tag('vDif', num(totais.vDifIBSUF)), tag('vDevTrib', num(totais.vDevTribIBSUF)),
              tag('vIBSUF', num(totais.vIBSUF))),
            grupoObrigatorio('gIBSMun',
              tag('vDif', num(totais.vDifIBSMun)), tag('vDevTrib', num(totais.vDevTribIBSMun)),
              tag('vIBSMun', num(totais.vIBSMun))),
            tag('vIBS', num(totais.vIBSUF + totais.vIBSMun)),
            tag('vCredPres', num(totais.vCredPresIBS)),
            tag('vCredPresCondSus', num(totais.vCredPresCondSusIBS)),
          ),
          grupoObrigatorio('gCBS',
            tag('vDif', num(totais.vDifCBS)), tag('vDevTrib', num(totais.vDevTribCBS)), tag('vCBS', num(totais.vCBS)),
            tag('vCredPres', num(totais.vCredPresCBS)), tag('vCredPresCondSus', num(totais.vCredPresCondSusCBS))),
          totais.temMonoIBSCBS
            ? grupoObrigatorio('gMono',
                tag('vIBSMono', num(totais.vIBSMono)), tag('vCBSMono', num(totais.vCBSMono)),
                tag('vIBSMonoReten', num(totais.vIBSMonoReten)), tag('vCBSMonoReten', num(totais.vCBSMonoReten)),
                tag('vIBSMonoRet', num(totais.vIBSMonoRet)), tag('vCBSMonoRet', num(totais.vCBSMonoRet)),
              )
            : '',
          totais.vIBSEstCred || totais.vCBSEstCred
            ? grupoObrigatorio('gEstornoCred',
                tag('vIBSEstCred', num(totais.vIBSEstCred)), tag('vCBSEstCred', num(totais.vCBSEstCred)))
            : '',
        )
      : '',
  );

  // ----- transp -----
  const t = doc.transporte;
  const transporte = grupoObrigatorio('transp',
    tag('modFrete', t?.modalidadeFrete ?? 9),
    t?.transportadora
      ? grupo('transporta',
          tag('CNPJ', t.transportadora.cnpj?.replace(/\D/g, '')) ||
            tag('CPF', t.transportadora.cpf?.replace(/\D/g, '')),
          tag('xNome', limparTexto(t.transportadora.nome || '', 60)),
          tag('IE', t.transportadora.ie?.replace(/\D/g, '')),
          tag('xEnder', limparTexto(t.transportadora.endereco || '', 60)),
          tag('xMun', limparTexto(t.transportadora.municipio || '', 60)),
          tag('UF', t.transportadora.uf),
        )
      : '',
    t?.veiculo
      ? grupo('veicTransp', tag('placa', t.veiculo.placa), tag('UF', t.veiculo.uf), tag('RNTC', t.veiculo.rntc))
      : '',
    (t?.volumes || [])
      .map((v) =>
        grupo('vol',
          tag('qVol', v.quantidade),
          tag('esp', limparTexto(v.especie || '', 60)),
          tag('marca', limparTexto(v.marca || '', 60)),
          tag('nVol', limparTexto(v.numeracao || '', 60)),
          tag('pesoL', v.pesoLiquido !== undefined ? num(v.pesoLiquido, 3) : undefined),
          tag('pesoB', v.pesoBruto !== undefined ? num(v.pesoBruto, 3) : undefined),
        ),
      )
      .join(''),
  );

  // ----- pag -----
  const pagamentos = doc.pagamentos?.length
    ? doc.pagamentos
    : [{ forma: '90' } as Pagamento];

  const pag = grupoObrigatorio('pag',
    pagamentos
      .map((p) =>
        grupoObrigatorio('detPag',
          p.indPag !== undefined ? tag('indPag', p.indPag) : '',
          tag('tPag', p.forma),
          p.forma === '99' ? tag('xPag', limparTexto(p.descricao || 'Outros', 60)) : '',
          // Sem valor informado, o pagamento cobre a nota inteira ("90 — Sem pagamento" é sempre zero)
          tag('vPag', num(p.forma === '90' ? 0 : p.valor ?? totais.vNF)),
        ),
      )
      .join(''),
  );

  // Vinculação com a transação de pagamento (IT DFe 2026.001): irmã do pag no infNFe
  const pgtoVinc = doc.vinculosPagamento?.length
    ? grupoObrigatorio('gPgtoVinc',
        doc.vinculosPagamento
          .map((vp) =>
            `<gPgto nPag="${Number(vp.numero) || 1}" idTransacao="${escapar(String(vp.idTransacao))}">` +
              tag('tpMeioPgto', String(vp.meioPagamento).replace(/\D/g, '').padStart(2, '0')) +
              tag('CNPJReceb', vp.cnpjRecebedor.replace(/\D/g, '')) +
              tag('CNPJBasePSP', vp.cnpjBasePSP.replace(/[^0-9A-Za-z]/g, '').toUpperCase()) +
              '</gPgto>',
          )
          .join(''),
      )
    : '';

  // ----- infAdic / infRespTec -----
  const infAdic = grupo('infAdic',
    tag('infAdFisco', limparTexto(doc.informacoesAdicionais?.fisco || '', 2000)),
    tag('infCpl', limparTexto(doc.informacoesAdicionais?.contribuinte || '', 5000)),
  );

  const g = ctx.config.geral;
  const rt = doc.responsavelTecnico ?? (g.respTecCNPJ
    ? { cnpj: g.respTecCNPJ, contato: g.respTecContato, email: g.respTecEmail, fone: g.respTecFone, idCSRT: g.idCSRT, csrt: g.csrt }
    : undefined);
  const infRespTec = rt
    ? grupoObrigatorio('infRespTec',
        tag('CNPJ', rt.cnpj.replace(/\D/g, '')),
        tag('xContato', limparTexto(rt.contato, 60)),
        tag('email', rt.email),
        tag('fone', rt.fone.replace(/\D/g, '')),
        ...(rt.idCSRT && rt.csrt
          ? [tag('idCSRT', rt.idCSRT), tag('hashCSRT', hashCSRT(rt.csrt, chave))]
          : []),
      )
    : '';

  const infNFe =
    `<infNFe versao="4.00" Id="NFe${chave}">` +
    ide + emitente + destinatario + itens + total + transporte + pag + pgtoVinc + infAdic + infRespTec +
    '</infNFe>';

  // NFC-e leva o bloco suplementar com o QR-Code e a URL de consulta
  const suplementar = nfce
    ? grupoObrigatorio('infNFeSupl',
        `<qrCode><![CDATA[${qrCode(ctx, chave, totais, emissao, tipoEmissao)}]]></qrCode>`,
        `<urlChave>${urlsConsulta('NFCe', emit.uf, ambiente, versaoQRCode(ctx)).consulta}</urlChave>`,
      )
    : '';

  const xml = `${DECLARACAO}<NFe xmlns="${NS_NFE}">${infNFe}${suplementar}</NFe>`;

  return { xml, chave, numero: doc.ide.numero, serie: doc.ide.serie, modelo, totais };
}

function gerarDI(di?: DeclaracaoImportacao): string {
  if (!di) return '';
  return grupoObrigatorio('DI',
    tag('nDI', limparTexto(di.numero, 15)),
    tag('dDI', di.data),
    tag('xLocDesemb', limparTexto(di.localDesembaraco, 60)),
    tag('UFDesemb', di.ufDesembaraco),
    tag('dDesemb', di.dataDesembaraco),
    tag('tpViaTransp', di.viaTransporte),
    tag('vAFRMM', di.afrmm !== undefined ? num(di.afrmm) : undefined),
    tag('tpIntermedio', di.intermedio),
    tag('CNPJ', di.cnpjAdquirente?.replace(/\D/g, '')),
    tag('UFTerceiro', di.ufTerceiro),
    tag('cExportador', limparTexto(di.codigoExportador, 60)),
    ...(di.adicoes || []).map((a) =>
      grupoObrigatorio('adi',
        tag('nAdicao', a.numero),
        tag('nSeqAdic', a.sequencia),
        tag('cFabricante', limparTexto(a.fabricante, 60)),
        tag('vDescDI', a.desconto ? num(a.desconto) : undefined),
        tag('nDraw', a.drawback),
      ),
    ),
  );
}

/** hashCSRT = SHA-1 do CSRT + chave, em base64 (NT 2018.005) */
function hashCSRT(csrt: string, chave: string): string {
  return crypto.createHash('sha1').update(csrt + chave, 'utf8').digest('base64');
}

/**
 * QR-Code da NFC-e, versão 2 (TACBrNFe.GetURLQRCode).
 * Em emissão online a entrada é chave|versao|tpAmb|; offline (tpEmis 9) inclui
 * o dia da emissão, o valor e o digest.
 */
/** Versão do QR-Code escolhida nas Configurações; a 2 é a vigente desde 2019 */
function versaoQRCode(ctx: Contexto): number {
  return Number(ctx.config.geral.versaoQRCode) || VERSAO_QRCODE;
}

function qrCode(
  ctx: Contexto,
  chave: string,
  totais: Totais,
  emissao: Date,
  tipoEmissao: number,
): string {
  const cfg = ctx.config.geral;
  const ambiente = ctx.config.webservice.ambiente;
  const versao = versaoQRCode(ctx);
  const urlBase = urlsConsulta('NFCe', ctx.emitente.uf, ambiente, versao).qrCode;
  const idCSC = String(Number(cfg.idCSC || 0));

  let entrada = `${chave}|${versao}|${ambiente}|`;
  if (tipoEmissao === 9) {
    const dia = String(emissao.getDate()).padStart(2, '0');
    // O digest só existe depois de assinar; na emissão offline a NFC-e vai sem ele
    entrada += `${dia}|${num(totais.vNF)}||`;
  }

  const hash = crypto.createHash('sha1').update(entrada + idCSC + cfg.csc, 'utf8').digest('hex').toUpperCase();
  const separador = urlBase.includes('?p=') ? '' : '?p=';

  return `${urlBase}${separador}${entrada}${idCSC}|${hash}`;
}

export { somarTotais };
