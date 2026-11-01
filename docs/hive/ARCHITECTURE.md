# Hive — levantamento sobre o Rakazo

Este documento descreve o Rakazo como está hoje e onde cada parte do Hive encaixa.
Não é um plano de implementação. Nenhuma fase começa sem aprovação.

Isto é uma leitura do ficheiro `LICENSE` e do código. Não é aconselhamento jurídico.

## Licença

O repositório está sob a Apache License 2.0. O aviso no fim do ficheiro é
`Copyright 2026 Rakazo contributors`. Não existe um ficheiro `NOTICE`.

A licença permite uso comercial. Permite copiar, modificar, sublicenciar e
distribuir o programa, em código ou compilado, com ou sem alterações, e cobrar
por ele, por suporte ou por uma garantia própria. Não obriga a publicar as
modificações. Não é uma licença copyleft.

Quem distribui o Hive, a um cliente ou dentro de uma imagem, tem de:

- Entregar uma cópia desta licença.
- Marcar de forma visível os ficheiros que foram alterados.
- Manter, no código distribuído, os avisos de copyright, patente, marca e
  atribuição que já vêm no Rakazo e que ainda digam respeito a essa parte.
- Não apresentar o Hive como se fosse o Rakazo. A licença não autoriza o uso
  das marcas e do nome do produto, exceto para dizer de onde o trabalho veio
  e para reproduzir o conteúdo de um `NOTICE`, se algum dia existir.

Dá para acrescentar um copyright próprio nas partes novas e pôr outras
condições só nessas partes, ou no conjunto, desde que a redistribuição do
código original continue a cumprir a Apache 2.0. O código que veio do Rakazo
não passa a ser proprietário por estar dentro do Hive.

Há uma cláusula de patentes: se o Hive processar alguém por alegar que o
Rakazo, ou um contributo incorporado nele, viola uma patente, as licenças de
patente desta licença terminam nessa data.

Não há `NOTICE` hoje. Se o upstream passar a distribuir um, as entregas do
Hive têm de incluir os avisos desse ficheiro que ainda se apliquem.

## Como o produto está montado

O monorepo é um produto só: web (React 19, Vite, Tailwind), API (Hono e oRPC),
worker, Electron (a mesma interface web) e Expo. O comportamento partilhado
está em `packages/`. A base é PostgreSQL com Prisma. A fila é Graphile Worker
(`WAKEUP_DRIVER=graphile`). O arranque self-hosted está em `infra/compose`:
Postgres, migração, API, worker, web e, na composição de produção, Caddy.
Os contentores de computador são imagens à parte (`rakazo/computer`), criadas
pelo supervisor através do socket Docker. Não são a máquina de quem está a
conversar.

A API e o worker ligam-se com o papel `rakazo_app`, sujeito a row-level
security. As migrações usam outro login. Os repositórios filtram por espaço e
por utilizador; um bot que não seja do ator devolve erro de isolamento.

Os segredos persistentes vão para a tabela `secrets` como `ciphertext`, com a
chave do espaço embrulhada por uma chave mestra (`space_keys`,
`ENCRYPTION_KEY` / `ENCRYPTION_MASTER_KEYS`). `SECRET_STORE=encrypted` é o
omisso. `SECRET_STORE=infisical` é opcional e guarda referências, não o
segredo em claro. Há também KMS opcional. O conteúdo dos chats pode ser
cifrado em repouso (`CONTENT_ENCRYPTION`).

## Utilizadores e papéis

O login é Better Auth: email e palavra-passe, código por email, passkeys, e
um fornecedor OIDC genérico configurado por ambiente (emissor, cliente,
segredo, âmbitos). Dá para fechar o registo (`signupsEnabled`) e limitar
domínios (`signupAllowlist`). Dá para desligar a palavra-passe. Não há SAML.
O OIDC é um único emissor de instalação, não uma página por empresa.

`User` é a conta. `Organization` é o agrupamento do Better Auth: quem cria a
organização fica com o papel `owner`, e um utilizador normal não pode criar
outra. `Member.role` é texto (`owner`, e nos testes também `member`). Não há
`SUPER_ADMIN` nem `ADMIN` de produto.

`Space` é a área de trabalho dentro da organização. O primeiro espaço é o
omisso. Um membro novo da organização entra nesse espaço como `member`.
`SpaceMember.role` é `owner` ou `member`. O owner muda o nome e apaga o
espaço. O member trabalha lá dentro. Isto não é um departamento: cada pessoa
continua a ser dona do que cria.

`AuditEvent` já regista quem fez o quê na organização, sem chaves estrangeiras
e sem conteúdo de mensagens nem segredos. `SecurityEvent` regista autenticação.
Há encaminhamento opcional do audit log por webhook.

## Bots

