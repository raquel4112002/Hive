<!-- Hive modification: Phase 7 login, install, and backups. Derived from Rakazo (Apache License 2.0). -->

# Fase 7 — login empresarial, instalação e cópias

O OIDC fica por organização. Um admin grava o issuer, o client id e o segredo no painel. O segredo vai para o cofre, no caminho `org/<organização>/bot/_sso/client`, e não volta na leitura. Com uma configuração ativa, o processo usa esses valores no arranque. O `.env` continua a servir o perfil `sso`. O browser usa `http://127.0.0.1:18080` e `OIDC_DISCOVERY_URL` aponta para `http://keycloak:8080/realms/hive`, para a API ler a descoberta na rede interna. `OIDC_ALLOW_INSECURE=true` só é aceite nesse HTTP.

Uma conta nova, com email verificado, entra como USER na área Todos. Não fica SUPER_ADMIN. Um grupo do IdP pode subir essa pessoa a ADMIN e juntá-la a um departamento, numa linha `grupo=ADMIN:Departamento`. Uma conta que já existe só fica ligada ao IdP quando essa pessoa está autenticada e usa o fluxo de ligação. Um email por verificar, ou um subject que muda o email para o de outra conta, não liga. Com o login por password desligado, o SUPER_ADMIN fundador continua a poder entrar com password. É a conta de emergência.

Remover a pessoa no IdP não chega ao Hive sozinho. A sincronização recebe a lista de subjects ainda presentes, arquiva quem falta e apaga as sessões. Um admin também pode desativar a conta e terminar as sessões nesse momento. No login seguinte uma conta arquivada recebe `This account is disabled.`

SAML não está implementado. O ecrã de SSO é o sítio onde entraria, com o mesmo cofre para o segredo, quando o OIDC estiver estável em produção.

O script `scripts/hive-install.sh` destina-se a Ubuntu e Debian. Confirma o Docker, gera segredos no `.env` quando estão vazios, recusa portas internas publicadas em todas as interfaces, arranca os perfis pedidos e espera por `/health`. O Caddy, perfil `edge`, é a única entrada HTTPS. O certificado interno é `tls internal`. Let's Encrypt fica por retirar essa linha e definir o domínio público.

`scripts/hive-backup.sh` escreve o `pg_dump`, os volumes do MinIO e do OpenBao, o diretório de dados e o `.env` cifrado. `HIVE_BACKUP_KEEP` é a retenção em dias. `HIVE_BACKUP_TARGET` copia para outro diretório ou para `s3://`. O timer diário está em `infra/compose/hive-backup.timer`. `scripts/hive-update.sh` faz a cópia antes de reconstruir. Se a saúde falhar, `scripts/hive-restore.sh` volta a carregar essa cópia.

O ecrã de estado do admin mostra a versão, os perfis ligados, se o cofre está aberto ou selado, e o espaço livre em disco.

## Verificação

O login local no Keycloak entrou com email verificado, ficou ADMIN, e ficou na área Todos e no departamento do grupo. Arquivar a conta fez o login seguinte voltar com `ACCOUNT_DISABLED`. A cópia de segurança foi restaurada numa base temporária: bots, conversas, mensagens e a marca voltaram, as tabelas de conhecimento, marca e SSO continuam com `FORCE ROW LEVEL SECURITY`, e o papel da aplicação não viu a linha de prova. A base temporária foi apagada. O script de instalação foi validado na sintaxe. Não houve uma máquina Linux limpa nem uma segunda stack para o restauro completo.
