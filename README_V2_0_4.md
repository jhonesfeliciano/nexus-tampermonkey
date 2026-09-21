# NEXUS - Atualização Notas Perdidas v2.0.4

Esta versão corrige a inconsistência entre **Atualizar pelo Sistema** e **Importar arquivo**.

## Regra aplicada
- A Região é o conjunto completo exibido no relatório Notas Perdidas.
- `Qtd Remarcada > 0` = **Atrasada**.
- `Qtd Remarcada = 0` = **Em Dia**.
- `Atrasadas + Em Dia` deve ser exatamente igual à **Contagem** do rodapé daquela Região no APEX.
- Se a captura não fechar com o rodapé, o envio é bloqueado para evitar salvar dados incompletos.

## Publicação
1. Envie `releases/2.0.4/` e faça o commit.
2. Depois substitua `manifest.json` e faça outro commit.
3. Atualize o HTML no Netlify usando o ZIP correspondente.

Os loaders existentes não precisam ser reinstalados.
