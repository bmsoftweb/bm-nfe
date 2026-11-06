/**
 * Reúne o que toda operação com a SEFAZ precisa: configuração, emitente e
 * certificado da empresa. O certificado fica em cache na memória porque abrir o
 * PKCS#12 custa caro e ele só muda quando é trocado na tela.
 */
import { pool } from '../db.js';
import { ConfigNFe, lerConfig } from '../config.js';
import { carregarPfx, CertificadoCarregado } from './certificado.js';
import { ModeloDFe } from './servicos.js';
import { dataHoraMysql } from './datas.js';

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
}

/**
 * NT 2026.007: emitente sem IE (e sem "ISENTO") é contribuinte exclusivo do IBS/CBS.
 * A NF-e sai sem a tag IE, sem ICMS, com IBS/CBS em todo item, e é autorizada só na SVRS.
 */
export function emitenteSemIE(emit: Emitente): boolean {
  const ie = (emit.inscricao_estadual || '').trim();
  return !/ISENTO/i.test(ie) && !/\d/.test(ie);
}

export interface Contexto {
  empresaId: number;
  config: ConfigNFe;
  emitente: Emitente;
  certificado: CertificadoCarregado;
  modelo: ModeloDFe;
}

const cacheCertificado = new Map<number, { atualizadoEm: string; cert: CertificadoCarregado }>();

export function esquecerCertificado(empresaId: number) {
  cacheCertificado.delete(empresaId);
}

export async function carregarCertificado(empresaId: number): Promise<CertificadoCarregado> {
  const [linhas] = await pool.query<any[]>(
    'SELECT arquivo, senha, atualizado_em FROM nfe_certificados WHERE empresa_id = ? LIMIT 1',
    [empresaId],
  );
  if (!linhas.length) {
    throw new Error('Nenhum certificado digital cadastrado. Envie o arquivo .pfx em Configurações › Certificado.');
  }

  const { arquivo, senha, atualizado_em } = linhas[0];
  const emCache = cacheCertificado.get(empresaId);
  if (emCache && emCache.atualizadoEm === String(atualizado_em)) return emCache.cert;

  const cert = carregarPfx(Buffer.from(arquivo), senha);
  cacheCertificado.set(empresaId, { atualizadoEm: String(atualizado_em), cert });
  return cert;
}

export async function carregarEmitente(empresaId: number): Promise<Emitente> {
  const [linhas] = await pool.query<any[]>('SELECT * FROM nfe_empresas WHERE id = ? LIMIT 1', [empresaId]);
  if (!linhas.length) throw new Error('Emitente não encontrado.');
  return linhas[0] as Emitente;
}

export async function montarContexto(empresaId: number): Promise<Contexto> {
  const [config, emitente, certificado] = await Promise.all([
    lerConfig(empresaId),
    carregarEmitente(empresaId),
    carregarCertificado(empresaId),
  ]);

  if (certificado.info.diasParaVencer < 0) {
    throw new Error(
      `O certificado digital venceu em ${certificado.info.validoAte.toLocaleDateString('pt-BR')}.`,
    );
  }

  return {
    empresaId,
    config,
    emitente,
    certificado,
    modelo: config.geral.modeloDF === '65' ? 'NFCe' : 'NFe',
  };
}

export interface RegistroLog {
  operacao: string;
  url?: string;
  chave?: string;
  sucesso: boolean;
  codigoStatus?: number;
  motivo?: string;
  duracaoMs?: number;
  envio?: string;
  retorno?: string;
}

export async function registrarLog(empresaId: number, reg: RegistroLog) {
  try {
    await pool.query(
      `INSERT INTO nfe_log
         (empresa_id, operacao, url, chave, sucesso, codigo_status, motivo, duracao_ms, envio, retorno, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        reg.operacao,
        reg.url?.slice(0, 255) || null,
        reg.chave || null,
        reg.sucesso ? 1 : 0,
        reg.codigoStatus ?? null,
        reg.motivo?.slice(0, 255) || null,
        reg.duracaoMs ?? null,
        reg.envio || null,
        reg.retorno || null,
        dataHoraMysql(),
      ],
    );
  } catch (err) {
    // O log nunca pode derrubar a operação que ele está registrando
    console.warn('Falha ao gravar o log da operação:', err);
  }
}
