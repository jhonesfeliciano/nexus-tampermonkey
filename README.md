# NEXUS — Loader Dinâmico GitHub + Tampermonkey

Este pacote separa o Tampermonkey em dois loaders pequenos e mantém o código real versionado no GitHub.

## Estrutura

```text
manifest.json
releases/
  1.9.0/
    teresina/nexus-teresina.js
    palmas/nexus-palmas.js
loaders/
  NEXUS_LOADER_TERESINA.user.js
  NEXUS_LOADER_PALMAS.user.js
```

O `manifest.json` informa qual versão cada loader deve executar. Os loaders baixam a versão aprovada do GitHub, validam o SHA-256 e a sintaxe e, depois de uma execução inicial válida, guardam uma cópia no armazenamento do Tampermonkey. Se o GitHub ficar fora do ar, o último código salvo é usado como fallback.

## Requisito importante

Use um repositório **público** e exclusivo para estes scripts. Não coloque senhas, tokens, credenciais privadas ou arquivos sensíveis nele.

## Primeira instalação

1. Crie no GitHub um repositório público, por exemplo `nexus-tampermonkey`.
2. Envie para a raiz do repositório **o conteúdo desta pasta**, não a pasta externa inteira. Assim `manifest.json` precisa aparecer diretamente na raiz do GitHub.
3. No Tampermonkey, desative os scripts antigos `CICLOS - TERESINA...` e `CICLOS - PALMAS...` para evitar dois painéis na mesma página.
4. Instale apenas o loader correspondente ao computador/local:
   - `loaders/NEXUS_LOADER_TERESINA.user.js`, ou
   - `loaders/NEXUS_LOADER_PALMAS.user.js`.
5. Abra `https://sistema.romancemoda.com.br/` e acesse a página Notas Perdidas. Na primeira execução o loader pedirá o repositório.
6. Informe no formato `SEU_USUARIO/nexus-tampermonkey` ou cole a URL completa do repositório.
7. Recarregue a página. O painel CICLOS v1.9 deve aparecer normalmente.

## Atualizar futuramente sem mexer no Tampermonkey

Não substitua a versão antiga. Crie uma nova pasta, por exemplo:

```text
releases/2.0.0/teresina/nexus-teresina.js
releases/2.0.0/palmas/nexus-palmas.js
```

Depois altere somente o `manifest.json` para apontar para a nova versão. O loader buscará a nova versão automaticamente na próxima abertura/recarregamento da página.

### Rollback

Se uma versão nova apresentar problema, basta voltar `version`, `path` e `sha256` do `manifest.json` para a versão anterior. Os arquivos da versão antiga permanecem no repositório.

## Menus do loader no Tampermonkey

Cada loader registra opções para:

- configurar/trocar o repositório;
- ver versão e cache atual;
- limpar o cache local.

## Cache offline

O cache é salvo somente depois que o arquivo remoto passa pela validação de tamanho, sintaxe e SHA-256 e a execução inicial não gera erro síncrono. Se o GitHub falhar em uma abertura posterior, o loader tenta executar esse cache.

## Loader MATRIZ

O arquivo `loaders/NEXUS_LOADER_MATRIZ.user.js` é destinado ao computador administrativo. Ele usa o repositório `jhonesfeliciano/nexus-tampermonkey`, identifica solicitações pendentes de TERESINA/PALMAS no Firebase e carrega somente o canal necessário. Quando não há solicitação, exibe um seletor manual. Possui cache separado por canal e retoma automaticamente uma captura após recarregamento do Oracle APEX.


## v2.0.0 - correção das notas atrasadas por semana
A semana operacional de cada nota passa a ser calculada por **Semana Distribuição + 6 semanas**. A Semana Cobrança continua no payload para auditoria, mas não desloca uma nota remarcada para outra semana. O manifest já aponta para 2.0.0 e a 1.9.0 foi mantida para rollback.
