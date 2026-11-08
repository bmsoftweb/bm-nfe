# BMNFe como concentrador de NF-e: plano

Objetivo: outros módulos do ERP (PDV, pedidos, faturamento, Delphi ou web)
mandam os dados da nota e o BMNFe numera, gera, assina, transmite e devolve o
resultado, sem nota duplicada e sem número repetido.

Este plano cobre as fases 1 e 2, que são as que geram duplicidade na SEFAZ.
As fases 3 a 6 estão resumidas no fim.

---

## Fase 1 — Numeração atômica

### Problema hoje

O número vem de quem chama. A sugestão da tela (`GET /proximo-numero`) é
`MAX(numero) + 1` em `nfe_documentos`: dois módulos que pedem ao mesmo tempo
recebem o mesmo número, e a segunda nota volta com a rejeição 539 (duplicidade
de NF-e com diferença na chave). Nada no banco impede duas linhas com o mesmo
número.

### Solução

Um contador por empresa + modelo + série + ambiente, incrementado com o padrão
`LAST_INSERT_ID(expr)` do MySQL: um único comando que sobe o contador e devolve
o valor à própria conexão. Duas reservas simultâneas nunca recebem o mesmo
número, e não é preciso abrir transação nem travar linha.

```sql
-- Reserva o próximo número. ? = empresa, modelo, serie, ambiente, numero_inicial
INSERT INTO nfe_numeracao (empresa_id, modelo, serie, ambiente, ultimo_numero)
VALUES (?, ?, ?, ?, LAST_INSERT_ID(?))
ON DUPLICATE KEY UPDATE ultimo_numero = LAST_INSERT_ID(ultimo_numero + 1);

SELECT LAST_INSERT_ID() AS numero;   -- mesma conexão do INSERT
```

`numero_inicial` só vale na primeira reserva da série: é o maior número já
usado (em `nfe_documentos` e em `nfe_inutilizacoes.numero_final`) + 1. Se duas
primeiras reservas correrem juntas, uma insere e a outra cai no
`ON DUPLICATE KEY` e recebe o seguinte. Não há janela de corrida.

### Regras

| Situação | O que acontece com o contador |
|---|---|
| Módulo não manda `ide.numero` | Reserva o próximo (acima) |
| Tela manda um número digitado | Grava a nota e faz `ultimo_numero = GREATEST(ultimo_numero, numero)` |
| Inutilização autorizada | `ultimo_numero = GREATEST(ultimo_numero, numero_final)` |
| `GET /proximo-numero` (sugestão da tela) | Só lê: `ultimo_numero + 1`, sem reservar |

O número reservado fica preso à referência da Fase 2: se a nota falhar na
validação, a nova tentativa com a mesma referência reusa o mesmo número, e não
sobra buraco na série. Só fica buraco se o módulo abandonar a referência; esses
casos aparecem numa lista "números a inutilizar" (rascunhos parados há mais de
N dias).

### Rede de segurança no banco

Um índice único em `(empresa_id, modelo, serie, ambiente, numero)` faz o próprio
MySQL recusar o segundo registro com o mesmo número, mesmo que algum caminho do
código escape do contador. O índice atual `ix_nfe_documentos_numero` vira único.

