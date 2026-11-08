import React, { useEffect, useState } from 'react';
import { Download, Library, Table2, X } from 'lucide-react';
import * as api from '../services/api';
import { Botao, Etiqueta, Secao } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { ColunaGrade, Grade } from './Grade';
import { formatarData, formatarDataHora } from '../utils/formatters';

type NomeTabela = api.SituacaoTabela['nome'];

const TITULOS: Record<string, string> = { cfop: 'CFOP', ncm: 'NCM', municipios: 'Municípios' };
const TITULOS_ABA: Record<NomeTabela, string> = { cfop: 'Tabela de CFOP', ncm: 'Tabela NCM', municipios: 'Tabela de Municípios' };

/**
 * CFOP, NCM e municípios oficiais dos combos do ERP: só são baixados da fonte quando o usuário pede.
 * O Ver abre a grade da tabela numa aba filha; a faixa de abas só aparece com alguma aberta,
 * e o X de cada filha a fecha e volta para a 1ª aba.
 */
export const TabelasView: React.FC = () => {
  const [tabelas, setTabelas] = useState<api.SituacaoTabela[]>([]);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<NomeTabela[]>([]);
  const [ativa, setAtiva] = useState<'tabelas' | NomeTabela>('tabelas');

  const ver = (nome: NomeTabela) => {
    setAbertas((a) => (a.includes(nome) ? a : [...a, nome]));
    setAtiva(nome);
  };
  const fechar = (nome: NomeTabela) => {
    setAbertas((a) => a.filter((n) => n !== nome));
    setAtiva('tabelas');
  };

  const ler = () => api.buscarTabelas().then(setTabelas).catch((e) => setErro(e.message));
  useEffect(() => {
    ler();
  }, []);


  const atualizar = async (nome: NomeTabela) => {
    setBaixando(nome);
    setErro(null);
    try {
      const r = await api.atualizarTabela(nome);
      setFeito(`${TITULOS_ABA[nome]} atualizada: ${r.total.toLocaleString('pt-BR')} códigos (${r.versao}).`);
      await ler();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setBaixando(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {feito && <AvisoSucesso mensagem={feito} onFechar={() => setFeito(null)} />}

      {abertas.length > 0 && (
        <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
          <button
            type="button"
            onClick={() => setAtiva('tabelas')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors cursor-pointer ${
              ativa === 'tabelas'
                ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-b-blue-600'
                : 'border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
          >
            <Library className="w-3.5 h-3.5" />
            <span>Tabelas Fiscais</span>
          </button>
          {abertas.map((nome) => (
            <div
              key={nome}
              className={`flex items-center gap-1.5 pl-4 pr-2 border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors ${
                ativa === nome
                  ? 'bg-white dark:bg-stone-900 border-b-blue-600'
                  : 'border-b-transparent hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
              }`}
            >
              <button
                type="button"
                onClick={() => setAtiva(nome)}
                className={`flex items-center gap-2 py-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  ativa === nome ? 'text-blue-700 dark:text-blue-400' : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>{TITULOS_ABA[nome]}</span>
              </button>
              <button
                type="button"
                onClick={() => fechar(nome)}
                title="Fechar aba"
                className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Abas filhas continuam montadas enquanto abertas: busca, página e rolagem ficam como estavam */}
      {abertas.map((nome) => (
        <div key={nome} className={ativa === nome ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <GradeTabela nome={nome} />
        </div>
      ))}

      <div className={ativa === 'tabelas' ? 'flex flex-col overflow-y-auto' : 'hidden'}>
        {tabelas.map((t) => (
          <Secao
            key={t.nome}
            titulo={`${TITULOS[t.nome]} · ${t.tabela}`}
            descricao={t.fonte}
            acoes={
              <>
                <Botao
                  icone={<Table2 className="w-3.5 h-3.5" />}
                  disabled={!t.total}
                  title={`Abre a tabela de ${TITULOS[t.nome]} numa grade`}
                  onClick={() => ver(t.nome)}
                >
                  Ver
                </Botao>
                <Botao
                  variante="primario"
                  icone={<Download className="w-3.5 h-3.5" />}
                  carregando={baixando === t.nome}
                  disabled={!!baixando || !t.existe}
                  onClick={() => atualizar(t.nome)}
                >
                  {baixando === t.nome ? 'Baixando…' : t.total ? 'Atualizar' : 'Baixar'}
                </Botao>
              </>
            }
          >
            {!t.existe ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                A tabela {t.tabela} não está pronta no banco: rode o {t.sql}.
              </p>
            ) : (
              <p className="text-xs text-stone-600 dark:text-stone-300">
                {t.total
                  ? `${t.total.toLocaleString('pt-BR')} códigos, atualizada em ${formatarDataHora(t.atualizadoEm)}.`
                  : 'Vazia: clique em Baixar.'}
              </p>
            )}
          </Secao>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Grade de cada tabela (aba filha, aberta pelo Ver)
// ---------------------------------------------------------------------------

interface LinhaCfop {
  id: number;
  cfop: string;
  titulo: string;
  descricao: string | null;
  inicio_vigencia: string | null;
  fim_vigencia: string | null;
  /** ind_nfe, ind_devol…: 0 ou 1; ind_comb: 0, 1 ou 2 */
  [indicador: string]: string | number | null;
}

interface LinhaNcm {
  id: number;
  ncm: string;
  nome: string;
  descricao: string;
  inicio_vigencia: string | null;
  fim_vigencia: string | null;
  ato_legal: string | null;
}

const simNao = (v: unknown) =>
  Number(v) ? (
    <Etiqueta texto="Sim" classe="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" />
  ) : (
    <Etiqueta texto="Não" classe="bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400" />
  );

const INDICADORES_CFOP: [string, string][] = [
  ['ind_nfe', 'NF-e'],
  ['ind_comunica', 'Comunicação'],
  ['ind_transp', 'Transporte'],
  ['ind_devol', 'Devolução'],
  ['ind_retor', 'Retorno'],
  ['ind_anula', 'Anulação'],
  ['ind_remes', 'Remessa'],
  ['ind_exc_ibscbs', 'Exclusivo IBS/CBS'],
];

const COLUNAS_CFOP: ColunaGrade<LinhaCfop>[] = [
  { nome: 'cfop', rotulo: 'CFOP', valor: (l) => l.cfop },
  { nome: 'titulo', rotulo: 'Título', valor: (l) => l.titulo, dica: (l) => l.descricao || l.titulo },
  { nome: 'inicio_vigencia', rotulo: 'Início vigência', tipo: 'data', valor: (l) => formatarData(l.inicio_vigencia) },
  { nome: 'fim_vigencia', rotulo: 'Fim vigência', tipo: 'data', valor: (l) => formatarData(l.fim_vigencia) },
  ...INDICADORES_CFOP.map(([nome, rotulo]): ColunaGrade<LinhaCfop> => ({ nome, rotulo, tipo: 'centro', valor: (l) => simNao(l[nome]) })),
  { nome: 'ind_comb', rotulo: 'Combustível', tipo: 'numero', valor: (l) => l.ind_comb },
];

const COLUNAS_NCM: ColunaGrade<LinhaNcm>[] = [
  { nome: 'ncm', rotulo: 'NCM', valor: (l) => `${l.ncm.slice(0, 4)}.${l.ncm.slice(4, 6)}.${l.ncm.slice(6)}` },
  { nome: 'nome', rotulo: 'Nome (combos)', valor: (l) => l.nome, dica: (l) => l.nome },
  { nome: 'descricao', rotulo: 'Descrição completa', valor: (l) => l.descricao, dica: (l) => l.descricao },
  { nome: 'inicio_vigencia', rotulo: 'Início vigência', tipo: 'data', valor: (l) => formatarData(l.inicio_vigencia) },
  { nome: 'fim_vigencia', rotulo: 'Fim vigência', tipo: 'data', valor: (l) => formatarData(l.fim_vigencia) },
  { nome: 'ato_legal', rotulo: 'Ato legal', valor: (l) => l.ato_legal || '—' },
];

interface LinhaMunicipio {
  id: number;
  codigo_ibge: string;
  nome: string;
  uf: string;
}

const COLUNAS_MUNICIPIOS: ColunaGrade<LinhaMunicipio>[] = [
  { nome: 'codigo_ibge', rotulo: 'Código IBGE', valor: (l) => l.codigo_ibge },
  { nome: 'nome', rotulo: 'Município', valor: (l) => l.nome },
  { nome: 'uf', rotulo: 'UF', tipo: 'centro', valor: (l) => l.uf },
];

/** A tabela de CFOP, NCM ou municípios gravada no banco, na grade padrão (só leitura) */
const GradeTabela: React.FC<{ nome: NomeTabela }> = ({ nome }) => (
  <div className="flex-1 flex flex-col min-h-0">
    {nome === 'municipios' ? (
      <Grade<LinhaMunicipio>
        recurso="tabela_municipios"
        colunas={COLUNAS_MUNICIPIOS}
        carregarPagina={api.listarMunicipios}
        chave={(l) => l.id}
        ordemPadrao={{ campo: 'codigo_ibge', direcao: 'asc' }}
        rotuloVazio="Nenhum município encontrado"
      />
    ) : nome === 'cfop' ? (
      <Grade<LinhaCfop>
        recurso="tabela_cfop"
        colunas={COLUNAS_CFOP}
        carregarPagina={api.listarCfop}
        chave={(l) => l.id}
        ordemPadrao={{ campo: 'cfop', direcao: 'asc' }}
        rotuloVazio="Nenhum CFOP encontrado"
      />
    ) : (
      <Grade<LinhaNcm>
        recurso="tabela_ncm"
        colunas={COLUNAS_NCM}
        carregarPagina={api.listarNcm}
        chave={(l) => l.id}
        ordemPadrao={{ campo: 'ncm', direcao: 'asc' }}
        rotuloVazio="Nenhum NCM encontrado"
      />
    )}
  </div>
);
