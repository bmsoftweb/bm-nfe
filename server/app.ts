import 'dotenv/config';
import express, { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool, checkDbHealth, CONFIG_FALTANDO, MENSAGEM_CONFIG_FALTANDO } from './db.js';
import { criarRotasNFe } from './rotas/nfe.js';
import { criarRotasEmitir } from './rotas/emitir.js';
import { carregarCertificado } from './nfe/contexto.js';
import { lerConfig } from './config.js';
import { criarToken, exigirSessao } from './auth.js';


/** Aceita bcrypt e os formatos legados que ainda aparecem em bases antigas */
function senhaConfere(informada: string, gravada: string): boolean {
  if (!gravada?.trim()) return false;

  if (/^\$2[aby]\$/.test(gravada)) {
    try {
      if (bcrypt.compareSync(informada, gravada)) return true;
    } catch {
      // segue para os demais formatos
    }
  }

  if (informada === gravada) return true;

  for (const algoritmo of ['md5', 'sha256', 'sha1']) {
    const hash = crypto.createHash(algoritmo).update(informada).digest('hex');
    if (hash.toLowerCase() === gravada.toLowerCase()) return true;
  }

  return false;
}


/**
 * Monta o app Express com todas as rotas /api, sem listen e sem Vite:
 *   local    -> server.ts acrescenta o Vite e dá listen numa porta
 *   produção -> api/index.ts exporta este app como função serverless da Vercel
 */
