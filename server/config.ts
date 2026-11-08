/**
 * Configuração do emitente — o equivalente ao ACBrNFe.ini do exemplo Delphi.
 *
 * Fica em `nfe_config.dados` (JSON), uma linha por empresa. O formato segue as
 * abas do formulário original: Geral, WebService, Arquivos, Documento Auxiliar
 * e Email. O certificado tem tabela própria, porque o .pfx é binário.
 */
import { pool } from './db.js';

export interface ConfigGeral {
  /** 1=Normal, 2=Contingência FS-IA, 4=EPEC, 5=FS-DA, 6=SVC-AN, 7=SVC-RS, 9=Offline */
  formaEmissao: number;
  /** 55=NF-e, 65=NFC-e */
  modeloDF: '55' | '65';
  versaoDF: string;
  idCSC: string;
  csc: string;
  idCSRT: string;
  csrt: string;
  /** Responsável técnico (infRespTec): a software house, não o emitente */
  respTecCNPJ: string;
  respTecContato: string;
  respTecEmail: string;
  respTecFone: string;
  /** Emitente de NF-e conjugada (itens com ISSQN) */
  inscricaoMunicipal: string;
  cnae: string;
  versaoQRCode: number;
  atualizarXML: boolean;
  exibirErroSchema: boolean;
  retirarAcentos: boolean;
  /** 0=Nenhum, 1=Simples, 2=Detalhado */
  formatoAlerta: number;
}

export interface ConfigWebService {
  uf: string;
  /** 1=Produção, 2=Homologação */
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
}

export interface ConfigArquivos {
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
}

export interface ConfigDanfe {
  /** URL, data: URI ou caminho da imagem (PNG ou JPEG) impressa no quadro do emitente */
  logoMarca: string;
  /** A logomarca já traz nome e endereço: ocupa o quadro inteiro e os dados do emitente não são impressos */
  expandirLogo: boolean;
  /** 0=Bobina 80mm, 1=A4 */
  tipoDanfce: number;
  /** Imprime o DANFE também em homologação, com a tarja de "sem valor fiscal" */
  imprimirHomologacao: boolean;
}

export interface ConfigEmail {
  host: string;
  porta: string;
  usuario: string;
  senha: string;
  remetente: string;
  ssl: boolean;
  tls: boolean;
  assunto: string;
  mensagem: string;
}

export interface ConfigNFe {
  geral: ConfigGeral;
  webservice: ConfigWebService;
  arquivos: ConfigArquivos;
  danfe: ConfigDanfe;
  email: ConfigEmail;
}

export const CONFIG_PADRAO: ConfigNFe = {
  geral: {
    formaEmissao: 1,
    modeloDF: '55',
    versaoDF: '4.00',
    idCSC: '',
    csc: '',
    idCSRT: '',
    csrt: '',
    respTecCNPJ: '',
    respTecContato: '',
    respTecEmail: '',
    respTecFone: '',
    inscricaoMunicipal: '',
    cnae: '',
    versaoQRCode: 2,
    atualizarXML: true,
    exibirErroSchema: true,
    retirarAcentos: true,
    formatoAlerta: 1,
  },
  webservice: {
    uf: 'SP',
    ambiente: 2,
    timeout: 30,
    tentativas: 5,
    intervalo: 0,
    aguardar: 0,
    ajustarAguardar: true,
    salvarEnvelopeSoap: false,
    proxyHost: '',
    proxyPorta: '',
    proxyUsuario: '',
    proxySenha: '',
  },
  arquivos: {
    pastaNFe: 'NFe',
    pastaInutilizacao: 'Inutilizacao',
    pastaEvento: 'Evento',
    pastaPDF: 'PDF',
    salvarArquivos: true,
    pastasMensais: true,
    adicionarLiteral: true,
    salvarPorDataEmissao: false,
    salvarEventos: true,
    separarPorCNPJ: false,
    separarPorModelo: false,
  },
  danfe: {
    logoMarca: '',
    expandirLogo: false,
    tipoDanfce: 1,
    imprimirHomologacao: true,
  },
  email: {
    host: '',
    porta: '587',
    usuario: '',
    senha: '',
    remetente: '',
    ssl: false,
    tls: true,
    assunto: 'NF-e {numero} - {razaoSocial}',
    mensagem:
      'Segue em anexo o XML e o DANFE da NF-e nº {numero}, emitida em {dataEmissao}.\n\nChave de acesso: {chave}',
  },
};

/** Mescla raso por grupo: chave nova no código já vem com o padrão sem migração */
function mesclar(gravado: any): ConfigNFe {
  const saida: any = {};
  for (const grupo of Object.keys(CONFIG_PADRAO) as (keyof ConfigNFe)[]) {
    saida[grupo] = { ...CONFIG_PADRAO[grupo], ...(gravado?.[grupo] || {}) };
  }
  return saida as ConfigNFe;
}

export async function lerConfig(empresaId: number): Promise<ConfigNFe> {
  const [linhas] = await pool.query<any[]>(
    'SELECT dados FROM nfe_config WHERE empresa_id = ? LIMIT 1',
    [empresaId],
  );
  if (!linhas.length) return mesclar(null);

  const bruto = linhas[0].dados;
  return mesclar(typeof bruto === 'string' ? JSON.parse(bruto) : bruto);
}

export async function gravarConfig(empresaId: number, config: Partial<ConfigNFe>): Promise<ConfigNFe> {
  const atual = await lerConfig(empresaId);
  const novo = mesclar({ ...atual, ...config });

  await pool.query(
    `INSERT INTO nfe_config (empresa_id, dados) VALUES (?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE dados = VALUES(dados)`,
    [empresaId, JSON.stringify(novo)],
  );

  return novo;
}

/** A senha do proxy e do SMTP não voltam para a tela */
export function semSegredos(config: ConfigNFe): ConfigNFe {
  return {
    ...config,
    webservice: { ...config.webservice, proxySenha: config.webservice.proxySenha ? '••••••' : '' },
    email: { ...config.email, senha: config.email.senha ? '••••••' : '' },
  };
}

/** Um campo de senha que voltou mascarado não deve sobrescrever o que está gravado */
export function preservarSegredos(novo: any, atual: ConfigNFe): any {
  const mascara = /^•+$/;
  if (novo?.webservice && mascara.test(novo.webservice.proxySenha || '')) {
    novo.webservice.proxySenha = atual.webservice.proxySenha;
  }
  if (novo?.email && mascara.test(novo.email.senha || '')) {
    novo.email.senha = atual.email.senha;
  }
  return novo;
}
