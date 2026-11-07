import React, { useEffect, useState } from 'react';
import { Download, Table2 } from 'lucide-react';
import * as api from '../services/api';
import { Botao, Etiqueta, Secao } from './ui';
import { AvisoErro, NoCanto } from './AvisoErro';
import { ColunaGrade, Grade } from './Grade';
import { formatarData, formatarDataHora } from '../utils/formatters';

const TITULOS: Record<string, string> = { cfop: 'CFOP', ncm: 'NCM' };

/** CFOP e NCM oficiais dos combos do ERP: só são baixados da fonte quando o usuário pede */
export const TabelasView: React.FC<{ onVer: (nome: 'cfop' | 'ncm') => void }> = ({ onVer }) => {
  const [tabelas, setTabelas] = useState<api.SituacaoTabela[]>([]);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const ler = () => api.buscarTabelas().then(setTabelas).catch((e) => setErro(e.message));
  useEffect(() => {
    ler();
  }, []);

  useEffect(() => {
    if (!feito) return;
    const t = setTimeout(() => setFeito(null), 6000);
    return () => clearTimeout(t);
  }, [feito]);

  const atualizar = async (nome: string) => {
    setBaixando(nome);
    setErro(null);
    try {
      const r = await api.atualizarTabela(nome);
      setFeito(`${TITULOS[nome]} atualizada: ${r.total.toLocaleString('pt-BR')} códigos (${r.versao}).`);
      await ler();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setBaixando(null);
    }
  };

  return (
    <div className="flex flex-col">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {feito && (
        <NoCanto>
          <div className="pointer-events-auto bg-stone-900 text-white text-xs font-semibold py-3 px-4 rounded-xl shadow-2xl border border-stone-800 flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span>{feito}</span>
          </div>
        </NoCanto>
      )}

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
                onClick={() => onVer(t.nome)}
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
              A tabela {t.tabela} não existe no banco: rode o extras/2026-11-07_tabelas_fiscais.sql.
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
  );
};

// ---------------------------------------------------------------------------
// Grade de cada tabela (aba fora do menu, aberta pelo Ver)
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

/** A tabela de CFOP ou NCM gravada no banco, na grade padrão (só leitura) */
export const TabelaFiscalView: React.FC<{ nome: 'cfop' | 'ncm' }> = ({ nome }) => (
  <div className="flex-1 flex flex-col min-h-0">
    {nome === 'cfop' ? (
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