export function createApp() {
  const app = express();
  // O .pfx e os XMLs em base64 passam do limite padrão de 100kb
  app.use(express.json({ limit: '25mb' }));

  // Sem as variáveis de conexão nenhuma rota tem como funcionar: melhor dizer o
  // que falta do que deixar o mysql2 tentar 127.0.0.1 e devolver ECONNREFUSED.
  // A saúde do banco escapa da regra, porque é justamente quem relata o problema.
  if (CONFIG_FALTANDO.length) {
    app.use('/api', (req: Request, res: Response, proximo) => {
      if (req.path === '/db/status') return proximo();
      res.status(503).json({ success: false, error: MENSAGEM_CONFIG_FALTANDO });
    });
  }

  // =========================================================================
  // Autenticação: CNPJ do emitente + usuário + senha
  // =========================================================================
  app.post('/api/login', async (req: Request, res: Response) => {
    try {
      const { cnpj, usuario, senha } = req.body || {};
      const login = String(usuario || '').trim().toLowerCase();
      const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');

      if (cnpjLimpo.length !== 14 || !login) {
        return res.status(400).json({ success: false, error: 'Informe o CNPJ do emitente e o usuário.' });
      }

      const [empresas] = await pool.query<any[]>(
        'SELECT * FROM nfe_empresas WHERE cnpj = ? LIMIT 1',
        [cnpjLimpo],
      );
      if (!empresas.length) {
        return res.status(401).json({ success: false, error: 'Nenhum emitente cadastrado com este CNPJ.' });
      }

      const empresa = empresas[0];
      if (!empresa.ativo) {
        return res.status(401).json({ success: false, error: 'Este emitente está inativo.' });
      }

      // Usuários do ERP (sys_usuarios), ligados ao emitente pelo CNPJ da empresa
      const [usuarios] = await pool.query<any[]>(
        `SELECT u.id, u.login AS nome, u.login AS email, u.senha_hash
           FROM sys_usuarios u
           JOIN sys_empresas se ON se.id = u.empresa_id
          WHERE se.cnpj = ? AND LOWER(TRIM(u.login)) = ? AND u.ativo = 1 AND se.ativo = 1
          LIMIT 1`,
        [cnpjLimpo, login],
      );
      if (!usuarios.length) {
        return res.status(401).json({ success: false, error: `Usuário "${login}" não localizado neste emitente.` });
      }

      const encontrado = usuarios[0];
      const informada = String(senha || '');
      const semSenhaCadastrada = !String(encontrado.senha_hash || '').trim();

      if (semSenhaCadastrada) {
        // Usuário criado direto no banco, sem senha: a primeira que ele digitar
        // passa a ser a dele. Em branco não vale, senão o acesso ficaria aberto.
        if (!informada) {
          return res.status(401).json({
            success: false,
            error: 'Este usuário ainda não tem senha. Digite a senha que passará a valer para ele.',
          });
        }
      } else if (!senhaConfere(informada, encontrado.senha_hash)) {
        return res.status(401).json({ success: false, error: 'Senha incorreta.' });
      }

      // Senha ausente ou em formato legado vira bcrypt neste acesso
      if (semSenhaCadastrada || !/^\$2[aby]\$/.test(encontrado.senha_hash)) {
        await pool.query('UPDATE sys_usuarios SET senha_hash = ? WHERE id = ?', [
          bcrypt.hashSync(informada, 10),
          encontrado.id,
        ]);
      }

      delete encontrado.senha_hash;
      encontrado.empresa_id = empresa.id;
      // O token é a credencial das próximas chamadas: é dele que sai a empresa
      const token = criarToken(Number(encontrado.id), Number(empresa.id));
      res.json({ success: true, token, usuario: encontrado, empresa });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // =========================================================================
  // Daqui para baixo tudo exige sessão: só o login acima é público
  // =========================================================================
  app.use('/api', exigirSessao);

  // =========================================================================
  // Painel
  // =========================================================================
  app.get('/api/db/status', async (_req, res) => {
    res.json(await checkDbHealth());
  });

  app.get('/api/painel', async (req: Request, res: Response) => {
    try {
      const empresaId = req.usuario!.empresaId;

      const [[contagens]] = await pool.query<any[]>(
        `SELECT
           (SELECT COUNT(*) FROM nfe_documentos WHERE empresa_id = ?) AS documentos,
           (SELECT COUNT(*) FROM nfe_documentos WHERE empresa_id = ? AND situacao = 'autorizada') AS autorizadas,
           (SELECT COUNT(*) FROM nfe_documentos WHERE empresa_id = ? AND situacao = 'cancelada') AS canceladas,
           (SELECT COUNT(*) FROM nfe_documentos WHERE empresa_id = ? AND situacao = 'rejeitada') AS rejeitadas,
           (SELECT COALESCE(SUM(valor_total),0) FROM nfe_documentos WHERE empresa_id = ? AND situacao = 'autorizada') AS valor_autorizado,
           (SELECT COUNT(*) FROM nfe_eventos WHERE empresa_id = ?) AS eventos,
           (SELECT COUNT(*) FROM nfe_inutilizacoes WHERE empresa_id = ?) AS inutilizacoes,
           (SELECT COUNT(*) FROM nfe_distribuicao WHERE empresa_id = ?) AS distribuidos`,
        Array(8).fill(empresaId),
      );

      const [ultimos] = await pool.query<any[]>(
        `SELECT chave, numero, serie, situacao, valor_total, data_emissao, destinatario_nome, motivo
           FROM nfe_documentos WHERE empresa_id = ? ORDER BY id DESC LIMIT 8`,
        [empresaId],
      );

      const [erros] = await pool.query<any[]>(
        `SELECT operacao, codigo_status, motivo, criado_em
           FROM nfe_log WHERE empresa_id = ? AND sucesso = 0 ORDER BY id DESC LIMIT 5`,
        [empresaId],
      );

      const config = await lerConfig(empresaId);

      let certificado: any = null;
      try {
        const { info } = await carregarCertificado(empresaId);
        certificado = {
          razaoSocial: info.razaoSocial,
          cnpj: info.cnpj,
          validoAte: info.validoAte,
          diasParaVencer: info.diasParaVencer,
        };
      } catch (err: any) {
        certificado = { erro: err.message };
      }

      res.json({
        contagens,
        ultimos,
        erros,
        certificado,
        ambiente: config.webservice.ambiente,
        uf: config.webservice.uf,
        modelo: config.geral.modeloDF,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use('/api', criarRotasNFe());
  app.use('/api', criarRotasEmitir());

  return app;
}
