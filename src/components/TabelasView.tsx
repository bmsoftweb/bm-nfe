import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import * as api from '../services/api';
import { Botao, Secao } from './ui';
import { AvisoErro, NoCanto } from './AvisoErro';
import { formatarDataHora } from '../utils/formatters';

const TITULOS: Record<string, string> = { cfop: 'CFOP', ncm: 'NCM' };

/** CFOP e NCM oficiais dos combos do ERP: só são baixados da fonte quando o usuário pede */
export const TabelasView: React.FC = () => {
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
            <Botao
              variante="primario"
              icone={<Download className="w-3.5 h-3.5" />}
              carregando={baixando === t.nome}
              disabled={!!baixando || !t.existe}
              onClick={() => atualizar(t.nome)}
            >
              {baixando === t.nome ? 'Baixando…' : t.total ? 'Atualizar' : 'Baixar'}
            </Botao>
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
