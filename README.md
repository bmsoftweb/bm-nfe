# BMNFe

Conversão do projeto Delphi **ACBrNFe_Exemplo.dpr** (`ACBr/Exemplos/ACBrDFe/ACBrNFe/Delphi`)
para o layout, o padrão e a pilha do **b2b admin**: React 19 + Vite + Tailwind 4 no
front, Express + MySQL no back, tudo em TypeScript.

Não há DLL, ACBrMonitor nem executável externo: a emissão inteira — leitura do
certificado A1, assinatura XMLDSig, TLS mútuo, SOAP, DANFE e e-mail — roda dentro do
Node. Os fontes do ACBr entram como **referência**, não como dependência: o arquivo
de endereços dos webservices (`recursos/ACBrNFeServicos.ini`) e os schemas
(`recursos/Schemas`) são copiados de lá e podem ser atualizados a cada release do ACBr.

## Como rodar

```bash
npm install
```

1. Crie o banco e rode [`extras/bmnfe_schema.sql`](extras/bmnfe_schema.sql).
   O aplicativo nunca cria tabelas sozinho.
2. Copie `.env.example` para `.env` e preencha o acesso ao MySQL.
3. Cadastre uma linha em `nfe_empresas` (o emitente) e uma em `nfe_usuarios`
   (o login; a senha pode entrar em texto puro e é reescrita em bcrypt no primeiro acesso).

```bash
npm run dev
```

Sobe em <http://localhost:3000>. Para mudar a porta, defina `PORT`.

Build de produção (servidor próprio, Express dando `listen`):

```bash
npm run build:node
npm start
```

## Deploy na Vercel

O app é servido em duas metades, como no estoqueWeb:

- o front é estático, gerado por `npm run build` em `dist/`;
- as rotas `/api/*` são uma função serverless: [`api/index.ts`](api/index.ts) exporta o
  mesmo app Express montado em [`server/app.ts`](server/app.ts), e o
  [`vercel.json`](vercel.json) reescreve `/api/:path*` para ela.

Por isso `server/app.ts` só monta as rotas — quem dá `listen` e acrescenta o Vite é o
`server.ts`, usado apenas na execução local.

Dois detalhes que o deploy exige:

- **`includeFiles: "recursos/**"`** no `vercel.json`. Os endereços da SEFAZ e as raízes
  de certificação são lidos do disco, e arquivos que ninguém importa não entram no
  pacote da função sozinhos. [`server/nfe/recursos.ts`](server/nfe/recursos.ts) procura
  a pasta tanto pelo diretório de trabalho quanto a partir do próprio módulo, que é o
  único ponto de referência garantido em `/var/task`.
- **Imports relativos com `.js`** em todo o código de servidor. Em produção o módulo
  roda como ESM de verdade, onde o especificador sem extensão não resolve.

