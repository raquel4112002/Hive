<!-- Hive modification: Phase 2 proposal. Derived from Rakazo (Apache License 2.0). -->

# Fase 2 — papéis e atribuições

Especificação da Fase 2. O código e as migrações seguem este documento. A área Todos, o nível de acesso e os bots de publicação entram na migração `20261112140000_hive_publication`.

O Rakazo trata cada conta como dona dos bots que criou. `listBots` e `getBot`
filtram `spaceId` e `userId` do ator. `Thread.botId` é único: um bot, uma
conversa. As políticas de row-level security dos bots deixam passar qualquer
linha do espaço da transação (`app.space_id`). O papel `member.role` do
Better Auth (`owner`, `member`) não é o papel de produto. Não se lê esse
campo para autorizar o Hive.

## Modelo

`HiveRole` liga um utilizador a uma `Organization`:

| Coluna | Notas |
| --- | --- |
| `organizationId` | a instalação, o tenant que já existe |
| `userId` | |
| `role` | `SUPER_ADMIN`, `ADMIN` ou `USER` |

Único em (`organizationId`, `userId`). Um `SUPER_ADMIN` por organização.
Só um `SUPER_ADMIN` muda papéis, e não pode retirar o último `SUPER_ADMIN`.
Um `ADMIN` gere áreas, bots e atribuições da sua organização. Um `USER` só
usa o que lhe foi atribuído.

A migração copia os dados uma vez, para a instalação não ficar sem ninguém
que governe: o `owner` mais antigo da organização passa a `SUPER_ADMIN`; os
outros `owner` passam a `ADMIN`; o resto passa a `USER`. Depois disso o
pedido não volta a olhar para `member.role`.

`Department` é a área. Pertence à organização, não a um `Space`. `Space`
continua a ser o workspace em que o bot e o computador vivem.

| Coluna | Notas |
| --- | --- |
| `id` | |
| `organizationId` | |
| `name` | único dentro da organização |
| `system` | verdadeiro só na área Todos; o omisso é falso |
| `createdByUserId` | o admin que a criou; vazio na área Todos |

`DepartmentMember` liga pessoas à área. Único em (`departmentId`, `userId`).
A pessoa tem de ter `HiveRole` nessa organização.

`BotAssignment` é bot↔utilizador. Único em (`botId`, `userId`). Guarda
`assignedByUserId`, `createdAt` e `accessLevel`.

`BotDepartmentAssignment` é bot↔área. Único em (`botId`, `departmentId`).
Guarda os mesmos campos.

`accessLevel` é `CHAT` ou `READ_ONLY`. O omisso é `CHAT`, nas duas tabelas.
O nível efectivo de uma pessoa num bot é o mais alto entre a atribuição
directa e cada atribuição a uma área em que ela está, incluindo Todos. Se
um desses caminhos for `CHAT`, o nível é `CHAT`. Se só houver `READ_ONLY`,
o nível é `READ_ONLY`. Sem nenhum caminho, o bot não existe para ela.

`BotConnection` é bot↔`Connection`, criada pelo admin. Único em (`botId`,
`connectionId`). É a única forma de um run usar uma ligação. A `Connection`
tem de ser da conta de serviço da organização. O admin cria-a em nome da
organização: `connections/begin` grava a ligação com a conta de serviço como
dona. Uma `Connection` pessoal é recusada. Remover um admin não parte os
bots, porque a ligação não está na conta dele.

Apagar uma área apaga os seus membros e as atribuições de bots a essa área.
A área Todos não entra nessa regra. Apagar um bot apaga atribuições,
`BotConnection`, os computadores dedicados desse bot e o feed de publicações.
Nenhuma atribuição apaga o bot.

Estas colunas e a tabela `bot_posts` entram numa migração nova, depois de
`20261112120000_hive_access`. São aditivas: colunas com omissão, tabela nova.
O release anterior ignora-as. Não se reescreve a migração já aplicada.

## Área Todos

