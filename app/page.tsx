"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type SimplesStatus = "sim" | "nao" | "nao_informado" | "erro" | "pendente" | "consultando" | "invalido";

type Company = {
  id: string;
  cnpj: string;
  formattedCnpj: string;
  status: SimplesStatus;
  razaoSocial?: string;
  nomeFantasia?: string;
  situacaoCadastral?: string;
  dataOpcao?: string | null;
  dataExclusao?: string | null;
  cnaeCodigo?: string;
  cnaeDescricao?: string;
  message?: string;
};

type ApiCompany = {
  cnpj: string;
  razao_social?: string;
  nome_fantasia?: string;
  descricao_situacao_cadastral?: string;
  opcao_pelo_simples?: boolean | null;
  data_opcao_pelo_simples?: string | null;
  data_exclusao_do_simples?: string | null;
  cnae_fiscal?: number | string | null;
  cnae_fiscal_descricao?: string | null;
  message?: string;
};

const BATCH_SIZE = 25;
const DISPLAY_STEP = 100;
const OFFICIAL_URL = "https://www8.receita.fazenda.gov.br/SimplesNacional/aplicacoes.aspx?id=21";
// Consulta direta à fonte pública (site estático, sem servidor intermediário).
const BRASIL_API_BASE = "https://brasilapi.com.br/api/cnpj/v1";

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function formatCnpj(value: string) {
  const digits = onlyDigits(value).padStart(14, "0");
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

// A fonte devolve o CNAE como 7 dígitos (9430800). O padrão de leitura é 9430-8/00.
function formatCnae(value: number | string | null | undefined) {
  const digits = onlyDigits(String(value ?? ""));
  if (digits.length !== 7) return digits || "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 5)}/${digits.slice(5)}`;
}

function isValidCnpj(value: string) {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const calculateDigit = (base: string) => {
    let weight = base.length - 7;
    const sum = base.split("").reduce((total, digit) => {
      const result = total + Number(digit) * weight;
      weight -= 1;
      if (weight === 1) weight = 9;
      return result;
    }, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = calculateDigit(cnpj.slice(0, 12));
  const second = calculateDigit(cnpj.slice(0, 12) + first);
  return cnpj.endsWith(`${first}${second}`);
}

function parseCsv(text: string) {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return [];
  const firstLine = cleaned.split(/\r?\n/, 1)[0];
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    const next = cleaned[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function extractCnpjs(text: string) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const normalizedHeaders = rows[0].map((cell) => cell.toLowerCase().replace(/[^a-z0-9]/g, ""));
  let cnpjIndex = normalizedHeaders.findIndex((header) => header === "cnpj" || header.includes("cnpj"));
  const hasHeader = cnpjIndex >= 0;
  if (!hasHeader) cnpjIndex = 0;

  return rows.slice(hasHeader ? 1 : 0).map((row) => row[cnpjIndex] ?? "").filter(Boolean);
}

function statusLabel(status: SimplesStatus) {
  return {
    sim: "Optante",
    nao: "Não optante",
    nao_informado: "Não informado",
    erro: "Falha na consulta",
    pendente: "Na fila",
    consultando: "Consultando",
    invalido: "CNPJ inválido",
  }[status];
}

function csvEscape(value: string | null | undefined) {
  const safe = String(value ?? "");
  return `"${safe.replace(/"/g, '""')}"`;
}

export default function Home() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [fileName, setFileName] = useState("");
  const [notice, setNotice] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [filter, setFilter] = useState<"todos" | "sim" | "nao" | "outros">("todos");
  const [visibleCount, setVisibleCount] = useState(DISPLAY_STEP);
  const stopRef = useRef(false);

  const stats = useMemo(() => ({
    total: companies.length,
    sim: companies.filter((item) => item.status === "sim").length,
    nao: companies.filter((item) => item.status === "nao").length,
    outros: companies.filter((item) => ["nao_informado", "erro", "invalido"].includes(item.status)).length,
    erros: companies.filter((item) => item.status === "erro").length,
    concluidos: companies.filter((item) => !["pendente", "consultando", "erro"].includes(item.status)).length,
    aguardando: companies.filter((item) => item.status === "pendente" || item.status === "erro").length,
  }), [companies]);

  const filtered = companies.filter((item) => {
    if (filter === "todos") return true;
    if (filter === "outros") return ["nao_informado", "erro", "invalido"].includes(item.status);
    return item.status === filter;
  });

  const loadText = (text: string, name: string) => {
    const values = extractCnpjs(text);
    if (!values.length) {
      setNotice("Não encontrei CNPJs. Use uma coluna chamada CNPJ ou coloque o CNPJ na primeira coluna.");
      return;
    }

    const unique = Array.from(new Set(values.map(onlyDigits).filter(Boolean)));
    setCompanies(unique.map((cnpj, index) => ({
      id: `${cnpj}-${index}`,
      cnpj,
      formattedCnpj: cnpj.length === 14 ? formatCnpj(cnpj) : cnpj,
      status: isValidCnpj(cnpj) ? "pendente" : "invalido",
      message: isValidCnpj(cnpj) ? undefined : "Os dígitos verificadores não conferem.",
    })));
    setFileName(name);
    setFilter("todos");
    setVisibleCount(DISPLAY_STEP);
    setNotice(`${unique.length} CNPJ${unique.length === 1 ? "" : "s"} único${unique.length === 1 ? "" : "s"} carregado${unique.length === 1 ? "" : "s"}. A fila será processada automaticamente em lotes de até ${BATCH_SIZE}.`);
  };

  const readFile = (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setNotice("Escolha um arquivo no formato CSV.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => loadText(String(reader.result ?? ""), file.name);
    reader.readAsText(file, "UTF-8");
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => readFile(event.target.files?.[0]);
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    readFile(event.dataTransfer.files?.[0]);
  };

  const updateCompany = (id: string, patch: Partial<Company>) => {
    setCompanies((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const runQueries = async () => {
    stopRef.current = false;
    setIsRunning(true);
    const allPending = companies.filter((item) => item.status === "pendente" || item.status === "erro");
    const totalBatches = Math.ceil(allPending.length / BATCH_SIZE);
    let processed = 0;
    let failed = 0;

    for (let batchStart = 0; batchStart < allPending.length; batchStart += BATCH_SIZE) {
      if (stopRef.current) break;
      const batch = allPending.slice(batchStart, batchStart + BATCH_SIZE);
      const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;
      setNotice(`Processando lote ${batchNumber} de ${totalBatches}. Os resultados aparecem abaixo à medida que chegam.`);

      for (const company of batch) {
        if (stopRef.current) break;
        updateCompany(company.id, { status: "consultando", message: undefined });
        try {
          const response = await fetch(`${BRASIL_API_BASE}/${company.cnpj}`, {
            headers: { Accept: "application/json" },
          });
          const data = await response.json() as ApiCompany;
          if (!response.ok) throw new Error(data.message || "Não foi possível consultar este CNPJ.");

          const status: SimplesStatus = data.opcao_pelo_simples === true
            ? "sim"
            : data.opcao_pelo_simples === false
              ? "nao"
              : "nao_informado";
          updateCompany(company.id, {
            status,
            razaoSocial: data.razao_social,
            nomeFantasia: data.nome_fantasia,
            situacaoCadastral: data.descricao_situacao_cadastral,
            dataOpcao: data.data_opcao_pelo_simples,
            dataExclusao: data.data_exclusao_do_simples,
            cnaeCodigo: formatCnae(data.cnae_fiscal),
            cnaeDescricao: data.cnae_fiscal_descricao ?? undefined,
            message: status === "nao_informado" ? "A fonte não trouxe um valor conclusivo para o Simples." : undefined,
          });
        } catch (error) {
          failed += 1;
          updateCompany(company.id, { status: "erro", message: error instanceof Error ? error.message : "Falha na consulta." });
        }
        processed += 1;
        if (!stopRef.current) await new Promise((resolve) => setTimeout(resolve, 900));
      }

      const stillQueued = allPending.length - processed;
      if (!stopRef.current && stillQueued > 0) {
        setNotice(`Lote ${batchNumber} concluído. O próximo lote começa automaticamente em instantes — ${stillQueued} CNPJ${stillQueued === 1 ? "" : "s"} na fila.`);
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    }

    setIsRunning(false);
    const remaining = allPending.length - processed + failed;
    setNotice(stopRef.current
      ? `Consulta pausada. ${remaining} CNPJ${remaining === 1 ? "" : "s"} ainda aguardam na fila.`
      : failed > 0
        ? `Fila finalizada. ${failed} consulta${failed === 1 ? "" : "s"} ${failed === 1 ? "falhou" : "falharam"} e pode${failed === 1 ? "" : "m"} ser tentada${failed === 1 ? "" : "s"} novamente.`
        : "Todos os lotes foram concluídos. Revise os itens não informados antes de usar o resultado.");
  };

  const stopQueries = () => {
    stopRef.current = true;
  };

  const exportResults = () => {
    const headers = ["CNPJ", "Razão social", "Nome fantasia", "CNAE principal", "Descrição do CNAE", "Simples Nacional", "Situação cadastral", "Data da opção", "Data da exclusão", "Observação"];
    const lines = companies.map((item) => [
      item.formattedCnpj,
      item.razaoSocial,
      item.nomeFantasia,
      item.cnaeCodigo,
      item.cnaeDescricao,
      statusLabel(item.status),
      item.situacaoCadastral,
      item.dataOpcao,
      item.dataExclusao,
      item.message,
    ].map(csvEscape).join(";"));
    const blob = new Blob(["\uFEFF", headers.map(csvEscape).join(";"), "\r\n", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `resultado-simples-nacional-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadExample = () => {
    const blob = new Blob(["CNPJ;referencia\r\n19.131.243/0001-97;exemplo\r\n"], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "modelo-cnpjs.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const progress = stats.total ? Math.round((stats.concluidos / stats.total) * 100) : 0;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="CNPJ Simples — início">
          <span className="brand-mark">CS</span>
          <span>CNPJ Simples</span>
        </a>
        <div className="source-chip"><span /> Fonte pública · BrasilAPI</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span>01</span> CONSULTA EM LOTE</div>
        <h1>Descubra quem é<br /><em>Simples Nacional.</em></h1>
        <p>Importe uma lista de CNPJs, consulte o enquadramento e leve o resultado em CSV. Sem cadastro e sem chave de API.</p>
        <div className="trust-row">
          <span>✓ Validação de CNPJ</span>
          <span>✓ Consulta moderada</span>
          <span>✓ Exportação pronta</span>
        </div>
      </section>

      <section className="workspace" aria-labelledby="upload-title">
        <div className="step-head">
          <div><span className="step-number">01</span><div><p>PRIMEIRO PASSO</p><h2 id="upload-title">Envie sua lista</h2></div></div>
          <button className="text-button" type="button" onClick={downloadExample}>Baixar CSV modelo ↓</button>
        </div>

        <label
          className={`dropzone ${isDragging ? "dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
        >
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
          <span className="upload-icon">↥</span>
          <strong>{fileName || "Arraste o CSV para cá"}</strong>
          <span>{fileName ? "Clique para trocar o arquivo" : "ou clique para escolher no computador"}</span>
          <small>Coluna “CNPJ” · processamento automático em lotes de até {BATCH_SIZE}</small>
        </label>

        {notice && <div className="notice" role="status"><span>i</span>{notice}</div>}

        {companies.length > 0 && (
          <div className="action-row">
            <div><strong>{companies.length}</strong><span>CNPJs carregados · {stats.aguardando} aguardando</span></div>
            {!isRunning ? (
              <button className="primary-button" type="button" onClick={runQueries} disabled={!companies.some((item) => item.status === "pendente" || item.status === "erro")}>
                {stats.aguardando === 0
                  ? "Todos consultados"
                  : stats.erros === stats.aguardando && stats.concluidos > 0
                    ? `Tentar novamente (${stats.aguardando})`
                    : `Iniciar consulta automática (${stats.aguardando})`} <span>→</span>
              </button>
            ) : (
              <button className="secondary-button" type="button" onClick={stopQueries}>Pausar consulta</button>
            )}
          </div>
        )}
      </section>

      {companies.length > 0 && (
        <section className="results" aria-labelledby="results-title">
          <div className="step-head result-head">
            <div><span className="step-number">02</span><div><p>RESULTADOS</p><h2 id="results-title">Enquadramento encontrado</h2></div></div>
            <button className="export-button" type="button" onClick={exportResults}>{stats.aguardando > 0 || isRunning ? "Exportar parcial" : "Exportar CSV"} ↓</button>
          </div>

          <div className="progress-wrap" aria-label={`Progresso: ${progress}%`}>
            <div className="progress-meta"><span>{stats.concluidos} de {stats.total} processados</span><strong>{progress}%</strong></div>
            <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          </div>

          <div className="stats-grid">
            <button className={filter === "todos" ? "active" : ""} onClick={() => { setFilter("todos"); setVisibleCount(DISPLAY_STEP); }}><span>Total</span><strong>{stats.total}</strong></button>
            <button className={filter === "sim" ? "active" : ""} onClick={() => { setFilter("sim"); setVisibleCount(DISPLAY_STEP); }}><span className="dot green" />Optantes<strong>{stats.sim}</strong></button>
            <button className={filter === "nao" ? "active" : ""} onClick={() => { setFilter("nao"); setVisibleCount(DISPLAY_STEP); }}><span className="dot red" />Não optantes<strong>{stats.nao}</strong></button>
            <button className={filter === "outros" ? "active" : ""} onClick={() => { setFilter("outros"); setVisibleCount(DISPLAY_STEP); }}><span className="dot amber" />Revisar<strong>{stats.outros}</strong></button>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>Empresa</th><th>CNPJ</th><th>CNAE principal</th><th>Situação</th><th>Simples Nacional</th><th>Conferência</th></tr></thead>
              <tbody>
                {filtered.slice(0, visibleCount).map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.razaoSocial || (item.status === "invalido" ? "Não consultado" : "Aguardando consulta")}</strong><span>{item.nomeFantasia || item.message || "—"}</span></td>
                    <td className="mono">{item.formattedCnpj}</td>
                    <td>{item.cnaeCodigo ? <><strong className="mono">{item.cnaeCodigo}</strong><span>{item.cnaeDescricao || "—"}</span></> : "—"}</td>
                    <td>{item.situacaoCadastral ? <span className="registry-status">{item.situacaoCadastral}</span> : "—"}</td>
                    <td><span className={`status status-${item.status}`}><i />{statusLabel(item.status)}</span></td>
                    <td><a href={OFFICIAL_URL} target="_blank" rel="noreferrer" aria-label={`Conferir ${item.formattedCnpj} no portal oficial`}>Portal oficial ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > visibleCount && (
            <div className="load-more-row">
              <span>Mostrando {visibleCount} de {filtered.length} itens</span>
              <button type="button" onClick={() => setVisibleCount((count) => count + DISPLAY_STEP)}>Mostrar mais {Math.min(DISPLAY_STEP, filtered.length - visibleCount)}</button>
            </div>
          )}
        </section>
      )}

      <section className="how-it-works">
        <p className="section-label">COMO FUNCIONA</p>
        <div className="how-grid">
          <article><span>1</span><h3>Leia o arquivo</h3><p>O CNPJ pode vir com ou sem pontuação, em CSV separado por vírgula ou ponto e vírgula.</p></article>
          <article><span>2</span><h3>Consulte com cuidado</h3><p>As consultas são feitas uma a uma, com intervalo, para respeitar a fonte comunitária.</p></article>
          <article><span>3</span><h3>Revise e exporte</h3><p>Valores ausentes ficam marcados para revisão. O resultado final pode ser baixado em CSV.</p></article>
        </div>
      </section>

      <footer>
        <span>CNPJ Simples · consulta auxiliar</span>
        <p>Dados fornecidos pela BrasilAPI. Para decisões fiscais, confirme no <a href={OFFICIAL_URL} target="_blank" rel="noreferrer">Portal do Simples Nacional</a>.</p>
      </footer>
    </main>
  );
}
