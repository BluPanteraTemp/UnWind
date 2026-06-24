import { useMemo, useState } from "react";
import axios from "axios";
import {
  Upload, AlertTriangle, CheckCircle, XCircle, FileSpreadsheet,
  Columns3, Rows3, Copy, Settings2, BarChart3, Table2, RefreshCw,
  Eye, SlidersHorizontal, Filter, X, ChevronDown, Download, GitBranch,
  ChevronLeft, ChevronRight
} from "lucide-react";

import MatrixView from "./components/MatrixView";
import Charts from "./components/Charts";
import Columns from "./components/Columns";
import Overview from "./components/Overview";
import FileUploadCenter from "./components/FileUploadCentre";
import Lineage from "./components/Lineage";
import ThreadWordmark from "./components/ThreadWordmark";


const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

function getApiErrorMessage(err, fallback) {
  if (err.response?.data?.detail) return err.response.data.detail;

  if (err.message === "Network Error") {
    return `Could not reach the backend at ${API_BASE_URL}. Check that FastAPI is running and that the frontend origin is allowed by CORS.`;
  }

  return err.message || fallback;
}

function isFileExpiredError(err) {
  const detail = String(err.response?.data?.detail || err.message || "");
  return detail.includes("File expired");
}

const COLORS = {
  indigo: "#4f46e5",
  cyan: "#0891b2",
  emerald: "#059669",
  amber: "#d97706",
  rose: "#e11d48",
  violet: "#7c3aed",
  slate: "#475569",
  grid: "#dbe3ef",
};

const CHART_COLORS = {
  primary: "#06B6D4",      // Cyan (your area graph color)
  secondary: "#22D3EE",    // Light cyan
  accent: "#0891B2",       // Dark teal
  gradient: "url(#cyanGradient)",
};

const metricOptions = [
  { key: "recommendationScorePercentage", label: "Blank score %", dataKey: "Blank score %" },
  { key: "nullPercentage", label: "True blank %", dataKey: "True blank %" },
  { key: "customBlankPercentage", label: "Custom blank %", dataKey: "Custom blank %" },
  { key: "uniqueCount", label: "Unique values", dataKey: "Unique values" },
  { key: "invalidCount", label: "Invalid count", dataKey: "Invalid count" },
  { key: "issueCount", label: "Issue count", dataKey: "Issue count" },
];


const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

function startProgress(setProgress) {
  setProgress(8);

  return window.setInterval(() => {
    setProgress((current) => {
      if (current >= 92) return current;

      const nextStep = Math.max(1, (92 - current) * 0.18);
      return Math.min(92, current + nextStep);
    });
  }, 450);
}

function normalizePercentageInput(value, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) return fallback;

  return Math.max(0, Math.min(100, numericValue));
}

const EXPORT_RECOMMENDATION_STYLES = {
  keep: {
    fill: "DCFCE7",
    font: "166534",
    label: "Keep",
  },
  review: {
    fill: "FEF3C7",
    font: "92400E",
    label: "Review",
  },
  discard: {
    fill: "FEE2E2",
    font: "991B1B",
    label: "Discard",
  },
};

const EXPORT_HEADER_FILL = "EAF4FF";
const EXPORT_BORDER = {
  top: { style: "thin", color: { argb: "FFE2E8F0" } },
  left: { style: "thin", color: { argb: "FFE2E8F0" } },
  bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
  right: { style: "thin", color: { argb: "FFE2E8F0" } },
};

function toArgb(hex) {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

function cleanFilePart(value) {
  return String(value || "data-profile")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "data-profile";
}

function styleWorksheetHeader(worksheet) {
  const header = worksheet.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF0F172A" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: toArgb(EXPORT_HEADER_FILL) },
    };
    cell.alignment = { vertical: "middle" };
    cell.border = EXPORT_BORDER;
  });
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
}

function applyRecommendationStyle(row, recommendation, recommendationColumnNumber) {
  const style = EXPORT_RECOMMENDATION_STYLES[recommendation] ?? EXPORT_RECOMMENDATION_STYLES.review;

  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: toArgb(style.fill) },
    };
    cell.border = EXPORT_BORDER;
  });

  const recommendationCell = row.getCell(recommendationColumnNumber);
  recommendationCell.value = style.label;
  recommendationCell.font = { bold: true, color: { argb: toArgb(style.font) } };
}

function finishWorksheet(worksheet) {
  worksheet.columns.forEach((column) => {
    let maxLength = 10;

    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value == null ? "" : String(cell.value);
      maxLength = Math.max(maxLength, value.length);
      cell.alignment = {
        vertical: "middle",
        wrapText: value.length > 40,
      };
      cell.border = cell.border ?? EXPORT_BORDER;
    });

    column.width = Math.min(Math.max(maxLength + 2, 12), 42);
  });
}

function buildProfileSummarySheet(workbook, columns) {
  const worksheet = workbook.addWorksheet("Profiling summary");

  worksheet.columns = [
    { header: "Column", key: "column" },
    { header: "Type", key: "type" },
    { header: "Mandatory", key: "mandatory" },
    { header: "Blank score %", key: "blankScore" },
    { header: "True blanks", key: "trueBlanks" },
    { header: "True blank %", key: "trueBlankPercentage" },
    { header: "Custom blanks", key: "customBlanks" },
    { header: "Custom blank %", key: "customBlankPercentage" },
    { header: "Unique values", key: "uniqueValues" },
    { header: "Invalid count", key: "invalidCount" },
    { header: "Issues", key: "issues" },
    { header: "Recommendation", key: "recommendation" },
  ];

  columns.forEach((column) => {
    const row = worksheet.addRow({
      column: column.name,
      type: column.profileType,
      mandatory: column.isMandatory ? "Yes" : "No",
      blankScore: column.quality.recommendationScorePercentage,
      trueBlanks: column.quality.nullCount,
      trueBlankPercentage: column.quality.nullPercentage,
      customBlanks: column.quality.customBlankCount,
      customBlankPercentage: column.quality.customBlankPercentage,
      uniqueValues: column.quality.uniqueCount,
      invalidCount: column.quality.invalidCount,
      issues: column.issues.join(", "),
      recommendation: column.recommendation,
    });

    applyRecommendationStyle(row, column.recommendation, 12);
  });

  styleWorksheetHeader(worksheet);
  worksheet.autoFilter = "A1:L1";
  finishWorksheet(worksheet);
}