Cada organização que tem papéis Hive tem uma área de sistema. O nome visível
é Todos. `system` é verdadeiro. A migração cria-a no mesmo passo em que cria
os papéis. Não se apaga e não se renomeia: `hive.department.delete` e
`hive.department.rename` recusam essa linha. Se já existir uma área com o
nome Todos, a migração reserva esse nome para a área de sistema e a outra
fica com outro nome.

Quem ganha `HiveRole` entra em Todos no mesmo passo, na migração inicial e
em cada papel criado depois. Quem perde o papel sai. A conta de serviço não
tem papel e não entra. Uma pessoa arquivada não conta como membro: não vê
os bots da área e não recebe avisos.

Atribuir um bot a Todos é uma `BotDepartmentAssignment` normal. Vale para
toda a organização, porque toda a gente com papel está nessa área. Não cria,
por si, uma thread por pessoa nem um computador por pessoa. Isso depende do
nível efectivo e de o bot ser ou não de publicação.

## Nível de acesso

`CHAT` num bot que não é de publicação abre a thread dessa pessoa, como o
resto deste documento descreve.

`READ_ONLY` vê o bot na lista e o feed, quando existem publicações. Não abre
conversa. Falham `threads/get`, `threads/send`, `threads/sendWithRoutines`,
`threads/followUp`, `threads/stop`, `threads/react`, `threads/answer`,
`threads/answerCall`, `threads/declineCall`, `threads/endCall`,
`threads/markRead`, `threads/markUnread` e `threads/clear`. Falham
`computer/screenUrl`, `computer/status` e `computer/heartbeat`. As rotas de
edição continuam recusadas, como para qualquer `USER`. A interface não
mostra caixa de texto. Não se cria thread nem computador dedicado para esse
par.

Passar uma pessoa de `CHAT` para `READ_ONLY` não apaga a thread antiga. As
rotas de conversa passam a falhar. O texto antigo não passa para o feed.

## Bot de publicação

Um bot pode ser marcado como bot de publicação. `Bot.publication` é o
omisso falso. Não tem conversa com utilizadores. Só corre rotinas. As rotas
de conversa falham para toda a gente, mesmo com nível `CHAT`. Não se cria
thread de pessoa nem computador dedicado por pessoa.

O resultado de uma rotina desse bot não é copiado para a thread de ninguém.
Entra no feed, uma linha `BotPost`:

| Coluna | Notas |
| --- | --- |
| `botId` | |
| `routineRunId` | o run que a produziu |
| `content` | o texto do resultado |
| `createdAt` | |

Os artefactos desse resultado são linhas do post, não um `Artifact` de uma
pessoa. Quem está atribuído ao bot, em qualquer nível, lê o feed: lista,
abrir uma publicação e descarregar os artefactos dessa publicação. As rotas
são `posts/list`, `posts/get` e `posts/artifact`. O feed é partilhado e só
de leitura. Não há rota de utilizador que crie, altere ou apague uma
publicação.

O admin e o super-admin lêem o feed. É conteúdo da organização, não uma
conversa privada. Não precisam de `conversations/inspect`.

A escrita é só do worker, com `app.rls_bypass`, em nome da conta de serviço.
Marcar um bot como publicação não converte threads já existentes em
publicações.

A rotina já tem `notify`. Num bot de publicação, ao criar a rotina, o omisso
dessa flag é desligado. Com `notify` ligado, cada destinatário — a pessoa
indicada, ou cada pessoa da área indicada — recebe um aviso de que há uma
publicação nova. O aviso não cria mensagem numa thread pessoal e não leva o
texto como conversa. Com `notify` desligado, a publicação fica no feed e
ninguém é avisado.

## Conta de serviço

`Bot.userId` deixa de ser a pessoa que criou o bot. A migração cria, por
organização, uma conta técnica:

- uma linha em `User`, sem password, sem sessão, sem passkey e sem
  `HiveRole`;
