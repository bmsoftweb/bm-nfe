-- =====================================================================
-- BMNFe — tabelas fiscais oficiais dos combos do ERP (CFOP e NCM)
--
-- Rode uma vez no banco do ERP (o mesmo do BMNFe). Os dados entram pela tela
-- "Tabelas Fiscais" do BMNFe (botão Baixar/Atualizar), direto da fonte oficial:
--   fis_cfop: planilha "Tabela de CFOP" do Portal Nacional da NF-e (Documentos › Diversos);
--   fis_ncm:  Tabela NCM vigente do Portal Único Siscomex, só os códigos de 8 dígitos.
--
-- Reversão: DROP TABLE fis_cfop; DROP TABLE fis_ncm;
-- =====================================================================

CREATE TABLE IF NOT EXISTS fis_cfop (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cfop CHAR(4) NOT NULL,
  titulo VARCHAR(500) NOT NULL,
  descricao TEXT NULL,
  inicio_vigencia DATE NULL,
  fim_vigencia DATE NULL,
  ind_nfe TINYINT(1) NOT NULL DEFAULT 0,         -- pode ser usado na NF-e
  ind_comunica TINYINT(1) NOT NULL DEFAULT 0,    -- serviço de comunicação
  ind_transp TINYINT(1) NOT NULL DEFAULT 0,      -- serviço de transporte
  ind_devol TINYINT(1) NOT NULL DEFAULT 0,       -- devolução
  ind_retor TINYINT(1) NOT NULL DEFAULT 0,       -- retorno
  ind_anula TINYINT(1) NOT NULL DEFAULT 0,       -- anulação
  ind_remes TINYINT(1) NOT NULL DEFAULT 0,       -- remessa
  ind_comb TINYINT NOT NULL DEFAULT 0,           -- combustível (0, 1 ou 2)
  ind_exc_ibscbs TINYINT(1) NOT NULL DEFAULT 0,  -- permitido ao contribuinte exclusivo do IBS/CBS
  criado_em DATETIME NULL,
  atualizado_em DATETIME NULL,
  UNIQUE KEY uk_fis_cfop (cfop)
);

CREATE TABLE IF NOT EXISTS fis_ncm (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ncm CHAR(8) NOT NULL,
  nome VARCHAR(255) NOT NULL,     -- resumo para os combos: níveis de cima encurtados, o último inteiro
  descricao TEXT NOT NULL,        -- completa: posição > subposição > item > subitem
  inicio_vigencia DATE NULL,
  fim_vigencia DATE NULL,
  ato_legal VARCHAR(40) NULL,     -- ato que criou o código (ex.: Res Gecex 272/2021)
  criado_em DATETIME NULL,
  atualizado_em DATETIME NULL,
  UNIQUE KEY uk_fis_ncm (ncm)
);
