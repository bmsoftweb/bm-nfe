/**
 * Concentrador (doc/plano-concentrador.md, fases 1 e 2): os módulos do ERP mandam
 * a nota em JSON com uma referência própria, e o nfeWeb numera, gera, assina,
 * transmite e responde. Mandar a mesma referência de novo nunca cria outra nota:
 * devolve a que existe ou continua de onde parou.
 *
 *   POST /api/emitir              { referencia, documento, sincrono? }
 *   GET  /api/emitir/:referencia  situação, sem transmitir (consulta a SEFAZ se ficou sem resposta)
 *   GET  /api/emitir-pendentes    referências paradas sem autorização (números a inutilizar)
 */
import crypto from 'crypto';
import { Router } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../db.js';
import { Contexto, montarContexto } from '../nfe/contexto.js';
import { assinar } from '../nfe/assinatura.js';
import { gerarNFe } from '../nfe/gerarNFe.js';
import { autorizar, consultarChave, consultarRecibo, montarProcNFe } from '../nfe/operacoes.js';
import { exigirValido, validarNFe } from '../nfe/validacao.js';
import { dataHoraMysql } from '../nfe/datas.js';
import { semDeclaracao, valorTag } from '../nfe/xml.js';
import { reservarNumero } from '../nfe/numeracao.js';
import { decidir, situacaoPeloStatus, validarReferencia } from '../nfe/concentrador.js';
import { empresaDaRequisicao, rota } from './nfe.js';

interface Linha {
  id: number;
  referencia: string;
  chave: string | null;
  modelo: string;
  serie: number;
  numero: number;
  situacao: string;
  recibo: string | null;
  protocolo: string | null;
  codigo_status: number | null;
  motivo: string | null;
  xml: string | null;
  xml_protocolo: string | null;
  /** Segundos desde a última mudança da linha */
  idade: number;
}

const texto = (err: any) => String(err?.message || err).slice(0, 255);

async function buscar(
  empresaId: number,
  referencia: string,
  con: Pick<PoolConnection, 'query'> = pool,
): Promise<Linha | undefined> {
  try {
    const [linhas] = await con.query<any[]>(
      `SELECT id, referencia, chave, modelo, serie, numero, situacao, recibo, protocolo, codigo_status,
              motivo, xml, xml_protocolo, TIMESTAMPDIFF(SECOND, atualizado_em, NOW()) AS idade
         FROM nfe_documentos WHERE empresa_id = ? AND referencia = ? LIMIT 1`,
      [empresaId, referencia],
    );
    return linhas[0];
  } catch (err: any) {
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      throw new Error('Falta a coluna referencia em nfe_documentos: rode o extras/2026-11-05_concentrador.sql no banco.');
    }
    throw err;
  }
}

/** Os nomes das colunas são fixos, do próprio código; só os valores vêm de fora */
async function atualizar(id: number, campos: Record<string, unknown>) {
  const nomes = Object.keys(campos);
  await pool.query(
    `UPDATE nfe_documentos SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`,
    [...nomes.map((n) => campos[n]), id],
  );
}

function resposta(l: Linha, repetida = false) {
  return {
    success: true,
    referencia: l.referencia,
    situacao: l.situacao,
    chave: l.chave,
    modelo: l.modelo,
    serie: l.serie,
    numero: l.numero,
    protocolo: l.protocolo,
    cStat: l.codigo_status,
    motivo: l.motivo,
    /** nfeProc (nota + protocolo) quando autorizada, cancelada ou denegada */
    xml: l.xml_protocolo,
    /** true quando nada foi transmitido nesta chamada: a nota já estava resolvida */
    repetida,
  };
}

/**
 * Primeira vez da referência: reserva o número e grava o rascunho antes de qualquer
 * coisa. O GET_LOCK da referência faz as chamadas simultâneas com a mesma referência
 * esperarem a primeira; sem ele, cada uma reservaria um número e as perdedoras
 * deixariam buracos na série.
 */
async function criar(ctx: Contexto, referencia: string, documento: any): Promise<Linha> {
  // O nome do lock tem no máximo 64 caracteres; a referência tem até 80
  const trava = `nfeweb:${crypto.createHash('sha1').update(`${ctx.empresaId}:${referencia}`).digest('hex')}`;
  const con = await pool.getConnection();
  try {
    const [[{ obtida }]] = await con.query<any[]>('SELECT GET_LOCK(?, 15) AS obtida', [trava]);
    if (Number(obtida) !== 1) throw new Error('Outra chamada está criando esta referência. Tente de novo em instantes.');

    // Daqui até soltar o lock, tudo pela conexão do lock: cada chamada usa uma só do pool
    const existente = await buscar(ctx.empresaId, referencia, con);
    if (existente) return existente;

    const serie = Number(documento.ide.serie) || 1;
    const numero = await reservarNumero({
      empresaId: ctx.empresaId, modelo: ctx.config.geral.modeloDF, serie, ambiente: ctx.config.webservice.ambiente,
    }, con);
    await con.query(
      `INSERT INTO nfe_documentos (empresa_id, referencia, modelo, serie, numero, situacao, ambiente, dados)
       VALUES (?, ?, ?, ?, ?, 'rascunho', ?, CAST(? AS JSON))`,
      [ctx.empresaId, referencia, ctx.config.geral.modeloDF, serie, numero, ctx.config.webservice.ambiente,
        JSON.stringify(documento)],
    );
    return (await buscar(ctx.empresaId, referencia, con))!;
  } finally {
    await con.query('SELECT RELEASE_LOCK(?)', [trava]).catch(() => {});
    con.release();
  }
}