Variáveis de ambiente a definir no projeto da Vercel (Settings › Environment Variables),
as mesmas do `.env`: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`,
`MYSQL_DATABASE` e `SESSION_SECRET`. O MySQL precisa aceitar conexão vinda de fora.
Use um `SESSION_SECRET` **diferente** do local: o token de um ambiente não deve valer
no outro. Faltando qualquer uma, a API responde 503 dizendo qual falta.

## Autenticação

O login (`POST /api/login`, CNPJ do emitente + usuário + senha) devolve um **token
assinado com HMAC-SHA256** ([`server/auth.ts`](server/auth.ts)), no mesmo desenho do
estoqueWeb. Todo o resto de `/api` exige esse token no header
`Authorization: Bearer <token>` e responde 401 sem ele.

- A **empresa sai do token**, nunca de um header. Antes o servidor confiava num
  `x-empresa-id` enviado pelo cliente: quem soubesse a URL podia cancelar notas,
  inutilizar numeração ou apagar o certificado de qualquer emitente.
- O token vale **12 horas** e não precisa de tabela: a assinatura com o
  `SESSION_SECRET` é o que o torna impossível de forjar. Trocar o segredo derruba todas
  as sessões abertas.
- O usuário é **relido do banco** a cada requisição (cache de 30 s): desativar o usuário
  ou o emitente corta o acesso em até meio minuto, sem esperar o token vencer.
- No navegador, o token fica no `localStorage` com "Lembrar neste dispositivo" e no
  `sessionStorage` sem ele. A senha nunca é guardada. Um 401 com sessão aberta leva de
  volta ao login com o motivo.

## Conferência automática

```bash
npm run teste
```

São dois roteiros, sem rede e sem banco:

- `server/nfe/autoteste.ts` — dígito da chave de acesso (conferido contra a tabela de
  pesos do `ACBrDFeUtil.GerarDigito`), CNPJ/CPF, resolução das URLs no
  `ACBrNFeServicos.ini`, construtor de XML, arredondamento monetário e soma dos totais.
- `server/nfe/autoteste-emissao.ts` — gera um certificado de teste, monta uma NF-e,
  confere a ordem dos grupos do schema, assina, valida a assinatura, adultera o XML
  para provar que a validação recusa, imprime o DANFE e gera uma NFC-e com QR-Code.
  Depois passa o XML **real** de cada tipo pelos schemas oficiais: NF-e, NFC-e,
  cancelamento, carta de correção, duas manifestações e inutilização — e prova que
  NCM inválido, grupo fora de ordem e protocolo curto são barrados.

## De onde veio cada tela

| Formulário Delphi | Tela aqui |
| --- | --- |
| Configurações › Certificado | Configurações › Certificado (upload do `.pfx`, dados do titular, validade) |
| Configurações › Geral | Configurações › Geral (modelo, forma de emissão, CSC, CSRT, QR-Code) |
| Configurações › WebService + Proxy + Retorno de Envio | Configurações › WebService |
| Configurações › Emitente | Configurações › Emitente |
| Configurações › Arquivos | Configurações › Arquivos |
| Documento Auxiliar | Configurações › Documento Auxiliar |
| Email | Configurações › Email |
| Envios | Envios (nova NF-e, importar XML, transmitir, DANFE, e-mail, validar assinatura) |
| Consultas | Consultas (status do serviço, chave, recibo do lote, cadastro) |
| Eventos | Eventos (cancelamento, carta de correção, manifestação) |
| Inutilização | Inutilização |
| Distribuição DFe | Distribuição DF-e (por último NSU, NSU e chave, com manifestação na lista) |
| Respostas / XML Resposta / Log / Retorno Completo WS / Dados | Painel de respostas embaixo de cada tela, e a tela Log de Comunicação |

## Arquitetura

```
server.ts                 login, painel, Vite/SPA
server/db.ts              pool MySQL e verificação de saúde
server/config.ts          configuração do emitente (JSON em nfe_config)
server/rotas/nfe.ts       API: cada rota é um botão do formulário original
server/nfe/certificado.ts abre o .pfx com node-forge e devolve chave + certificado em PEM
server/nfe/assinatura.ts  XMLDSig: RSA-SHA1, digest SHA-1, C14N 1.0 (o perfil da NF-e)
server/nfe/soap.ts        envelope soap12 e POST com TLS mútuo
server/nfe/servicos.ts    resolve URL, namespace e SOAPAction pelo ACBrNFeServicos.ini
recursos/cadeias/         raízes confiáveis para validar o servidor da SEFAZ
server/nfe/gerarNFe.ts    monta o XML do layout 4.00 e calcula os totais
server/nfe/operacoes.ts   status, consulta, evento, inutilização, autorização, DF-e
server/nfe/danfe.ts       DANFE e DANFE NFC-e em PDF (pdfkit + bwip-js)
server/nfe/email.ts       envio do XML e do PDF por SMTP
src/                      React: Sidebar, Header, painel de respostas e as telas
```

### Decisões que valem registrar

- **Só a versão 4.00 do layout.** A 3.10 saiu de vigor; carregá-la dobraria o número de
  caminhos em cada serviço.
- **Configuração em JSON.** O conjunto de opções acompanha o `ACBrNFe.ini` e muda com
  frequência; uma coluna por opção geraria migração a cada ajuste.
- **Certificado no banco.** O servidor não depende de nada instalado na máquina, e o
  cache em memória evita reabrir o PKCS#12 a cada requisição.
- **Totais sempre recalculados** a partir dos itens, com arredondamento por notação
  exponencial — `(1.005).toFixed(2)` devolve `1.00` e isso vira rejeição 610.
- **Horário de Brasília** em `server/nfe/datas.ts`; nada usa `toISOString()`.
- **Raiz ICP-Brasil em `recursos/cadeias`.** Os webservices estaduais ficam sob a
  Autoridade Certificadora Raiz Brasileira, que não está no pacote de CAs do Node nem,
  em geral, no repositório do Windows — sem ela o handshake morre em
  `unable to get local issuer certificate`. As raízes dessa pasta **somam** às CAs
  padrão, e a verificação do servidor continua ligada: desligá-la deixaria a conexão e
  o XML assinado dentro dela abertos a interceptação. Para uma UF que exija outra raiz,
  basta jogar o `.crt` nessa pasta.

### Validação contra os schemas (XSD)

Nada vai para a SEFAZ sem passar pelos XSD oficiais de `recursos/Schemas`
([`server/nfe/validacao.ts`](server/nfe/validacao.ts)). O validador é o `xmllint` da
libxml2 compilado para WebAssembly (`xmllint-wasm`): roda dentro do Node, sem binário
nativo nem programa externo, e funciona na Vercel. É o mesmo motor que o ACBr usa por
baixo do `SSL.Validar`. Custa uns 200 ms por documento.

O comportamento segue o ACBr:

- a validação **sempre** roda e, se falhar, o envio é **barrado** — na geração (a nota
  nem é gravada), na transmissão (cobre também XML importado), nos eventos e na
  inutilização;
- **"Exibir erro de schema"** (Configurações › Geral) só decide o que a tela mostra:
  ligado, a lista campo a campo; desligado, só o aviso curto ("Falha na validação dos
  dados da nota: 123"), e o detalhe nem sai do servidor;
- **evento** é validado em duas etapas, como no `TNFeEnvEvento`: o lote `<envEvento>`
  contra `envEvento_v1.00.xsd` e o `<detEvento>` contra o schema do código dele
  (`e110111_v1.00.xsd` para cancelamento, `e110110` para carta de correção etc.).

Cada `.xsd` é lido junto com tudo o que ele inclui ou importa, recursivamente — o
`xmllint` roda num sistema de arquivos em memória e não enxerga o que não for
pré-carregado. As mensagens do `xmllint` saem traduzidas nos casos comuns (formato,
tamanho, ordem, elemento faltando, valor fora da lista).

O botão **Validar XML** da lista de documentos confere uma nota contra o schema sem
enviar nada, como no exemplo Delphi.

Na Vercel o `xmllint-wasm` sobe um *worker* e carrega o `.wasm` por caminho montado
em tempo de execução — o rastreador de arquivos não enxerga isso, por isso o pacote
está no `includeFiles` do `vercel.json`, ao lado de `recursos/**`.

### Onde ficam os arquivos

Nada é gravado em disco: o XML assinado, o XML com protocolo, os eventos, as
inutilizações, os documentos da Distribuição DF-e e o próprio `.pfx` ficam todos no
MySQL, e o DANFE é gerado a cada pedido em vez de ser guardado. É o que permite rodar
em serverless, onde o sistema de arquivos é somente leitura fora de `/tmp` — e `/tmp`
some a cada invocação.

Por consequência, a aba **Configurações › Arquivos** (pastas, criar pastas mensalmente,
separar por CNPJ etc.) existe porque o formulário Delphi tinha, e as opções são
gravadas, mas ainda não têm efeito: não há gravação em disco para configurar.

### O que ainda não está aqui

- **Grupos raros do layout**: exportação, comércio exterior, combustíveis, ISSQN,
  cana, ICMS UF de destino (DIFAL) e os eventos da Reforma Tributária.
- **Impressão em impressora térmica (EscPos)**: o DANFE NFC-e sai em PDF de bobina,
  não em comandos ESC/POS.
- **Contingência** (FS-DA, EPEC, offline da NFC-e) está prevista na configuração e na
  chave de acesso, mas o fluxo completo de retorno à emissão normal não foi feito.
