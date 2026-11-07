-- =====================================================================
-- BMNFe — municípios do IBGE na cad_cidades do ERP
--
-- A tela "Tabelas Fiscais" do BMNFe preenche a cad_cidades com a API de
-- Localidades do IBGE (botão Baixar/Atualizar). A carga usa o índice único
-- que a tabela já tem (uq_cidade_ibge, em codigo_ibge): o município que já
-- existe só tem nome e UF atualizados e mantém o id, que é FK de
-- cad_pessoas.cidade_id e cad_pessoas_enderecos.cidade_id.
--
-- Faltam só as colunas de auditoria, que mostram na tela quando a lista
-- foi atualizada. Rode uma vez no banco do ERP.
--
-- Reversão: ALTER TABLE cad_cidades DROP COLUMN criado_em, DROP COLUMN atualizado_em;
-- =====================================================================

ALTER TABLE cad_cidades
  ADD COLUMN criado_em DATETIME NULL,
  ADD COLUMN atualizado_em DATETIME NULL;
