// MatrixView.jsx - Soft green/yellow/red palette

import { useMemo, useState } from "react";
import { Download, Layers, Info } from "lucide-react";

const MATRIX_THEME = {
    // Soft, approachable scale from green → yellow → red
    scale: [
        "#E8F5E9",  // 0%   - very soft green
        "#C8E6C9",  // 25%  - light green
        "#FFF9C4",  // 50%  - faint yellow
        "#FFECB3",  // 65%  - warm yellow
        "#FFE0B2",  // 75%  - light orange
        "#FFCDD2",  // 100% - soft red
    ],
    recommendation: {
        keep: "#2E7D32",   // deep green - clear and readable
        review: "#E65100",  // deep orange - stands out but not harsh
        discard: "#C62828", // deep red - clearly negative but not aggressive
    },
};

function interpolateColor(color1, color2, factor) {
    const hex = (color) => {
        const cleaned = color.replace("#", "");
        return [
            parseInt(cleaned.substring(0, 2), 16),
            parseInt(cleaned.substring(2, 4), 16),
            parseInt(cleaned.substring(4, 6), 16),
        ];
    };

    const c1 = hex(color1);
    const c2 = hex(color2);

    const result = c1.map((v, i) =>
        Math.round(v + factor * (c2[i] - v))
    );

    return `rgb(${result[0]}, ${result[1]}, ${result[2]})`;
}

function getMatrixColor(value) {
    const scale = MATRIX_THEME.scale;
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));

    // Map 0-100 to 0-5 scale indices
    const position = (clamped / 100) * (scale.length - 1);
    const index = Math.floor(position);
    const factor = position - index;

    if (index >= scale.length - 1) {
        return scale[scale.length - 1];
    }

    return interpolateColor(scale[index], scale[index + 1], factor);
}

function FieldName({ name, isMandatory }) {
    return (
        <span>
            {name}
            {isMandatory && <span className="ml-0.5 text-rose-500">*</span>}
        </span>
    );
}

function getWorstBlankPercentage(row) {
    return Math.max(
        0,
        ...(row.cells ?? []).map((cell) => Number(cell.blankPercentage) || 0)
    );
}

function hasReviewOrDiscardCell(row) {
    return (row.cells ?? []).some((cell) => cell.recommendation !== "keep");
}

function getCellCountLabel(cell) {
    const blankCount = Number(cell.blankCount) || 0;
    const customBlankCount = Number(cell.customBlankCount) || 0;
    const totalRows = Number(cell.totalRows) || 0;
    const issueCount = blankCount + customBlankCount;

    return `${issueCount.toLocaleString()} / ${totalRows.toLocaleString()}`;
}