`Bot` pertence a um `userId` e a um `spaceId`. Listar e abrir um bot exige os
dois. Outra pessoa no mesmo espaço não vê esses bots. Não há tabela de
atribuição a pessoas nem a áreas.

O que o bot é está nas colunas do próprio bot: nome, instruções, modelo
opcional (`modelProvider`, `modelId`), ferramentas internas desligadas, cor,
computador, e ligações a servidores MCP (`bot_mcp_servers`). Quem é dono edita
tudo isto. Não há um modo só de uso.

`BotSection` é uma pasta visual do próprio utilizador, não um departamento.
`ChatGroup` junta bots desse mesmo utilizador. `parentBotId` cria bots filhos.
`fleetManagement` e `crossSpaceCommunication` deixam bots falar entre si,
sempre dentro das contas que os possuem.

Cada bot tem um `Thread`. Uma volta de conversa é um `Task` e um `Run`. O
worker reclama o run por lease no Postgres.

## Credenciais de modelo

A chave é da pessoa, não do bot. `UserModelCredential` aponta para um
`secretId`. O fornecedor `openai-compatible` já exige URL base e id de modelo;
a chave fica no segredo cifrado. O bot só escolhe fornecedor e modelo. A chave
usada no run é a da conta que o executa, ou a preferência do espaço
(`space_model_preferences`, `user_model_preferences`).

`DeploymentSettings` pode ter um modelo e uma credencial de instalação
(`deploymentModelCredentialCipher`). Continua a ser uma credencial da
instalação, não uma virtual key por bot.

`UsageRecord` já guarda tokens e `costUsd` por espaço, utilizador, bot, run e
modelo. O id do bot não se apaga em cascata, para o gasto sobreviver ao bot.
Isto mede o que o Rakazo viu na resposta do modelo. Não lê o painel de um
proxy LiteLLM nem impõe o orçamento de uma virtual key.

## Computadores

`Computer` é uma sandbox no servidor (Docker no Compose; também existem outros
fornecedores). Pertence a um utilizador e a um espaço. O âmbito omissão é
`team`: vários bots desse utilizador partilham a máquina. `dedicated` isola um
bot. O estado, o ecrã e os leases de execução estão na base. O home do
computador pode ir para armazenamento S3 (`OBJECT_STORAGE_*`).

Isto já cumpre "o bot não corre na máquina de quem conversa". À parte ficam o
Electron, que é a interface, e `UserDevice`, que é um aparelho emparelhado
para notificações e ligação. O Hive pode não os distribuir. Não são o sítio
onde o agente executa ferramentas.

## Integrações e cofre

`McpServer` é um servidor MCP do utilizador, no espaço. Segredos de headers,
ambiente e argumentos vão para `secrets`. `BotMcpServer` escolhe que bot o
pode usar e que ferramentas. Há OAuth de MCP.

`Connection` é uma conta ligada (o conector omissão é Composio).
`CapabilityInstall` é um plugin instalado, com skills e servidores que ele
cria. `AgentSkill` é uma skill partilhada pelos assistentes desse utilizador,
não presa a um bot. `TaughtSkill` é um guião gravado de um bot.

`VaultCredential` é o cofre da pessoa (conta inteira, ou um espaço com
override). `BotSecret` é um segredo com nome, de um bot, também da pessoa.
`AgentSecret` é um segredo com nome ao nível do espaço. `IntegrationProviderConfig`
é credencial de instalação. Em todos estes casos o valor persistido é
ciphertext ou uma referência, conforme o `SECRET_STORE`.

Não há OpenBao. O equivalente opcional que já existe é o Infisical.

## Tarefas e conhecimento

`Routine` é o agendamento: crons, fuso, webhook, GitHub, e um watch. Dispara
`Run`s do bot dono. `ScratchpadItem` é uma lista de notas do bot.

`MemoryDocument` é texto por caminho, com âmbito, utilizador e bot opcional.
Não há pgvector nem ACL por pedaço. `Artifact` é um ficheiro enviado ou
produzido, no disco ou em S3, também preso ao utilizador e ao bot ou grupo.

## Onde o Hive encaixa

Módulos novos (`packages/hive-*` ou `apps/*/src/hive`). O Rakazo continua a
ser o motor de conversa, runs, fila, cifra e contentores. As regras de
empresa não se espalham por dentro desses fluxos salvo num ponto de decisão
já existente (quem pode ver o bot, que credencial o run usa, que segredo a
ferramenta lê).

### Fase 1 — nome

O nome visível, os pacotes `@rakazo/*`, as imagens `rakazo/*`, o papel
`rakazo_app`, as variáveis `RAKAZO_*` e os textos estão por todo o lado.
Renomear o produto não pode apagar `Copyright 2026 Rakazo contributors` nem
a licença. Ficheiros alterados precisam de um aviso de modificação. O nome
Rakazo fica só na atribuição de origem.

