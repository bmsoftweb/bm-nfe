import React, { useState } from 'react';
import { FileCheck2, LogIn, TriangleAlert } from 'lucide-react';
import { Emitente, Usuario } from '../types';
import { entrar } from '../services/api';
import { INPUT_CLASS_LG, LABEL_CLASS } from '../utils/formStyles';
import { ThemeToggle } from './ThemeToggle';
import { ThemeMode } from '../utils/theme';
import { Toggle } from './Toggle';
import { lerLembrete, limparLembrete, salvarLembrete } from '../utils/session';
import { formatarCnpj } from '../utils/formatters';

interface LoginViewProps {
  tema: ThemeMode;
  onAlternarTema: () => void;
  avisoInicial?: string | null;
  onEntrou: (usuario: Usuario, empresa: Emitente, token: string, lembrar: boolean) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ tema, onAlternarTema, avisoInicial, onEntrou }) => {
  const lembrete = lerLembrete();

  const [cnpj, setCnpj] = useState(lembrete ? formatarCnpj(lembrete.cnpj) : '');
  const [usuario, setUsuario] = useState(lembrete?.usuario || '');
  const [senha, setSenha] = useState('');
  const [lembrar, setLembrar] = useState(!!lembrete);
  const [erro, setErro] = useState<string | null>(avisoInicial || null);
  const [enviando, setEnviando] = useState(false);

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const cnpjLimpo = cnpj.replace(/\D/g, '');
      const resposta = await entrar(cnpjLimpo, usuario, senha);

      if (lembrar) salvarLembrete({ cnpj: cnpjLimpo, usuario });
      else limparLembrete();

      onEntrou(resposta.usuario, resposta.empresa, resposta.token, lembrar);
    } catch (err: any) {
      setErro(err.message || 'Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100/70 dark:bg-stone-950 flex items-center justify-center p-4 font-sans antialiased">
      <div className="absolute top-4 right-4">
        <ThemeToggle theme={tema} onToggle={onAlternarTema} variant="login" />
      </div>

      <form
        onSubmit={submeter}
        className="w-full max-w-sm bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800
          rounded-2xl shadow-xl p-6 flex flex-col gap-4"
      >
        <div className="flex flex-col items-center gap-2 mb-2">
          <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/40">
            <FileCheck2 className="w-7 h-7 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-lg font-bold text-stone-800 dark:text-stone-100">BMNFe</h1>
          <p className="text-xs text-stone-500 dark:text-stone-400 text-center">
            Emissão, consulta e eventos de NF-e e NFC-e
          </p>
        </div>

        {erro && (
          <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl p-3">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-px" />
            <span>{erro}</span>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="login-cnpj">CNPJ do emitente</label>
          <input
            id="login-cnpj"
            required
            autoFocus
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            value={cnpj}
            onChange={(e) => setCnpj(formatarCnpj(e.target.value.replace(/\D/g, '').slice(0, 14)) || e.target.value)}
            className={`${INPUT_CLASS_LG} w-full`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="login-usuario">Usuário ou e-mail</label>
          <input
            id="login-usuario"
            required
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            className={`${INPUT_CLASS_LG} w-full`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="login-senha">Senha</label>
          <input
            id="login-senha"
            type="password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className={`${INPUT_CLASS_LG} w-full`}
          />
        </div>

        <Toggle checked={lembrar} onChange={setLembrar} label="Lembrar neste dispositivo" size="sm" />

        <button
          type="submit"
          disabled={enviando}
          className="mt-1 h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700
            text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-60"
        >
          <LogIn className="w-4 h-4" />
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
};
