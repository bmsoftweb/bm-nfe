import React, { useEffect, useState } from 'react';
import { Download, Inbox } from 'lucide-react';
import * as api from '../services/api';
import { Meta } from '../types';
import { Botao, Secao, Selecao, Texto, Vazio } from './ui';
import { PainelRespostas, useOperacao } from './PainelRespostas';
import { formatarChave, formatarDataHora, formatarMoeda } from '../utils/formatters';

/**
 * Aba "Distribuição DF-e": baixa do Ambiente Nacional os documentos em que a
 * empresa é destinatária, e manifesta-se sobre eles.
 */
export const DistribuicaoView: React.FC<{ meta: Meta | null }> = ({ meta }) => {
  const { retorno, erro, errosSchema, carregando, executar, fecharErro } = useOperacao();

  const [modo, setModo] = useState<'ultNSU' | 'nsu' | 'chave'>('ultNSU');
  const [valor, setValor] = useState('0');
  const [documentos, setDocumentos] = useState<any[]>([]);
  const [manifestando, setManifestando] = useState<string | null>(null);

  const carregarDocumentos = () =>
    api.listarDistribuicao().then(setDocumentos).catch(() => setDocumentos([]));
  useEffect(() => { carregarDocumentos(); }, []);

  const consultar = async () => {
    await executar(() => api.distribuicaoDFe({ [modo]: valor } as any));
    carregarDocumentos();
  };

  const manifestar = async (chave: string, tipoEvento: string) => {
    setManifestando(chave);
    try {
      await executar(() => api.enviarEvento({ chave, tipoEvento }));
      carregarDocumentos();
    } finally {
      setManifestando(null);
    }
  };

  const eventosManifestacao = (meta?.tiposEvento || []).filter((t) => t.grupo === 'manifestacao');

  return (
    <div className="flex flex-col">
      <Secao
        titulo="Distribuição DF-e"
        descricao="Documentos emitidos contra o CNPJ do emitente, no Ambiente Nacional"
      >
        <div className="flex flex-wrap items-end gap-3">
          <Selecao
            rotulo="Consultar por"
            value={modo}
            onChange={(e) => {
              setModo(e.target.value as any);
              setValor(e.target.value === 'chave' ? '' : '0');
            }}
            opcoes={[
              { valor: 'ultNSU', rotulo: 'Último NSU (lote)' },
              { valor: 'nsu', rotulo: 'NSU específico' },
              { valor: 'chave', rotulo: 'Chave de acesso' },
            ]}
            className="w-56"
          />
          <Texto
            rotulo={modo === 'chave' ? 'Chave de acesso' : 'NSU'}
            required
            inputMode="numeric"
            value={valor}
            onChange={(e) => setValor(e.target.value.replace(/\D/g, '').slice(0, modo === 'chave' ? 44 : 15))}
            className="flex-1 min-w-[260px]"
          />
          <Botao
            variante="primario"
            icone={<Download className="w-3.5 h-3.5" />}
            carregando={carregando}
            onClick={consultar}
          >
            Consultar
          </Botao>
        </div>
      </Secao>

      <PainelRespostas
        retorno={retorno}
        erro={erro} onFecharErro={fecharErro}
        errosSchema={errosSchema}
        carregando={carregando}
        resumo={[
          ['Último NSU', retorno?.dados?.ultNSU],
          ['Maior NSU disponível', retorno?.dados?.maxNSU],
          ['Documentos recebidos', retorno?.dados?.documentos?.length],
        ]}
      />

      <Secao titulo="Documentos recebidos" descricao="Os XMLs baixados ficam guardados no banco">
        {documentos.length === 0 ? (
          <Vazio mensagem="Nenhum documento baixado ainda." icone={<Inbox className="w-6 h-6 text-stone-300" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
                  <th className="text-right font-semibold py-2 pr-3">NSU</th>
                  <th className="text-left font-semibold py-2 pr-3">Tipo</th>
                  <th className="text-left font-semibold py-2 pr-3">Chave</th>
                  <th className="text-left font-semibold py-2 pr-3">Emitente</th>
                  <th className="text-right font-semibold py-2 pr-3">Valor</th>
                  <th className="text-center font-semibold py-2 pr-3">Data</th>
                  <th className="text-left font-semibold py-2">Manifestação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {documentos.map((d) => (
                  <tr key={d.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/40">
                    <td className="py-2 pr-3 text-right font-mono">{Number(d.nsu)}</td>
                    <td className="py-2 pr-3">{d.tipo}</td>
                    <td className="py-2 pr-3 font-mono text-[10px]">{d.chave ? formatarChave(d.chave) : '—'}</td>
                    <td className="py-2 pr-3 truncate max-w-[220px]">{d.emitente_nome || '—'}</td>
                    <td className="py-2 pr-3 text-right">{d.valor ? formatarMoeda(d.valor) : '—'}</td>
                    <td className="py-2 pr-3 text-center">{formatarDataHora(d.data_documento)}</td>
                    <td className="py-2">
                      {d.chave ? (
                        <select
                          className="text-[11px] bg-stone-50 dark:bg-stone-800 py-1 px-2 cursor-pointer"
                          disabled={manifestando === d.chave}
                          value=""
                          onChange={(e) => e.target.value && manifestar(d.chave, e.target.value)}
                        >
                          <option value="">Manifestar…</option>
                          {eventosManifestacao.map((t) => (
                            <option key={t.codigo} value={t.codigo}>
                              {t.descricao.replace('Manifestação — ', '')}
                            </option>
                          ))}
                        </select>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </div>
  );
};
