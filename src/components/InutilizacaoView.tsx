import React, { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import * as api from '../services/api';
import { Meta } from '../types';
import { Area, Botao, Confirmacao, Secao, Selecao, Texto, Vazio } from './ui';
import { PainelRespostas, useOperacao } from './PainelRespostas';
import { formatarDataHora } from '../utils/formatters';

/** Aba "Inutilização": inutiliza uma faixa de numeração que não será usada */
export const InutilizacaoView: React.FC<{ meta: Meta | null; modeloPadrao: string }> = ({ meta, modeloPadrao }) => {
  const { retorno, erro, errosSchema, carregando, executar, fecharErro } = useOperacao();

  const [ano, setAno] = useState(new Date().getFullYear());
  const [modelo, setModelo] = useState(modeloPadrao);
  const [serie, setSerie] = useState(1);
  const [numeroInicial, setNumeroInicial] = useState<number | ''>('');
  const [numeroFinal, setNumeroFinal] = useState<number | ''>('');
  const [justificativa, setJustificativa] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [historico, setHistorico] = useState<any[]>([]);

  const carregarHistorico = () =>
    api.listarInutilizacoes().then(setHistorico).catch(() => setHistorico([]));
  useEffect(() => { carregarHistorico(); }, []);

  const valido =
    numeroInicial !== '' &&
    numeroFinal !== '' &&
    Number(numeroFinal) >= Number(numeroInicial) &&
    justificativa.trim().length >= 15;

  const inutilizar = async () => {
    setConfirmando(false);
    await executar(() =>
      api.inutilizar({
        ano,
        modelo,
        serie,
        numeroInicial: Number(numeroInicial),
        numeroFinal: Number(numeroFinal),
        justificativa,
      }),
    );
    carregarHistorico();
  };

  return (
    <div className="flex flex-col">
      <Secao
        titulo="Inutilizar numeração"
        descricao="Informe a faixa de números que não será utilizada. A operação é definitiva."
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Texto
            rotulo="Ano"
            type="number"
            required
            min={2006}
            max={2100}
            value={ano}
            onChange={(e) => setAno(Number(e.target.value))}
            className="lg:col-span-2"
          />
          <Selecao
            rotulo="Modelo"
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            opcoes={(meta?.modelos || []).map((m) => ({ valor: m.valor, rotulo: m.rotulo }))}
            className="lg:col-span-3"
          />
          <Texto
            rotulo="Série"
            type="number"
            required
            min={0}
            max={999}
            value={serie}
            onChange={(e) => setSerie(Number(e.target.value))}
            className="lg:col-span-2"
          />
          <Texto
            rotulo="Número inicial"
            type="number"
            required
            min={1}
            value={numeroInicial}
            onChange={(e) => setNumeroInicial(e.target.value === '' ? '' : Number(e.target.value))}
            className="lg:col-span-2"
          />
          <Texto
            rotulo="Número final"
            type="number"
            required
            min={1}
            value={numeroFinal}
            onChange={(e) => setNumeroFinal(e.target.value === '' ? '' : Number(e.target.value))}
            className="lg:col-span-3"
          />
          <Area
            rotulo="Justificativa"
            required
            rows={2}
            maxLength={255}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            dica={`${justificativa.trim().length}/255 — mínimo de 15 caracteres`}
            className="lg:col-span-12"
          />
        </div>

        <div className="flex justify-end pt-4">
          <Botao
            variante="perigo"
            icone={<Ban className="w-3.5 h-3.5" />}
            carregando={carregando}
            disabled={!valido}
            onClick={() => setConfirmando(true)}
          >
            Inutilizar Numeração
          </Botao>
        </div>
      </Secao>

      <PainelRespostas
        retorno={retorno}
        erro={erro} onFecharErro={fecharErro}
        errosSchema={errosSchema}
        carregando={carregando}
        resumo={[
          ['Protocolo', retorno?.dados?.protocolo],
          ['Recebido em', retorno?.dados?.dataRecebimento],
        ]}
      />

      <Secao titulo="Inutilizações registradas">
        {historico.length === 0 ? (
          <Vazio mensagem="Nenhuma numeração inutilizada." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
                  <th className="text-center font-semibold py-2 pr-3">Ano</th>
                  <th className="text-center font-semibold py-2 pr-3">Modelo</th>
                  <th className="text-right font-semibold py-2 pr-3">Série</th>
                  <th className="text-right font-semibold py-2 pr-3">De</th>
                  <th className="text-right font-semibold py-2 pr-3">Até</th>
                  <th className="text-left font-semibold py-2 pr-3">Protocolo</th>
                  <th className="text-center font-semibold py-2 pr-3">Data</th>
                  <th className="text-left font-semibold py-2">Retorno</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {historico.map((i) => (
                  <tr key={i.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/40">
                    <td className="py-2 pr-3 text-center">{i.ano}</td>
                    <td className="py-2 pr-3 text-center">{i.modelo}</td>
                    <td className="py-2 pr-3 text-right">{i.serie}</td>
                    <td className="py-2 pr-3 text-right">{i.numero_inicial}</td>
                    <td className="py-2 pr-3 text-right">{i.numero_final}</td>
                    <td className="py-2 pr-3 font-mono text-[10px]">{i.protocolo || '—'}</td>
                    <td className="py-2 pr-3 text-center">{formatarDataHora(i.criado_em)}</td>
                    <td className="py-2">{i.codigo_status} — {i.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      <Confirmacao
        aberto={confirmando}
        titulo="Inutilizar esta faixa de numeração?"
        mensagem={
          <>
            Os números <strong>{numeroInicial}</strong> a <strong>{numeroFinal}</strong> da série{' '}
            <strong>{serie}</strong> ({modelo}/{ano}) deixarão de poder ser usados. A SEFAZ não desfaz
            uma inutilização.
          </>
        }
        rotuloConfirmar="Inutilizar"
        onConfirmar={inutilizar}
        onCancelar={() => setConfirmando(false)}
      />
    </div>
  );
};
