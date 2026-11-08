import React, { useEffect, useState } from 'react';
import { Hash, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import * as api from '../services/api';
import { Botao, Campo, Confirmacao, Etiqueta, Secao, Selecao, Texto } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { AcaoGrade, ColunaGrade, Grade } from './Grade';
import { NumberField } from './NumberField';
import { Toggle } from './Toggle';

/** formato_impressao é o tpImp do XML */
export const FORMATOS: Record<number, string> = {
  1: 'Retrato',
  2: 'Paisagem',
  3: 'DANFE Simplificado',
  4: 'DANFE NFC-e',
};

const MODELOS = [
  { valor: '55', rotulo: 'NF-e (modelo 55)' },
  { valor: '65', rotulo: 'NFC-e (modelo 65)' },
];

interface Aba {
  chave: string;
  titulo: string;
  registro: api.Serie | null;
}

const COLUNAS: ColunaGrade<api.Serie>[] = [
  { nome: 'modelo', rotulo: 'Modelo', tipo: 'centro', valor: (s) => (s.modelo === '65' ? 'NFC-e (65)' : 'NF-e (55)') },
  { nome: 'serie', rotulo: 'Série', tipo: 'numero', valor: (s) => s.serie },
  { nome: 'descricao', rotulo: 'Descrição', valor: (s) => s.descricao || '—', dica: (s) => s.descricao || undefined },
  { nome: 'formato_impressao', rotulo: 'Formato de impressão', valor: (s) => FORMATOS[s.formato_impressao] || s.formato_impressao },
  {
    nome: 'ativo',
    rotulo: 'Ativa',
    tipo: 'centro',
    valor: (s) =>
      Number(s.ativo) ? (
        <Etiqueta texto="Sim" classe="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" />
      ) : (
        <Etiqueta texto="Não" classe="bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400" />
      ),
  },
];

/**
 * Cadastro de séries. A emissão (Nova NF-e e o concentrador) só aceita série
 * cadastrada e ativa, e o formato da série vai no tpImp e define o DANFE.
 * Cada registro aberto (Novo, Editar, duplo clique) vira uma aba filha com X.
 */
export const SeriesView: React.FC = () => {
  const [abas, setAbas] = useState<Aba[]>([]);
  const [ativa, setAtiva] = useState('lista');
  const [versao, setVersao] = useState(0);
  const [modeloPadrao, setModeloPadrao] = useState<'55' | '65'>('55');
  const [excluindo, setExcluindo] = useState<api.Serie | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  useEffect(() => {
    // O modelo em uso (Configurações › Geral) vem marcado na série nova
    api.seriesAtivas().then((r) => setModeloPadrao(r.modelo === '65' ? '65' : '55')).catch(() => {});
  }, []);


  const abrir = (registro: api.Serie | null) => {
    const chave = registro ? `id:${registro.id}` : 'nova';
    const titulo = registro ? `Série ${registro.serie} (${registro.modelo})` : 'Nova série';
    setAbas((a) => (a.some((x) => x.chave === chave) ? a : [...a, { chave, titulo, registro }]));
    setAtiva(chave);
  };
  const fechar = (chave: string) => {
    setAbas((a) => a.filter((x) => x.chave !== chave));
    setAtiva('lista');
  };

  const excluir = async (s: api.Serie) => {
    setExcluindo(null);
    try {
      await api.excluirSerie(s.id!);
      fechar(`id:${s.id}`);
      setVersao((v) => v + 1);
      setFeito(`Série ${s.serie} excluída.`);
    } catch (e: any) {
      setErro(e.message);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {feito && <AvisoSucesso mensagem={feito} onFechar={() => setFeito(null)} />}

      {abas.length > 0 && (
        <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
          <button
            type="button"
            onClick={() => setAtiva('lista')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors cursor-pointer ${
              ativa === 'lista'
                ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-b-blue-600'
                : 'border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
          >
            <Hash className="w-3.5 h-3.5" />
            <span>Séries</span>
          </button>
          {abas.map((aba) => (
            <div
              key={aba.chave}
              className={`flex items-center gap-1.5 pl-4 pr-2 border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors ${
                ativa === aba.chave
                  ? 'bg-white dark:bg-stone-900 border-b-blue-600'
                  : 'border-b-transparent hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
              }`}
            >
              <button
                type="button"
                onClick={() => setAtiva(aba.chave)}
                className={`flex items-center gap-2 py-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  ativa === aba.chave ? 'text-blue-700 dark:text-blue-400' : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                {aba.registro ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{aba.titulo}</span>
              </button>
              <button
                type="button"
                onClick={() => fechar(aba.chave)}
                title="Fechar aba"
                className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formulários abertos continuam montados: o que foi digitado fica ao trocar de aba */}
      {abas.map((aba) => (
        <div key={aba.chave} className={ativa === aba.chave ? 'flex-1 flex flex-col min-h-0 overflow-y-auto' : 'hidden'}>
          <FormularioSerie
            registro={aba.registro}
            modeloPadrao={modeloPadrao}
            ativa={ativa === aba.chave}
            onErro={setErro}
            onCancelar={() => fechar(aba.chave)}
            onSalvo={(s) => {
              fechar(aba.chave);
              setVersao((v) => v + 1);
              setFeito(`Série ${s.serie} gravada.`);
            }}
          />
        </div>
      ))}

      <div className={ativa === 'lista' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
        <Grade<api.Serie>
          recurso="series"
          colunas={COLUNAS}
          carregarPagina={api.listarSeries}
          chave={(s) => s.id!}
          ordemPadrao={{ campo: 'serie', direcao: 'asc' }}
          recarregar={versao}
          rotuloVazio="Nenhuma série cadastrada: sem série a nota não é emitida"
          onDuploClique={abrir}
          larguraAcoes={72}
          acoes={(s) => (
            <>
              <AcaoGrade titulo="Editar" icone={<Pencil className="w-3.5 h-3.5" />} onClick={() => abrir(s)} />
              <AcaoGrade
                titulo="Excluir (só série sem notas; a que já tem notas é desativada)"
                icone={<Trash2 className="w-3.5 h-3.5" />}
                tom="vermelho"
                onClick={() => setExcluindo(s)}
              />
            </>
          )}
          botoes={
            <Botao variante="primario" icone={<Plus className="w-3.5 h-3.5" />} onClick={() => abrir(null)}>
              Novo
            </Botao>
          }
        />
      </div>

      <Confirmacao
        aberto={!!excluindo}
        titulo="Excluir a série?"
        mensagem={
          <>
            A série <strong>{excluindo?.serie}</strong> do modelo {excluindo?.modelo} sai do cadastro. Série que já tem
            notas não pode ser excluída: desative-a.
          </>
        }
        rotuloConfirmar="Excluir"
        perigo
        onConfirmar={() => excluindo && excluir(excluindo)}
        onCancelar={() => setExcluindo(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Formulário (aba filha)
// ---------------------------------------------------------------------------

const FormularioSerie: React.FC<{
  registro: api.Serie | null;
  modeloPadrao: '55' | '65';
  ativa: boolean;
  onErro: (mensagem: string) => void;
  onCancelar: () => void;
  onSalvo: (s: api.Serie) => void;
}> = ({ registro, modeloPadrao, ativa, onErro, onCancelar, onSalvo }) => {
  const [form, setForm] = useState<api.Serie>(
    () =>
      registro || {
        modelo: modeloPadrao,
        serie: '',
        descricao: '',
        formato_impressao: modeloPadrao === '65' ? 4 : 1,
        ativo: 1,
      },
  );
  const [gravando, setGravando] = useState(false);
  const idFoco = `serie-${registro?.id ?? 'nova'}`;

  // Inclusão: o modelo já vem preenchido, então o foco vai direto para o número da série
  useEffect(() => {
    if (ativa) document.getElementById(idFoco)?.focus();
  }, [ativa, idFoco]);

  const trocarModelo = (modelo: '55' | '65') =>
    setForm((f) => ({ ...f, modelo, formato_impressao: modelo === '65' ? 4 : f.formato_impressao === 4 ? 1 : f.formato_impressao }));

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGravando(true);
    try {
      await api.gravarSerie(form);
      onSalvo(form);
    } catch (err: any) {
      onErro(err.message);
    } finally {
      setGravando(false);
    }
  };

  const nfce = form.modelo === '65';

  return (
    <form onSubmit={salvar}>
      <Secao
        titulo={registro ? `Série ${registro.serie} — ${nfce ? 'NFC-e' : 'NF-e'}` : 'Nova série'}
        descricao="A emissão só aceita série cadastrada e ativa. O formato vai no tpImp do XML e define o DANFE impresso."
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 max-w-4xl">
          <Selecao
            rotulo="Modelo"
            value={form.modelo}
            onChange={(e) => trocarModelo(e.target.value as '55' | '65')}
            opcoes={MODELOS}
            disabled={!!registro}
            dica={registro ? 'Modelo e número não mudam depois de cadastrados' : undefined}
            className="lg:col-span-4"
          />
          <Campo rotulo="Série (0 a 999)" className="lg:col-span-2">
            <NumberField
              id={idFoco}
              value={form.serie}
              onChange={(v) => setForm((f) => ({ ...f, serie: v === '' ? '' : Math.min(999, Number(v)) }))}
              disabled={!!registro}
              required
            />
          </Campo>
          <Texto
            rotulo="Descrição"
            value={form.descricao || ''}
            maxLength={60}
            onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
            className="lg:col-span-6"
          />
          <Selecao
            rotulo="Formato de impressão (DANFE)"
            value={form.formato_impressao}
            onChange={(e) => setForm((f) => ({ ...f, formato_impressao: Number(e.target.value) }))}
            opcoes={
              nfce
                ? [{ valor: 4, rotulo: FORMATOS[4] }]
                : [1, 2, 3].map((v) => ({ valor: v, rotulo: FORMATOS[v] }))
            }
            disabled={nfce}
            dica={nfce ? 'A NFC-e sai sempre no DANFE NFC-e' : 'Simplificado: o DANFE reduzido do MOC (etiqueta/bobina)'}
            className="lg:col-span-6"
          />
          <div className="lg:col-span-6 flex items-end pb-2">
            <Toggle
              checked={!!Number(form.ativo)}
              onChange={(v) => setForm((f) => ({ ...f, ativo: v ? 1 : 0 }))}
              label="Ativa (aparece na emissão)"
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end max-w-4xl pt-4">
          <Botao type="button" onClick={onCancelar}>
            Cancelar
          </Botao>
          <Botao type="submit" variante="primario" icone={<Save className="w-3.5 h-3.5" />} carregando={gravando}>
            Salvar
          </Botao>
        </div>
      </Secao>
    </form>
  );
};