function buildIssueListSheet(workbook, columns) {
  const worksheet = workbook.addWorksheet("Issue list");

  worksheet.columns = [
    { header: "Column", key: "column" },
    { header: "Mandatory", key: "mandatory" },
    { header: "Issue", key: "issue" },
    { header: "Blank score %", key: "blankScore" },
    { header: "True blanks", key: "trueBlanks" },
    { header: "Custom blanks", key: "customBlanks" },
    { header: "Invalid count", key: "invalidCount" },
    { header: "Recommendation", key: "recommendation" },
  ];

  const issueColumns = columns.filter((column) => column.issues.length > 0);

  if (!issueColumns.length) {
    const row = worksheet.addRow({
      column: "No issues found",
      mandatory: "",
      issue: "",
      blankScore: "",
      trueBlanks: "",
      customBlanks: "",
      invalidCount: "",
      recommendation: "Keep",
    });
    applyRecommendationStyle(row, "keep", 8);
  }

  issueColumns.forEach((column) => {
    column.issues.forEach((issue) => {
      const row = worksheet.addRow({
        column: column.name,
        mandatory: column.isMandatory ? "Yes" : "No",
        issue,
        blankScore: column.quality.recommendationScorePercentage,
        trueBlanks: column.quality.nullCount,
        customBlanks: column.quality.customBlankCount,
        invalidCount: column.quality.invalidCount,
        recommendation: column.recommendation,
      });

      applyRecommendationStyle(row, column.recommendation, 8);
    });
  });

  styleWorksheetHeader(worksheet);
  worksheet.autoFilter = "A1:H1";
  finishWorksheet(worksheet);
}

function buildMatrixSheet(workbook, matrixData) {
  const worksheet = workbook.addWorksheet("Matrix results");

  if (!matrixData?.rows?.length) {
    worksheet.columns = [
      { header: "Matrix results", key: "message" },
    ];
    worksheet.addRow({
      message: "No matrix has been generated yet. Choose a Group By value and generate the matrix before exporting.",
    });
    styleWorksheetHeader(worksheet);
    finishWorksheet(worksheet);
    return;
  }

  worksheet.columns = [
    { header: `Field by ${matrixData.groupBy}`, key: "field" },
    ...(matrixData.groups ?? []).map((group) => ({
      header: `${group.value} (${group.rowCount} rows)`,
      key: String(group.value),
    })),
  ];

  matrixData.rows.forEach((matrixRow) => {
    const rowValues = { field: matrixRow.field };

    matrixRow.cells?.forEach((cell) => {
      rowValues[String(cell.groupValue)] = cell.blankPercentage;
    });

    const row = worksheet.addRow(rowValues);
    row.getCell(1).font = { bold: true, color: { argb: "FF334155" } };

    matrixRow.cells?.forEach((cell, index) => {
      const excelCell = row.getCell(index + 2);
      const style = EXPORT_RECOMMENDATION_STYLES[cell.recommendation] ?? EXPORT_RECOMMENDATION_STYLES.review;

      excelCell.numFmt = '0.00"%"';
      excelCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: toArgb(style.fill) },
      };
      excelCell.font = { color: { argb: toArgb(style.font) } };
      excelCell.note = `Blank: ${cell.blankPercentage}%\nTrue blanks: ${cell.blankCount}\nCustom blanks: ${cell.customBlankCount}\nRecommendation: ${style.label}`;
    });
  });

  styleWorksheetHeader(worksheet);
  worksheet.autoFilter = {
    from: "A1",
    to: {
      row: 1,
      column: Math.max(1, (matrixData.groups?.length ?? 0) + 1),
    },
  };
  finishWorksheet(worksheet);
}