- o email é único e gerado na migração, não é uma caixa que receba correio
  e não é um endereço fixo no código;
- não inicia sessão e não aparece na lista de pessoas.

Os `Bot.userId` dessa organização passam a apontar para essa conta. O mesmo
para `Computer.userId` dos computadores desses bots. Threads, tasks e runs
não mudam de `userId`: esse campo é quem falou, não quem é dono do bot.

A conta de serviço não se apaga enquanto a organização tiver bots. Não tem
`UserModelCredential`, `Connection`, `AgentSkill`, `AgentSecret` nem
`VaultCredential`. Até à Fase 3 a única credencial de modelo é
`DeploymentSettings.deploymentModelCredentialCipher`, a credencial da
instalação. Se essa credencial não existir, o run falha. Não se usa a chave
de nenhum admin.

Remover um admin não mexe nos bots. O procedimento apaga o `HiveRole`, as
filas em áreas, as `BotAssignment` dessa pessoa e as conversas, memórias,
artefactos e scratchpad cujo `userId` é o dela. Os bots ficam na conta de
serviço. O último `SUPER_ADMIN` não pode ser removido. Um acesso a conversas
que essa pessoa tenha aberto fecha-se no mesmo passo.

## Remoção de pessoa

`DeploymentSettings` guarda a política. `personRemovalMode` é `archive` ou
`delete`. O omisso é `archive`. `personArchiveDays` é quantos dias o
arquivado espera antes de ser apagado; o omisso é 30.

Arquivar marca a pessoa e o conteúdo fica invisível para toda a gente. A
única leitura é `conversations/inspect`, com o prazo e o motivo de sempre.
Apagar já remove conversas, memórias, artefactos e scratchpad nessa altura.
Um trabalho posterior apaga o que chegou ao fim dos N dias. A conta de
serviço não entra nesta política. O último `SUPER_ADMIN` não sai.

## Threads por pessoa

Hoje `threads_botId_key` é único. `find` por `botId` devolve uma thread.
Grupos usam `groupId` único e ficam como estão: esta mudança é só a thread
de um bot.

O par (`botId`, `userId`) passa a ser único nas threads de pessoas, onde
`botId` não é nulo e a thread não é de uma rotina. Cada pessoa com nível
efectivo `CHAT`, num bot que não é de publicação, tem a sua thread.
`Thread.userId` é essa pessoa. `READ_ONLY` e um bot de publicação não abrem
thread de pessoa. Duas pessoas na mesma área não
partilham mensagens, resumo de compactação, nem o cursor de leitura. A
thread de uma rotina tem `routineId` e fica de fora desse único: várias
rotinas do mesmo bot podem existir, todas na conta de serviço.

`MemoryDocument`, `Artifact` e `ScratchpadItem` criados nessa conversa
guardam o mesmo `userId`. Já têm a coluna. O que muda é o alcance: um
documento de memória do bot deixa de ser único em (`spaceId`, `scope`,
`botId`, `path`). O único novo inclui `userId`, senão a segunda pessoa
grava por cima da primeira. `MemoryRevision` segue o documento.
`Artifact.userId` e `ScratchpadItem.userId` têm de ser o da thread que os
criou. Um ficheiro de uma pessoa não aparece na lista da outra.

A migração, por causa dos dois releases lado a lado:

1. Acrescenta o único (`botId`, `userId`). Os dados de hoje já o cumprem:
   há no máximo uma thread por bot, e essa thread já tem `userId`.
2. O código novo procura a thread por (`botId`, `userId`) e, se não
   existir, cria a dessa pessoa. Não lê a thread de outra pessoa quando o
   único antigo ainda recusa a segunda linha.
3. A migração `20261112130000_hive_drop_shared_thread` remove
   `threads_botId_key` nesta release. As consultas passam a usar
   (`botId`, `userId`) para a conversa de uma pessoa e `routineId` para a
   thread da conta de serviço.
4. O único antigo de `memory_documents` sai numa migração `-- deferred`,
   depois de existir o único com `userId`.

