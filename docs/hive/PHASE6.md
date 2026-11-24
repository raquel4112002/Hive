<!-- Hive modification: Phase 6 brand. Derived from Rakazo (Apache License 2.0). -->

# Fase 6 — imagem da empresa

Cada organização tem um nome, um texto de login, uma cor principal, uma cor de destaque, um logótipo claro, um logótipo escuro e um favicon. O valor por omissão do nome é `Hive`, ou `HIVE_BRAND_NAME` quando está definido. O que um admin grava no portal substitui o `.env`.

Só `SUPER_ADMIN` e `ADMIN` gravam. Um `USER` cai no mesmo erro de isolamento das outras ações de admin, e a API responde 404. A leitura da marca da própria organização está aberta a quem tem sessão. O ecrã de login, sem sessão, usa o convite quando o endereço o traz, ou a única organização da instalação. Com várias organizações e sem convite, ficam os valores de instalação, sem ficheiros.

Os ficheiros ficam no MinIO do perfil `knowledge`, na chave `brand/<organização>/...`. Sem esse perfil, ficam no diretório de dados. PNG, SVG e ICO, até 512 KB. Um SVG com `script`, um URL `javascript:`, um atributo `on…` ou um `iframe` é recusado com `This image is not allowed.`

As cores entram em `--primary`, `--primary-foreground` e `--brand-accent` no elemento da página, por isso o modo claro e o escuro continuam a aplicar o resto do tema. O texto sobre a cor principal é branco ou preto, o que tiver mais contraste. Se o texto branco ficar abaixo de 4.5:1, o portal avisa `White text would be hard to read on this color.` e usa texto preto. A cor é gravada na mesma.

O login, a barra lateral, o título da página, o favicon e o topo das publicações mostram essa marca. O convite, quando há um servidor de email, leva o nome da organização no assunto e no corpo. Cada bot pode ter um avatar carregado; o nome do bot mantém-se. O separador de ícones que dizia Rakazo passa a dizer Icon.

Duas organizações não partilham o texto: a vista de uma não contém o nome da outra, e os emails de convite também não.