async function downloadProfileWorkbook({ data, columns, matrixData }) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "Data Profiler";
  workbook.created = new Date();

  buildProfileSummarySheet(workbook, columns);
  buildIssueListSheet(workbook, columns);
  buildMatrixSheet(workbook, matrixData);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filePart = cleanFilePart(data?.dataset?.fileName);

  link.href = url;
  link.download = `${filePart}-profile-export.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


function App() {
  const [file, setFile] = useState(null);
  const [data, setData] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [activeSheet, setActiveSheet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState(null);
  const [chartColumnSearch, setChartColumnSearch] = useState("");
  const [fileId, setFileId] = useState(null);
  const [sheetCache, setSheetCache] = useState({});
  const [mandatoryFields, setMandatoryFields] = useState([]);
  const [mandatoryFieldOptions, setMandatoryFieldOptions] = useState([]);
  const [mandatoryFieldsLoading, setMandatoryFieldsLoading] = useState(false);
  const [mandatoryFieldsError, setMandatoryFieldsError] = useState("");

  const [rules, setRules] = useState({
    reviewNullAbove: 25,
    discardNullAtLeast: 95,
    includeCustomBlanks: false,
    customBlankValues: "0, -, N/A, Unknown, None, NULL",
  });

  const [columnFilter, setColumnFilter] = useState("all");
  const [tableFilters, setTableFilters] = useState({
    type: "all",
    mandatory: "all",
    minBlank: "",
    minUnique: "",
    search: "",
    ignoredIssues: [],
  });
  const [dataMode, setDataMode] = useState("issues");
  const [chartType, setChartType] = useState("bar");
  const [chartMetric, setChartMetric] = useState("recommendationScorePercentage");
  const [selectedChartColumns, setSelectedChartColumns] = useState([]);
  const [chartTopCount, setChartTopCount] = useState(10);
  const [showChartPicker, setShowChartPicker] = useState(false);

  const [rowFilters, setRowFilters] = useState([]);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filterColumn, setFilterColumn] = useState("");
  const [filterValues, setFilterValues] = useState([]);
  const [selectedFilterValues, setSelectedFilterValues] = useState([]);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterApplying, setFilterApplying] = useState(false);
  const [profileProgress, setProfileProgress] = useState(8);
  const [sheetProgress, setSheetProgress] = useState(8);
  const [sheetProfiling, setSheetProfiling] = useState(false);
  const [groupBy, setGroupBy] = useState("");
  const [matrixData, setMatrixData] = useState(null);
  const [matrixLoading, setMatrixLoading] = useState(false);

  // Render field names consistently with a red asterisk when they are mandatory.
  const markMandatory = (name) => (
    <span>
      {name}
      {mandatoryFields.includes(name) && <span className="ml-0.5 text-rose-500">*</span>}
    </span>
  );

  const toggleMandatoryField = (name) => {
    // Mandatory choices affect profile issues and matrices, so clear cached derived results.
    setMandatoryFields((prev) =>
      prev.includes(name)
        ? prev.filter((field) => field !== name)
        : [...prev, name]
    );
    setSheetCache({});
    setMatrixData(null);
  };

  const withWorkbookLineage = (nextData) => ({
    ...nextData,
    lineage: nextData?.lineage ?? data?.lineage,
  });

  const buildProfileUploadFormData = (targetSheetName = null) => {
    const formData = new FormData();

    formData.append("file", file);
    formData.append("review_null_above", String(normalizePercentageInput(rules.reviewNullAbove, 25)));
    formData.append("discard_null_at_least", String(normalizePercentageInput(rules.discardNullAtLeast, 95)));
    formData.append("include_custom_blanks", String(rules.includeCustomBlanks));
    formData.append("custom_blank_values", rules.customBlankValues);
    formData.append("mandatory_fields", JSON.stringify(mandatoryFields));
    formData.append("row_filters", JSON.stringify(rowFilters));

    if (targetSheetName) {
      formData.append("sheet_name", targetSheetName);
    }

    return formData;
  };

  const handleFileSelect = async (nextFile, options = {}) => {
    const { resetProfile = true } = options;

    setFile(nextFile);

    // Home-page uploads reset the experience; header uploads only stage the next file.
    if (resetProfile) {
      setData(null);
      setFileId(null);
      setSheets(null);
      setSheetNames([]);
      setActiveSheet(null);
      setSheetCache({});
      setSelectedColumn(null);
      setSelectedChartColumns([]);
      setMatrixData(null);
    } else {
      setMatrixData(null);
    }

    setMandatoryFields([]);
    setMandatoryFieldOptions([]);
    setMandatoryFieldsError("");

    if (!nextFile) return;

    // Read only the document columns first so users can pick mandatory fields before profiling.
    const formData = new FormData();
    formData.append("file", nextFile);
    setMandatoryFieldsLoading(true);

    try {
      const res = await axios.post(`${API_BASE_URL}/document-columns`, formData);
      setMandatoryFieldOptions(res.data.columns ?? []);
    } catch (err) {
      console.error("DOCUMENT COLUMNS ERROR", err);
      setMandatoryFieldsError(getApiErrorMessage(err, "Could not read columns"));
    } finally {
      setMandatoryFieldsLoading(false);
    }
  };

  const handleUpload = async () => {
    console.log("UPLOAD CLICKED", { file, rules });

    if (!file) {
      console.warn("No file selected");
      return;
    }

    // Full profiling request. The backend stores the file and returns a fileId for later actions.
    const formData = buildProfileUploadFormData();

    setLoading(true);
    const progressTimer = startProgress(setProfileProgress);

    try {
      console.log("Sending /profile request...");
      console.time("profile request");

      const res = await axios.post(`${API_BASE_URL}/profile`, formData);

      console.timeEnd("profile request");
      console.log("PROFILE RESPONSE", res.data);

      setData(res.data);
      setSelectedColumn(res.data.columns?.[0] ?? null);
      setMandatoryFieldOptions((res.data.columns ?? []).map((c) => c.name));

      // CSV and Excel both return a fileId now, which enables row filters and matrices.
      if (res.data.fileId) {
        setFileId(res.data.fileId);
        setSheets(res.data.sheets ?? {});
        setSheetNames(res.data.sheetNames ?? []);
        setActiveSheet(res.data.activeSheet ?? null);
        setSheetCache({
          [res.data.activeSheet]: res.data,
        });
      } else {
        setFileId(null);
        setSheets(null);
        setSheetNames([]);
        setActiveSheet(null);
        setSheetCache({});
      }

      setSelectedChartColumns(
        (res.data.columns ?? []).slice(0, 12).map((c) => c.name)
      );

      setMatrixData(null);
      setActiveTab("overview");
    } catch (err) {
      console.error("PROFILE ERROR", err);
      console.error("ERROR RESPONSE", err.response?.data);
      alert(getApiErrorMessage(err, "Upload failed"));
    } finally {
      console.log("UPLOAD FINISHED - clearing loading");
      window.clearInterval(progressTimer);
      setProfileProgress(100);
      await wait(450);
      setLoading(false);
    }
  };

  const handleSheetChange = async (sheetName) => {
    console.log("SHEET CHANGE", {
      sheetName,
      fileId,
      cached: Boolean(sheetCache[sheetName]),
    });

    // Reuse a previously profiled sheet instead of re-reading it from the backend.
    if (sheetCache[sheetName]) {
      console.log("Using cached sheet", sheetName);

      const cachedSheet = withWorkbookLineage(sheetCache[sheetName]);

      setData(cachedSheet);
      setActiveSheet(sheetName);
      setSelectedColumn(cachedSheet.columns?.[0] ?? null);
      setSelectedChartColumns(
        (cachedSheet.columns ?? []).slice(0, 12).map((c) => c.name)
      );

      return;
    }

    if (!fileId) {
      console.error("No fileId found", {
        sheetName,
        sheetCacheKeys: Object.keys(sheetCache),
      });
      return;
    }

    const formData = new FormData();
    formData.append("file_id", fileId);
    formData.append("sheet_name", sheetName);
    formData.append("review_null_above", String(normalizePercentageInput(rules.reviewNullAbove, 25)));
    formData.append("discard_null_at_least", String(normalizePercentageInput(rules.discardNullAtLeast, 95)));
    formData.append("include_custom_blanks", String(rules.includeCustomBlanks));
    formData.append("custom_blank_values", rules.customBlankValues);
    formData.append("mandatory_fields", JSON.stringify(mandatoryFields));
    formData.append("row_filters", JSON.stringify(rowFilters));

    setSheetProfiling(true);
    const progressTimer = startProgress(setSheetProgress);
    const timerLabel = `profile-sheet request: ${sheetName}`;

    try {
      console.time(timerLabel);

      const res = await axios.post(`${API_BASE_URL}/profile-sheet`, formData);

      console.timeEnd(timerLabel);
      console.log("PROFILE SHEET RESPONSE", res.data);
      const sheetData = withWorkbookLineage(res.data);

      setSheetCache((prev) => ({
        ...prev,
        [sheetName]: sheetData,
      }));

      setData(sheetData);
      setActiveSheet(sheetName);
      setSelectedColumn(sheetData.columns?.[0] ?? null);
      setMandatoryFieldOptions((sheetData.columns ?? []).map((c) => c.name));
      setSelectedChartColumns((sheetData.columns ?? []).slice(0, 12).map((c) => c.name));
    } catch (err) {
      if (isFileExpiredError(err) && file) {
        console.warn("Stored file expired; re-uploading workbook for selected sheet");

        try {
          const res = await axios.post(`${API_BASE_URL}/profile`, buildProfileUploadFormData(sheetName));
          const sheetData = withWorkbookLineage(res.data);

          setFileId(res.data.fileId ?? null);
          setSheets(res.data.sheets ?? {});
          setSheetNames(res.data.sheetNames ?? []);
          setActiveSheet(res.data.activeSheet ?? sheetName);
          setSheetCache({
            [res.data.activeSheet ?? sheetName]: sheetData,
          });
          setData(sheetData);
          setSelectedColumn(sheetData.columns?.[0] ?? null);
          setMandatoryFieldOptions((sheetData.columns ?? []).map((c) => c.name));
          setSelectedChartColumns((sheetData.columns ?? []).slice(0, 12).map((c) => c.name));
          setMatrixData(null);
          return;
        } catch (reuploadErr) {
          console.error("PROFILE SHEET REUPLOAD ERROR", reuploadErr);
          console.error("ERROR RESPONSE", reuploadErr.response?.data);
          alert(getApiErrorMessage(reuploadErr, "Sheet profiling failed"));
          return;
        }
      }

      console.error("PROFILE SHEET ERROR", err);
      console.error("ERROR RESPONSE", err.response?.data);
      alert(getApiErrorMessage(err, "Sheet profiling failed"));
    } finally {
      window.clearInterval(progressTimer);
      setSheetProgress(100);
      await wait(350);
      setSheetProfiling(false);
    }
  };

  const loadColumnValues = async (columnName, search = "") => {
    if (!fileId || !activeSheet || !columnName) return;

    // Populate the row-filter value picker for the currently selected column.
    const formData = new FormData();
    formData.append("file_id", fileId);
    formData.append("sheet_name", activeSheet);
    formData.append("column_name", columnName);
    formData.append("search", search);
    formData.append("limit", "150");

    const res = await axios.post(`${API_BASE_URL}/column-values`, formData);
    setFilterValues(res.data.values ?? []);
  };

  const openRowFilterModal = () => {
    const firstColumn = columns[0]?.name ?? "";

    setFilterColumn(firstColumn);
    setSelectedFilterValues([]);
    setFilterSearch("");
    setFilterModalOpen(true);

    if (firstColumn) {
      loadColumnValues(firstColumn);
    }
  };

  const reprofileWithFilters = async (filtersToUse) => {
    // Apply row filters to the current stored file. Falls back to full upload if needed.
    if (!fileId || !activeSheet) {
      await handleUpload();
      return;
    }

    const formData = new FormData();
    formData.append("file_id", fileId);
    formData.append("sheet_name", activeSheet);
    formData.append("review_null_above", String(normalizePercentageInput(rules.reviewNullAbove, 25)));
    formData.append("discard_null_at_least", String(normalizePercentageInput(rules.discardNullAtLeast, 95)));
    formData.append("include_custom_blanks", String(rules.includeCustomBlanks));
    formData.append("custom_blank_values", rules.customBlankValues);
    formData.append("mandatory_fields", JSON.stringify(mandatoryFields));
    formData.append("row_filters", JSON.stringify(filtersToUse));

    setFilterApplying(true);

    try {
      const res = await axios.post(`${API_BASE_URL}/profile-sheet`, formData);
      const sheetData = withWorkbookLineage(res.data);

      setData(sheetData);
      setSelectedColumn(sheetData.columns?.[0] ?? null);
      setMandatoryFieldOptions((sheetData.columns ?? []).map((c) => c.name));
      setSelectedChartColumns((sheetData.columns ?? []).slice(0, 12).map((c) => c.name));
    } finally {
      setFilterApplying(false);
    }
  };

  const addRowFilter = async () => {
    if (!filterColumn || selectedFilterValues.length === 0) return;

    const nextFilters = [
      ...rowFilters.filter((f) => f.column !== filterColumn),
      {
        column: filterColumn,
        values: selectedFilterValues,
      },
    ];

    setRowFilters(nextFilters);
    setFilterModalOpen(false);
    await reprofileWithFilters(nextFilters);
  };

  const removeRowFilter = async (columnName) => {
    const nextFilters = rowFilters.filter((f) => f.column !== columnName);
    setRowFilters(nextFilters);
    await reprofileWithFilters(nextFilters);
  };

  const getFilterLabel = (filter) => {
    if (!filter?.values?.length) return "No values selected";

    if (filter.values.length <= 3) {
      return filter.values.join(", ");
    }

    return `${filter.values.slice(0, 3).join(", ")} +${filter.values.length - 3} more`;
  };



  const editRowFilter = async (filter) => {
    setFilterColumn(filter.column);
    setSelectedFilterValues(filter.values);
    setFilterSearch("");
    setFilterModalOpen(true);
    await loadColumnValues(filter.column);
  };

  const handleExportExcel = async () => {
    if (!data) return;

    try {
      await downloadProfileWorkbook({
        data,
        columns,
        matrixData,
      });
    } catch (err) {
      console.error("EXPORT ERROR", err);
      alert(err.message || "Export failed");
    }
  };

  const handleUploadClick = () => {
    if (file) {
      handleUpload();
    }
  };

  const loadMatrix = async (groupColumn = groupBy) => {
    if (!fileId || !activeSheet || !groupColumn) return;

    // Matrix compares blank percentages for every field across values in the group column.
    const formData = new FormData();

    formData.append("file_id", fileId);
    formData.append("sheet_name", activeSheet);
    formData.append("group_by", groupColumn);
    formData.append("review_null_above", String(normalizePercentageInput(rules.reviewNullAbove, 25)));
    formData.append("discard_null_at_least", String(normalizePercentageInput(rules.discardNullAtLeast, 95)));
    formData.append("include_custom_blanks", String(rules.includeCustomBlanks));
    formData.append("custom_blank_values", rules.customBlankValues);
    formData.append("row_filters", JSON.stringify(rowFilters));

    setMatrixLoading(true);

    try {
      const res = await axios.post(`${API_BASE_URL}/matrix`, formData);
      setMatrixData(res.data);
    } catch (err) {
      console.error("MATRIX ERROR", err);
      alert(getApiErrorMessage(err, "Matrix failed"));
    } finally {
      setMatrixLoading(false);
    }
  };
  const columns = data?.columns ?? [];

  const profileTypes = useMemo(() => ["all", ...new Set(columns.map((c) => c.profileType))], [columns]);
  const issueTypes = useMemo(
    () => [...new Set(columns.flatMap((col) => col.issues ?? []))].sort(),
    [columns]
  );
  const getEffectiveIssues = (col) =>
    (col.issues ?? []).filter((issue) => !(tableFilters.ignoredIssues ?? []).includes(issue));
  const effectiveColumnsWithIssues = useMemo(
    () => columns.filter((col) => getEffectiveIssues(col).length > 0).length,
    [columns, tableFilters.ignoredIssues]
  );

  const filteredColumns = useMemo(() => {
    return columns.filter((col) => {
      const effectiveIssues = getEffectiveIssues(col);
      const recOk = columnFilter === "all" || (columnFilter === "issues" ? effectiveIssues.length > 0 : col.recommendation === columnFilter);
      const typeOk = tableFilters.type === "all" || col.profileType === tableFilters.type;
      const mandatoryOk = tableFilters.mandatory === "all" || (tableFilters.mandatory === "mandatory" ? col.isMandatory : !col.isMandatory);
      const blankOk = tableFilters.minBlank === "" || col.quality.recommendationScorePercentage >= Number(tableFilters.minBlank);
      const uniqueOk = tableFilters.minUnique === "" || col.quality.uniqueCount >= Number(tableFilters.minUnique);
      const searchOk = tableFilters.search.trim() === "" || col.name.toLowerCase().includes(tableFilters.search.toLowerCase());
      return recOk && typeOk && mandatoryOk && blankOk && uniqueOk && searchOk;
    });
  }, [columns, columnFilter, tableFilters]);

  const chartData = useMemo(() => {
    const selected = selectedChartColumns.length ? selectedChartColumns : columns.slice(0, 12).map((c) => c.name);
    return columns
      .filter((col) => selected.includes(col.name))
      .map((col) => ({
        name: col.isMandatory ? `${col.name} *` : col.name,
        "Blank score %": col.quality.recommendationScorePercentage,
        "True blank %": col.quality.nullPercentage,
        "Custom blank %": col.quality.customBlankPercentage,
        "Unique values": col.quality.uniqueCount,
        "Invalid count": col.quality.invalidCount,
        "Issue count": col.issues.length,
      }));
  }, [columns, selectedChartColumns]);

  const chartDataKey = metricOptions.find((m) => m.key === chartMetric)?.dataKey ?? "Blank score %";
  const lineage = data?.lineage;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-200">
      {!data && !loading ? (
        // Show file upload center when no data
        <FileUploadCenter
          onFileSelect={handleFileSelect}
          onUpload={handleUploadClick}
          mandatoryFields={mandatoryFields}
          mandatoryFieldOptions={mandatoryFieldOptions}
          mandatoryFieldsLoading={mandatoryFieldsLoading}
          mandatoryFieldsError={mandatoryFieldsError}
          onToggleMandatoryField={toggleMandatoryField}
        />
      ) : (
        // Show the main app when data exists or loading
        <>
          <header className="sticky top-0 z-40 border-b border-slate-200 bg-gradient-to-r from-blue-50/80 via-white/80 to-teal-50/80 backdrop-blur-md px-6 py-3">
            <div className="flex items-center justify-between gap-4">
              {/* Center Logo */}
              <div className="absolute w-[50px] top-1/2 -translate-x-1/2 -translate-y-1/4">
                <ThreadWordmark variant="header" />
              </div>

              {/* Left spacer */}
              <div className="w-[160px]" />

              {/* Actions */}
              <div className="ml-auto flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50">
                  <FileSpreadsheet size={14} className="text-blue-500" />
                  <span className="max-w-[240px] truncate text-sm">
                    {file ? file.name : "Choose file"}
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) =>
                      handleFileSelect(e.target.files?.[0] ?? null, {
                        resetProfile: false,
                      })
                    }
                  />
                </label>

                <button
                  onClick={handleUpload}
                  disabled={!file || loading}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <RefreshCw size={14} /> : <Upload size={14} />}
                  {loading ? "Profiling..." : data ? "Re-profile" : "Generate"}
                </button>
              </div>
            </div>
          </header>

          {loading && <LoadingState hasExistingData={Boolean(data)} progress={profileProgress} />}

          {data && !loading && (
            <div className="flex min-h-[calc(100vh-65px)]">
              <aside className={`${sidebarCollapsed ? "w-14 p-2" : "w-[380px] p-4"} shrink-0 border-r border-slate-200 bg-white transition-[width] duration-200`}>
                <div className="sticky top-[80px] space-y-4">
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed((value) => !value)}
                    title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    className={`flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 ${sidebarCollapsed ? "w-full" : "w-full gap-2 text-sm font-medium"
                      }`}
                  >
                    {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                    {!sidebarCollapsed && <span>Collapse sidebar</span>}
                  </button>

                  {!sidebarCollapsed && (
                    <>
                      <Panel title="Data source" icon={<FileSpreadsheet size={16} />}>
                        <div className="space-y-3">
                          {/* File name */}
                          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                            <FileSpreadsheet size={14} className="text-emerald-500" />
                            <span className="text-sm font-medium text-slate-700 truncate">
                              {data.dataset.fileName}
                            </span>
                          </div>

                          {/* Row and column stats with icons */}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50">
                                <Rows3 size={14} className="text-emerald-600" />
                              </div>
                              <div>
                                <p className="text-xs text-slate-400">Total rows</p>
                                <p className="text-sm font-bold text-slate-800">{data.dataset.rowCount.toLocaleString()}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50">
                                <Columns3 size={14} className="text-blue-600" />
                              </div>
                              <div>
                                <p className="text-xs text-slate-400">Total columns</p>
                                <p className="text-sm font-bold text-slate-800">{data.dataset.columnCount.toLocaleString()}</p>
                              </div>
                            </div>
                          </div>

                          {/* Sheet selector - only for multi-sheet Excel files */}
                          {sheetNames.length > 1 && (
                            <div className="space-y-1.5">
                              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                                <span className="text-sm">📄</span> Sheet
                              </label>
                              <select
                                value={activeSheet ?? ""}
                                onChange={(e) => handleSheetChange(e.target.value)}
                                disabled={sheetProfiling}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                              >
                                {sheetNames.map((s) => {
                                  // Clean display name: remove the filename prefix if it exists
                                  let displayName = s;
                                  const fileNameWithoutExt = data.dataset.fileName.replace(/\.(xlsx|xls|csv)$/i, '');

                                  if (displayName.startsWith(fileNameWithoutExt + " - ")) {
                                    displayName = displayName.replace(fileNameWithoutExt + " - ", "");
                                  } else if (displayName.startsWith(data.dataset.fileName.replace(/\.(xlsx|xls)$/i, '') + " - ")) {
                                    displayName = displayName.replace(data.dataset.fileName.replace(/\.(xlsx|xls)$/i, '') + " - ", "");
                                  }

                                  return <option key={s} value={s}>{displayName}</option>;
                                })}
                              </select>
                              <p className="text-xs text-slate-400">
                                {sheetNames.length} sheets in this workbook
                              </p>
                              {sheetProfiling && (
                                <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2">
                                  <div className="mb-1 flex items-center justify-between text-xs">
                                    <span className="font-medium text-slate-600">Profiling sheet</span>
                                    <span className="text-slate-400">Please wait</span>
                                  </div>
                                  <ProgressBar size="sm" progress={sheetProgress} />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </Panel>

                      <Panel title="Mandatory fields" icon={<AlertTriangle size={16} />} collapsible>
                        <div className="space-y-3">
                          <div className="rounded-lg bg-grey-50/60 px-3 py-2">
                            <p className="text-xs leading-relaxed text-slate-600">
                              Fields marked mandatory are shown with a red asterisk and flagged when blank values are found.
                            </p>
                          </div>

                          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/40 p-2">
                            {mandatoryFieldOptions.length === 0 && (
                              <p className="px-2 py-3 text-center text-xs text-slate-400">
                                Choose a file to load fields
                              </p>
                            )}

                            {mandatoryFieldOptions.map((name) => (
                              <label
                                key={name}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 transition hover:bg-white"
                              >
                                <input
                                  type="checkbox"
                                  checked={mandatoryFields.includes(name)}
                                  onChange={() => toggleMandatoryField(name)}
                                  className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-1 focus:ring-rose-200"
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {markMandatory(name)}
                                </span>
                              </label>
                            ))}
                          </div>

                          <button
                            onClick={() => {
                              if (fileId && activeSheet) {
                                reprofileWithFilters(rowFilters);
                              } else {
                                handleUpload();
                              }
                            }}
                            disabled={!file || loading}
                            className="w-full rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Re-profile with mandatory fields
                          </button>
                        </div>
                      </Panel>

                      <Panel title="Recommendation criteria" icon={<Settings2 size={16} />} collapsible>
                        <div className="space-y-4">
                          {/* Review threshold */}
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-500">
                              Review if blank score is above
                            </label>
                            <div className="flex items-center gap-3">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={rules.reviewNullAbove}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setRules((p) => ({
                                    ...p,
                                    reviewNullAbove: value === "" ? "" : Number(value),
                                  }));
                                }}
                                onBlur={() =>
                                  setRules((p) => ({
                                    ...p,
                                    reviewNullAbove: normalizePercentageInput(p.reviewNullAbove, 25),
                                  }))
                                }
                                className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                              />
                              <span className="text-xs text-slate-400">%</span>
                            </div>
                          </div>

                          {/* Discard threshold */}
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-500">
                              Discard if blank score is at least
                            </label>
                            <div className="flex items-center gap-3">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={rules.discardNullAtLeast}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setRules((p) => ({
                                    ...p,
                                    discardNullAtLeast: value === "" ? "" : Number(value),
                                  }));
                                }}
                                onBlur={() =>
                                  setRules((p) => ({
                                    ...p,
                                    discardNullAtLeast: normalizePercentageInput(p.discardNullAtLeast, 95),
                                  }))
                                }
                                className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                              />
                              <span className="text-xs text-slate-400">%</span>
                            </div>
                          </div>

                          {/* Custom blank values */}
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-500">
                              Treat these values as blank
                            </label>
                            <input
                              value={rules.customBlankValues}
                              onChange={(e) => setRules((p) => ({ ...p, customBlankValues: e.target.value }))}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                              placeholder="e.g., 0, -, N/A, Unknown"
                            />
                            <p className="mt-1 text-xs text-slate-400">
                              Comma-separated values
                            </p>
                          </div>

                          {/* Checkbox */}
                          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-100 bg-slate-50/50 p-3 transition hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={rules.includeCustomBlanks}
                              onChange={(e) => setRules((p) => ({ ...p, includeCustomBlanks: e.target.checked }))}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-1 focus:ring-blue-200"
                            />
                            <span className="text-xs text-slate-600 leading-relaxed">
                              Include custom blank values in recommendation score
                            </span>
                          </label>

                          {/* Button */}
                          <button
                            onClick={handleUpload}
                            className="mt-2 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                          >
                            Apply and re-profile
                          </button>
                        </div>
                      </Panel>

                      <Panel title="Row filters" icon={<Filter size={16} />} collapsible>
                        <div className="space-y-3">
                          <button
                            type="button"
                            onClick={openRowFilterModal}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:border-blue-400 hover:bg-blue-100"
                          >
                            <span className="text-lg leading-none">+</span>
                            Add row filter
                          </button>

                          <div className="space-y-2">
                            {rowFilters.length === 0 && (
                              <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-4 text-center">
                                <p className="text-xs text-slate-400">
                                  No row filters applied
                                </p>
                              </div>
                            )}

                            {rowFilters.map((f) => (
                              <button
                                key={f.column}
                                type="button"
                                onClick={() => editRowFilter(f)}
                                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-slate-800">
                                      {f.column}
                                    </p>
                                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                                      {getFilterLabel(f)}
                                    </p>
                                  </div>
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeRowFilter(f.column);
                                    }}
                                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50 hover:text-red-600"
                                  >
                                    Remove
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </Panel>

                      <Panel title="Grouping" icon={<SlidersHorizontal size={16} />} collapsible>
                        <div className="space-y-3">
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-500">
                              Group By
                            </label>
                            <select
                              value={groupBy}
                              onChange={(e) => {
                                const value = e.target.value;
                                setGroupBy(value);
                                setMatrixData(null);
                                if (value) {
                                  loadMatrix(value);
                                }
                              }}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                            >
                              <option value="">-- None --</option>
                              {columns.map((col) => (
                                <option key={col.name} value={col.name}>
                                  {col.name}{col.isMandatory ? " *" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="rounded-lg bg-blue-50/50 px-3 py-2">
                            <p className="text-xs text-slate-600 leading-relaxed">
                              Matrix compares blank % for each field across the selected group.
                            </p>
                          </div>
                        </div>
                      </Panel>
                    </>
                  )}
                </div>
              </aside>

              <main className="min-w-0 flex-1 p-5">
                <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-10">
                  <Stat icon={<Rows3 size={16} />} label="Rows" value={data.dataset.rowCount} />
                  <Stat icon={<Columns3 size={16} />} label="Columns" value={data.dataset.columnCount} />
                  <Stat icon={<Copy size={16} />} label="Duplicates" value={data.dataset.duplicateRows} />
                  <Stat icon={<AlertTriangle size={16} />} label="Blank cells" value={data.summary.totalBlankCells} tone="red" />
                  <Stat
                    icon={<GitBranch size={16} />}
                    label="Queries"
                    value={lineage?.summary?.queryCount ?? 0}
                    tone="blue"
                    active={activeTab === "lineage"}
                    onClick={() => setActiveTab("lineage")}
                  />
                  <Stat
                    label="Keep"
                    value={data.summary.recommendationCounts.keep}
                    tone="green"
                    active={columnFilter === "keep"}
                    onClick={() => {
                      setColumnFilter(columnFilter === "keep" ? "all" : "keep");
                      setActiveTab("columns");
                    }}
                  />
                  <Stat
                    label="Review"
                    value={data.summary.recommendationCounts.review}
                    tone="amber"
                    active={columnFilter === "review"}
                    onClick={() => {
                      setColumnFilter(columnFilter === "review" ? "all" : "review");
                      setActiveTab("columns");
                    }}
                  />
                  <Stat
                    label="Discard"
                    value={data.summary.recommendationCounts.discard}
                    tone="red"
                    active={columnFilter === "discard"}
                    onClick={() => {
                      setColumnFilter(columnFilter === "discard" ? "all" : "discard");
                      setActiveTab("columns");
                    }}
                  />
                  <Stat
                    label="Issues"
                    value={effectiveColumnsWithIssues}
                    tone="blue"
                    active={columnFilter === "issues"}
                    onClick={() => {
                      setColumnFilter(columnFilter === "issues" ? "all" : "issues");
                      setActiveTab("columns");
                    }}
                  />
                  <Stat
                    label="Mandatory"
                    value={data.summary.mandatoryColumns ?? mandatoryFields.length}
                    tone="red"
                    active={tableFilters.mandatory === "mandatory"}
                    onClick={() => {
                      setTableFilters((p) => ({
                        ...p,
                        mandatory: p.mandatory === "mandatory" ? "all" : "mandatory",
                      }));
                      setActiveTab("columns");
                    }}
                  />
                </div>

                <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                  <div className="flex flex-wrap gap-2">
                    <Tab
                      active={activeTab === "overview"}
                      onClick={() => setActiveTab("overview")}
                      icon={<Eye size={14} />}
                      label="Overview"
                    />
                    <Tab
                      active={activeTab === "columns"}
                      onClick={() => setActiveTab("columns")}
                      icon={<Table2 size={14} />}
                      label="Columns"
                    />
                    <Tab
                      active={activeTab === "charts"}
                      onClick={() => setActiveTab("charts")}
                      icon={<BarChart3 size={14} />}
                      label="Charts"
                    />
                    <Tab
                      active={activeTab === "lineage"}
                      onClick={() => setActiveTab("lineage")}
                      icon={<GitBranch size={14} />}
                      label="Lineage"
                    />
                    <Tab
                      label="Matrix"
                      active={activeTab === "matrix"}
                      onClick={() => {
                        setActiveTab("matrix");
                        if (groupBy && !matrixData) {
                          loadMatrix(groupBy);
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleExportExcel}
                    className="flex shrink-0 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
                  >
                    <Download size={14} />
                    Export Excel
                  </button>
                </div>

                {activeTab === "overview" && (
                  <Overview
                    data={data}
                    columns={columns}
                    setActiveTab={setActiveTab}
                    setSelectedColumn={setSelectedColumn}
                  />
                )}
                {activeTab === "columns" && (
                  <Columns
                    columns={columns}
                    filteredColumns={filteredColumns}
                    selectedColumn={selectedColumn}
                    setSelectedColumn={setSelectedColumn}
                    tableFilters={tableFilters}
                    setTableFilters={setTableFilters}
                    profileTypes={profileTypes}
                    issueTypes={issueTypes}
                  />
                )}
                {activeTab === "charts" && (
                  <Charts
                    columns={columns}
                    chartData={chartData}
                    chartDataKey={chartDataKey}
                    chartType={chartType}
                    setChartType={setChartType}
                    chartMetric={chartMetric}
                    setChartMetric={setChartMetric}
                    selectedChartColumns={selectedChartColumns}
                    setSelectedChartColumns={setSelectedChartColumns}
                    chartTopCount={chartTopCount}
                    setChartTopCount={setChartTopCount}
                    showChartPicker={showChartPicker}
                    setShowChartPicker={setShowChartPicker}
                    chartColumnSearch={chartColumnSearch}
                    setChartColumnSearch={setChartColumnSearch}
                  />
                )}
                {activeTab === "matrix" && (
                  <MatrixView
                    matrixData={matrixData}
                    matrixLoading={matrixLoading}
                    groupBy={groupBy}
                    mandatoryFields={mandatoryFields}
                    loadMatrix={loadMatrix}
                  />
                )}
                {activeTab === "lineage" && (
                  <Lineage lineage={lineage} />
                )}
              </main>
            </div>
          )}

          {/* Filter Modal */}
          {filterModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
              <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                  <h2 className="text-lg font-semibold text-slate-800">Add row filter</h2>
                  <button
                    type="button"
                    onClick={() => setFilterModalOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-5">
                  {/* Column selector */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                      Column
                    </label>
                    <select
                      value={filterColumn}
                      onChange={(e) => {
                        setFilterColumn(e.target.value);
                        setSelectedFilterValues([]);
                        loadColumnValues(e.target.value, filterSearch);
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                    >
                      {columns.map((col) => (
                        <option key={col.name} value={col.name}>
                          {col.name}{col.isMandatory ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Search input */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                      Search values
                    </label>
                    <div className="relative">
                      <input
                        value={filterSearch}
                        onChange={(e) => {
                          setFilterSearch(e.target.value);
                          loadColumnValues(filterColumn, e.target.value);
                        }}
                        placeholder="Type to search..."
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pl-9 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                      />
                      <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedFilterValues(filterValues.map((x) => x.value))}
                      className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedFilterValues([])}
                      className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
                    >
                      Clear all
                    </button>
                    <span className="flex-1" />
                    <span className="text-xs text-slate-400">
                      {selectedFilterValues.length} selected
                    </span>
                  </div>

                  {/* Values list */}
                  <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
                    {filterValues.length === 0 ? (
                      <div className="py-8 text-center text-sm text-slate-400">
                        No values found
                      </div>
                    ) : (
                      filterValues.map((item) => {
                        const checked = selectedFilterValues.includes(item.value);
                        return (
                          <label
                            key={item.value}
                            className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition ${checked ? "bg-blue-50" : "hover:bg-slate-50"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedFilterValues((prev) =>
                                  prev.includes(item.value)
                                    ? prev.filter((x) => x !== item.value)
                                    : [...prev, item.value]
                                )
                              }
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-1 focus:ring-blue-200"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                              {item.value === "" || item.value === null ? "(blank)" : item.value}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                              {item.count.toLocaleString()}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4 bg-slate-50/50">
                  <button
                    type="button"
                    onClick={() => setFilterModalOpen(false)}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={addRowFilter}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  >
                    Add filter
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

}

function ProgressBar({ size = "md", progress = 0 }) {
  const height = size === "sm" ? "h-1.5" : "h-2.5";
  const boundedProgress = Math.max(0, Math.min(100, progress));

  return (
    <div className={`${height} overflow-hidden rounded-full bg-slate-100`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-500 to-teal-400 shadow-sm transition-[width] duration-500 ease-out"
        style={{ width: `${boundedProgress}%` }}
      />
    </div>
  );
}

function LoadingState({ hasExistingData = false, progress }) {
  return (
    <div className={`flex ${hasExistingData ? "min-h-[220px]" : "min-h-[80vh]"} items-center justify-center px-4`}>
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white px-8 py-7 text-center shadow-sm">
        <p className="text-lg font-bold text-slate-800">Profiling your dataset...</p>
        <p className="mt-2 text-sm text-slate-500">
          Checking structure, blanks, issues, and recommendations.
        </p>
        <div className="mt-6">
          <ProgressBar progress={progress} />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, icon, children, collapsible = false, defaultOpen = true }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  // Sidebar sections opt into collapse behavior; normal panels stay permanently open.
  if (collapsible) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          aria-expanded={isOpen}
          aria-controls={contentId}
          className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-slate-900"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-blue-600">{icon}</span>
            <span className="truncate">{title}</span>
          </span>
          <ChevronDown
            size={16}
            className={`shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isOpen && (
          <div id={contentId} className="mt-3">
            {children}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="text-blue-600">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}
