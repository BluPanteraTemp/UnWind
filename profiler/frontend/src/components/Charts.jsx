// components/Charts.jsx
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid
} from "recharts";
import {
  SlidersHorizontal, X, AlertTriangle, BarChart3
} from "lucide-react";

const CHART_COLORS = {
  primary: "#2563EB",
  secondary: "#1D4ED8",
  accent: "#1E40AF",
};

const HOVER_CURSOR = { fill: "#E2E8F0" };

const getChartHeight = (type, rowCount) => {
  if (type === "pie") return rowCount > 12 ? 560 : 460;
  if (type === "horizontal") return Math.max(420, Math.min(1200, rowCount * 34 + 120));
  return Math.max(420, Math.min(720, rowCount * 24 + 260));
};

const metricOptions = [
  { key: "recommendationScorePercentage", label: "Blank score %", dataKey: "Blank score %" },
  { key: "nullPercentage", label: "True blank %", dataKey: "True blank %" },
  { key: "customBlankPercentage", label: "Custom blank %", dataKey: "Custom blank %" },
  { key: "uniqueCount", label: "Unique values", dataKey: "Unique values" },
  { key: "invalidCount", label: "Invalid count", dataKey: "Invalid count" },
  { key: "issueCount", label: "Issue count", dataKey: "Issue count" },
];

