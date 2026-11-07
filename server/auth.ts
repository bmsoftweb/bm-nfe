/**
 * Autenticação do BMNFe.
 *
 * Antes, o login conferia a senha mas não emitia credencial nenhuma: toda chamada
 * depois dele só mandava o header `x-empresa-id`, e o servidor confiava. Qualquer um
 * com a URL podia cancelar notas, inutilizar numeração ou apagar o certificado.
 *
 * Agora, como no estoqueWeb, o login devolve um token assinado com HMAC-SHA256
 * (SESSION_SECRET). A empresa sai do token — nunca de um header que o cliente
 * controla — e o usuário é relido do banco a cada requisição (com cache curto),
 * então desativar o usuário ou o emitente derruba a sessão em até 30 segundos.
 */
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { pool } from './db.js';

export interface UsuarioSessao {
  id: number;
  empresaId: number;
  nome: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioSessao;
    }
  }
}

const VALIDADE_MS = 1000 * 60 * 60 * 12; // 12 horas
const CACHE_MS = 30_000;

function segredo(): string {
  const valor = process.env.SESSION_SECRET || '';
  // Segredo curto permitiria forjar token por força bruta
  if (valor.length < 32) {
    throw new Error('SESSION_SECRET não configurado (mínimo de 32 caracteres) no .env ou na Vercel.');
  }
  return valor;
}

function assinarTexto(conteudo: string): string {
  return crypto.createHmac('sha256', segredo()).update(conteudo).digest('base64url');
}

/** O token leva o usuário, a empresa e a validade, assinados */
export function criarToken(usuarioId: number, empresaId: number, agoraMs = Date.now()): string {
  const corpo = Buffer.from(
    JSON.stringify({ uid: usuarioId, emp: empresaId, exp: agoraMs + VALIDADE_MS }),
  ).toString('base64url');
  return `${corpo}.${assinarTexto(corpo)}`;
}

/** Devolve o conteúdo do token, ou null se for inválido, adulterado ou vencido */
export function lerToken(token: string, agoraMs = Date.now()): { uid: number; emp: number } | null {
  const [corpo, assinatura] = String(token || '').split('.');
  if (!corpo || !assinatura) return null;

  // Comparação em tempo constante: não deixa medir quantos bytes da assinatura bateram
  const recebida = Buffer.from(assinatura);
  const esperada = Buffer.from(assinarTexto(corpo));
  if (recebida.length !== esperada.length || !crypto.timingSafeEqual(recebida, esperada)) return null;

  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (!dados?.uid || !dados?.emp || Number(dados.exp) < agoraMs) return null;
    return { uid: Number(dados.uid), emp: Number(dados.emp) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Usuário da sessão
// ---------------------------------------------------------------------------

const cacheUsuarios = new Map<number, { usuario: UsuarioSessao | null; ate: number }>();

async function carregarUsuario(id: number): Promise<UsuarioSessao | null> {
  const emCache = cacheUsuarios.get(id);
  if (emCache && emCache.ate > Date.now()) return emCache.usuario;

  // Usuário do ERP (sys_usuarios); o emitente é a nfe_empresas com o CNPJ da empresa dele
  const [linhas] = await pool.query<any[]>(
    `SELECT u.id, e.id AS empresa_id, u.login AS nome, u.login AS email
       FROM sys_usuarios u
       JOIN sys_empresas se ON se.id = u.empresa_id
       JOIN nfe_empresas e ON e.cnpj = se.cnpj COLLATE utf8mb4_unicode_ci
      WHERE u.id = ? AND u.ativo = 1 AND se.ativo = 1 AND e.ativo = 1
      LIMIT 1`,
    [id],
  );

  const usuario = linhas.length
    ? {
        id: Number(linhas[0].id),
        empresaId: Number(linhas[0].empresa_id),
        nome: String(linhas[0].nome || ''),
        email: String(linhas[0].email || ''),
      }
    : null;

  cacheUsuarios.set(id, { usuario, ate: Date.now() + CACHE_MS });
  return usuario;
}

/**
 * Exige sessão válida e preenche req.usuario. Tudo em /api passa por aqui, menos
 * o login.
 */
export async function exigirSessao(req: Request, res: Response, next: NextFunction) {
  try {
    const bruto = req.header('authorization') || '';
    const dados = lerToken(bruto.startsWith('Bearer ') ? bruto.slice(7) : '');
    if (!dados) {
      return res.status(401).json({ success: false, error: 'Sessão expirada ou inválida. Entre novamente.' });
    }

    const usuario = await carregarUsuario(dados.uid);
    // O usuário mudou de empresa, foi desativado ou o emitente foi desativado
    if (!usuario || usuario.empresaId !== dados.emp) {
      return res.status(401).json({ success: false, error: 'Acesso não está mais ativo. Entre novamente.' });
    }

    req.usuario = usuario;
    next();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