A segunda pessoa do mesmo bot abre a sua conversa. Não há janela em que as
duas pessoas leiam o mesmo transcript.

## Rotinas

A rotina pertence ao bot. Corre na conta de serviço, numa thread própria da
rotina, não na thread de uma pessoa. O admin define os destinatários do
resultado: pessoas, uma área, ou as duas. Cada destinatário recebe o
resultado na sua thread. Duas pessoas da mesma área não leem o resultado
numa thread partilhada.

A rotina não reutiliza a thread de uma pessoa, nem a de quem carregou em testar.

Num bot de publicação o resultado não segue este caminho. Vai para o feed,
como a secção do bot de publicação descreve.

## Quem vê o quê

Um `USER` vê um bot quando o nível efectivo é `CHAT` ou `READ_ONLY`: por
`BotAssignment` ou por `BotDepartmentAssignment` de uma área em que está,
incluindo Todos. Com `CHAT`, num bot que não é de publicação, abre a sua
thread e conversa. Com `READ_ONLY`, ou num bot de publicação, vê o bot e o
feed e não conversa. Não herda bots do espaço e não vê a thread, mensagens,
memória, artefactos ou scratchpad de outra pessoa, mesmo no mesmo bot. O
feed não é conversa: é a mesma lista para toda a gente atribuída.

Um `ADMIN` ou `SUPER_ADMIN` vê a configuração de todos os bots das spaces
da organização: ficha, rotinas, MCP, atribuições, computador, custos em
`usage_records` e `AuditEvent`. Não tem `SELECT` em `messages`, nem no
conteúdo de thread (resumo de compactação), nem em `memory_documents`,
`memory_revisions`, `artifacts` ou `scratchpad_items` de outras pessoas.
A lista de bots não inclui o texto da última mensagem.

Ninguém tem leitura permanente de conversas alheias. O acesso é um
procedimento à parte, `conversations/inspect`, só de `SUPER_ADMIN`:

- pede o id da thread e um motivo;
- abre um prazo curto, só para essa thread e só para esse ator;
- cada leitura grava `hive.conversation.read` com ator, thread, motivo e
  prazo;
- no fim do prazo o `SELECT` deixa de existir;
- um `ADMIN` não chama o procedimento e não recebe o prazo;
- o prazo fecha-se se o ator for removido.

Sem prazo, nem o `SUPER_ADMIN` lê mensagens. O prazo não desliga o RLS para
o resto das tabelas.

`getBot` e a lista deixam de exigir `userId = ator` no bot. Exigem a
atribuição, com a exceção do admin para a ficha. `threads/get` e
`threads/send` exigem a thread (`botId`, `userId` do ator). Um id de thread
de outra pessoa não chega.

## Row-level security

As políticas atuais dos bots (`bots_tenant`) aceitam qualquer linha do
`app.space_id`. Um `USER` do mesmo espaço leria o bot, as mensagens e os
ficheiros direto na base.

A migração é aditiva e convive com o release anterior. Esse release não
conhece a versão nova de `app.rls_version`, por isso as políticas
`*_previous_release` mantêm o acesso por espaço enquanto ele ainda corre.
Esta release passa à versão seguinte.

`SELECT` de um `USER` em `bots`, `routines`, `bot_mcp_servers`,
`taught_skills`, `bot_secrets` e `bot_connections`: o bot está atribuído a
ele ou a uma área dele.

`SELECT` de um `USER` em `threads`, `messages`, `runs`, `tasks`,
`memory_documents`, `memory_revisions`, `artifacts`, `scratchpad_items` e
`usage_records`: a linha é desse `userId` e o bot está-lhe atribuído.
`usage_records` não tem texto de mensagem; o `USER` só vê os seus custos.