/** Grava o resultado de um protocolo (do envio, do recibo ou da consulta pela chave) */
async function aplicarProtocolo(l: Linha, xml: string, protNFe: string, cStat: number, motivo: string) {
  const situacao = situacaoPeloStatus(cStat);
  const usouNumero = situacao !== 'rejeitada';
  await atualizar(l.id, {
    situacao,
    protocolo: usouNumero ? valorTag(protNFe, 'nProt') || null : null,
    codigo_status: cStat,
    motivo: motivo.slice(0, 255),
    xml_protocolo: usouNumero ? montarProcNFe(xml, protNFe) : null,
  });
}

/**
 * Nota que saiu sem resposta: descobre na SEFAZ o que aconteceu com ela. Vem antes
 * de qualquer reenvio, porque gerar de novo muda a chave e, se a primeira tiver sido
 * autorizada, a segunda volta com a rejeição 539 e a autorizada fica sem dono.
 */
async function verificar(ctx: Contexto, l: Linha): Promise<'resolvida' | 'nao_consta' | 'pendente'> {
  try {
    if (l.recibo) {
      const r = await consultarRecibo(ctx, l.recibo);
      if (r.dados?.emProcessamento) return 'pendente';
      if (r.dados?.protNFe && r.dados.chave === l.chave && l.xml) {
        await aplicarProtocolo(l, l.xml, r.dados.protNFe, r.dados.cStatNota, r.dados.motivoNota);
        return 'resolvida';
      }
    }
    if (!l.chave || !l.xml) return 'nao_consta';

    const c = await consultarChave(ctx, l.chave);
    if (c.cStat === 217) return 'nao_consta'; // NF-e não consta na base da SEFAZ
    if (c.dados?.protNFe) {
      // Vale o cStat da consulta: nota cancelada traz o protocolo original, de autorização
      await aplicarProtocolo(l, l.xml, c.dados.protNFe, c.cStat, c.xMotivo);
      return 'resolvida';
    }
    return 'pendente';
  } catch {
    // SEFAZ fora do ar ou sem resposta: continua sem saber, o módulo pergunta depois
    return 'pendente';
  }
}

/** Gera, assina, valida e transmite. A linha já está "processando" nas mãos desta chamada. */
async function gerarETransmitir(ctx: Contexto, l: Linha, documento: any, sincrono: boolean) {
  // 539: o número foi usado na SEFAZ por outra chave; esta nota precisa de outro
  const numero = l.codigo_status === 539
    ? await reservarNumero({
        empresaId: ctx.empresaId, modelo: l.modelo, serie: l.serie, ambiente: ctx.config.webservice.ambiente,
      })
    : l.numero;
  const dados = JSON.stringify(documento);

  let xml: string;
  let gerada: ReturnType<typeof gerarNFe>;
  try {
    gerada = gerarNFe(ctx, { ...documento, ide: { ...documento.ide, serie: l.serie, numero } });
    xml = `<?xml version="1.0" encoding="UTF-8"?>` +
      assinar(semDeclaracao(gerada.xml), 'infNFe', `NFe${gerada.chave}`, ctx.certificado);
    exigirValido(
      await validarNFe(xml),
      `Falha na validação dos dados da nota: ${numero}`,
      ctx.config.geral.exibirErroSchema,
    );
  } catch (err) {
    // Volta a rascunho com o mesmo número: o módulo corrige e manda a mesma referência
    await atualizar(l.id, { situacao: 'rascunho', numero, codigo_status: null, motivo: texto(err), dados });
    throw err;
  }

  const dest = documento.destinatario;
  await atualizar(l.id, {
    chave: gerada.chave, numero, data_emissao: dataHoraMysql(),
    destinatario_documento: (dest?.cnpj || dest?.cpf || '').replace(/\D/g, '') || null,
    destinatario_nome: dest?.nome || null, valor_total: gerada.totais.vNF, dados, xml,
    recibo: null, protocolo: null, codigo_status: null, motivo: null, xml_protocolo: null,
  });
  const enviada: Linha = { ...l, chave: gerada.chave, numero, xml, recibo: null };

  let ret: Awaited<ReturnType<typeof autorizar>>;
  try {
    ret = await autorizar(ctx, xml, { sincrono });
  } catch (err) {
    await atualizar(l.id, { situacao: 'enviada', motivo: `Sem resposta da SEFAZ: ${texto(err)}`.slice(0, 255) });
    return;
  }

  const d = ret.dados || {};
  if (d.cStatNota === 204 || ret.cStat === 204) {
    // Duplicidade: esta mesma chave já estava na SEFAZ; a consulta traz o protocolo
    if ((await verificar(ctx, enviada)) !== 'resolvida') {
      await atualizar(l.id, { situacao: 'enviada', codigo_status: 204, motivo: ret.xMotivo });
    }
  } else if (d.protNFe) {
    await aplicarProtocolo(enviada, xml, d.protNFe, d.cStatNota, d.motivoNota);
  } else if (d.recibo) {
    await atualizar(l.id, { situacao: 'enviada', recibo: d.recibo, codigo_status: ret.cStat, motivo: ret.xMotivo });
  } else {
    // Lote recusado inteiro (cStat do lote): a nota não entrou
    await atualizar(l.id, { situacao: 'rejeitada', codigo_status: ret.cStat, motivo: ret.xMotivo });
  }
}

