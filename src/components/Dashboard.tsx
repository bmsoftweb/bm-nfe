import React from 'react';
import {
  AlertTriangle, Ban, CheckCircle2, FileText, Inbox, ShieldAlert, ShieldCheck, TrendingUp, XCircle,
} from 'lucide-react';
import { Painel, StatusBanco } from '../types';
import { Etiqueta, Secao, Vazio } from './ui';
import { AMBIENTES, SITUACOES, formatarDataHora, formatarMoeda } from '../utils/formatters';

const Indicador: React.FC<{
  rotulo: string;
  valor: string | number;
  icone: React.ReactNode;
  cor: string;
  onClick?: () => void;
}> = ({ rotulo, valor, icone, cor, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className="text-left bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4
      flex items-center gap-3 enabled:hover:border-blue-300 dark:enabled:hover:border-blue-800 transition-colors
      enabled:cursor-pointer disabled:cursor-default"
  >
    <div className={`p-2.5 rounded-xl ${cor}`}>{icone}</div>
    <div className="min-w-0">
      <div className="text-lg font-bold text-stone-800 dark:text-stone-100 leading-tight">{valor}</div>
      <div className="text-[11px] text-stone-500 dark:text-stone-400">{rotulo}</div>
    </div>
  </button>
);

export const Dashboard: React.FC<{
  painel: Painel | null;
  statusBanco: StatusBanco | null;
  onNavegar: (aba: string) => void;
}> = ({ painel, statusBanco, onNavegar }) => {
  if (statusBanco && statusBanco.tabelasFaltando.length > 0) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 dark:text-amber-200">
            <p className="font-bold mb-1">O banco ainda não tem as tabelas do BMNFe.</p>
            <p>
              Rode <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 rounded">extras/bmnfe_schema.sql</code> no
              banco <strong>{statusBanco.database}</strong>. Faltam:{' '}
              {statusBanco.tabelasFaltando.join(', ')}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!painel) {
    return <div className="py-16 text-center text-xs text-stone-500">Carregando os indicadores…</div>;
  }

  const c = painel.contagens || {};
  const certificado = painel.certificado || {};

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Indicador
          rotulo="Documentos"
          valor={c.documentos ?? 0}
          icone={<FileText className="w-5 h-5 text-blue-600" />}
          cor="bg-blue-50 dark:bg-blue-950/40"
          onClick={() => onNavegar('documentos')}
        />
        <Indicador
          rotulo="Autorizadas"
          valor={c.autorizadas ?? 0}
          icone={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          cor="bg-emerald-50 dark:bg-emerald-950/40"
          onClick={() => onNavegar('documentos')}
        />
        <Indicador
          rotulo="Rejeitadas"
          valor={c.rejeitadas ?? 0}
          icone={<XCircle className="w-5 h-5 text-red-600" />}
          cor="bg-red-50 dark:bg-red-950/40"
          onClick={() => onNavegar('documentos')}
        />
        <Indicador
          rotulo="Valor autorizado"
          valor={formatarMoeda(c.valor_autorizado)}
          icone={<TrendingUp className="w-5 h-5 text-stone-600 dark:text-stone-300" />}
          cor="bg-stone-100 dark:bg-stone-800"
        />

        <Indicador
          rotulo="Canceladas"
          valor={c.canceladas ?? 0}
          icone={<Ban className="w-5 h-5 text-stone-600 dark:text-stone-300" />}
          cor="bg-stone-100 dark:bg-stone-800"
          onClick={() => onNavegar('eventos')}
        />
        <Indicador
          rotulo="Eventos"
          valor={c.eventos ?? 0}
          icone={<CheckCircle2 className="w-5 h-5 text-sky-600" />}
          cor="bg-sky-50 dark:bg-sky-950/40"
          onClick={() => onNavegar('eventos')}
        />
        <Indicador
          rotulo="Inutilizações"
          valor={c.inutilizacoes ?? 0}
          icone={<Ban className="w-5 h-5 text-amber-600" />}
          cor="bg-amber-50 dark:bg-amber-950/40"
          onClick={() => onNavegar('inutilizacao')}
        />
        <Indicador
          rotulo="Recebidos (DF-e)"
          valor={c.distribuidos ?? 0}
          icone={<Inbox className="w-5 h-5 text-indigo-600" />}
          cor="bg-indigo-50 dark:bg-indigo-950/40"
          onClick={() => onNavegar('distribuicao')}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <Secao titulo="Últimos documentos" variante="cartao">
            {painel.ultimos.length === 0 ? (
              <Vazio mensagem="Nenhuma nota emitida ainda." />
            ) : (
              <table className="w-full text-xs">
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {painel.ultimos.map((d) => {
                    const s = SITUACOES[d.situacao] || SITUACOES.rascunho;
                    return (
                      <tr key={d.chave}>
                        <td className="py-2 pr-3 text-right font-semibold w-16">{d.numero}</td>
                        <td className="py-2 pr-3 text-center whitespace-nowrap w-28">
                          {formatarDataHora(d.data_emissao)}
                        </td>
                        <td className="py-2 pr-3 truncate max-w-[200px]">{d.destinatario_nome || '—'}</td>
                        <td className="py-2 pr-3 text-right">{formatarMoeda(d.valor_total)}</td>
                        <td className="py-2 text-center w-28">
                          <Etiqueta texto={s.rotulo} classe={s.classe} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Secao>
        </div>

        <div className="flex flex-col gap-4">
          <Secao titulo="Situação do certificado" variante="cartao">
            {certificado.erro ? (
              <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />
                <span>{certificado.erro}</span>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <ShieldCheck
                  className={`w-5 h-5 shrink-0 ${
                    (certificado.diasParaVencer ?? 0) <= 30 ? 'text-amber-500' : 'text-emerald-500'
                  }`}
                />
                <div className="text-xs">
                  <div className="font-semibold text-stone-800 dark:text-stone-100">{certificado.razaoSocial}</div>
                  <div className="text-stone-500 dark:text-stone-400">
                    Vence em {certificado.diasParaVencer} dia(s) —{' '}
                    {formatarDataHora(certificado.validoAte as any).slice(0, 10)}
                  </div>
                </div>
              </div>
            )}

            <dl className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800 text-xs grid grid-cols-2 gap-y-1.5">
              <dt className="text-stone-500">Ambiente</dt>
              <dd className="text-right font-semibold">{AMBIENTES[painel.ambiente]}</dd>
              <dt className="text-stone-500">UF</dt>
              <dd className="text-right font-semibold">{painel.uf}</dd>
              <dt className="text-stone-500">Modelo</dt>
              <dd className="text-right font-semibold">{painel.modelo === '65' ? 'NFC-e' : 'NF-e'}</dd>
            </dl>
          </Secao>

          <Secao titulo="Últimas falhas" variante="cartao">
            {painel.erros.length === 0 ? (
              <Vazio mensagem="Nenhuma falha registrada." />
            ) : (
              <ul className="flex flex-col gap-2 text-xs">
                {painel.erros.map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-semibold text-stone-700 dark:text-stone-200">{e.operacao}</div>
                      <div className="text-stone-500 dark:text-stone-400 break-words">
                        {e.codigo_status ? `${e.codigo_status} — ` : ''}{e.motivo}
                      </div>
                      <div className="text-[10px] text-stone-400">{formatarDataHora(e.criado_em)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </div>
      </div>
    </div>
  );
};
