-- =====================================================================
-- BMNFe — preferências das grades por usuário
--
-- Guarda, em JSON, o que cada usuário escolhe nas listas (larguras, ordem das
-- colunas, modo Ajustar/Melhor largura e linhas da grade), no mesmo formato do
-- usuarios.config_listas do b2b admin. Só é gravado em "Salvar Configuração".
--
-- Rode uma vez no banco do BMNFe. Instalações novas já recebem a coluna pelo
-- extras/bmnfe_schema.sql.
-- =====================================================================

ALTER TABLE nfe_usuarios ADD COLUMN config_listas TEXT NULL AFTER cargo;
