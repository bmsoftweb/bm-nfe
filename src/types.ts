export interface Usuario {
  id: number;
  empresa_id: number;
  nome: string;
  email: string;
  cargo?: string;
}

export interface Emitente {
  id: number;
  cnpj: string;
  inscricao_estadual: string;
  razao_social: string;
  nome_fantasia: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  codigo_municipio: string;
  municipio: string;
  uf: string;
  cep: string;
  fone: string;
  crt: number;
  ativo?: number;
}

export interface ConfigNFe {
  geral: {
    formaEmissao: number;
    modeloDF: '55' | '65';
    versaoDF: string;
    idCSC: string;
    csc: string;
    idCSRT: string;
    csrt: string;
    respTecCNPJ: string;
    respTecContato: string;
    respTecEmail: string;
    respTecFone: string;
    inscricaoMunicipal: string;
    cnae: string;
    versaoQRCode: number;
    atualizarXML: boolean;
    exibirErroSchema: boolean;
    retirarAcentos: boolean;
    formatoAlerta: number;
  };
  webservice: {
    uf: string;
    ambiente: 1 | 2;
    timeout: number;
    tentativas: number;
    intervalo: number;
    aguardar: number;
    ajustarAguardar: boolean;
    salvarEnvelopeSoap: boolean;
    proxyHost: string;
    proxyPorta: string;
    proxyUsuario: string;
    proxySenha: string;
  };
  arquivos: {
    pastaNFe: string;
    pastaInutilizacao: string;
    pastaEvento: string;
    pastaPDF: string;
    salvarArquivos: boolean;
    pastasMensais: boolean;
    adicionarLiteral: boolean;
    salvarPorDataEmissao: boolean;
    salvarEventos: boolean;
    separarPorCNPJ: boolean;
    separarPorModelo: boolean;
  };
  danfe: {
    logoMarca: string;
    tipoDanfe: number;
    tipoDanfce: number;
    imprimirHomologacao: boolean;
  };
  email: {
    host: string;
    porta: string;
    usuario: string;
    senha: string;
    remetente: string;
    ssl: boolean;
    tls: boolean;
    assunto: string;
    mensagem: string;
  };
}

export interface CertificadoInfo {
  nome_arquivo: string;
  cnpj: string;
  razao_social: string;
  numero_serie: string;
  emissor: string;
  valido_de: string;
  valido_ate: string;
  diasParaVencer: number;
  vencido: boolean;
}

export interface TipoEvento {
  codigo: string;
  descricao: string;
  descEvento: string;
  grupo: 'comuns' | 'manifestacao' | 'reforma';
  orgaoNacional?: boolean;
  exigeJustificativa?: boolean;
  exigeProtocolo?: boolean;
  exigeCorrecao?: boolean;
}

export interface Meta {
  ufs: string[];
  tiposEvento: TipoEvento[];
  configPadrao: ConfigNFe;
  formasEmissao: { valor: number; rotulo: string }[];
  modelos: { valor: string; rotulo: string }[];
}

/** Um problema apontado pelo XSD */
export interface ErroSchema {
  campo?: string;
  mensagem: string;
}

export interface ResultadoValidacao {
  valido: boolean;
  /** Arquivo .xsd contra o qual o documento foi conferido */
  schema: string;
  erros: ErroSchema[];
}

/** Erro devolvido pela API; na falha de schema vem com a lista de problemas */
export interface ErroApi extends Error {
  errosSchema?: ErroSchema[];
  schema?: string;
}

/** Retorno padronizado de toda operação com a SEFAZ */
export interface Retorno {
  sucesso: boolean;
  cStat: number;
  xMotivo: string;
  xml: string;
  envio: string;
  retornoCompleto: string;
  url: string;
  duracaoMs: number;
  dados?: Record<string, any>;
}

export interface DocumentoLista {
  id: number;
  chave: string;
  modelo: string;
  serie: number;
  numero: number;
  situacao: string;
  ambiente: number;
  data_emissao: string;
  destinatario_nome: string;
  valor_total: string;
  protocolo: string;
  codigo_status: number;
  motivo: string;
  /** 1 quando a nota foi gerada aqui e guarda os dados do formulário (pode ser copiada) */
  copiavel: number;
}

export interface StatusBanco {
  connected: boolean;
  latencyMs: number;
  version?: string;
  database: string;
  host: string;
  error?: string;
  tabelasFaltando: string[];
}

export interface Painel {
  contagens: Record<string, number>;
  ultimos: DocumentoLista[];
  erros: { operacao: string; codigo_status: number; motivo: string; criado_em: string }[];
  certificado: { razaoSocial?: string; cnpj?: string; validoAte?: string; diasParaVencer?: number; erro?: string };
  ambiente: number;
  uf: string;
  modelo: string;
}
