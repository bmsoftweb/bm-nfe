/**
 * Rotas da API. Cada uma corresponde a um botão do formulário do exemplo
 * Delphi; o isolamento por empresa vem da sessão (token assinado, ver auth.ts),
 * e não de um header que o cliente controla.
 */
import { Request, Response, Router } from 'express';
import { pool } from '../db.js';
import { CONFIG_PADRAO, gravarConfig, lerConfig, preservarSegredos, semSegredos } from '../config.js';
import { carregarCertificado, esquecerCertificado, montarContexto, carregarEmitente } from '../nfe/contexto.js';
import { carregarPfx } from '../nfe/certificado.js';
import { assinar, conferirAssinatura } from '../nfe/assinatura.js';
import { gerarNFe } from '../nfe/gerarNFe.js';
import { gerarDanfe } from '../nfe/danfe.js';
import { enviarEmail, testarSmtp } from '../nfe/email.js';
import { TIPOS_EVENTO } from '../nfe/eventos.js';
import { UFS } from '../nfe/servicos.js';
import { chaveValida } from '../nfe/chave.js';
import { dataHoraMysql, paraBR } from '../nfe/datas.js';
import { recortarElemento, semDeclaracao, valorTag } from '../nfe/xml.js';
import { FalhaSchema, exigirValido, validarNFe, validarQualquer } from '../nfe/validacao.js';
import { proximoNumero } from '../nfe/numeracao.js';
import { atualizarTabela, situacaoTabelas } from '../tabelas.js';
import {
  autorizar,
  consultarCadastro,
  consultarClassificacaoTributaria,
  consultarChave,
  consultarRecibo,
  distribuicaoDFe,
  enviarEvento,
  inutilizar,
  montarProcNFe,
  statusServico,
} from '../nfe/operacoes.js';

/**
 * Situações em que a nota ainda pode ser editada. A SEFAZ não guarda nota
 * rejeitada, então o número continua livre; assinada nunca saiu daqui.
 */
const SITUACOES_EDITAVEIS = ['assinada', 'rejeitada'];

function exigirEditavel(situacao: string) {
  if (SITUACOES_EDITAVEIS.includes(situacao)) return;

  const motivos: Record<string, string> = {
    autorizada:
      'Nota autorizada não pode ser editada. Para corrigir, use a Carta de Correção (Eventos) ' +
      'ou cancele e emita outra.',
    cancelada: 'Nota cancelada não pode ser editada: o número já foi usado na SEFAZ.',
    denegada: 'Nota denegada não pode ser editada: o número já foi usado na SEFAZ.',
    enviada:
      'A nota foi enviada e aguarda o retorno. Consulte o recibo antes de editar — ' +
      'ela pode ter sido autorizada.',
  };
  throw new Error(motivos[situacao] || `Nota na situação "${situacao}" não pode ser editada.`);
}

/**
 * A empresa vem da sessão validada pelo exigirSessao — nunca de um header, que o
 * cliente poderia trocar para agir em nome de outro emitente.
 */
export function empresaDaRequisicao(req: Request): number {
  const id = req.usuario?.empresaId;
  if (!id) throw new Error('Sessão sem empresa. Entre novamente.');
  return id;
}

/**
 * Envolve o handler para que toda exceção vire um 400 com a mensagem em português.
 * Falha de schema sai como 422 e leva a lista de erros, para a tela mostrar campo a campo.
 */
export function rota(handler: (req: Request, res: Response) => Promise<any>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      if (res.headersSent) return;
      if (err instanceof FalhaSchema) {
        res.status(422).json(
          err.detalhar
            ? { success: false, error: err.aviso, errosSchema: err.erros, schema: err.schema }
            : { success: false, error: err.aviso },
        );
        return;
      }
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  };
}

