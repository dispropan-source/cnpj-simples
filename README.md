# CNPJ Simples

Aplicação web para importar uma lista de CNPJs em CSV e consultar o enquadramento no Simples Nacional usando dados públicos da [BrasilAPI](https://brasilapi.com.br/).

**Aplicação publicada:** [cnpj.dispropan.app](https://cnpj.dispropan.app/)

## Funcionalidades

- Importação de CSV separado por vírgula ou ponto e vírgula.
- Detecção automática da coluna `CNPJ`.
- Validação dos dígitos verificadores.
- CNAE principal (código e descrição) de cada CNPJ.
- Processamento automático em lotes de 25 consultas.
- Pausa e retomada da fila.
- Resultados progressivos e filtros por enquadramento.
- Exportação parcial ou completa em CSV.
- Link de conferência no Portal do Simples Nacional.

## Arquitetura

Site **100% estático** (client-side). A consulta é feita direto do navegador para a
BrasilAPI — não há banco de dados, login nem servidor intermediário. O build gera a
pasta `out/`, que pode ser hospedada em qualquer servidor de arquivos estáticos.

Construído com [Next.js](https://nextjs.org/) (App Router) em modo de export estático
(`output: "export"`), React 19 e Tailwind CSS v4.

## Como executar

Requer Node.js 20 ou superior.

```bash
npm install
npm run dev
```

## Como gerar a versão estática (produção)

```bash
npm run build
```

Os arquivos prontos para publicação ficam na pasta `out/`. Basta enviar o **conteúdo**
dessa pasta para a raiz do subdomínio no servidor de hospedagem.

## Estrutura principal

- `app/page.tsx`: interface, leitura do CSV, fila de processamento e exportação.
- `app/layout.tsx`: metadados, fontes e estrutura do documento.
- `app/globals.css`: identidade visual e responsividade.

## Fonte e uso responsável

A BrasilAPI é um projeto comunitário e gratuito. O app limita o ritmo das consultas e
processa os dados em lotes para evitar sobrecarga. Para decisões fiscais, confirme o
resultado no [Portal oficial do Simples Nacional](https://www8.receita.fazenda.gov.br/SimplesNacional/aplicacoes.aspx?id=21).

Quando a fonte não fornece um valor conclusivo, o resultado é exibido como **Não informado**, nunca convertido automaticamente em **Não optante**.