function cleanFilePart(value) {
    return String(value || "matrix-view")
        .replace(/[^a-z0-9-_]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "matrix-view";
}

function toArgb(hex) {
    return `FF${hex.replace("#", "").toUpperCase()}`;
}

const MATRIX_EXPORT_STYLES = {
    keep: { fill: "DCFCE7", font: "166534", label: "Keep" },
    review: { fill: "FEF3C7", font: "92400E", label: "Review" },
    discard: { fill: "FEE2E2", font: "991B1B", label: "Discard" },
};

function getExportCellValue(cell, mode) {
    const blankPct = Number(cell.blankPercentage) || 0;

    if (mode === "count") return getCellCountLabel(cell);
    if (mode === "both") return `${blankPct}% (${getCellCountLabel(cell)})`;

    return blankPct;
}

async function exportMatrixView({ matrixData, rows, displayMode, sortBy, hideHealthy }) {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Matrix view");
    const border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };

    workbook.creator = "UnWind";
    workbook.created = new Date();

    worksheet.columns = [
        { header: `Field by ${matrixData.groupBy}`, key: "field" },
        ...(matrixData.groups ?? []).map((group) => ({
            header: `${group.value} (${group.rowCount} rows)`,
            key: String(group.value),
        })),
    ];

    rows.forEach((matrixRow) => {
        const rowValues = { field: matrixRow.field };

        matrixRow.cells?.forEach((cell) => {
            rowValues[String(cell.groupValue)] = getExportCellValue(cell, displayMode);
        });

        const row = worksheet.addRow(rowValues);
        row.getCell(1).font = { bold: true, color: { argb: "FF334155" } };

        matrixRow.cells?.forEach((cell, index) => {
            const excelCell = row.getCell(index + 2);
            const style = MATRIX_EXPORT_STYLES[cell.recommendation] ?? MATRIX_EXPORT_STYLES.review;

            if (displayMode === "percentage") {
                excelCell.numFmt = '0.00"%"';
            }

            excelCell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: toArgb(style.fill) },
            };
            excelCell.font = { color: { argb: toArgb(style.font) } };
            excelCell.border = border;
            excelCell.note = `Blank: ${cell.blankPercentage}%\nTrue blanks: ${cell.blankCount}\nCustom blanks: ${cell.customBlankCount}\nRows: ${cell.totalRows}\nRecommendation: ${style.label}`;
        });
    });

    const header = worksheet.getRow(1);
    header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FF0F172A" } };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFEAF4FF" },
        };
        cell.border = border;
        cell.alignment = { vertical: "middle", wrapText: true };
    });

    worksheet.addRow([]);
    worksheet.addRow(["Exported view settings"]);
    worksheet.addRow(["Display mode", displayMode]);
    worksheet.addRow(["Sort", sortBy]);
    worksheet.addRow(["Hide healthy fields", hideHealthy ? "Yes" : "No"]);
    worksheet.addRow(["Rows exported", rows.length]);

    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.autoFilter = {
        from: "A1",
        to: { row: 1, column: Math.max(1, (matrixData.groups?.length ?? 0) + 1) },
    };
    worksheet.columns.forEach((column) => {
        let maxLength = 12;
        column.eachCell({ includeEmpty: true }, (cell) => {
            const value = cell.value == null ? "" : String(cell.value);
            maxLength = Math.max(maxLength, value.length);
            cell.alignment = { vertical: "middle", wrapText: value.length > 32 };
            cell.border = cell.border ?? border;
        });
        column.width = Math.min(Math.max(maxLength + 2, 14), 42);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${cleanFilePart(matrixData.groupBy)}-matrix-view.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function MatrixCellValue({ cell, mode, blankPct }) {
    const countLabel = getCellCountLabel(cell);

    if (mode === "count") {
        return (
            <span className="text-sm font-semibold text-slate-700">
                {countLabel}
            </span>
        );
    }

    if (mode === "both") {
        return (
            <span className="space-y-0.5">
                <span className="block text-sm font-semibold text-slate-700">
                    {blankPct}%
                </span>
                <span className="block text-[10px] font-medium text-slate-500">
                    {countLabel}
                </span>
            </span>
        );
    }

    return (
        <span className="text-sm font-semibold text-slate-700">
            {blankPct}%
        </span>
    );
}

function MatrixView({ matrixData, matrixLoading, groupBy, mandatoryFields = [], loadMatrix }) {
    const [sortBy, setSortBy] = useState("original");
    const [hideHealthy, setHideHealthy] = useState(false);
    const [displayMode, setDisplayMode] = useState("percentage");
    const isMandatoryField = (name) => mandatoryFields.includes(name);
    const visibleRows = useMemo(() => {
        const rows = [...(matrixData?.rows ?? [])];
        const filteredRows = hideHealthy
            ? rows.filter((row) => hasReviewOrDiscardCell(row))
            : rows;

        if (sortBy === "worst") {
            return filteredRows.sort((a, b) => getWorstBlankPercentage(b) - getWorstBlankPercentage(a));
        }

        if (sortBy === "name") {
            return filteredRows.sort((a, b) => a.field.localeCompare(b.field));
        }

        return filteredRows;
    }, [matrixData, sortBy, hideHealthy]);

    const handleExportMatrixView = async () => {
        if (!matrixData) return;

        try {
            await exportMatrixView({
                matrixData,
                rows: visibleRows,
                displayMode,
                sortBy,
                hideHealthy,
            });
        } catch (err) {
            console.error("MATRIX EXPORT ERROR", err);
            alert(err.message || "Matrix export failed");
        }
    };

    if (!groupBy) {
        return (
            <section className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                    <Layers size={20} className="text-slate-400" />
                </div>
                <h3 className="text-base font-semibold text-slate-700">Select a group</h3>
                <p className="mt-1 text-sm text-slate-400">
                    Choose a "Group By" column from the sidebar
                </p>
            </section>
        );
    }

    if (matrixLoading) {
        return (
            <section className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
                <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
                <p className="text-sm font-medium text-slate-500">Loading matrix...</p>
            </section>
        );
    }

    if (!matrixData) {
        return (
            <section className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
                <p className="mb-4 text-sm text-slate-500">
                    Grouping by <span className="font-mono font-medium text-slate-700"><FieldName name={groupBy} isMandatory={isMandatoryField(groupBy)} /></span>
                </p>
                <button
                    onClick={() => loadMatrix(groupBy)}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                >
                    Generate matrix
                </button>
            </section>
        );
    }

    return (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Header */}
            <div className="border-b border-slate-100 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 className="text-base font-semibold text-slate-800">
                            Matrix by <span className="font-sans"><FieldName name={matrixData.groupBy} isMandatory={isMandatoryField(matrixData.groupBy)} /></span>
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-400">
                            Blank percentage by column and group value
                        </p>
                    </div>

                    {/* Legend with soft colors */}
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500">Low blank</span>
                        <div className="flex h-5 overflow-hidden rounded-md shadow-inner">
                            <div className="flex h-full w-32">
                                <div className="w-1/6 bg-[#E8F5E9] border-r border-white" title="0%" />
                                <div className="w-1/6 bg-[#C8E6C9] border-r border-white" title="25%" />
                                <div className="w-1/6 bg-[#FFF9C4] border-r border-white" title="50%" />
                                <div className="w-1/6 bg-[#FFECB3] border-r border-white" title="65%" />
                                <div className="w-1/6 bg-[#FFE0B2] border-r border-white" title="75%" />
                                <div className="w-1/6 bg-[#FFCDD2]" title="100%" />
                            </div>
                        </div>
                        <span className="text-slate-500">High blank →</span>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                    >
                        <option value="original">Original order</option>
                        <option value="worst">Worst blank % first</option>
                        <option value="name">Field name A-Z</option>
                    </select>

                    <div className="flex rounded-lg bg-slate-100 p-1">
                        {[
                            ["percentage", "%"],
                            ["count", "Counts"],
                            ["both", "Both"],
                        ].map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setDisplayMode(value)}
                                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${displayMode === value
                                    ? "bg-white text-blue-600 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
                        <input
                            type="checkbox"
                            checked={hideHealthy}
                            onChange={(e) => setHideHealthy(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-1 focus:ring-blue-200"
                        />
                        Hide healthy fields
                    </label>

                    <button
                        type="button"
                        onClick={handleExportMatrixView}
                        className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
                    >
                        <Download size={14} />
                        Export matrix view
                    </button>
                </div>
            </div>

            {/* Scrollable table */}
            <div className="max-h-[calc(100vh-260px)] overflow-auto">
                <table className="min-w-max text-sm">
                    <thead>
                        <tr className="bg-slate-50">
                            {/* Field column header */}
                            <th
                                className="sticky left-0 top-0 z-20 min-w-[200px] border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500"
                                style={{ backgroundColor: "#F8FAFC" }}
                            >
                                Field
                            </th>

                            {/* Group headers */}
                            {matrixData.groups?.map((group) => (
                                <th
                                    key={group.value}
                                    className="sticky top-0 z-10 min-w-[120px] border-b border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-medium text-slate-600"
                                    style={{ backgroundColor: "#F8FAFC" }}
                                >
                                    <div className="truncate max-w-[100px]" title={group.value}>
                                        {group.value}
                                    </div>
                                    <div className="mt-1 text-[10px] font-normal text-slate-400">
                                        {group.rowCount?.toLocaleString()} rows
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>

                    <tbody>
                        {visibleRows.length === 0 && (
                            <tr>
                                <td
                                    colSpan={(matrixData.groups?.length ?? 0) + 1}
                                    className="px-4 py-10 text-center text-sm text-slate-400"
                                >
                                    No fields match the current matrix controls.
                                </td>
                            </tr>
                        )}
                        {visibleRows.map((row, idx) => (
                            <tr key={row.field} className={`${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"} hover:bg-slate-100`}>
                                {/* Field column - sticky */}
                                <td
                                    className="sticky left-0 z-10 border-b border-r border-slate-100 px-4 py-2.5 font-sans text-sm font-medium text-slate-700"
                                    style={{ backgroundColor: idx % 2 === 0 ? "#FFFFFF" : "#F8FAFC" }}
                                >
                                    <FieldName name={row.field} isMandatory={isMandatoryField(row.field)} />
                                </td>

                                {row.cells?.map((cell) => {
                                    const blankPct = Number(cell.blankPercentage) || 0;
                                    const bgColor = getMatrixColor(blankPct);

                                    // Use the theme's recommendation colors (already optimized for contrast)
                                    const recColor = MATRIX_THEME.recommendation[cell.recommendation] || MATRIX_THEME.recommendation.review;

                                    return (
                                        <td
                                            key={`${row.field}-${cell.groupValue}`}
                                            className="border border-slate-100 px-3 py-2.5 text-center transition-all duration-150"
                                            style={{ backgroundColor: bgColor }}
                                            title={`Blank: ${blankPct}% · ${getCellCountLabel(cell)} rows · ${cell.recommendation}`}
                                        >
                                            <div>
                                                <MatrixCellValue cell={cell} mode={displayMode} blankPct={blankPct} />
                                            </div>
                                            <div className="mt-0.5">
                                                <span
                                                    className="text-[10px] font-bold uppercase tracking-wide"
                                                    style={{ color: recColor }}
                                                >
                                                    {cell.recommendation}
                                                </span>
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            {matrixData.rows?.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-2.5">
                    <p className="flex items-center gap-1.5 text-xs text-slate-400">
                        <Info size={12} />
                        Showing {visibleRows.length} of {matrixData.rows.length} fields · {matrixData.groups?.length} groups
                    </p>
                </div>
            )}
        </section>
    );
}

export default MatrixView;