export function criarRotasNFe(): Router {
  const r = Router();

  // =========================================================================
  // Metadados das telas
  // =========================================================================
  r.get('/meta', (_req, res) => {
    res.json({
      ufs: UFS,
      tiposEvento: TIPOS_EVENTO,
      configPadrao: CONFIG_PADRAO,
      formasEmissao: [
        { valor: 1, rotulo: 'Normal' },
        { valor: 2, rotulo: 'Contingência FS-IA' },
        { valor: 4, rotulo: 'EPEC' },
        { valor: 5, rotulo: 'Contingência FS-DA' },
        { valor: 6, rotulo: 'SVC-AN' },
        { valor: 7, rotulo: 'SVC-RS' },
        { valor: 9, rotulo: 'Offline (NFC-e)' },
      ],
      modelos: [
        { valor: '55', rotulo: '55 — NF-e' },
        { valor: '65', rotulo: '65 — NFC-e' },
      ],
    });
  });

  // =========================================================================
  // Configurações e emitente
  // =========================================================================
  r.get('/config', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const [config, emitente] = await Promise.all([lerConfig(empresaId), carregarEmitente(empresaId)]);

    let certificado: any = null;
    const [linhas] = await pool.query<any[]>(
      `SELECT nome_arquivo, cnpj, razao_social, numero_serie, emissor, valido_de, valido_ate, atualizado_em
         FROM nfe_certificados WHERE empresa_id = ? LIMIT 1`,
      [empresaId],
    );
    if (linhas.length) {
      const c = linhas[0];
      const dias = Math.floor((new Date(c.valido_ate).getTime() - Date.now()) / 86_400_000);
      certificado = { ...c, diasParaVencer: dias, vencido: dias < 0 };
    }

    res.json({ config: semSegredos(config), emitente, certificado });
  }));

  r.put('/config', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const atual = await lerConfig(empresaId);
    const novo = await gravarConfig(empresaId, preservarSegredos(req.body || {}, atual));
    res.json({ success: true, config: semSegredos(novo) });
  }));

  r.put('/emitente', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const c = req.body || {};
    const colunas = [
      'cnpj', 'inscricao_estadual', 'razao_social', 'nome_fantasia', 'logradouro', 'numero',
      'complemento', 'bairro', 'codigo_municipio', 'municipio', 'uf', 'cep', 'fone', 'crt',
    ];
    const campos = colunas.filter((col) => col in c);
    if (!campos.length) throw new Error('Nenhum campo do emitente foi informado.');

    await pool.query(
      `UPDATE nfe_empresas SET ${campos.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
      [...campos.map((f) => (typeof c[f] === 'string' ? c[f].trim() : c[f])), empresaId],
    );

    res.json({ success: true, emitente: await carregarEmitente(empresaId) });
  }));

  // =========================================================================
  // Certificado
  // =========================================================================
  r.post('/certificado', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const { arquivoBase64, nomeArquivo, senha } = req.body || {};
    if (!arquivoBase64) throw new Error('Envie o arquivo .pfx do certificado.');
    if (!senha) throw new Error('Informe a senha do certificado.');

    const pfx = Buffer.from(String(arquivoBase64).replace(/^data:[^,]+,/, ''), 'base64');
    // Falha aqui (senha errada, arquivo inválido) impede gravar lixo no banco
    const { info } = carregarPfx(pfx, senha);

    await pool.query(
      `INSERT INTO nfe_certificados
         (empresa_id, nome_arquivo, arquivo, senha, cnpj, razao_social, numero_serie, emissor, valido_de, valido_ate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nome_arquivo = VALUES(nome_arquivo), arquivo = VALUES(arquivo), senha = VALUES(senha),
         cnpj = VALUES(cnpj), razao_social = VALUES(razao_social), numero_serie = VALUES(numero_serie),
         emissor = VALUES(emissor), valido_de = VALUES(valido_de), valido_ate = VALUES(valido_ate)`,
      [
        empresaId, nomeArquivo || 'certificado.pfx', pfx, senha,
        info.cnpj, info.razaoSocial, info.numeroSerie, info.emissor,
        dataHoraMysql(info.validoDe), dataHoraMysql(info.validoAte),
      ],
    );

    esquecerCertificado(empresaId);
    res.json({ success: true, certificado: { ...info, validoDe: paraBR(info.validoDe, false), validoAte: paraBR(info.validoAte, false) } });
  }));

  r.delete('/certificado', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    await pool.query('DELETE FROM nfe_certificados WHERE empresa_id = ?', [empresaId]);
    esquecerCertificado(empresaId);
    res.json({ success: true });
  }));

  // =========================================================================
  // Consultas
  // =========================================================================
  r.post('/status', rota(async (req, res) => {
    res.json(await statusServico(await montarContexto(empresaDaRequisicao(req))));
  }));

  r.post('/consultar', rota(async (req, res) => {
    const ctx = await montarContexto(empresaDaRequisicao(req));
    const ret = await consultarChave(ctx, String(req.body?.chave || ''));

    // A consulta é a forma mais confiável de fechar a situação do documento
    if (ret.dados?.protocolo) {
      await pool.query(
        `UPDATE nfe_documentos SET protocolo = ?, codigo_status = ?, motivo = ?,
                situacao = CASE WHEN ? = 101 THEN 'cancelada' WHEN ? IN (100,150) THEN 'autorizada' ELSE situacao END
          WHERE empresa_id = ? AND chave = ?`,
        [ret.dados.protocolo, ret.cStat, ret.xMotivo, ret.cStat, ret.cStat, ctx.empresaId, req.body.chave],
      );
    }

    res.json(ret);
  }));

  r.post('/consultar-cadastro', rota(async (req, res) => {
    const ctx = await montarContexto(empresaDaRequisicao(req));
    const { uf, cnpj, cpf, ie } = req.body || {};
    res.json(await consultarCadastro(ctx, uf || ctx.config.webservice.uf, { cnpj, cpf, ie }));
  }));

  r.post('/consultar-recibo', rota(async (req, res) => {
    const ctx = await montarContexto(empresaDaRequisicao(req));
    res.json(await consultarRecibo(ctx, String(req.body?.recibo || '')));
  }));

  // Tabela oficial do cClassTrib para os módulos do ERP: a API da SVRS pede o certificado, que fica aqui
  r.get('/tabelas/classificacao-tributaria', rota(async (req, res) => {
    res.json(await consultarClassificacaoTributaria(await montarContexto(empresaDaRequisicao(req))));
  }));

  // CFOP e NCM dos combos do ERP: baixados da fonte oficial só quando o usuário pede (tela Tabelas Fiscais)
  r.get('/tabelas', rota(async (_req, res) => {
    res.json(await situacaoTabelas());
  }));

  r.post('/tabelas/:nome/atualizar', rota(async (req, res) => {
    res.json(await atualizarTabela(req.params.nome));
  }));

  // =========================================================================
  // Emissão
  // =========================================================================

  /** Gera o XML, assina e guarda como rascunho assinado */
  r.post('/gerar', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const ctx = await montarContexto(empresaId);
    const documento = req.body?.documento;
    if (!documento) throw new Error('Informe os dados da nota.');

    // Edição: confere a situação antes de gerar, para não assinar à toa
    const documentoId = req.body?.documentoId ? Number(req.body.documentoId) : null;
    if (documentoId) {
      const [linhas] = await pool.query<any[]>(
        'SELECT situacao FROM nfe_documentos WHERE id = ? AND empresa_id = ? LIMIT 1',
        [documentoId, empresaId],
      );
      if (!linhas.length) throw new Error('Documento não encontrado.');
      exigirEditavel(linhas[0].situacao);
    }

    const gerada = gerarNFe(ctx, documento);
    const assinada = assinar(semDeclaracao(gerada.xml), 'infNFe', `NFe${gerada.chave}`, ctx.certificado);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>${assinada}`;

    // Nota fora do schema nem chega a ser gravada: o usuário corrige o formulário
    exigirValido(
      await validarNFe(xml),
      `Falha na validação dos dados da nota: ${gerada.numero}`,
      ctx.config.geral.exibirErroSchema,
    );

    const dest = documento.destinatario;
    const destinatarioDocumento = (dest?.cnpj || dest?.cpf || '').replace(/\D/g, '') || null;

    let gravado = documentoId;
    try {
      if (documentoId) {
        // Edição regrava o MESMO registro: a nota corrigida não vira uma segunda linha.
        // A chave muda (o código numérico é novo) e o retorno da rejeição anterior é
        // limpo; o histórico dela continua no nfe_log. A condição na situação protege
        // contra alguém ter transmitido a nota entre abrir a edição e gerar.
        const [resultado] = await pool.query<any>(
          `UPDATE nfe_documentos
              SET chave = ?, modelo = ?, serie = ?, numero = ?, situacao = 'assinada', ambiente = ?,
                  data_emissao = ?, destinatario_documento = ?, destinatario_nome = ?, valor_total = ?,
                  dados = CAST(? AS JSON), xml = ?,
                  recibo = NULL, protocolo = NULL, codigo_status = NULL, motivo = NULL, xml_protocolo = NULL
            WHERE id = ? AND empresa_id = ? AND situacao IN (${SITUACOES_EDITAVEIS.map(() => '?').join(', ')})`,
          [
            gerada.chave, gerada.modelo, gerada.serie, gerada.numero, ctx.config.webservice.ambiente,
            dataHoraMysql(), destinatarioDocumento, dest?.nome || null, gerada.totais.vNF,
            JSON.stringify(documento), xml,
            documentoId, empresaId, ...SITUACOES_EDITAVEIS,
          ],
        );
        if (!resultado.affectedRows) {
          throw new Error('A nota mudou de situação enquanto era editada. Recarregue a lista e confira.');
        }
      } else {
        const [inserido] = await pool.query<any>(
          `INSERT INTO nfe_documentos
             (empresa_id, chave, modelo, serie, numero, situacao, ambiente, data_emissao,
              destinatario_documento, destinatario_nome, valor_total, dados, xml)
           VALUES (?, ?, ?, ?, ?, 'assinada', ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
          [
            empresaId, gerada.chave, gerada.modelo, gerada.serie, gerada.numero,
            ctx.config.webservice.ambiente, dataHoraMysql(),
            destinatarioDocumento, dest?.nome || null, gerada.totais.vNF,
            JSON.stringify(documento), xml,
          ],
        );
        gravado = inserido.insertId;
      }
    } catch (err: any) {
      // Número único por série (doc/plano-concentrador.md): o banco recusa a segunda nota
      if (err?.code === 'ER_DUP_ENTRY') {
        throw new Error(
          `O número ${gerada.numero} da série ${gerada.serie} já está em uso por outra nota. ` +
            'Use o próximo número ou edite a nota que já existe.',
        );
      }
      throw err;
    }

    // documentoId: a tela manda de volta no próximo "Gerar", que regrava esta nota em vez de criar outra
    res.json({ success: true, chave: gerada.chave, totais: gerada.totais, xml, documentoId: gravado });
  }));

  /** Transmite para a SEFAZ um XML já assinado (o gerado aqui ou um importado) */
  r.post('/enviar', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const ctx = await montarContexto(empresaId);

    let xml: string = req.body?.xml || '';
    if (!xml && req.body?.chave) {
      const [linhas] = await pool.query<any[]>(
        'SELECT xml FROM nfe_documentos WHERE empresa_id = ? AND chave = ? LIMIT 1',
        [empresaId, req.body.chave],
      );
      xml = linhas[0]?.xml || '';
    }
    if (!xml) throw new Error('Informe o XML da NF-e ou a chave de um documento já gerado.');

    const ret = await autorizar(ctx, xml, { sincrono: req.body?.sincrono !== false });
    const chave = ret.dados?.chave;

    if (chave) {
      const autorizada = ret.dados?.autorizada;
      const procNFe = autorizada && ret.dados?.protNFe ? montarProcNFe(xml, ret.dados.protNFe) : null;

      await pool.query(
        `UPDATE nfe_documentos
            SET situacao = ?, recibo = ?, protocolo = ?, codigo_status = ?, motivo = ?, xml_protocolo = ?
          WHERE empresa_id = ? AND chave = ?`,
        [
          autorizada ? 'autorizada' : ret.dados?.recibo ? 'enviada' : 'rejeitada',
          ret.dados?.recibo || null,
          ret.dados?.protocolo || null,
          ret.dados?.cStatNota || ret.cStat,
          ret.dados?.motivoNota || ret.xMotivo,
          procNFe,
          empresaId, chave,
        ],
      );
    }

    res.json(ret);
  }));

  /** Importa um XML de fora (o "Importar TXT/XML" do exemplo) */
  r.post('/importar', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const xml: string = req.body?.xml || '';
    const chave = (xml.match(/Id="NFe(\d{44})"/) || [])[1];
    if (!chave) throw new Error('O arquivo não contém uma NF-e com chave de acesso.');

    const modelo = chave.slice(20, 22);
    const serie = Number(chave.slice(22, 25));
    const numero = Number(chave.slice(25, 34));
    const ambiente = Number(valorTag(xml, 'tpAmb') || 2);

    // Com o número único por série, o ON DUPLICATE abaixo poderia cair numa nota de
    // outra chave e sobrescrevê-la: esse caso é barrado antes
    const [outra] = await pool.query<any[]>(
      `SELECT chave FROM nfe_documentos
        WHERE empresa_id = ? AND modelo = ? AND serie = ? AND ambiente = ? AND numero = ?
          AND (chave IS NULL OR chave <> ?) LIMIT 1`,
      [empresaId, modelo, serie, ambiente, numero, chave],
    );
    if (outra.length) {
      throw new Error(
        `O número ${numero} da série ${serie} já está em uso por outra nota` +
          (outra[0].chave ? ` (chave ${outra[0].chave}).` : '.'),
      );
    }

    const protNFe = recortarElemento(xml, 'protNFe');
    await pool.query(
      `INSERT INTO nfe_documentos
         (empresa_id, chave, modelo, serie, numero, situacao, ambiente, data_emissao,
          destinatario_nome, valor_total, xml, xml_protocolo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE xml = VALUES(xml), xml_protocolo = VALUES(xml_protocolo)`,
      [
        empresaId, chave, modelo, serie, numero,
        protNFe ? 'autorizada' : 'assinada', ambiente,
        dataHoraMysql(), valorTag(recortarElemento(xml, 'dest') || '', 'xNome'),
        Number(valorTag(xml, 'vNF') || 0), xml, protNFe,
      ],
    );

    res.json({ success: true, chave });
  }));

  r.post('/validar-assinatura', rota(async (req, res) => {
    res.json(conferirAssinatura(String(req.body?.xml || '')));
  }));

  /**
   * Botão "Validar XML": confere o documento contra o schema sem enviar nada.
   * Aceita o XML direto ou a chave de um documento já guardado. Resultado
   * inválido não é erro da requisição — volta 200 com a lista de problemas.
   */
  r.post('/validar-xml', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);

    let xml: string = req.body?.xml || '';
    if (!xml && req.body?.chave) {
      const [linhas] = await pool.query<any[]>(
        'SELECT xml, xml_protocolo FROM nfe_documentos WHERE empresa_id = ? AND chave = ? LIMIT 1',
        [empresaId, req.body.chave],
      );
      xml = linhas[0]?.xml_protocolo || linhas[0]?.xml || '';
    }
    if (!xml) throw new Error('Informe o XML ou a chave de um documento já gerado.');

    res.json(await validarQualquer(xml));
  }));

  // =========================================================================
  // Eventos e inutilização
  // =========================================================================
  r.post('/evento', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const ctx = await montarContexto(empresaId);
    const ret = await enviarEvento(ctx, req.body || {});

    await pool.query(
      `INSERT INTO nfe_eventos
         (empresa_id, chave, tipo_evento, descricao, sequencia, ambiente, data_evento,
          justificativa, protocolo, codigo_status, motivo, xml, xml_retorno)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId, req.body.chave.replace(/\D/g, ''), ret.dados?.tipoEvento, ret.dados?.descricao,
        ret.dados?.sequencia, ctx.config.webservice.ambiente, dataHoraMysql(),
        req.body.justificativa || req.body.correcao || null,
        ret.dados?.protocolo || null, ret.cStat, ret.xMotivo,
        ret.dados?.xmlEnvio || null, ret.dados?.procEventoNFe || ret.xml,
      ],
    );

    // Cancelamento aceito fecha o documento
    if (ret.sucesso && ret.dados?.tipoEvento === '110111') {
      await pool.query(
        `UPDATE nfe_documentos SET situacao = 'cancelada' WHERE empresa_id = ? AND chave = ?`,
        [empresaId, req.body.chave.replace(/\D/g, '')],
      );
    }

    res.json(ret);
  }));

  r.post('/inutilizar', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const ctx = await montarContexto(empresaId);
    const p = {
      ano: Number(req.body?.ano) || new Date().getFullYear(),
      modelo: String(req.body?.modelo || ctx.config.geral.modeloDF),
      serie: Number(req.body?.serie) || 1,
      numeroInicial: Number(req.body?.numeroInicial),
      numeroFinal: Number(req.body?.numeroFinal),
      justificativa: String(req.body?.justificativa || ''),
    };

    const ret = await inutilizar(ctx, p);

    await pool.query(
      `INSERT INTO nfe_inutilizacoes
         (empresa_id, ano, modelo, serie, numero_inicial, numero_final, justificativa,
          ambiente, protocolo, codigo_status, motivo, xml, xml_retorno)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId, p.ano, p.modelo, p.serie, p.numeroInicial, p.numeroFinal, p.justificativa,
        ctx.config.webservice.ambiente, ret.dados?.protocolo || null, ret.cStat, ret.xMotivo,
        ret.dados?.xmlEnvio || null, ret.dados?.procInutNFe || ret.xml,
      ],
    );

    res.json(ret);
  }));

  // =========================================================================
  // Distribuição DF-e
  // =========================================================================
  r.post('/distribuicao', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const ctx = await montarContexto(empresaId);
    const ret = await distribuicaoDFe(ctx, req.body || {});

    for (const d of ret.dados?.documentos || []) {
      await pool.query(
        `INSERT INTO nfe_distribuicao
           (empresa_id, nsu, schema_doc, chave, tipo, emitente_nome, valor, data_documento, xml)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE xml = VALUES(xml)`,
        [
          empresaId, d.nsu, d.schema, d.chave || null, d.tipo, d.emitente || null,
          d.valor, d.data ? dataHoraMysql(new Date(d.data)) : null, d.xml,
        ],
      );
    }

    res.json(ret);
  }));

  // =========================================================================
  // DANFE e e-mail
  // =========================================================================
  r.post('/danfe', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const config = await lerConfig(empresaId);

    let xml: string = req.body?.xml || '';
    if (!xml && req.body?.chave) {
      const [linhas] = await pool.query<any[]>(
        'SELECT xml, xml_protocolo FROM nfe_documentos WHERE empresa_id = ? AND chave = ? LIMIT 1',
        [empresaId, req.body.chave],
      );
      xml = linhas[0]?.xml_protocolo || linhas[0]?.xml || '';
    }
    if (!xml) throw new Error('Nenhum XML encontrado para gerar o DANFE.');

    const pdf = await gerarDanfe(xml, {
      logo: config.danfe.logoMarca,
      homologacao: Number(valorTag(xml, 'tpAmb')) === 2,
      paisagem: config.danfe.tipoDanfe === 1,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="DANFE-${req.body?.chave || 'nfe'}.pdf"`);
    res.send(pdf);
  }));

  r.post('/email', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const config = await lerConfig(empresaId);
    const { chave, para, assunto, mensagem, anexarPdf } = req.body || {};

    const [linhas] = await pool.query<any[]>(
      'SELECT chave, numero, serie, xml, xml_protocolo, data_emissao FROM nfe_documentos WHERE empresa_id = ? AND chave = ? LIMIT 1',
      [empresaId, chave],
    );
    if (!linhas.length) throw new Error('Documento não encontrado.');
    const d = linhas[0];
    const xml = d.xml_protocolo || d.xml;

    const anexos = [{ nome: `${d.chave}-nfe.xml`, conteudo: xml, tipo: 'application/xml' }];
    if (anexarPdf !== false) {
      anexos.push({
        nome: `${d.chave}-danfe.pdf`,
        conteudo: (await gerarDanfe(xml, { homologacao: Number(valorTag(xml, 'tpAmb')) === 2 })) as any,
        tipo: 'application/pdf',
      });
    }

    const emitente = await carregarEmitente(empresaId);
    const envio = await enviarEmail(config.email, {
      para, assunto, mensagem, anexos,
      variaveis: {
        numero: String(d.numero),
        serie: String(d.serie),
        chave: d.chave,
        dataEmissao: paraBR(d.data_emissao, false),
        razaoSocial: emitente.razao_social,
      },
    });

    res.json({ success: true, ...envio });
  }));

  r.post('/email/testar', rota(async (req, res) => {
    const config = await lerConfig(empresaDaRequisicao(req));
    await testarSmtp(config.email);
    res.json({ success: true });
  }));

  // =========================================================================
  // Listagens
  // =========================================================================
  const listagem = (tabela: string, ordem: string, colunas: string) =>
    rota(async (req, res) => {
      const empresaId = empresaDaRequisicao(req);
      const limite = Math.min(Number(req.query.limite) || 100, 500);
      const [linhas] = await pool.query<any[]>(
        `SELECT ${colunas} FROM ${tabela} WHERE empresa_id = ? ORDER BY ${ordem} DESC LIMIT ?`,
        [empresaId, limite],
      );
      res.json(linhas);
    });

  /**
   * Listagem paginada das grades (padrão b2b admin): página, registros por página,
   * busca e ordenação vêm da tela, mas só por nomes da whitelist — nenhum nome de
   * coluna do cliente chega ao SQL.
   */
  const paginada = (def: {
    tabela: string;
    colunas: string;
    /** campo da grade -> expressão SQL de ordenação */
    ordenaveis: Record<string, string>;
    /** expressões pesquisadas pela busca simples */
    busca: string[];
    ordemPadrao: string;
    direcaoPadrao: 'asc' | 'desc';
    /** Tabela sem empresa_id, igual para todas as empresas (as tabelas fiscais) */
    global?: boolean;
  }) =>
    rota(async (req, res) => {
      const empresa = def.global ? [] : [empresaDaRequisicao(req)];
      const porPagina = [10, 25, 50, 100].includes(Number(req.query.porPagina)) ? Number(req.query.porPagina) : 25;
      const pagina = Math.max(1, Math.floor(Number(req.query.pagina) || 1));
      const ordem = def.ordenaveis[String(req.query.ordem)] || def.ordenaveis[def.ordemPadrao];
      const direcao = req.query.direcao === 'asc' ? 'ASC' : req.query.direcao === 'desc' ? 'DESC' : def.direcaoPadrao.toUpperCase();

      const termo = String(req.query.busca || '').trim();
      const filtro = termo ? ` AND (${def.busca.map((c) => `${c} LIKE ?`).join(' OR ')})` : '';
      const params = termo ? def.busca.map(() => `%${termo}%`) : [];
      const onde = `WHERE ${def.global ? '1 = 1' : 'empresa_id = ?'}${filtro}`;

      const [[{ total }]] = await pool.query<any[]>(
        `SELECT COUNT(*) AS total FROM ${def.tabela} ${onde}`,
        [...empresa, ...params],
      );
      // O id desempata a ordenação, para a paginação não repetir nem pular linha
      const [linhas] = await pool.query<any[]>(
        `SELECT ${def.colunas} FROM ${def.tabela} ${onde}
          ORDER BY ${ordem} ${direcao}, id ${direcao} LIMIT ? OFFSET ?`,
        [...empresa, ...params, porPagina, (pagina - 1) * porPagina],
      );

      res.json({ data: linhas, total: Number(total), totalPages: Math.max(1, Math.ceil(Number(total) / porPagina)) });
    });

  r.get('/documentos', paginada({
    tabela: 'nfe_documentos',
    colunas:
      'id, chave, modelo, serie, numero, situacao, ambiente, data_emissao, destinatario_nome, valor_total, protocolo, codigo_status, motivo, ' +
      // Só nota gerada aqui guarda os dados do formulário; XML importado não tem o que copiar
      '(dados IS NOT NULL) AS copiavel',
    ordenaveis: {
      numero: 'numero', serie: 'serie', data_emissao: 'data_emissao', destinatario_nome: 'destinatario_nome',
      valor_total: 'valor_total', situacao: 'situacao', ambiente: 'ambiente', motivo: 'codigo_status',
    },
    busca: ['CAST(numero AS CHAR)', 'destinatario_nome', 'chave', 'situacao', 'motivo'],
    ordemPadrao: 'data_emissao',
    direcaoPadrao: 'desc',
  }));

  /** Sugestão para a Nova NF-e: o próximo do contador da série, sem reservar */
  r.get('/proximo-numero', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const config = await lerConfig(empresaId);
    const numero = await proximoNumero({
      empresaId, modelo: config.geral.modeloDF, serie: Number(req.query.serie) || 1,
      ambiente: config.webservice.ambiente,
    });
    res.json({ numero });
  }));

  r.get('/documentos/:chave', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    if (!chaveValida(req.params.chave)) throw new Error('Chave de acesso inválida.');
    const [linhas] = await pool.query<any[]>(
      'SELECT * FROM nfe_documentos WHERE empresa_id = ? AND chave = ? LIMIT 1',
      [empresaId, req.params.chave],
    );
    if (!linhas.length) throw new Error('Documento não encontrado.');
    res.json(linhas[0]);
  }));

  r.get('/eventos', listagem(
    'nfe_eventos', 'id',
    'id, chave, tipo_evento, descricao, sequencia, data_evento, protocolo, codigo_status, motivo',
  ));

  r.get('/inutilizacoes', listagem(
    'nfe_inutilizacoes', 'id',
    'id, ano, modelo, serie, numero_inicial, numero_final, justificativa, protocolo, codigo_status, motivo, criado_em',
  ));

  r.get('/distribuicao', listagem(
    'nfe_distribuicao', 'CAST(nsu AS UNSIGNED)',
    'id, nsu, schema_doc, chave, tipo, emitente_nome, valor, data_documento, manifestado',
  ));

  r.get('/log', paginada({
    tabela: 'nfe_log',
    colunas: 'id, operacao, url, chave, sucesso, codigo_status, motivo, duracao_ms, criado_em',
    ordenaveis: {
      criado_em: 'criado_em', operacao: 'operacao', chave: 'chave', sucesso: 'sucesso',
      duracao_ms: 'duracao_ms', codigo_status: 'codigo_status', motivo: 'motivo',
    },
    busca: ['operacao', 'chave', 'motivo', 'CAST(codigo_status AS CHAR)'],
    ordemPadrao: 'criado_em',
    direcaoPadrao: 'desc',
  }));

  // Tabelas fiscais (tela Tabelas Fiscais › Ver): só leitura
  const INDICADORES_CFOP = 'ind_nfe, ind_comunica, ind_transp, ind_devol, ind_retor, ind_anula, ind_remes, ind_comb, ind_exc_ibscbs';
  r.get('/tabelas/cfop', paginada({
    tabela: 'fis_cfop',
    global: true,
    colunas: `id, cfop, titulo, descricao, inicio_vigencia, fim_vigencia, ${INDICADORES_CFOP}`,
    ordenaveis: {
      cfop: 'cfop', titulo: 'titulo', inicio_vigencia: 'inicio_vigencia', fim_vigencia: 'fim_vigencia',
      ...Object.fromEntries(INDICADORES_CFOP.split(', ').map((c) => [c, c])),
    },
    busca: ['cfop', 'titulo', 'descricao'],
    ordemPadrao: 'cfop',
    direcaoPadrao: 'asc',
  }));

  r.get('/tabelas/ncm', paginada({
    tabela: 'fis_ncm',
    global: true,
    colunas: 'id, ncm, nome, descricao, inicio_vigencia, fim_vigencia, ato_legal',
    ordenaveis: {
      ncm: 'ncm', nome: 'nome', descricao: 'descricao', inicio_vigencia: 'inicio_vigencia',
      fim_vigencia: 'fim_vigencia', ato_legal: 'ato_legal',
    },
    // O NCM aparece com pontos na grade (0000.00.00): a busca acha nos dois formatos
    busca: ['ncm', "CONCAT(LEFT(ncm, 4), '.', SUBSTRING(ncm, 5, 2), '.', RIGHT(ncm, 2))", 'descricao', 'ato_legal'],
    ordemPadrao: 'ncm',
    direcaoPadrao: 'asc',
  }));

  r.get('/tabelas/municipios', paginada({
    tabela: 'cad_cidades',
    global: true,
    colunas: 'id, codigo_ibge, nome, uf',
    ordenaveis: { codigo_ibge: 'codigo_ibge', nome: 'nome', uf: 'uf' },
    busca: ['codigo_ibge', 'nome', 'uf'],
    ordemPadrao: 'codigo_ibge',
    direcaoPadrao: 'asc',
  }));

  // =========================================================================
  // Preferências das grades (usuarios.config_listas no b2b admin)
  // O usuário vem da sessão, nunca de um parâmetro do cliente.
  // =========================================================================
  const faltaColuna = (err: any) =>
    err?.code === 'ER_BAD_FIELD_ERROR'
      ? 'A coluna sys_usuarios.config_listas ainda não existe.'
      : err?.message;

  r.get('/config-listas', rota(async (req, res) => {
    let config: Record<string, unknown> = {};
    try {
      const [linhas] = await pool.query<any[]>(
        'SELECT config_listas FROM sys_usuarios WHERE id = ? LIMIT 1',
        [req.usuario!.id],
      );
      config = JSON.parse(linhas[0]?.config_listas || '{}') || {};
    } catch {
      // Coluna ainda não criada ou JSON inválido: as grades abrem com o padrão
    }
    res.json(config);
  }));

  r.put('/config-listas', rota(async (req, res) => {
    const corpo = req.body;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('Configuração inválida.');
    const texto = JSON.stringify(corpo);
    if (texto.length > 60000) throw new Error('Configuração muito grande.');

    try {
      const [resultado] = await pool.query<any>(
        'UPDATE sys_usuarios SET config_listas = ? WHERE id = ?',
        [texto, req.usuario!.id],
      );
      if (!resultado.affectedRows) {
        res.status(404).json({ success: false, error: 'Usuário da sessão não encontrado.' });
        return;
      }
    } catch (err: any) {
      throw new Error(faltaColuna(err));
    }
    res.json({ success: true });
  }));

  r.get('/log/:id', rota(async (req, res) => {
    const empresaId = empresaDaRequisicao(req);
    const [linhas] = await pool.query<any[]>(
      'SELECT * FROM nfe_log WHERE empresa_id = ? AND id = ? LIMIT 1',
      [empresaId, Number(req.params.id)],
    );
    if (!linhas.length) throw new Error('Registro de log não encontrado.');
    res.json(linhas[0]);
  }));

  return r;
}
