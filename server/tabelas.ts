/**
 * Tabelas oficiais que os módulos do ERP usam nos combos (CFOP, NCM e municípios), baixadas sob pedido pela
 * tela "Tabelas Fiscais". Ficam no banco do ERP (fis_cfop, fis_ncm e a cad_cidades do cadastro), preparadas
 * pelos SQL de extras/: o app nunca cria nem altera tabela.
 */
import { inflateRawSync } from 'node:zlib';
import { pool } from './db.js';
import { dataHoraMysql } from './nfe/datas.js';

/** Portal Nacional da NF-e > Documentos > Diversos: lá sai cada nova "Tabela de CFOP - Publicada em dd/mm/aaaa" */
const PORTAL_DIVERSOS = 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=';
/** Tabela NCM vigente do Portal Único Siscomex (API pública da Classif) */
const URL_NCM = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO';
/** Municípios da API de Localidades do IBGE (o código de 7 dígitos é o cMun da NF-e) */
const URL_MUNICIPIOS = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado';
/** O servidor do banco derruba comando que demora mais de 30 s para chegar (net_read_timeout) */
const LOTE = 500;

/** `sql`: o script de extras/ que deixa a tabela pronta (criada, ou com as colunas que a carga usa) */
export const TABELAS = {
  cfop: { tabela: 'fis_cfop', fonte: 'Portal Nacional da NF-e (Documentos › Diversos › Tabela de CFOP)', sql: 'extras/2026-11-07_tabelas_fiscais.sql' },
  ncm: { tabela: 'fis_ncm', fonte: 'Portal Único Siscomex (Tabela NCM vigente)', sql: 'extras/2026-11-07_tabelas_fiscais.sql' },
  municipios: { tabela: 'cad_cidades', fonte: 'IBGE (API de Localidades)', sql: 'extras/2026-11-07_cad_cidades.sql' },
} as const;
export type NomeTabela = keyof typeof TABELAS;

/** Quantos códigos cada tabela tem e quando foi atualizada (existe: false = tabela ou coluna faltando no banco) */
export async function situacaoTabelas() {
  const lista = [];
  for (const [nome, { tabela, fonte, sql }] of Object.entries(TABELAS)) {
    try {
      const [[l]] = await pool.query<any[]>(`SELECT COUNT(*) AS total, MAX(atualizado_em) AS atualizadoEm FROM ${tabela}`);
      lista.push({ nome, tabela, fonte, sql, existe: true, total: Number(l.total), atualizadoEm: l.atualizadoEm });
    } catch (err: any) {
      if (err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') throw err;
      lista.push({ nome, tabela, fonte, sql, existe: false, total: 0, atualizadoEm: null });
    }
  }
  return lista;
}

export async function atualizarTabela(nome: string): Promise<{ total: number; versao: string }> {
  if (nome === 'cfop') return atualizarCfop();
  if (nome === 'ncm') return atualizarNcm();
  if (nome === 'municipios') return atualizarMunicipios();
  throw new Error(`Tabela "${nome}" desconhecida.`);
}

/** Grava em lotes numa transação só: ou a tabela inteira entra, ou nada muda */
async function gravar(nome: NomeTabela, apagarAntes: boolean, sql: string, linhas: unknown[][]) {
  const { tabela, sql: script } = TABELAS[nome];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (apagarAntes) await conn.query(`DELETE FROM ${tabela}`);
    for (let i = 0; i < linhas.length; i += LOTE) await conn.query(sql, [linhas.slice(i, i + LOTE)]);
    await conn.commit();
  } catch (err: any) {
    await conn.rollback();
    throw err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR'
      ? new Error(`A tabela ${tabela} não está pronta no banco: rode o ${script}.`)
      : err;
  } finally {
    conn.release();
  }
}

async function baixar(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) }).catch((e) => {
    throw new Error(`Não foi possível baixar de ${new URL(url).host}: ${e.cause?.code || e.message}`);
  });
  if (!r.ok) throw new Error(`${new URL(url).host} respondeu HTTP ${r.status}.`);
  return r;
}

// ---------------------------------------------------------------------------
// CFOP: planilha do Informe Técnico 2023.002 (uma linha por código, com vigência e indicadores)
// ---------------------------------------------------------------------------