`ADMIN` e `SUPER_ADMIN`: `SELECT`, `INSERT`, `UPDATE` e `DELETE` na
configuração (`bots`, rotinas, MCP, segredos do bot, `bot_connections`,
computadores da organização). `SELECT` em `usage_records` e `audit_events`
da organização. Sem `SELECT` em `messages`, conteúdo de thread,
`memory_documents`, `memory_revisions`, `artifacts` e `scratchpad_items`,
exceto durante um `conversations/inspect` válido, e aí só na thread abrangida.

O `USER` não tem política de `INSERT`/`UPDATE`/`DELETE` nas tabelas de
configuração. A escrita falha na base mesmo que uma rota se esqueça do
papel. Pode inserir mensagens, memória, artefactos e scratchpad só na
própria thread, e só quando o nível efectivo é `CHAT` e o bot não é de
publicação. `READ_ONLY` não tem essa escrita.

`bot_posts` e os artefactos do post: `SELECT` para quem tem atribuição ao
bot, em qualquer nível, e para o admin da organização. Sem `INSERT`,
`UPDATE` ou `DELETE` para utilizadores. O worker escreve com
`app.rls_bypass`. Um `USER` sem atribuição não vê a linha, nem por id.

`computers`, `mcp_servers`, `connections`, `user_model_credentials`,
`secrets`, `agent_secrets` e `vault_credentials`: um `USER` não escreve e
não lê linhas de outras contas. Lê o computador dedicado da sua thread, e
mais nenhum. `AgentSkill` de outra conta não entra em nenhuma política de
leitura do `USER`.

O bypass `app.rls_bypass` mantém-se para o worker e para as migrações. O
worker não corre com a sessão do `USER` quando grava estado do computador.

## Rotas de escrita

O bloqueio é no servidor, antes do handler, com o papel lido de `HiveRole`.
Quando o alvo é um bot ou uma thread que o `USER` não tem, a resposta é a
de um bot inexistente. Nas rotas sem bot (modelos, plugins, skills de conta)
a resposta é recusa explícita.

Conversa na própria thread, só com nível efectivo `CHAT` e num bot que não
é de publicação: `threads/send`, `threads/sendWithRoutines`,
`threads/followUp`, `threads/stop`, `threads/react`, `threads/answer`,
`threads/answerCall`, `threads/declineCall`, `threads/endCall`,
`threads/markRead`, `threads/markUnread`, `threads/clear`. `threads/clear`
só apaga a thread de quem chama. `READ_ONLY` e qualquer pessoa num bot de
publicação levam a mesma recusa que um bot inexistente nestas rotas.

`posts/list`, `posts/get` e `posts/artifact` ficam para quem tem atribuição,
em qualquer nível, e para o admin. Não escrevem.

### Bots

Recusadas a um `USER`:

- `bots/create`, `bots/importPreview`, `bots/importCreate`,
  `bots/duplicate`, `bots/reorder`, `bots/update`,
  `bots/restoreInstructions`, `bots/setComputer`, `bots/archive`,
  `bots/restore`, `bots/remove`, `bots/rotateWebhookSecret`
- `groups/create`, `groups/duplicate`, `groups/update`, `groups/archive`,
  `groups/restore`, `groups/remove`
- `botSections/create`, `botSections/update`, `botSections/remove`
- `onboarding/start`, `onboarding/promptFocus`, `onboarding/choose`,
  `onboarding/dismissFocus`, `onboarding/appConnected`

### Rotinas

Recusadas a um `USER`: `routines/create`, `routines/update`,
`routines/remove`, `routines/testRun`.

`routines/list` e `routines/history` de um bot atribuído ficam. Não criam
nada.

### MCP

Recusadas a um `USER`:

- `mcp/servers/create`, `mcp/servers/update`, `mcp/servers/remove`,
  `mcp/servers/test`
- `mcp/assignments/approve`, `mcp/assignments/dismiss`,
  `mcp/assignments/replace`
- `mcp/oauth/begin`, `mcp/oauth/complete`, `mcp/oauth/disconnect`

### Segredos

Recusadas a um `USER`, incluindo a lista e o valor:

- `vault/list`, `vault/put`, `vault/reveal`, `vault/remove`
- `botSecrets/list`, `botSecrets/put`, `botSecrets/remove`
- `agentSecrets/list`, `agentSecrets/put`, `agentSecrets/remove`

### Skills

Recusadas a um `USER`:

- `skills/start`, `skills/appendEvent`, `skills/snapshot`, `skills/stop`,
  `skills/updateDraft`, `skills/save`, `skills/testRun`, `skills/remove`
- `agentSkills/list`, `agentSkills/get`, `agentSkills/create`,
  `agentSkills/update`, `agentSkills/remove`
- `availability/set`, `availability/chooseForSpace`

`skills/list` de um bot atribuído fica: são as `TaughtSkill` desse bot, não
as skills da conta de ninguém.

### Computadores

Um bot com algum `USER` em nível efectivo `CHAT`, e que não seja de
publicação, não usa computador `team`. Cada par (`botId`, `userId`) nesse
caso tem um computador `dedicated`, criado na conta de serviço, usado só
pela thread dessa pessoa. O run não usa `Bot.computerId` partilhado. Dois
`USER` no mesmo bot de área não partilham disco nem ecrã. Um bot só com
`READ_ONLY`, ou um bot de publicação, não abre computadores dedicados por
pessoa. Atribuir a Todos não abre um computador por membro.

O computador arranca quando essa pessoa precisa dele e pára depois de
`HIVE_COMPUTER_IDLE_MINUTES` sem uso. O omisso, e o valor de exemplo no
`.env`, é 30. `HIVE_MAX_ACTIVE_COMPUTERS` é o máximo de computadores
dedicados a correr ao mesmo tempo, em toda a instalação. O omisso, e o
valor de exemplo, é 2. Um valor vazio ou inválido usa esses omissos. Quem
chega com o limite cheio fica numa fila e arranca quando um lugar liberta,
pela ordem de chegada.

Recusadas a um `USER`:

- `computer/boot`, `computer/stop`, `computer/recover`, `computer/reset`,
  `computer/update`, `computer/releaseInterrupted`,
  `computer/dismissUpdate`, `computer/takeover`, `computer/release`,
  `computer/input`, `computer/uploadFile`
- `computer/files`, `computer/readFile`, `computer/downloadFile`,
  `computer/terminalUrl`, `computer/commands`

`computer/screenUrl`, `computer/status` e `computer/heartbeat` só para o
`USER` dono dessa thread, com nível efectivo `CHAT`, e só se o computador
for o `dedicated` desse par. Um computador `team` não devolve `screenUrl`.
`READ_ONLY` e um bot de publicação também não. O admin não chama
`screenUrl`.

### Plugins

Recusadas a um `USER`:

- `connections/begin`, `connections/complete`, `connections/rename`,
  `connections/revoke`
- `capabilities/install`, `capabilities/pluginParts`,
  `capabilities/remove`
- `integrationSetup/save`
- `marketplace/review`

Ligar uma `Connection` ao bot é configuração: só o admin escreve
`BotConnection`, e só se a ligação for da conta de serviço.

### Modelos

Recusadas a um `USER`:

- `models/connect`, `models/disconnect`, `models/rename`,
  `models/setDefault`, `models/setRole`, `models/setBackups`
- `models/beginOAuth`, `models/submitOAuthCode`, `models/completeOAuth`,
  `models/finishOAuth`, `models/cancelOAuth`
- `models/probeOpenAiCompatible`, `models/probeCatalog`
- `models/list`, `models/credentials`

Até à Fase 3 ninguém escolhe um modelo por bot. A instalação é que tem a
credencial.

## O que um run carrega

`Run.userId` é quem enviou a mensagem. O modelo não se resolve por esse
campo nem por `Bot.userId`. A chave é a credencial da instalação.

O run não carrega `Connection`, `AgentSkill`, `AgentSecret` nem
`VaultCredential` da conta do admin, nem da conta de serviço. Carrega só:

- `BotMcpServer` desse bot;
- `BotSecret` desse bot;
- `Connection` apontadas por `BotConnection` desse bot;
- `TaughtSkill` desse bot.

Uma `Connection` do admin que não esteja em `BotConnection` não é chamada,
mesmo que o run corra no espaço dela. O executor deixa de fazer
`connection.findMany({ userId: run.userId })` e
`listAgentSkillRecords` pela conta de quem fala ou de quem criou o bot.

`resolveRunModel` deixa de exigir `Bot.userId = userId` do run. Lê o bot
por `botId` e `spaceId` e usa a credencial da instalação.

## Delegação

`crossSpaceCommunication` fica desligado nos bots que tenham algum `USER`
atribuído. Atravessar spaces sai do conjunto de atribuições.

`fleetManagement` e os bots filhos só delegam num bot que esse mesmo `USER`
também tenha atribuído, por `BotAssignment` ou pela área. Um filho criado
nesse run nasce na conta de serviço, com `BotAssignment` só para quem falou,
thread e computador dedicated só dessa pessoa. O outro `USER` do bot pai
não o vê.

Se o alvo não está atribuído a quem falou, a delegação é recusada. Não há
fallback para um bot do admin. Um bot importado com a flag ligada e sem
alvos atribuídos comporta-se como desligado.

## AuditEvent

`AuditEvent` guarda ator, ação, alvo, resultado e data, sem conteúdo de
mensagem e sem segredos. `tool.call` continua com o bot como ator e passa a
levar no `metadata` o `userId` de quem falou, e nada do texto.

Ações novas, sem valores de segredo, chaves, prompts ou mensagens:

- `hive.role.set`
- `hive.department.create`, `hive.department.rename`, `hive.department.delete`
- `hive.department.member.add`, `hive.department.member.remove`
- `hive.bot.assign_user`, `hive.bot.unassign_user`
- `hive.bot.assign_department`, `hive.bot.unassign_department`
- `hive.bot.create`, `hive.bot.update`, `hive.bot.archive`, `hive.bot.remove`
- `hive.bot.connect`, `hive.bot.disconnect` para `BotConnection`
- `hive.routine.create`, `hive.routine.update`, `hive.routine.remove`
- `hive.mcp.create`, `hive.mcp.update`, `hive.mcp.remove`, `hive.mcp.assign`
- `hive.secret.put`, `hive.secret.remove`
- `hive.skill.create`, `hive.skill.update`, `hive.skill.remove`
- `hive.plugin.install`, `hive.plugin.remove`
- `hive.model.connect`, `hive.model.disconnect`
- `hive.computer.attach`, `hive.computer.detach`
- `hive.conversation.read`
- `hive.member.remove` quando um admin é removido
- `hive.post.publish` com o id do bot e o id do post, sem o texto

Uma recusa de um `USER` numa rota de edição grava `hive.access.denied` com
o caminho da rota e o id do alvo, sem o corpo do pedido.

## Testes

Dois `USER` e um admin na mesma organização e no mesmo espaço. Um bot na
conta de serviço, sem atribuição. Tudo pela API, e outra vez pela base com
o papel `rakazo_app` e `app.user_id` / `app.space_id` de cada um.

- O `USER` não vê o bot em `bots/list`.
- `bots/get`, `threads/get` e `threads/send` com o id do bot falham como
  se o bot não existisse.
- `bots/update`, `routines/create`, `mcp/servers/create`, `vault/put`,
  `agentSkills/create`, `computer/boot`, `connections/begin` e
  `models/connect` falham para o `USER`.
- Atribuir o bot ao `USER` passa a deixar listar, abrir e enviar na thread
  dele. As rotas de edição continuam a falhar.
- Tirar a atribuição direta e atribuir o bot a uma área dos dois `USER`
  volta a deixar cada um listar e enviar.