Antes de criar, conferir se a base já tem repetidos (notas de teste, "Novo
(copiar)" com o mesmo número etc.):

```sql
SELECT empresa_id, modelo, serie, ambiente, numero, COUNT(*) AS vezes
  FROM nfe_documentos
 GROUP BY empresa_id, modelo, serie, ambiente, numero
HAVING COUNT(*) > 1;
```

Se houver, decidir caso a caso (normalmente apagar rascunhos e rejeitadas
antigas) antes do `ALTER`.

---

## Fase 2 — Idempotência por referência

### Problema hoje

Se o módulo manda a nota e a resposta se perde (timeout, queda de rede), ele
não sabe se a nota saiu. Reenviando, nasce outra linha, com outra chave, e
possivelmente uma segunda nota autorizada para a mesma venda.

### Solução

Cada módulo manda uma **referência própria**, única por empresa, prefixada pelo
módulo: `PDV-000123`, `PEDIDO-45678`, `OS-2026-0091`. O concentrador guarda a
referência em `nfe_documentos.referencia` com índice único. Mandar a mesma
referência de novo nunca cria outra nota: devolve ou continua a que existe.

### Rota nova: `POST /api/emitir`

Faz tudo numa chamada: reserva número, gera, assina, valida no XSD, transmite e
responde.

```json
{
  "referencia": "PDV-000123",
  "documento": { "ide": { "...": "sem numero: o concentrador numera" }, "itens": [] },
  "sincrono": true
}
```

Resposta (igual para a primeira chamada e para as repetidas):

```json
{
  "referencia": "PDV-000123",
  "situacao": "autorizada",
  "chave": "3526...",
  "numero": 1234, "serie": 1,
  "protocolo": "135260000000001",
  "cStat": 100, "motivo": "Autorizado o uso da NF-e",
  "xml": "<nfeProc>...</nfeProc>",
  "repetida": false
}
```

A `ide.serie` precisa estar cadastrada e ativa na tela Séries (tabela
`nfe_series`, script `extras/2026-11-07_series.sql`); fora disso a chamada é
recusada antes de reservar número. O formato do DANFE da série (retrato,
paisagem ou simplificado) vai no `tpImp` do XML.

`GET /api/emitir/PDV-000123` devolve a mesma resposta, sem transmitir nada: é
como o módulo descobre o resultado depois de um timeout.

Com `"transmitir": false` a rota numera, gera, assina e valida, mas para antes da
SEFAZ: a nota fica `assinada` (pronta para o Enviar da tela de envios) e a resposta
traz também `totais` (vProd, vNF, vICMS, vPIS, vCOFINS, vIBSUF, vIBSMun, vCBS…).
Chamar de novo com a mesma referência gera outra vez com o mesmo número. É o que
usa o "Gerar NFe" do romaneioLamina (referência `ROM-000123`).

### O que a rota faz com cada situação da referência

| Situação encontrada | Ação |
|---|---|
| Não existe | Reserva número, grava `rascunho` com a referência, segue o fluxo |
| `rascunho`, `assinada`, `rejeitada` | Gera de novo com os dados recebidos e o **mesmo número**, transmite |
| `processando` há menos de 2 min | 409 "em processamento": o módulo consulta pelo GET depois |
| `processando` há mais de 2 min, ou `enviada` | **Consulta a chave na SEFAZ antes de qualquer coisa**: se autorizou, grava e devolve; se não existe lá, gera de novo e transmite |
| `autorizada` | Devolve a nota (`repetida: true`), sem transmitir |
| `cancelada`, `denegada` | 409: a referência já foi usada; o módulo precisa de outra |

A referência gravada antes de transmitir é o que fecha a corrida: o `INSERT`
com índice único só passa para uma das chamadas simultâneas; a outra relê a
linha e cai na tabela acima.

A passagem para `processando` é atômica:

```sql
UPDATE nfe_documentos SET situacao = 'processando'
 WHERE id = ? AND situacao IN ('rascunho', 'assinada', 'rejeitada');
-- affectedRows = 0  →  outra chamada pegou a nota primeiro
```

Se o processo cair no meio da transmissão, a linha fica `processando`. Depois de
2 minutos ela é tratada como `enviada` (consulta pela chave), então não trava
para sempre.

### Por que consultar antes de regenerar

Ao gerar de novo, o código numérico da chave muda. Se a primeira tentativa
tiver sido autorizada sem que a resposta chegasse, a segunda volta com a rejeição
539, e a nota autorizada fica sem dono no banco. Consultando a chave antiga
antes, a nota autorizada é recuperada e devolvida.

---

## Banco de dados (você cria)

```sql
-- Fase 1: contador de numeração
CREATE TABLE nfe_numeracao (
  empresa_id     INT UNSIGNED NOT NULL,
  modelo         CHAR(2)      NOT NULL,
  serie          INT          NOT NULL,
  ambiente       TINYINT      NOT NULL,
  ultimo_numero  INT          NOT NULL,
  atualizado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, modelo, serie, ambiente),
  CONSTRAINT fk_nfe_numeracao_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fase 1: número único por série (rodar a conferência de repetidos antes)
ALTER TABLE nfe_documentos
  DROP INDEX ix_nfe_documentos_numero,
  ADD UNIQUE KEY uq_nfe_documentos_numero (empresa_id, modelo, serie, ambiente, numero);

-- Fase 2: referência do módulo de origem
ALTER TABLE nfe_documentos
  ADD COLUMN referencia VARCHAR(80) NULL AFTER empresa_id,
  ADD UNIQUE KEY uq_nfe_documentos_referencia (empresa_id, referencia);
```

Notas fiscais da tela continuam com `referencia` nula (o MySQL aceita vários
nulos no índice único). A situação nova `processando` cabe no `VARCHAR(20)`
atual, sem mudar a coluna.

Reversão:

```sql
ALTER TABLE nfe_documentos
  DROP INDEX uq_nfe_documentos_referencia,
  DROP COLUMN referencia;

ALTER TABLE nfe_documentos
  DROP INDEX uq_nfe_documentos_numero,
  ADD KEY ix_nfe_documentos_numero (empresa_id, modelo, serie, numero);

DROP TABLE nfe_numeracao;
```

---

## Ordem de implementação

1. **Contador** em `server/nfe/numeracao.ts`: `reservarNumero`, `acompanharNumero`
   (o `GREATEST`) e `proximoNumero` (só leitura). Ligar no `/gerar` da tela, na
   inutilização e no `/proximo-numero`. A tela continua igual para o usuário.
2. **`POST /api/emitir` e `GET /api/emitir/:referencia`** em `server/rotas/emitir.ts`,
   reaproveitando `gerarNFe`, `assinar`, `validarNFe`, `autorizar` e
   `consultarChave` sem mudar nenhum deles.
3. **A decisão da tabela de situações** como uma função pura
   (`decidir(situacao, idadeMs) → ação`) com teste no autoteste: é a parte que,
   se errar, gera nota duplicada.
4. **Teste em homologação**: um script dispara 20 `POST /api/emitir` simultâneos
   (referências diferentes) e confere 20 números distintos e seguidos; depois 5
   simultâneos com a **mesma** referência e confere uma nota só.
5. **Lista de buracos**: rascunhos com referência parados há mais de N dias, para
   inutilizar.

Até a Fase 3 existir, os módulos usam o login atual (token de 12 h) para chamar
a rota.

---

## Fases seguintes (resumo)

3. **Chave de API por módulo**: credencial sem prazo, revogável, com o nome do
   módulo gravado em cada nota. Tabela `nfe_chaves_api` (você cria).
4. **Rota única completa**: devolver também o DANFE (PDF) e enviar o e-mail ao
   destinatário quando configurado.
5. **Fila por certificado**: uma transmissão por vez por empresa, para não levar
   a rejeição 656 (consumo indevido) quando vários módulos disparam juntos.
6. **Aviso ao módulo**: além do GET por referência, opcionalmente chamar uma URL
   do módulo (webhook) quando a nota for autorizada ou rejeitada.

**Hospedagem:** o concentrador deve rodar como servidor Node contínuo, não como
função serverless da Vercel. Fila, reconsulta de notas `processando` e cache do
certificado dependem de um processo vivo.

## Decisões que ficam com você

- Prefixo e formato das referências de cada módulo (até 80 caracteres).
- Em quantos dias um rascunho parado entra na lista de números a inutilizar.
- Se a Fase 2 aceita também XML pronto (gerado pelo ACBr no Delphi) além do
  JSON. O plano assume JSON, que deixa a regra fiscal num lugar só.