async function atualizarCfop() {
  // O portal é ASP.NET com detecção de cookie: sem este cookie ele só redireciona
  const init = { headers: { Cookie: 'AspxAutoDetectCookieSupport=1' } };
  const pagina = await (await baixar(PORTAL_DIVERSOS, init)).text();
  const publicadas = [
    ...pagina.matchAll(/href="(exibirArquivo\.aspx\?conteudo=[^"]+)"><span class="tituloConteudo">\s*(Tabela de CFOP - Publicada em (\d\d)\/(\d\d)\/(\d{4}))/g),
  ].sort((a, b) => `${b[5]}${b[4]}${b[3]}`.localeCompare(`${a[5]}${a[4]}${a[3]}`));
  if (!publicadas.length) throw new Error('A "Tabela de CFOP" não foi encontrada no Portal da NF-e (Documentos › Diversos).');
  const [, link, versao] = publicadas[0];

  const xlsx = Buffer.from(await (await baixar(new URL(link, PORTAL_DIVERSOS).href, init)).arrayBuffer());
  const [cab, ...corpo] = lerPlanilha(xlsx);
  // Colunas pelo cabeçalho, não pela posição: se o Portal mexer na planilha, falha em vez de gravar errado
  const col = (inicio: string) => {
    const c = Object.keys(cab).find((k) => cab[k]?.trim().startsWith(inicio));
    if (!c) throw new Error(`A planilha de CFOP mudou de formato: falta a coluna "${inicio}".`);
    return c;
  };
  const [cCfop, cIni, cFim, cTit, cDesc] = ['CFOP', 'Início', 'Fim', 'Título', 'Descrição'].map(col);
  const indicadores = ['indNFe', 'indComunica', 'indTransp', 'indDevol', 'indRetor', 'indAnula', 'indRemes', 'indComb', 'indExcIBSCBS'].map(col);

  const agora = dataHoraMysql();
  const linhas = corpo
    .filter((l) => /^\d{4}$/.test(l[cCfop]?.trim() ?? ''))
    .map((l) => [
      l[cCfop].trim(),
      l[cTit]?.trim() || '',
      l[cDesc]?.trim() || null,
      dataExcel(l[cIni]),
      dataExcel(l[cFim]),
      ...indicadores.map((c) => Number(l[c]) || 0),
      agora,
      agora,
    ]);
  if (linhas.length < 500) throw new Error(`A planilha de CFOP veio com só ${linhas.length} códigos: nada foi gravado.`);

  const campos = 'ind_nfe, ind_comunica, ind_transp, ind_devol, ind_retor, ind_anula, ind_remes, ind_comb, ind_exc_ibscbs';
  const atualiza = ['titulo', 'descricao', 'inicio_vigencia', 'fim_vigencia', ...campos.split(', '), 'atualizado_em']
    .map((c) => `${c} = VALUES(${c})`)
    .join(', ');
  // Código revogado continua na planilha (com o fim da vigência): atualizar basta, nada sai
  await gravar(
    'cfop',
    false,
    `INSERT INTO fis_cfop (cfop, titulo, descricao, inicio_vigencia, fim_vigencia, ${campos}, criado_em, atualizado_em)
     VALUES ? ON DUPLICATE KEY UPDATE ${atualiza}`,
    linhas,
  );
  return { total: linhas.length, versao };
}

/** Data serial do Excel (dias desde 30/12/1899) → aaaa-mm-dd */
const dataExcel = (v?: string) => (v ? new Date(Date.UTC(1899, 11, 30) + Number(v) * 864e5).toISOString().slice(0, 10) : null);

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const textoXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] !== '#' ? ENTIDADES[e] ?? m : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
  );
const textos = (s: string) => [...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => textoXml(t[1])).join('');

