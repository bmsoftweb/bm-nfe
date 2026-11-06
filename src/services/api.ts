import {
  CertificadoInfo, ConfigNFe, DocumentoLista, Emitente, ErroApi, Meta, Painel, ResultadoValidacao,
  Retorno, StatusBanco, Usuario,
} from '../types';

/**
 * Token de sessão devolvido pelo login. Vai em toda requisição no header
 * Authorization; é dele que o servidor tira a empresa.
 */
let token: string | null = null;
let aoExpirar: ((mensagem: string) => void) | null = null;

export function definirToken(novo: string | null) {
  token = novo;
}

/** Chamado quando o servidor recusa a sessão (401), para voltar ao login */
export function aoExpirarSessao(callback: (mensagem: string) => void) {
  aoExpirar = callback;
}

function cabecalhos(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** 401 com sessão aberta significa token vencido ou acesso revogado: volta ao login */
function conferirSessao(status: number, mensagem: string) {
  if (status === 401 && token && aoExpirar) aoExpirar(mensagem);
}

async function pedir<T>(rota: string, opcoes: RequestInit = {}): Promise<T> {
  const resposta = await fetch(`/api${rota}`, { ...opcoes, headers: { ...cabecalhos(), ...opcoes.headers } });
  const texto = await resposta.text();

  let corpo: any = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = { error: texto };
  }

  if (!resposta.ok) {
    conferirSessao(resposta.status, corpo?.error || 'Sessão expirada. Entre novamente.');
    const erro: ErroApi = new Error(corpo?.error || `Falha na requisição (${resposta.status}).`);
    // Falha de schema (422) traz a lista campo a campo para a tela mostrar
    if (corpo?.errosSchema) {
      erro.errosSchema = corpo.errosSchema;
      erro.schema = corpo.schema;
    }
    throw erro;
  }
  return corpo as T;
}

const post = <T>(rota: string, corpo?: any) =>
  pedir<T>(rota, { method: 'POST', body: JSON.stringify(corpo ?? {}) });

// ---------------------------------------------------------------------------
// Sessão e painel
// ---------------------------------------------------------------------------

export const entrar = (cnpj: string, usuario: string, senha: string) =>
  post<{ success: boolean; token: string; usuario: Usuario; empresa: Emitente }>('/login', { cnpj, usuario, senha });

export const buscarMeta = () => pedir<Meta>('/meta');
export const buscarPainel = () => pedir<Painel>('/painel');
export const buscarStatusBanco = () => pedir<StatusBanco>('/db/status');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export const buscarConfig = () =>
  pedir<{ config: ConfigNFe; emitente: Emitente; certificado: CertificadoInfo | null }>('/config');

export const gravarConfig = (config: Partial<ConfigNFe>) =>
  pedir<{ success: boolean; config: ConfigNFe }>('/config', { method: 'PUT', body: JSON.stringify(config) });

export const gravarEmitente = (emitente: Partial<Emitente>) =>
  pedir<{ success: boolean; emitente: Emitente }>('/emitente', { method: 'PUT', body: JSON.stringify(emitente) });

export const enviarCertificado = (arquivoBase64: string, nomeArquivo: string, senha: string) =>
  post<{ success: boolean; certificado: any }>('/certificado', { arquivoBase64, nomeArquivo, senha });

