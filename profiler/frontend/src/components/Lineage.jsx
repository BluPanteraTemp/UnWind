import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Code2,
  Database,
  FileInput,
  GitBranch,
  Link2,
  Search,
  Table2,
} from "lucide-react";
import LineageDiagram from "./LineageDiagram";

function StatTile({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-800">{Number(value || 0).toLocaleString()}</p>
    </div>
  );
}

function Pill({ children, tone = "slate" }) {
  const classes = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  }[tone];

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>
      {children}
    </span>
  );
}

function StatusBadge({ loaded }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        loaded
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-500"
      }`}
    >
      {loaded ? "Loaded" : "Connection only"}
    </span>
  );
}

function CountMetric({ icon, value, label, tone = "slate" }) {
  const classes = {
    slate: "text-slate-500",
    blue: "text-blue-600",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${classes}`} title={label}>
      {icon}
      <span className="tabular-nums text-slate-700">{value}</span>
    </span>
  );
}

function RiskList({ risks }) {
  const [open, setOpen] = useState(false);

  if (!risks.length) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-800">No lineage risks detected</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span>
          <span className="block text-base font-semibold text-slate-800">Risks and notes</span>
          <span className="mt-0.5 block text-sm text-slate-500">{risks.length} workbook lineage notes</span>
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
          {risks.map((risk, index) => (
            <div key={`${risk.message}-${index}`} className="flex gap-3 px-5 py-3">
              <AlertTriangle
                size={16}
                className={risk.severity === "warning" ? "mt-0.5 shrink-0 text-amber-600" : "mt-0.5 shrink-0 text-blue-600"}
              />
              <p className="text-sm leading-relaxed text-slate-600">{risk.message}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function QueryRow({ query }) {
  const [open, setOpen] = useState(false);
  const loaded = (query.outputs ?? []).length > 0;
  const firstOutput = query.outputs?.[0]
    ? `${query.outputs[0].sheetName}!${query.outputs[0].tableName}`
    : "-";

  return (
    <article className="overflow-hidden bg-white shadow-sm transition hover:bg-slate-50/50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="grid w-full grid-cols-[minmax(220px,1fr)_150px_110px_110px_90px_minmax(180px,0.8fr)_32px] items-center gap-4 px-4 py-3 text-left"
      >
        <div className="min-w-0 pr-2">
          <h3 className="truncate text-sm font-semibold text-slate-900" title={query.name}>
            {query.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {query.formulaPath || "Power Query"}
          </p>
        </div>
        <StatusBadge loaded={loaded} />
        <CountMetric icon={<GitBranch size={14} />} value={query.dependencies?.length ?? 0} label="Dependencies" tone="blue" />
        <CountMetric icon={<Database size={14} />} value={query.transformations?.length ?? 0} label="Transform types" tone="amber" />
        <CountMetric icon={<FileInput size={14} />} value={query.sources?.length ?? 0} label="Sources" />
        <p className="truncate text-sm text-slate-600" title={firstOutput}>
          {firstOutput}
        </p>
        <ChevronDown
          size={18}
          className={`justify-self-end text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 px-5 py-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <DetailBlock
              icon={<Link2 size={14} />}
              title="Dependencies"
              items={query.dependencies}
              empty="No query references found"
            />
            <DetailBlock
              icon={<FileInput size={14} />}
              title="Sources"
              items={(query.sources ?? []).map((source) => `${source.type}: ${source.value}`)}
              empty="No source pattern found"
            />
            <DetailBlock
              icon={<Table2 size={14} />}
              title="Outputs"
              items={(query.outputs ?? []).map((output) => `${output.sheetName}!${output.tableName} ${output.range}`)}
              empty="Not loaded to a worksheet table"
            />
          </div>

          {query.transformations?.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
                <Database size={14} />
                Transformations
              </p>
              <div className="flex flex-wrap gap-2">
                {query.transformations.map((item) => (
                  <Pill key={item.function} tone="blue">
                    {item.label} ({item.count})
                  </Pill>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
              <Code2 size={14} />
              M preview
            </p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
              {query.mCodePreview}
              {query.mCodeLength > query.mCodePreview.length ? "\n..." : ""}
            </pre>
          </div>
        </div>
      )}
    </article>
  );
}

function QueryInventoryTable({ queries }) {
  if (!queries.length) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <Search size={24} className="mx-auto text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-700">No queries match the current filters</p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="grid min-w-[980px] grid-cols-[minmax(220px,1fr)_150px_110px_110px_90px_minmax(180px,0.8fr)_32px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        <span>Query</span>
        <span>Status</span>
        <span>Dependencies</span>
        <span>Transforms</span>
        <span>Sources</span>
        <span>Output</span>
        <span />
      </div>
      <div className="min-w-[980px] divide-y divide-slate-100">
        {queries.map((query) => (
          <QueryRow key={query.name} query={query} />
        ))}
      </div>
    </section>
  );
}

function DetailBlock({ icon, title, items = [], empty }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
        {icon}
        {title}
      </p>
      {items.length > 0 ? (
        <div className="space-y-1">
          {items.map((item) => (
            <p key={item} className="truncate text-sm text-slate-700" title={item}>
              {item}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">{empty}</p>
      )}
    </div>
  );
}

export default function Lineage({ lineage }) {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("list");
  const [showSummary, setShowSummary] = useState(false);
  const [queryFilter, setQueryFilter] = useState("all");
  const queries = lineage?.queries ?? [];
  const summary = lineage?.summary ?? {};
  const filteredQueries = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matchesFilter = (query) => {
      if (queryFilter === "loaded") return (query.outputs ?? []).length > 0;
      if (queryFilter === "connection") return (query.outputs ?? []).length === 0;
      if (queryFilter === "dependencies") return (query.dependencies ?? []).length > 0;
      if (queryFilter === "sources") return (query.sources ?? []).length > 0;
      return true;
    };

    return queries.filter((query) => {
      if (!matchesFilter(query)) return false;
      if (!term) return true;

      const haystack = [
        query.name,
        ...(query.dependencies ?? []),
        ...(query.sources ?? []).map((source) => source.value),
        ...(query.outputs ?? []).map((output) => `${output.sheetName} ${output.tableName}`),
      ].join(" ").toLowerCase();

      return haystack.includes(term);
    });
  }, [queries, queryFilter, search]);

  if (!lineage?.supported) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <GitBranch size={32} className="mx-auto text-slate-300" />
        <h2 className="mt-3 text-lg font-semibold text-slate-800">Workbook lineage is available for XLSX and XLSM files</h2>
        <p className="mt-2 text-sm text-slate-500">Upload an Excel workbook with Power Query connections to inspect query dependencies.</p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Power Query inventory</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {filteredQueries.length} of {queries.length} queries shown
              <span className="mx-2 text-slate-300">/</span>
              {summary.loadedQueryCount ?? 0} loaded outputs
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => setShowSummary((value) => !value)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Metrics
              <ChevronDown
                size={14}
                className={`transition-transform ${showSummary ? "rotate-180" : ""}`}
              />
            </button>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "list"
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("diagram")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "diagram"
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Diagram
              </button>
            </div>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search queries, sources, outputs"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100 sm:w-80"
              />
            </div>
          </div>
        </div>
      </section>

      {viewMode === "list" && (
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["all", "All"],
            ["loaded", "Loaded"],
            ["connection", "Connection only"],
            ["dependencies", "Has dependencies"],
            ["sources", "Has sources"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setQueryFilter(key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                queryFilter === key
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {showSummary && (
        <div className="grid gap-3 md:grid-cols-5">
          <StatTile label="Queries" value={summary.queryCount} />
          <StatTile label="Connections" value={summary.connectionCount} />
          <StatTile label="Loaded" value={summary.loadedQueryCount} />
          <StatTile label="Sources" value={summary.sourceCount} />
          <StatTile label="Notes" value={summary.riskCount} />
        </div>
      )}

      {viewMode === "diagram" ? (
        <LineageDiagram queries={filteredQueries} />
      ) : (
        <div className="overflow-x-auto">
          <QueryInventoryTable queries={filteredQueries} />
        </div>
      )}

      <RiskList risks={lineage.risks ?? []} />
    </div>
  );
}