/** Linhas da primeira aba de um .xlsx como { coluna: texto } (ex.: { A: '5101', M: 'Venda de...' }) */
function lerPlanilha(xlsx: Buffer): Record<string, string>[] {
  const compartilhados = [...(arquivoDoZip(xlsx, 'xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1]));
  const aba = arquivoDoZip(xlsx, 'xl/worksheets/sheet1.xml');
  if (!aba) throw new Error('O arquivo baixado não é a planilha esperada (.xlsx).');
  return [...aba.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(([, linha]) => {
    const cel: Record<string, string> = {};
    for (const [, attrs, corpo = ''] of linha.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const coluna = attrs.match(/\br="([A-Z]+)/)?.[1];
      const tipo = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (coluna) cel[coluna] = tipo === 's' ? compartilhados[Number(v)] : tipo === 'inlineStr' ? textos(corpo) : textoXml(v ?? '');
    }
    return cel;
  });
}

/** Conteúdo de um arquivo de dentro do .zip (o .xlsx é um zip), achado pelo diretório central */
function arquivoDoZip(zip: Buffer, nome: string): string | null {
  const fim = zip.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (fim < 0) throw new Error('O arquivo baixado não é a planilha esperada (.xlsx).');
  let p = zip.readUInt32LE(fim + 16);
  for (let i = zip.readUInt16LE(fim + 10); i > 0; i--) {
    const tamNome = zip.readUInt16LE(p + 28);
    if (zip.toString('utf8', p + 46, p + 46 + tamNome) === nome) {
      const local = zip.readUInt32LE(p + 42);
      const ini = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const dados = zip.subarray(ini, ini + zip.readUInt32LE(p + 20));
      return (zip.readUInt16LE(p + 10) === 8 ? inflateRawSync(dados) : dados).toString('utf8');
    }
    p += 46 + tamNome + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return null;
}

// ---------------------------------------------------------------------------
// NCM: só os códigos de 8 dígitos, com o nome resumido (combos) e a descrição completa
// (posição > subposição > item > subitem)
// ---------------------------------------------------------------------------

interface Nomenclatura {
  Codigo: string;
  Descricao: string;
  Data_Inicio: string;
  Data_Fim: string;
  Tipo_Ato_Ini?: string;
  Numero_Ato_Ini?: string;
  Ano_Ato_Ini?: string;
}

const SOBRESCRITO = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** Texto do Siscomex sem HTML (cm<sup>2</sup> vira cm²), sem os traços de nível ("-- ") e sem o ":" do fim */
const limpa = (s: string) =>
  s
    .replace(/<sup>(.*?)<\/sup>/g, (_, n: string) => n.replace(/\d/g, (d) => SOBRESCRITO[Number(d)]))
    .replace(/<[^>]+>/g, '')
    .replace(/^[ –-]+/, '')
    .replace(/ +/g, ' ')
    .replace(/:+$/, '')
    .trim();

const corta = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/[ ,;]+$/, '')}…`);

/** dd/mm/aaaa → aaaa-mm-dd; 31/12/9999 (sem fim) → null */
const dataBR = (s: string) => (!s || s.startsWith('31/12/9999') ? null : s.split('/').reverse().join('-'));

async function atualizarNcm() {
  const json = (await (await baixar(URL_NCM)).json()) as { Data_Ultima_Atualizacao_NCM: string; Ato: string; Nomenclaturas: Nomenclatura[] };
  const por = new Map(json.Nomenclaturas.map((x) => [x.Codigo.replace(/\D/g, ''), x]));

  const agora = dataHoraMysql();
  const linhas = [...por.keys()]
    .filter((c) => c.length === 8)
    .sort()
    .map((c) => {
      const x = por.get(c)!;
      // Níveis do código (posição 4 dígitos até o subitem 8), sem repetir texto
      const niveis = [...new Set([4, 5, 6, 7, 8].map((n) => por.get(c.slice(0, n))).filter(Boolean).map((p) => limpa(p!.Descricao)).filter(Boolean))];
      // Nome para os combos: os níveis de cima resumidos, o último inteiro
      const nome = corta([...niveis.slice(0, -1).map((a) => corta(a, 45)), niveis[niveis.length - 1]].join(' > '), 255);
      const ato = `${x.Tipo_Ato_Ini ?? ''} ${x.Numero_Ato_Ini ?? ''}/${x.Ano_Ato_Ini ?? ''}`.trim();
      return [c, nome, niveis.join(' > '), dataBR(x.Data_Inicio), dataBR(x.Data_Fim), ato, agora, agora];
    });
  if (linhas.length < 5000) throw new Error(`A tabela NCM veio com só ${linhas.length} códigos: nada foi gravado.`);

  // Troca a tabela inteira: NCM extinto sai
  await gravar(
    'ncm',
    true,
    'INSERT INTO fis_ncm (ncm, nome, descricao, inicio_vigencia, fim_vigencia, ato_legal, criado_em, atualizado_em) VALUES ?',
    linhas,
  );
  return { total: linhas.length, versao: `${json.Data_Ultima_Atualizacao_NCM}, ${json.Ato}` };
}

// ---------------------------------------------------------------------------
// Municípios: a cad_cidades do cadastro do ERP (cad_pessoas e cad_pessoas_enderecos apontam para ela)
// ---------------------------------------------------------------------------

async function atualizarMunicipios() {
  const lista = (await (await baixar(URL_MUNICIPIOS)).json()) as { 'municipio-id': number; 'municipio-nome': string; 'UF-sigla': string }[];
  const agora = dataHoraMysql();
  const linhas = lista.map((m) => [String(m['municipio-id']), m['municipio-nome'].trim(), m['UF-sigla'], agora, agora]);
  if (linhas.length < 5000 || linhas.some(([codigo, , uf]) => !/^\d{7}$/.test(codigo) || !/^[A-Z]{2}$/.test(uf))) {
    throw new Error(`A lista de municípios do IBGE veio incompleta ou fora do formato (${linhas.length} linhas): nada foi gravado.`);
  }

  // Pelo código IBGE (índice único): quem já existe só tem nome e UF atualizados e mantém o id, que é FK do cadastro
  await gravar(
    'municipios',
    false,
    `INSERT INTO cad_cidades (codigo_ibge, nome, uf, criado_em, atualizado_em) VALUES ?
     ON DUPLICATE KEY UPDATE nome = VALUES(nome), uf = VALUES(uf), atualizado_em = VALUES(atualizado_em)`,
    linhas,
  );
  return { total: linhas.length, versao: `IBGE, ${new Set(linhas.map((l) => l[2])).size} UFs` };
}