export default function Charts({
  columns,
  chartData,
  chartDataKey,
  chartType,
  setChartType,
  chartMetric,
  setChartMetric,
  selectedChartColumns,
  setSelectedChartColumns,
  chartTopCount,
  setChartTopCount,
  showChartPicker,
  setShowChartPicker,
  chartColumnSearch,
  setChartColumnSearch,
}) {
  const toggleCol = (name) =>
    setSelectedChartColumns((prev) =>
      prev.includes(name)
        ? prev.filter((x) => x !== name)
        : [...prev, name]
    );

  const searchedColumns = columns.filter((col) =>
    col.name.toLowerCase().includes(chartColumnSearch.toLowerCase())
  );

  const normalizedTopCount = Math.max(
    1,
    Math.min(Number(chartTopCount) || 1, columns.length || 1)
  );

  const selectTop = () =>
    setSelectedChartColumns(columns.slice(0, normalizedTopCount).map((c) => c.name));

  const selectIssues = () =>
    setSelectedChartColumns(
      columns.filter((c) => c.issues.length > 0).slice(0, 20).map((c) => c.name)
    );

  const getPieChartValidData = () => {
    return chartData.filter(item => {
      const value = item[chartDataKey];
      return typeof value === 'number' && !isNaN(value) && value >= 0;
    });
  };

  const getInvalidColumnsForPie = () => {
    if (chartType !== 'pie') return [];

    return chartData.filter(item => {
      const value = item[chartDataKey];
      return typeof value !== 'number' || isNaN(value) || value < 0;
    }).map(item => item.name);
  };

  const pieValidData = getPieChartValidData();
  const invalidColumns = getInvalidColumnsForPie();
  const hasInvalidData = invalidColumns.length > 0;
  const selectedMetricLabel =
    metricOptions.find((m) => m.key === chartMetric)?.label ?? "Metric";
  const visibleChartData = chartType === "pie" ? pieValidData : chartData;
  const chartHeight = getChartHeight(chartType, visibleChartData.length);

  // Chart type options
  const chartTypes = [
    { value: "bar", label: "Bar", icon: "📊" },
    { value: "horizontal", label: "Horizontal", icon: "📈" },
    { value: "line", label: "Line", icon: "📉" },
    { value: "area", label: "Area", icon: "📊" },
    { value: "pie", label: "Pie", icon: "🥧" },
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Charts</h2>
            <p className="mt-0.5 text-sm text-slate-400">
              Compare selected columns across different metrics
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Metric selector */}
            <select
              value={chartMetric}
              onChange={(e) => setChartMetric(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
            >
              {metricOptions.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>

            {/* Chart type selector - pills */}
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {chartTypes.map((type) => (
                <button
                  key={type.value}
                  onClick={() => setChartType(type.value)}
                  className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${chartType === type.value
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                    }`}
                >
                  <span>{type.icon}</span>
                  <span className="hidden sm:inline">{type.label}</span>
                </button>
              ))}
            </div>

            {/* Column picker button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowChartPicker((p) => !p)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50"
              >
                <SlidersHorizontal size={14} />
                Columns ({selectedChartColumns.length})
              </button>

              {showChartPicker && (
                <div className="absolute right-0 z-30 mt-2 w-[400px] rounded-xl border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <h3 className="text-sm font-semibold text-slate-800">
                      Select columns
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowChartPicker(false)}
                      className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="p-4 space-y-3">
                    <input
                      value={chartColumnSearch}
                      onChange={(e) => setChartColumnSearch(e.target.value)}
                      placeholder="Search columns..."
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                    />

                    <div className="grid grid-cols-4 gap-2">
                      <div className="col-span-2 flex min-w-0 rounded-md bg-slate-100 p-1">
                        <input
                          type="number"
                          min="1"
                          max={Math.max(columns.length, 1)}
                          value={chartTopCount}
                          onChange={(e) => {
                            const value = e.target.value;
                            setChartTopCount(value === "" ? "" : Number(value));
                          }}
                          onBlur={() => setChartTopCount(normalizedTopCount)}
                          className="min-w-0 flex-1 rounded bg-white px-2 py-1 text-xs font-medium text-slate-700 outline-none focus:ring-1 focus:ring-blue-200"
                          aria-label="Number of top columns"
                        />
                        <button onClick={selectTop} className="shrink-0 rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200">
                          Top {normalizedTopCount}
                        </button>
                      </div>
                      <button onClick={selectIssues} className="rounded-md bg-slate-100 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200">
                        Issues
                      </button>
                      <button onClick={() => setSelectedChartColumns(columns.map((c) => c.name))} className="rounded-md bg-slate-100 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200">
                        All
                      </button>
                      <button onClick={() => setSelectedChartColumns([])} className="col-span-4 rounded-md bg-slate-100 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200">
                        None
                      </button>
                    </div>

                    <div className="max-h-[300px] space-y-1 overflow-y-auto">
                      {searchedColumns.map((col) => {
                        const checked = selectedChartColumns.includes(col.name);
                        return (
                          <label
                            key={col.name}
                            className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${checked
                              ? "bg-blue-50 border border-blue-200"
                              : "hover:bg-slate-50"
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCol(col.name)}
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-1 focus:ring-blue-200"
                            />
                            <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
                              {col.name}
                              {col.isMandatory && <span className="ml-0.5 text-rose-500">*</span>}
                            </span>
                            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                              {col.quality.recommendationScorePercentage}%
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Chart Area */}
      <div className="p-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50/30 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-700">
                {selectedMetricLabel}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {chartData.length} column{chartData.length !== 1 ? 's' : ''} selected
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-16 rounded-full bg-gradient-to-r from-blue-500 to-teal-400" />
              <span className="text-[10px] font-medium uppercase text-slate-400">
                {chartType}
              </span>
            </div>
          </div>

          <div className="w-full">
            {chartType === 'pie' && hasInvalidData && (
              <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800">
                      {invalidColumns.length} column{invalidColumns.length !== 1 ? 's' : ''} excluded from pie chart
                    </p>
                    <p className="text-xs text-amber-600 mt-1">
                      {invalidColumns.slice(0, 5).join(', ')}
                      {invalidColumns.length > 5 && ` +${invalidColumns.length - 5} more`}
                      {invalidColumns.length > 0 && ' — '}
                      Pie charts require numeric values (blank %, unique count, etc.)
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="w-full overflow-x-auto overflow-y-visible pb-1">
              <div
                className={chartType === "pie" ? "min-w-0" : "min-w-[680px]"}
                style={{ height: `${chartHeight}px` }}
              >
                {chartType === "pie" ? (
                  renderChart(chartType, pieValidData, chartDataKey)
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    {renderChart(chartType, chartData, chartDataKey)}
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function renderChart(type, data, dataKey) {
  const commonGrid = (
    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
  );

  const commonXAxis = (
    <XAxis
      dataKey="name"
      angle={-35}
      textAnchor="end"
      interval={0}
      height={80}
      tick={{ fontSize: 11, fill: "#64748B" }}
      axisLine={{ stroke: "#CBD5E1" }}
      tickLine={false}
    />
  );

  const commonYAxis = (
    <YAxis
      tick={{ fontSize: 11, fill: "#64748B" }}
      axisLine={{ stroke: "#CBD5E1" }}
      tickLine={false}
    />
  );

  const commonTooltip = (
    <Tooltip
      cursor={HOVER_CURSOR}
      contentStyle={{
        border: "1px solid #CBD5E1",
        borderRadius: "0px",
        background: "white",
        fontSize: "14px",
      }}
      labelStyle={{
        color: "#0F172A",
        fontSize: "14px",
        fontWeight: 600,
        marginBottom: "6px",
      }}
      itemStyle={{
        color: CHART_COLORS.primary,
        fontSize: "14px",
        fontWeight: 500,
      }}
    />
  );

  if (!data.length) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        No columns selected
      </div>
    );
  }

  if (type === "pie") {
    const validPieData = data.filter((item) => {
      const value = Number(item[dataKey]);
      return Number.isFinite(value) && value > 0;
    });

    const zeroData = data.filter((item) => {
      const value = Number(item[dataKey]);
      return Number.isFinite(value) && value === 0;
    });

    const PIE_COLORS = [
      "#2563EB",
      "#06B6D4",
      "#14B8A6",
      "#0F766E",
      "#1E3A8A",
      "#7C3AED",
      "#0891B2",
      "#38BDF8",
    ];

    const total = validPieData.reduce(
      (sum, item) => sum + Number(item[dataKey]),
      0
    );

    if (!validPieData.length) {
      return (
        <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white text-center">
          <div className="mb-3 rounded-full bg-slate-100 p-3">
            <BarChart3 size={24} className="text-slate-300" />
          </div>
          <p className="text-sm font-bold text-slate-600">No positive values</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-400">
            All selected columns have zero or invalid values for this metric.
          </p>
        </div>
      );
    }

    return (
      <div className="grid h-full min-h-[420px] grid-cols-1 gap-6 lg:grid-cols-[minmax(360px,1fr)_360px]">
        <div className="relative flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-6">
          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={validPieData}
                  dataKey={dataKey}
                  nameKey="name"
                  innerRadius={90}
                  outerRadius={150}
                  paddingAngle={0}
                  label={false}
                  labelLine={false}
                >
                  {validPieData.map((entry, i) => (
                    <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => {
                    const numValue = Number(value);
                    const percentage =
                      total > 0 ? ((numValue / total) * 100).toFixed(1) : "0";
                    return [
                      `${numValue.toLocaleString()} (${percentage}%)`,
                      name,
                    ];
                  }}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #E2E8F0",
                    fontSize: "12px",
                    background: "white",
                    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.12)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex h-40 w-40 flex-col items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm">
              <p className="text-xl font-black text-slate-900">
                {total.toLocaleString()}
              </p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-slate-400">
                Total
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <p className="text-sm font-black text-slate-900">Distribution</p>
            <p className="mt-1 text-xs text-slate-500">
              {validPieData.length} positive column{validPieData.length !== 1 ? "s" : ""}
              {zeroData.length > 0 ? ` · ${zeroData.length} zero value` : ""}
            </p>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
            {validPieData.map((item, i) => {
              const rawValue = Number(item[dataKey]);
              const percentage =
                total > 0 ? ((rawValue / total) * 100).toFixed(1) : "0";
              return (
                <div
                  key={item.name}
                  className="grid grid-cols-[14px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50"
                >
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="truncate text-sm font-semibold text-slate-700">
                    {item.name}
                  </span>
                  <span className="text-sm font-black text-slate-900">
                    {rawValue.toLocaleString()}
                  </span>
                  <span className="w-14 text-right text-xs font-semibold text-slate-400">
                    {percentage}%
                  </span>
                </div>
              );
            })}
            {zeroData.map((item) => (
              <div
                key={item.name}
                className="grid grid-cols-[14px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl px-2 py-1.5 opacity-50"
              >
                <span className="h-3 w-3 rounded-full bg-slate-300" />
                <span className="truncate text-sm font-semibold text-slate-500 line-through">
                  {item.name}
                </span>
                <span className="text-sm font-black text-slate-400">0</span>
                <span className="w-14 text-right text-xs font-semibold text-slate-400">
                  0%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (type === "horizontal") {
    return (
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 10, right: 30, left: 120, bottom: 10 }}
      >
        {commonGrid}
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "#64748B" }}
          axisLine={{ stroke: "#CBD5E1" }}
          tickLine={false}
        />
        <YAxis
          dataKey="name"
          type="category"
          width={120}
          tick={{ fontSize: 11, fill: "#475569" }}
          axisLine={{ stroke: "#CBD5E1" }}
          tickLine={false}
        />
        {commonTooltip}
        <Bar dataKey={dataKey} fill={CHART_COLORS.primary} radius={[0, 6, 6, 0]} />
      </BarChart>
    );
  }

  if (type === "line") {
    return (
      <LineChart data={data} margin={{ top: 15, right: 30, left: 5, bottom: 70 }}>
        {commonGrid}
        {commonXAxis}
        {commonYAxis}
        {commonTooltip}
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={CHART_COLORS.primary}
          strokeWidth={3}
          dot={{ r: 4, fill: CHART_COLORS.primary, strokeWidth: 0 }}
          activeDot={{ r: 6, fill: CHART_COLORS.accent }}
        />
      </LineChart>
    );
  }

  if (type === "area") {
    return (
      <AreaChart data={data} margin={{ top: 15, right: 30, left: 5, bottom: 70 }}>
        {commonGrid}
        {commonXAxis}
        {commonYAxis}
        {commonTooltip}
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={CHART_COLORS.primary}
          fill={CHART_COLORS.primary}
          fillOpacity={0.15}
          strokeWidth={2}
        />
      </AreaChart>
    );
  }

  // Default: Bar chart
  return (
    <BarChart data={data} margin={{ top: 15, right: 30, left: 5, bottom: 70 }}>
      {commonGrid}
      {commonXAxis}
      {commonYAxis}
      {commonTooltip}
      <Bar dataKey={dataKey} fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} />
    </BarChart>
  );
}
