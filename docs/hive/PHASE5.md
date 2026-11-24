<!-- Hive modification: Phase 5 knowledge. Derived from Rakazo (Apache License 2.0). -->

# Fase 5 — conhecimento por bot

Um admin cria coleções e liga-as a bots. Cada documento tem uma ACL: a organização, departamentos, ou pessoas. Na ingestão essa ACL é copiada para cada pedaço. A pesquisa não filtra depois, nem no prompt: a sessão SQL fica com a pessoa que conversa, ou com a lista de destinatários, e o row-level security esconde o resto.

Os ficheiros originais ficam no MinIO, perfil `knowledge`. O browser não recebe o endpoint nem as credenciais. Os pedaços e os embeddings ficam no Postgres com pgvector, 768 dimensões. O pedido de embedding vai ao LiteLLM quando `HIVE_LITELLM_BASE_URL` está definido, e ao endpoint do modelo de instalação quando o proxy está parado. O modelo é `HIVE_EMBEDDING_MODEL`.

PDF, DOCX, TXT e MD entram. O OCR fica desligado: pedi-lo marca o documento como falhado com `OCR is not configured.` Apagar o documento apaga o ficheiro, os pedaços e os embeddings. Reprocessar lê o ficheiro outra vez. Um conector SharePoint ou Google Drive, com herança das permissões de origem, fica por fazer.

Numa conversa, a pesquisa usa o utilizador dessa conversa. Num bot da organização cada pessoa só recebe o que ela pode ver. Uma rotina ou publicação da conta de serviço só usa documentos visíveis para todos os destinatários dessa publicação. Se a consulta não devolve nada, a ferramenta diz `I did not find that in the documents I can read.` e a resposta não deve nomear um documento.

A cópia do volume do MinIO está no [INSTALL.md](INSTALL.md), junto do Postgres e do OpenBao.