export const removerCertificado = () => pedir<{ success: boolean }>('/certificado', { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Operações com a SEFAZ
// ---------------------------------------------------------------------------

export const statusServico = () => post<Retorno>('/status');
export const consultarChave = (chave: string) => post<Retorno>('/consultar', { chave });
export const consultarRecibo = (recibo: string) => post<Retorno>('/consultar-recibo', { recibo });

export const consultarCadastro = (dados: { uf: string; cnpj?: string; cpf?: string; ie?: string }) =>
  post<Retorno>('/consultar-cadastro', dados);

/** Com `documentoId`, regrava a nota existente (edição de assinada ou rejeitada) em vez de criar outra */
export const gerarNFe = (documento: any, documentoId?: number) =>
  post<{ success: boolean; chave: string; totais: any; xml: string }>('/gerar', { documento, documentoId });

export const enviarNFe = (dados: { chave?: string; xml?: string; sincrono?: boolean }) =>
  post<Retorno>('/enviar', dados);

export const importarXml = (xml: string) => post<{ success: boolean; chave: string }>('/importar', { xml });

export const validarAssinatura = (xml: string) =>
  post<{ valida: boolean; erro?: string }>('/validar-assinatura', { xml });

/** Confere o documento contra o XSD oficial sem enviar nada à SEFAZ */
export const validarXml = (dados: { chave?: string; xml?: string }) =>
  post<ResultadoValidacao>('/validar-xml', dados);

export const enviarEvento = (dados: {
  chave: string; tipoEvento: string; sequencia?: number;
  justificativa?: string; protocolo?: string; correcao?: string;
  /** 112150: nova data de previsão de entrega (aaaa-mm-dd) */
  dataPrevisaoEntrega?: string;
  /** 112140: item da nota de pagamento antecipado que não foi fornecido */
  itensNaoFornecidos?: { item: number; valorIBS: number; valorCBS: number; quantidade: number; unidade: string }[];
  /** 110300: transação financeira a vincular */
  vinculoPagamento?: { idTransacao: string; meioPagamento: string; cnpjRecebedor: string; cnpjBasePSP: string };
  /** 110001: código do evento a cancelar (o protocolo dele vai em `protocolo`) */
  eventoCancelado?: string;
}) => post<Retorno>('/evento', dados);

export const inutilizar = (dados: {
  ano: number; modelo: string; serie: number;
  numeroInicial: number; numeroFinal: number; justificativa: string;
}) => post<Retorno>('/inutilizar', dados);

export const distribuicaoDFe = (filtro: { ultNSU?: string; nsu?: string; chave?: string }) =>
  post<Retorno>('/distribuicao', filtro);

export const enviarPorEmail = (dados: {
  chave: string; para: string; assunto?: string; mensagem?: string; anexarPdf?: boolean;
}) => post<{ success: boolean }>('/email', dados);

export const testarSmtp = () => post<{ success: boolean }>('/email/testar');

/** Abre o DANFE numa nova aba; o PDF vem do servidor, não do navegador */
export async function abrirDanfe(chave: string) {
  const resposta = await fetch('/api/danfe', {
    method: 'POST',
    headers: cabecalhos(),
    body: JSON.stringify({ chave }),
  });

  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({ error: 'Falha ao gerar o DANFE.' }));
    conferirSessao(resposta.status, erro.error);
    throw new Error(erro.error);
  }

  const url = URL.createObjectURL(await resposta.blob());
  window.open(url, '_blank');
  // O objeto só pode ser liberado depois que a aba carregou
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------------------
// Listagens
// ---------------------------------------------------------------------------

/** Parâmetros das grades paginadas no servidor (padrão b2b admin) */
export interface ConsultaGrade {
  pagina: number;
  porPagina: number;
  busca: string;
  ordem: string;
  direcao: 'asc' | 'desc';
}

export interface PaginaGrade<T> {
  data: T[];
  total: number;
  totalPages: number;
}

const paraQuery = (c: ConsultaGrade) =>
  new URLSearchParams({
    pagina: String(c.pagina),
    porPagina: String(c.porPagina),
    busca: c.busca,
    ordem: c.ordem,
    direcao: c.direcao,
  }).toString();

export const listarDocumentos = (c: ConsultaGrade) =>
  pedir<PaginaGrade<DocumentoLista>>(`/documentos?${paraQuery(c)}`);
/** Próximo número livre da série, para já abrir a Nova NF-e numerada */
export const proximoNumero = (serie: string) => pedir<{ numero: number }>(`/proximo-numero?serie=${encodeURIComponent(serie)}`);
export const buscarDocumento = (chave: string) => pedir<any>(`/documentos/${chave}`);
export const listarEventos = () => pedir<any[]>('/eventos');
export const listarInutilizacoes = () => pedir<any[]>('/inutilizacoes');
export const listarDistribuicao = () => pedir<any[]>('/distribuicao');
export const listarLog = (c: ConsultaGrade) => pedir<PaginaGrade<any>>(`/log?${paraQuery(c)}`);

// ---------------------------------------------------------------------------
// Preferências das grades
// ---------------------------------------------------------------------------

export const buscarConfigListas = () => pedir<Record<string, unknown>>('/config-listas');

export const gravarConfigListas = (config: Record<string, unknown>) =>
  pedir<{ success: boolean }>('/config-listas', { method: 'PUT', body: JSON.stringify(config) });
export const buscarLog = (id: number) => pedir<any>(`/log/${id}`);