A primeira parte muda só o que se vê e o que o Compose constrói: nome Hive
na web e no login, títulos, favicon provisório, README, instalação, nomes
das imagens e do projeto Compose. Os pacotes `@rakazo/*`, o papel
`rakazo_app` e as variáveis `RAKAZO_*` ficam para a parte seguinte. Electron
e Expo ficam de fora desta parte.

### Fase 2 — papéis e atribuições

Não mapear `owner` do Better Auth para `SUPER_ADMIN`. São coisas diferentes:
hoje qualquer conta é dona dos seus bots. O Hive precisa de papéis novos e de
duas atribuições que não existem: bot↔utilizador e bot↔área.

`Organization` serve como tenant de uma instalação. `Space` não serve como
departamento: mistura workspace pessoal, dono e membros com os mesmos poderes
sobre o que cada um criou. Uma área nova, criada pelo admin, é mais simples
do que redefinir espaço.

A lista e a conversa têm de filtrar pela atribuição no servidor, no mesmo
sítio em que `getBot` e `listBots` hoje exigem `userId` do ator. Esconder o
botão na interface não chega. O admin é a exceção, explícita.

As políticas de row-level security do Postgres também têm de aceitar um bot
atribuído ao utilizador ou à área dele. Um USER fica bloqueado em todas as
rotas de edição: bots, rotinas, MCP, segredos, skills e computadores.

`AuditEvent` já tem ator, ação, alvo e data. A fase estende as ações de
admin e o uso de ferramentas para esse registo, sem gravar segredos nem o
texto do chat.

### Fase 3 — LiteLLM por bot

O encaixe natural da chamada é o fornecedor `openai-compatible`: URL base e
modelo já existem. A virtual key não pode viver em `UserModelCredential`,
porque essa chave segue a pessoa e aparece na gestão de modelos dela.

O Hive guarda, por bot, a URL, a referência da key cifrada e o modelo. O
contentor recebe-os ao arrancar. A master key do LiteLLM fica só no ambiente
do servidor, para `POST /key/generate`, e nunca na base nem no cliente.

`UsageRecord` continua a servir para o que o run local mediu. A página de
custos do Hive lê o LiteLLM, porque o orçamento da virtual key é de lá.

### Fase 4 — cofre

Não substituir a cifra atual por colunas em claro, nem gravar o segredo no
OpenBao e outra cópia na base. Na base fica a referência. O OpenBao entra
como outro `SECRET_STORE`, ao lado de `encrypted` e `infisical`.

`BotSecret` é o sítio conceptual (segredo nomeado de um bot). No Hive a linha
deixa de ser do utilizador que criou o bot e passa a ser atribuída pelo
admin. A ferramenta resolve a referência na hora do uso. O valor não entra
no pedido ao modelo nem nos logs. Onde a integração já tem OAuth (MCP e
vários fornecedores), esse caminho mantém-se.

### Fase 5 — conhecimento

`MemoryDocument` e `Artifact` não chegam: não há índice vetorial nem ACL por
pedaço. Coleções novas, pgvector e MinIO (o armazenamento de objetos já fala
S3, por isso o MinIO é o endpoint, não um segundo desenho de ficheiros).
Cada pedaço guarda a ACL. A pesquisa aplica o bot e o utilizador do run.
Isto é código novo. Não se finge que a memória atual já filtra assim.

### Fase 6 — marca

`Organization.logo` é um campo do Better Auth, insuficiente. As cores do
produto saem de `@rakazo/ui-tokens` (tokens semânticos, uma fonte que gera
`tokens.css`). A marca da empresa deve preencher esses tokens — nome,
logótipo, favicon, primária, destaque, fundo — e o login tem de os ler
antes de haver sessão. Não espalhar cores fixas pelos ecrãs.

### Fase 7 — entrada e instalação

OIDC genérico, registo fechado e allowlist já existem e ficam. SAML, vários
IdPs por instalação e o assistente de primeiro arranque não existem. O
`bootstrap-owner` cria um owner técnico; não substitui o assistente.

O Compose de produção já tem Caddy, Postgres, API, worker e redes separadas.
Faltam MinIO, OpenBao e LiteLLM opcional, e a garantia de que os contentores
dos bots não publicam portas. Backup tem de passar a incluir Postgres, MinIO
e OpenBao. O PITR atual só cobre a base.

## O que não se reaproveita como está

- Tratar cada membro como dono dos seus bots, skills, plugins e chaves.
- Deixar a chave do modelo na conta de quem conversa.
- Usar o espaço pessoal como se fosse um departamento.
- Chamar Infisical de OpenBao. O mecanismo de referência serve; o serviço não.
- Indexar `MemoryDocument` e dizer que há pesquisa com permissões.
- Renomear o produto apagando o copyright ou a licença Apache.