function Stat({ icon, label, value, tone = "slate", active = false, onClick }) {
  const colors = {
    slate: "text-slate-600",
    red: "text-red-600",
    green: "text-emerald-600",
    amber: "text-amber-600",
    blue: "text-blue-600",
  };

  const isClickable = Boolean(onClick);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      className={`rounded-xl border p-3 text-left transition-all ${active
        ? "border-blue-400 bg-blue-50"
        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
        } ${isClickable ? "cursor-pointer" : "cursor-default"}`}
    >
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </span>
      </div>
      <p className={`mt-1 text-2xl font-bold ${colors[tone]}`}>
        {Number(value).toLocaleString()}
      </p>
    </button>
  );
}

function Tab({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ${active
        ? "border-blue-300 bg-blue-50 text-blue-600"
        : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700"
        }`}
    >
      {icon}
      {label}
    </button>
  );
}
function RecommendationBadge({ value }) { const config = { keep: [<CheckCircle size={13} />, "Keep", "bg-emerald-50 text-emerald-700 ring-emerald-200"], review: [<AlertTriangle size={13} />, "Review", "bg-amber-50 text-amber-700 ring-amber-200"], discard: [<XCircle size={13} />, "Discard", "bg-red-50 text-red-700 ring-red-200"] }; const item = config[value] ?? config.review; return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ring-1 ${item[2]}`}>{item[0]}{item[1]}</span>; }
export default App;
