<!-- Hive modification: Phase 4 credential vault. Derived from Rakazo (Apache License 2.0). -->

# Fase 4 — cofre por bot

Cada bot tem credenciais próprias: email, login de um sistema, e API keys. O valor fica no cofre. A API devolve só se está definido e a data em que mudou.

`SECRET_STORE=encrypted` continua a ser o arranque. `SECRET_STORE=openbao` usa o OpenBao do Compose, perfil `vault`, em desenvolvimento e em produção. O perfil fica parado até ser pedido.

O caminho de cada segredo é `org/<orgId>/bot/<botId>/<nome>`. No primeiro arranque com o token de root, o Hive cria o mount kv versão 2 em `secret/` se esse caminho estiver vazio. Ao gravar, cria uma política que só deixa o runtime desse bot ler esse caminho. O token de gestão escreve e não lê `secret/data/org/`. Arquivar o bot apaga a política e revoga o token.

A key do LiteLLM da Fase 3 passa para o mesmo caminho, `.../litellm`. As credenciais que já existiam são copiadas e lidas de volta antes de o ponteiro mudar. Se a leitura falhar, a cópia anterior fica.

Um admin grava e apaga no painel do bot. Um USER recebe 404 e não vê o formulário. O modelo não recebe o valor: a shell usa a variável `HIVE_<tipo>_<nome>` e a resposta, o progresso, a transcrição e a memória passam pelo redactor. O texto guardado mostra `[redacted]`.

Cada criação, alteração e remoção fica num evento com a pessoa e a hora. Cada vez que um run lê a credencial fica um evento `used` com o bot. O valor não entra no evento.

Depois de um restart o OpenBao fica selado. O health check da API, o aviso no portal do admin e a execução que precisa de uma credencial dizem `cofre selado`. A execução falha com essa mensagem em vez de ficar em working. O unseal manual e a opção de unseal automático com transit ou KMS, que esta instalação ainda não liga, estão no [INSTALL.md](INSTALL.md), com a cópia e o restauro do volume.
