// components/Overview.jsx
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { AlertTriangle } from "lucide-react";

// Reusable recommendation icon component
function RecommendationIcon({ value }) {
  const config = {
    keep: {
      icon: <CheckCircle size={16} />,
      className: "text-emerald-600",
      title: "Keep",
    },
    review: {
      icon: <AlertTriangle size={16} />,
      className: "text-amber-600",
      title: "Review",
    },
    discard: {
      icon: <XCircle size={16} />,
      className: "text-rose-600",
      title: "Discard",
    },
  };

  const item = config[value] ?? config.review;

  return (
    <span
      title={item.title}
      className={`mt-0.5 shrink-0 ${item.className}`}
    >
      {item.icon}
    </span>
  );
}

// Need to import these if not already available
import { CheckCircle, XCircle } from "lucide-react";

function FieldName({ name, isMandatory }) {
  return (
    <span>
      {name}
      {isMandatory && <span className="ml-0.5 text-rose-500">*</span>}
    </span>
  );
}

export default function Overview({ data, columns, setActiveTab, setSelectedColumn }) {
  const worstColumns = [...columns]
    .sort((a, b) => b.quality.recommendationScorePercentage - a.quality.recommendationScorePercentage)
    .slice(0, 10);
  
  const recData = [
    { name: "Keep", value: data.summary.recommendationCounts.keep, color: "#2563EB" },
    { name: "Review", value: data.summary.recommendationCounts.review, color: "#06B6D4" },
    { name: "Discard", value: data.summary.recommendationCounts.discard, color: "#1E3A8A" },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      {/* Columns needing attention - Glossy cards */}
      <section className="rounded-xl border border-white/30 bg-gradient-to-br from-slate-50 via-white to-slate-100 shadow-xl overflow-hidden relative">
        {/* Glossy overlay shine */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/60 via-transparent to-transparent pointer-events-none" />

        <div className="relative">
          <div className="border-b border-white/50 bg-gradient-to-r from-white/80 to-transparent px-5 py-4">
            <h2 className="text-base font-semibold text-slate-800">Columns needing attention</h2>
            <p className="mt-0.5 text-sm text-slate-500">Highest blank scores and strongest cleanup signals</p>
          </div>

          <div className="grid gap-3 p-5 md:grid-cols-2 max-h-[520px] overflow-auto">
            {worstColumns.map((col) => (
              <button
                key={col.name}
                onClick={() => { 
                  setSelectedColumn(col); 
                  setActiveTab("columns"); 
                }}
                className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 text-left transition-all hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="relative">
                  <div className="flex items-start gap-3">
                    <RecommendationIcon value={col.recommendation} />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800 group-hover:text-blue-700">
                        <FieldName name={col.name} isMandatory={col.isMandatory} />
                      </p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{col.profileType}</span>
                      <span className="text-slate-400">•</span>
                      <span className="text-slate-500">{col.quality.uniqueCount} unique</span>
                      {col.issues.length > 0 && (
                        <>
                          <span className="text-slate-400">•</span>
                          <span className="text-black">{col.issues.length} issue(s)</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-slate-500 font-medium">Blank score</span>
                      <span className="font-bold text-slate-900">
                        {col.quality.recommendationScorePercentage}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 to-teal-500 transition-all duration-500"
                        style={{ width: `${col.quality.recommendationScorePercentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Recommendation mix - Glossy donut */}
      <section className="rounded-xl border border-white/30 bg-gradient-to-br from-slate-50 via-white to-slate-100 shadow-xl overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-white/60 via-transparent to-transparent pointer-events-none" />

        <div className="relative">
          <div className="border-b border-white/50 bg-gradient-to-r from-white/80 to-transparent px-5 py-4">
            <h2 className="text-base font-semibold text-slate-800">Recommendation mix</h2>
            <p className="mt-0.5 text-sm text-slate-500">Quality split across columns</p>
          </div>

          <div className="p-6">
            <div className="relative h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={recData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={95}
                  >
                    {recData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} strokeOpacity={1} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [`${value} columns`, 'Count']}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                      background: 'white',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Simple center circle with navy text */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="rounded-full bg-white shadow-sm w-28 h-28 flex flex-col items-center justify-center border border-slate-200">
                  <p className="text-2xl font-black text-slate-800">
                    {data.summary.recommendationCounts.keep + data.summary.recommendationCounts.review + data.summary.recommendationCounts.discard}
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Total columns</p>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-5 flex justify-center gap-5">
              {recData.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full shadow-sm" style={{ backgroundColor: item.color }} />
                  <span className="text-sm font-medium text-slate-600">{item.name}</span>
                  <span className="text-sm font-bold text-slate-800">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