export function criarRotasEmitir(): Router {
  const r = Router();

  r.post('/emitir', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const referencia = validarReferencia(req.body?.referencia);
    const documento = req.body?.documento;
    if (!documento?.ide || !Array.isArray(documento.itens)) {
      throw new Error('Informe os dados da nota: documento com ide e itens.');
    }
    const sincrono = req.body?.sincrono !== false;
    const ctx = await montarContexto(empresaId);

    let l = (await buscar(empresaId, referencia)) || (await criar(ctx, referencia, documento));
    let acao = decidir(l.situacao, l.idade);

    if (acao === 'verificar') {
      const v = await verificar(ctx, l);
      l = (await buscar(empresaId, referencia))!;
      if (v === 'pendente') return res.status(202).json(resposta(l, true));
      if (v === 'resolvida') return res.json(resposta(l, true));
      // Não consta na SEFAZ: a nota nunca chegou lá e pode ser gerada de novo
      await atualizar(l.id, { situacao: 'rascunho' });
      l = { ...l, situacao: 'rascunho' };
      acao = 'gerar';
    }

    if (acao === 'devolver') return res.json(resposta(l, true));
    if (acao === 'usada') {
      return res.status(409).json({
        ...resposta(l, true),
        success: false,
        error: `A referência ${referencia} já foi usada na nota ${l.numero}, que está ${l.situacao}. Use outra referência.`,
      });
    }

    // Só uma chamada passa daqui com a mesma referência: a que mudar a situação primeiro
    const [tomada] = await pool.query<any>(
      `UPDATE nfe_documentos SET situacao = 'processando'
        WHERE id = ? AND situacao IN ('rascunho', 'assinada', 'rejeitada')`,
      [l.id],
    );
    if (acao === 'ocupada' || !tomada.affectedRows) {
      return res.status(409).json({
        ...resposta(l, true),
        success: false,
        error: 'A nota desta referência está sendo processada agora. Consulte o resultado em instantes.',
      });
    }

    await gerarETransmitir(ctx, l, documento, sincrono);
    l = (await buscar(empresaId, referencia))!;
    res.status(l.situacao === 'enviada' ? 202 : 200).json(resposta(l));
  }));

  r.get('/emitir/:referencia', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const referencia = validarReferencia(req.params.referencia);
    let l = await buscar(empresaId, referencia);
    if (!l) return res.status(404).json({ success: false, error: `Nenhuma nota com a referência ${referencia}.` });

    if (decidir(l.situacao, l.idade) === 'verificar') {
      const v = await verificar(await montarContexto(empresaId), l);
      if (v === 'nao_consta') {
        await atualizar(l.id, { situacao: 'rascunho', motivo: 'A nota não chegou à SEFAZ. Mande a mesma referência de novo.' });
      }
      l = (await buscar(empresaId, referencia))!;
    }
    res.status(['enviada', 'processando'].includes(l.situacao) ? 202 : 200).json(resposta(l));
  }));

  /** Referências paradas sem autorização há N dias (padrão 7): números a inutilizar */
  r.get('/emitir-pendentes', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const dias = req.query.dias === undefined ? 7 : Math.max(0, Number(req.query.dias) || 0);
    const [linhas] = await pool.query<any[]>(
      `SELECT referencia, modelo, serie, numero, situacao, codigo_status, motivo, atualizado_em
         FROM nfe_documentos
        WHERE empresa_id = ? AND referencia IS NOT NULL
          AND situacao IN ('rascunho', 'assinada', 'rejeitada')
          AND atualizado_em < NOW() - INTERVAL ? DAY
        ORDER BY modelo, serie, numero`,
      [empresaId, dias],
    );
    res.json({ success: true, dias, itens: linhas });
  }));

  return r;
}
