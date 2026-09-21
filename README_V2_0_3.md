# Nexus Tampermonkey — v2.0.3

Correção da integração de **Notas Perdidas**.

A regra passa a ser explícita:

- **Em Dia:** usa a Semana Cobrança que está sendo confirmada no Nexus.
- **Atrasadas:** usa todas as notas da mesma Região com `Qtd Remarcada > 0`, mesmo quando a remarcação moveu a coluna Cobrança para outra semana.

Isso preserva as notas atrasadas quando uma região avança para a próxima passagem do ciclo (+6 semanas).

## Publicação

Envie `releases/2.0.3/` primeiro. Depois de confirmar os arquivos no GitHub, substitua `manifest.json`.

Os loaders TERESINA, PALMAS e MATRIZ não precisam ser reinstalados.