- Cada um só lê a sua thread, as suas mensagens, os seus `Artifact`,
  `MemoryDocument` e `ScratchpadItem`. O `SELECT` do outro, com o id, vem
  vazio. O mesmo para ficheiros: o artefacto de um não entra na lista do
  outro, nem num `SELECT` em `artifacts`.
- Uma `Connection` que existe na conta do admin e não está em
  `BotConnection` não é carregada no run do `USER` e não pode ser chamada.
- O admin vê a ficha e os `usage_records`. `threads/get` e um `SELECT` em
  `messages` não devolvem o texto. `conversations/inspect` sem ser
  `SUPER_ADMIN` falha. Com o procedimento, a leitura aparece em
  `AuditEvent` e acaba quando o prazo acaba.
- O run do `USER` usa a credencial da instalação. `Run.userId` é o do
  `USER`. Não há leitura de `Connection` nem de `AgentSkill` do admin.
- Remover o admin deixa o bot na conta de serviço, ainda listável por quem
  está atribuído.
- O `AuditEvent` da atribuição tem o admin como ator e não contém o texto
  da mensagem nem um segredo.
- Um bot com `fleetManagement` não delega num bot que esse `USER` não tenha
  atribuído.
- Num bot de área com dois `USER`, o resultado de uma rotina chega à thread
  de cada destinatário. Não há thread partilhada.
- Uma `Connection` pessoal não entra em `BotConnection`. Uma ligação da
  conta de serviço entra. Remover o admin deixa o bot e a ligação no sítio.
- A política omissa arquiva. A pessoa arquivada não aparece; o conteúdo só
  volta por `conversations/inspect`.
- O computador dedicado do par arranca a pedido, pára depois da inactividade
  configurada, e espera na fila quando o limite global de activos está cheio.
- Atribuir o bot a Todos deixa-o visível aos dois `USER`. Apagar ou
  renomear Todos falha.
- Atribuição directa `READ_ONLY` e atribuição pela área em `CHAT` dão
  `CHAT`.
- Um `USER` com `READ_ONLY` vê o feed (`posts/list`, `posts/get` e o
  artefacto). `threads/send` falha. A interface desse caso não tem caixa
  de texto.
- Outro `USER` sem atribuição não vê as publicações, nem por `SELECT` em
  `bot_posts`.
- A publicação não aparece em nenhuma thread pessoal.

## Verificação

O modelo de teste é `qwen3.5:2b`, servido pelo Ollama no computador anfitrião pelo endpoint compatível com OpenAI. O endereço, a chave e o nome do modelo vêm de `HIVE_MODEL_BASE_URL`, `HIVE_MODEL_API_KEY` e `HIVE_DEFAULT_MODEL`. A partir do Compose no Docker Desktop o endereço é `http://host.docker.internal:11434/v1`, com `MCP_ALLOW_PRIVATE_ENDPOINT=true`. Ollama não valida a chave; o cliente envia uma na mesma. Apontar os mesmos três valores para o LiteLLM chega para a fase seguinte.

Duas pessoas com `CHAT` no Desk enviaram uma mensagem e receberam resposta desse modelo. Cada uma vê só a sua conversa. O admin, também em Todos com `CHAT`, tem caixa no Desk. A rotina Daily do Bulletin criou um `BotPost`. O admin e as duas pessoas veem o mesmo post. O Bulletin não tem caixa nem threads pessoais. As duas pessoas recebem 404 ao enviar para o Bulletin, ao criar um bot e ao testar a rotina. As chamadas, incluindo ferramentas, terminaram sem erro.

`pnpm test` no Windows falha em casos que não são da Fase 2: sockets de controlo em `\tmp\rk-control` com `EACCES`, scripts que invocam `sh` e deploys feitos para Unix, e workers de teste que esgotam o tempo. A mesma suite no commit anterior à Fase 2 falha nesses ficheiros. `events.test.ts` passou a usar `updateMany` e foi alinhado. A suite do servidor corre em Linux.
