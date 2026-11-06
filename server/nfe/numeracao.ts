/**
 * Numeração atômica por empresa + modelo + série + ambiente
 * (doc/plano-concentrador.md, fase 1). A tabela nfe_numeracao vem do
 * extras/2026-11-05_concentrador.sql.
 */
import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../db.js';

export interface Serie {
  empresaId: number;
  modelo: string;
  serie: number;
  ambiente: number;
}

const campos = (s: Serie) => [s.empresaId, s.modelo, s.serie, s.ambiente];

/** Tabela que ainda não foi criada vira uma mensagem que diz o que fazer */
async function comTabela<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (err: any) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      throw new Error('Falta criar a tabela nfe_numeracao: rode o extras/2026-11-05_concentrador.sql no banco.');
    }
    throw err;
  }
}

/** Maior número já usado na série: notas gravadas e faixas inutilizadas (cStat 102) */
async function maiorUsado(s: Serie, con: Pick<PoolConnection, 'query'> = pool): Promise<number> {
  const [linhas] = await con.query<any[]>(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(numero) FROM nfe_documentos
                  WHERE empresa_id = ? AND modelo = ? AND serie = ? AND ambiente = ?), 0),
       COALESCE((SELECT MAX(numero_final) FROM nfe_inutilizacoes
                  WHERE empresa_id = ? AND modelo = ? AND serie = ? AND ambiente = ? AND codigo_status = 102), 0)
     ) AS maior`,
    [...campos(s), ...campos(s)],
  );
  return Number(linhas[0].maior);
}

/**
 * Reserva o próximo número: duas reservas ao mesmo tempo nunca recebem o mesmo.
 * LAST_INSERT_ID(expr) sobe o contador e guarda o valor para esta conexão num
 * comando só. O GREATEST com o maior número usado cobre o que entrou por fora do
 * contador (digitado na tela, importado, inutilizado).
 */
export async function reservarNumero(s: Serie, conexao?: PoolConnection): Promise<number> {
  return comTabela(async () => {
    // Quem já segura uma conexão (o lock da referência) passa a dela: pedir outra ao
    // pool com todas as conexões presas em locks travaria tudo
    const con = conexao || (await pool.getConnection());
    try {
      const seguinte = (await maiorUsado(s, con)) + 1;
      await con.query(
        `INSERT INTO nfe_numeracao (empresa_id, modelo, serie, ambiente, ultimo_numero)
         VALUES (?, ?, ?, ?, LAST_INSERT_ID(?))
         ON DUPLICATE KEY UPDATE ultimo_numero = LAST_INSERT_ID(GREATEST(ultimo_numero + 1, ?))`,
        [...campos(s), seguinte, seguinte],
      );
      const [linhas] = await con.query<any[]>('SELECT LAST_INSERT_ID() AS numero');
      return Number(linhas[0].numero);
    } finally {
      if (!conexao) con.release();
    }
  });
}

/** Sugestão para a tela: o próximo número, sem reservar */
export async function proximoNumero(s: Serie): Promise<number> {
  return comTabela(async () => {
    const [linhas] = await pool.query<any[]>(
      'SELECT ultimo_numero FROM nfe_numeracao WHERE empresa_id = ? AND modelo = ? AND serie = ? AND ambiente = ?',
      campos(s),
    );
    return Math.max(Number(linhas[0]?.ultimo_numero || 0), await maiorUsado(s)) + 1;
  });
}
