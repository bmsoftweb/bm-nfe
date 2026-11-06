/**
 * Catálogo dos eventos da NF-e, espelhando as abas "Eventos" do exemplo Delphi.
 *
 * `orgaoNacional` marca os eventos que são recebidos pelo Ambiente Nacional em
 * vez da SEFAZ da UF — é o caso da manifestação do destinatário e do EPEC.
 */

export interface TipoEvento {
  codigo: string;
  descricao: string;
  /** Texto exato exigido em <descEvento> */
  descEvento: string;
  grupo: 'comuns' | 'manifestacao' | 'reforma';
  orgaoNacional?: boolean;
  /** Eventos da reforma tributária são recebidos pela SEFAZ Virtual do RS */
  orgaoSVRS?: boolean;
  exigeJustificativa?: boolean;
  exigeProtocolo?: boolean;
  exigeCorrecao?: boolean;
  /** 112150: pede a nova data de previsão de entrega */
  exigeDataPrevisao?: boolean;
  /** 112140: pede o item não fornecido (valores e quantidade) */
  exigeItemNaoFornecido?: boolean;
  /** 110300: pede a transação financeira a vincular (NT 2026.006) */
  exigeVinculoPagamento?: boolean;
  /** 110001: cancela outro evento, pelo tipo e protocolo dele */
  cancelaEvento?: boolean;
}

export const TIPOS_EVENTO: TipoEvento[] = [
  {
    codigo: '110111',
    descricao: 'Cancelamento',
    descEvento: 'Cancelamento',
    grupo: 'comuns',
    exigeJustificativa: true,
    exigeProtocolo: true,
  },
  {
    codigo: '110110',
    descricao: 'Carta de Correção',
    descEvento: 'Carta de Correcao',
    grupo: 'comuns',
    exigeCorrecao: true,
  },
  {
    codigo: '110140',
    descricao: 'EPEC — Evento Prévio de Emissão em Contingência',
    descEvento: 'EPEC',
    grupo: 'comuns',
    orgaoNacional: true,
  },
  {
    codigo: '110112',
    descricao: 'Cancelamento por Substituição (NFC-e)',
    descEvento: 'Cancelamento por Substituicao',
    grupo: 'comuns',
    exigeJustificativa: true,
    exigeProtocolo: true,
  },
  {
    codigo: '110130',
    descricao: 'Comprovante de Entrega da NF-e',
    descEvento: 'Comprovante de Entrega da NF-e',
    grupo: 'comuns',
  },
  {
    codigo: '110131',
    descricao: 'Cancelamento do Comprovante de Entrega',
    descEvento: 'Cancelamento do Comprovante de Entrega da NF-e',
    grupo: 'comuns',
  },
  {
    codigo: '110150',
    descricao: 'Ator Interessado na NF-e (Transportador)',
    descEvento: 'Ator interessado na NF-e',
    grupo: 'comuns',
  },
  {
    codigo: '110192',
    descricao: 'Insucesso na Entrega da NF-e',
    descEvento: 'Insucesso na Entrega da NF-e',
    grupo: 'comuns',
  },
  {
    codigo: '210200',
    descricao: 'Manifestação — Confirmação da Operação',
    descEvento: 'Confirmacao da Operacao',
    grupo: 'manifestacao',
    orgaoNacional: true,
  },
  {
    codigo: '210210',
    descricao: 'Manifestação — Ciência da Operação',
    descEvento: 'Ciencia da Operacao',
    grupo: 'manifestacao',
    orgaoNacional: true,
  },
  {
    codigo: '210220',
    descricao: 'Manifestação — Desconhecimento da Operação',
    descEvento: 'Desconhecimento da Operacao',
    grupo: 'manifestacao',
    orgaoNacional: true,
  },
  {
    codigo: '210240',
    descricao: 'Manifestação — Operação não Realizada',
    descEvento: 'Operacao nao Realizada',
    grupo: 'manifestacao',
    orgaoNacional: true,
    exigeJustificativa: true,
  },
  {
    codigo: '112140',
    descricao: 'Reforma — Fornecimento não realizado com pagamento antecipado',
    // Diferente dos eventos antigos, o schema deste exige o texto acentuado
    descEvento: 'Fornecimento não realizado com pagamento antecipado',
    grupo: 'reforma',
    orgaoSVRS: true,
    exigeItemNaoFornecido: true,
  },
  {
    codigo: '112150',
    descricao: 'Reforma — Atualização da Data de Previsão de Entrega',
    descEvento: 'Atualização da Data de Previsão de Entrega',
    grupo: 'reforma',
    orgaoSVRS: true,
    exigeDataPrevisao: true,
  },
  {
    // NT 2026.006 (split payment): liga a nota já autorizada a um Pix, boleto etc.
    codigo: '110300',
    descricao: 'Reforma — Vinculação da Transação de Pagamento',
    descEvento: 'Vinculação Pagamento',
    grupo: 'reforma',
    exigeProtocolo: true,
    exigeVinculoPagamento: true,
  },
  {
    codigo: '110001',
    descricao: 'Reforma — Cancelamento de Evento',
    descEvento: 'Cancelamento de Evento',
    grupo: 'reforma',
    cancelaEvento: true,
  },
];

/** Eventos do catálogo que o 110001 cancela (o schema aceita outros, que o nfeWeb não emite) */
export const EVENTOS_CANCELAVEIS = ['110300', '112140', '112150'];

export function acharTipoEvento(codigo: string): TipoEvento {
  const achado = TIPOS_EVENTO.find((t) => t.codigo === codigo);
  if (!achado) throw new Error(`Tipo de evento "${codigo}" não reconhecido.`);
  return achado;
}

/** Texto fixo que a legislação obriga a repetir em toda carta de correção */
export const COND_USO_CCE =
  'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 ' +
  'e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro ' +
  'nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, ' +
  'aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados ' +
  'cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';
