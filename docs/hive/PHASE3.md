<!-- Hive modification: Phase 3. Derived from Rakazo (Apache License 2.0). -->

# Fase 3 — uma key do LiteLLM por bot

Cada bot pode ter a sua key no proxy LiteLLM. A key da instalação continua a ser o recurso quando o bot não tem uma. Sem o proxy, o Hive usa o endpoint de hoje.

## Configuração

`HIVE_LITELLM_BASE_URL` é a raiz do proxy, sem `/v1`. `HIVE_LITELLM_MASTER_KEY` é a key de administração. As duas ficam no `.env` do servidor. Não entram no cliente, nem em `AppEnv` enviado ao browser. Falta uma delas e o proxy fica desligado.

`HIVE_MODEL_BASE_URL`, `HIVE_MODEL_API_KEY` e `HIVE_DEFAULT_MODEL` mantêm-se. São o Ollama, ou outro endpoint compatível com OpenAI, usado quando o bot não tem key. As chamadas ao modelo, quando há proxy, usam a raiz mais `/v1`.

## Key do bot

Ao criar um bot, o admin vê os modelos de `GET /model/info`. Pode indicar um orçamento mensal, em dólares. O Hive chama `POST /key/generate` com o modelo, `max_budget`, `budget_duration` de 30 dias, e metadados `bot_id` e `org_id`. O alias é `hive-` mais o id do bot. A key volta cifrada pelo `SECRET_STORE` e fica em `bot_litellm_keys`. A resposta ao browser não traz a key.

O admin pode colar uma key que já existe. Nesse caso não há `generate`. O modelo continua a ser obrigatório. Sem proxy, pedir um modelo ou uma key falha com um erro claro e o bot não fica criado.

Mudar o modelo ou o orçamento chama `POST /key/update` com a key decifrada. Arquivar chama `POST /key/block` e guarda a linha. Restaurar chama `POST /key/unblock`. Se o unblock falhar, o bot restaura na mesma. Apagar chama `POST /key/delete` e remove a linha. Se o proxy recusar o apagar, o bot não é apagado, para se poder tentar outra vez. Duplicar um bot não copia a key.

A tabela é nova. A versão anterior não a lê. A política de row-level security só passa com `app.rls_bypass`.

## Execução

Conversas, rotinas e publicações usam a key do bot. A key da instalação só entra quando o bot não tem linha em `bot_litellm_keys`. O runtime de teste não chama o proxy e não falha por falta de key.

Antes da chamada ao modelo, o Hive lê `GET /key/info`. Se `spend` atingiu `max_budget`, a conversa mostra "This bot has reached its monthly budget." A rotina falha com essa frase e não volta a `working`. Uma falha do proxy nessa leitura não conta como orçamento esgotado: a chamada ao modelo segue.

## Custos

O ecrã de administração lê `GET /spend/logs?summarize=false` do mês. Cada linha entra no bot pelo `metadata.bot_id` ou, quando o log só traz o alias, por `user_api_key_alias` com o prefixo `hive-`. O ecrã mostra dólares e tokens, por bot e por departamento. Um bot em dois departamentos entra nos dois totais. O `config.yaml` do proxy deixa os modelos locais a 0 por token, por isso o dinheiro fica em 0.00 até alguém definir um preço. `USER` recebe 404. Sem proxy, a lista vem vazia e o catálogo de modelos vem desligado.

## Testes

O cliente do proxy é testado com `fetch` simulado: catálogo sem duplicados, generate com modelo, orçamento e metadados, update, block, delete, soma dos logs (objeto `data` ou lista), e um erro que não contém a master key. Uma key com o gasto já em cima do orçamento falha antes da chamada ao modelo. Se `/key/info` não responder, a key segue e o run não é tratado como orçamento esgotado.

## Verificação

Um proxy LiteLLM temporário, com a sua própria base, ficou apontado ao Ollama do anfitrião. `GET /model/info` devolveu `qwen2.5:0.5b` e `qwen3.5:2b`. `POST /key/generate` devolveu uma key com o alias pedido e os metadados `bot_id` e `org_id`. Uma conclusão em `/v1/chat/completions`, autenticada com essa key e não com a master key, respondeu. `GET /key/info` devolveu o orçamento e os mesmos metadados. O proxy precisa de `DATABASE_URL` para emitir keys; sem isso `/key/generate` responde que a base não está ligada. O contentor de teste foi parado a seguir.
