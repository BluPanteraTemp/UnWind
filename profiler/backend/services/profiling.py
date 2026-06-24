"""Column profiling, statistics, issue examples, and dataset summaries."""

import json
import math
import re
from typing import Any, Dict, List, Optional

import polars as pl


TYPE_DETECTION_SAMPLE_SIZE = 1000
TOP_VALUES_LIMIT = 10
PREVIEW_ROWS = 50
PREVIEW_COLUMN_LIMIT = 100
ISSUE_ROWS_LIMIT = 100
ISSUE_EXAMPLES_LIMIT = 5
WIDE_PROFILE_COLUMN_LIMIT = 200


# Form parsing and JSON-safe output cleanup.
def parse_custom_blank_values(raw: Optional[str]) -> List[str]:
    if not raw:
        return []

    return [x.strip().lower() for x in raw.split(",") if x.strip()]


def parse_json_list(raw: Optional[str]) -> List[str]:
    # Frontend sends list-style form values, such as mandatory fields, as JSON strings.
    if not raw:
        return []

    try:
        values = json.loads(raw)
    except json.JSONDecodeError:
        return []

    if not isinstance(values, list):
        return []

    return [str(value) for value in values if str(value).strip()]


def clean_value(value):
    if value is None:
        return None

    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, 2)

    return value


def clean_record(record: Dict[str, Any]) -> Dict[str, Any]:
    return {key: clean_value(value) for key, value in record.items()}


def build_row_preview(row: Dict[str, Any], focus_column: str) -> Dict[str, Any]:
    preview = {}

    if focus_column in row:
        preview[focus_column] = row.get(focus_column)

    for key, value in row.items():
        if key == "_rowNumber" or key == focus_column:
            continue

        preview[key] = value

        if len(preview) >= 6:
            break

    return clean_record(preview)


# Type detection and validators.
def is_name_datetime_like(column_name: str) -> bool:
    name = column_name.lower()

    return (
        "date" in name
        or name.endswith("_at")
        or "time" in name
        or "created" in name
        or "updated" in name
        or "valid_from" in name
        or "valid_to" in name
    )


def try_parse_datetime(series: pl.Series) -> pl.Series:
    text = series.cast(pl.Utf8, strict=False)

    return (
        text.str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S", strict=False)
        .fill_null(text.str.strptime(pl.Datetime, "%Y-%m-%d", strict=False))
        .fill_null(text.str.strptime(pl.Datetime, "%d/%m/%Y", strict=False))
        .fill_null(text.str.strptime(pl.Datetime, "%m/%d/%Y", strict=False))
    )


def detect_profile_type(column_name: str, series: pl.Series) -> str:
    name = column_name.lower()

    if "email" in name or "mail" in name:
        return "email"

    if "phone" in name or "mobile" in name or "contact" in name:
        return "phone"

    dtype = series.dtype

    numeric_types = {
        pl.Int8, pl.Int16, pl.Int32, pl.Int64,
        pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64,
        pl.Float32, pl.Float64,
    }

    if dtype in numeric_types:
        return "numeric"

    if dtype == pl.Boolean:
        return "boolean"

    text_series = series.cast(pl.Utf8, strict=False).str.strip_chars()

    non_blank = text_series.filter(
        text_series.is_not_null() & (text_series != "")
    ).head(TYPE_DETECTION_SAMPLE_SIZE)

    values = non_blank.to_list()

    if not values:
        return "empty"

    if is_name_datetime_like(column_name):
        sample = values[:100]

        parsed = try_parse_datetime(pl.Series(sample))

        valid_ratio = parsed.drop_nulls().len() / len(sample)

        if valid_ratio > 0.7:
            return "datetime"

    # CSV columns are loaded as text, so infer numeric-ness from values instead of dtype.
    numeric_probe = pl.Series(values).cast(pl.Float64, strict=False)
    numeric_ratio = numeric_probe.drop_nulls().len() / len(values)

    if numeric_ratio > 0.8:
        return "numeric"

    unique_count = len(set(values))
    unique_ratio = unique_count / len(values)
    avg_length = sum(len(str(v)) for v in values) / len(values)

    if unique_ratio <= 0.3 and avg_length <= 50:
        return "categorical"

    return "text"


def validate_email_text(value: str) -> bool:
    if value is None or str(value).strip() == "":
        return True

    return re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", str(value).strip()) is not None


def validate_phone_text(value: str) -> bool:
    if value is None or str(value).strip() == "":
        return True

    cleaned = re.sub(r"[\s\-\(\)]", "", str(value).strip())

    return (
        cleaned.startswith("+")
        and cleaned[1:].isdigit()
        and 8 <= len(cleaned[1:]) <= 15
    ) or (
        cleaned.isdigit()
        and 8 <= len(cleaned) <= 15
    )


def blank_mask_expr(column_name: str):
    return (
        pl.col(column_name).is_null()
        | (pl.col(column_name).cast(pl.Utf8, strict=False).str.strip_chars() == "")
    )


def custom_blank_mask_expr(column_name: str, custom_blank_values: List[str]):
    if not custom_blank_values:
        return pl.lit(False)

    return (
        pl.col(column_name)
        .cast(pl.Utf8, strict=False)
        .str.strip_chars()
        .str.to_lowercase()
        .is_in(custom_blank_values)
        & ~blank_mask_expr(column_name)
    )


# Per-column statistics builders.
def build_top_values(series: pl.Series):
    s = series.cast(pl.Utf8, strict=False).str.strip_chars()
    s = s.filter(s.is_not_null() & (s != ""))

    if s.is_empty():
        return []

    vc = s.value_counts(sort=True).head(TOP_VALUES_LIMIT)

    name_col = vc.columns[0]
    count_col = vc.columns[1]

    return [
        {"value": str(row[name_col]), "count": int(row[count_col])}
        for row in vc.to_dicts()
    ]


def build_text_stats(series: pl.Series):
    s = series.cast(pl.Utf8, strict=False).str.strip_chars()
    non_empty = s.filter(s.is_not_null() & (s != ""))

    empty_count = int((s == "").sum() or 0)

    if non_empty.is_empty():
        return {
            "minLength": 0,
            "maxLength": 0,
            "meanLength": 0,
            "medianLength": 0,
            "emptyStringCount": empty_count,
        }

    lengths = non_empty.str.len_chars()

    return {
        "minLength": int(lengths.min() or 0),
        "maxLength": int(lengths.max() or 0),
        "meanLength": clean_value(float(lengths.mean() or 0)),
        "medianLength": clean_value(float(lengths.median() or 0)),
        "emptyStringCount": empty_count,
        "avgWordCount": clean_value(
            float(
                non_empty
                .str.split(" ")
                .list.len()
                .mean()
                or 0
            )
        ),
    }


def build_numeric_stats(series: pl.Series):
    numeric = series.cast(pl.Float64, strict=False).drop_nulls()

    if numeric.is_empty():
        return None, set()

    q1 = numeric.quantile(0.25)
    q3 = numeric.quantile(0.75)
    iqr = q3 - q1

    lower = q1 - (1.5 * iqr)
    upper = q3 + (1.5 * iqr)

    outlier_indices = set()

    values = numeric.to_list()
    outlier_count = sum(1 for value in values if value < lower or value > upper)

    hist = numeric.hist(bin_count=10)

    histogram = []
    if hist.height > 0:
        cols = hist.columns
        for row in hist.to_dicts():
            histogram.append(
                {
                    "range": str(row.get(cols[0])),
                    "count": int(row.get(cols[-1]) or 0),
                }
            )

    return {
        "min": clean_value(float(numeric.min())),
        "max": clean_value(float(numeric.max())),
        "mean": clean_value(float(numeric.mean())),
        "median": clean_value(float(numeric.median())),
        "stdDev": clean_value(float(numeric.std() or 0)),
        "q1": clean_value(float(q1)),
        "q3": clean_value(float(q3)),
        "iqr": clean_value(float(iqr)),
        "range": clean_value(float(numeric.max() - numeric.min())),
        "zeroCount": int((numeric == 0).sum() or 0),
        "negativeCount": int((numeric < 0).sum() or 0),
        "outlierCount": int(outlier_count),
        "lowerOutlierBound": clean_value(float(lower)),
        "upperOutlierBound": clean_value(float(upper)),
        "histogram": histogram,
    }, outlier_indices


def build_datetime_stats(series: pl.Series):
    text = series.cast(pl.Utf8, strict=False).str.strip_chars()
    non_blank = text.filter(text.is_not_null() & (text != ""))

    if non_blank.is_empty():
        return None

    parsed = try_parse_datetime(non_blank)

    valid = parsed.drop_nulls()

    if valid.is_empty():
        return {
            "minDate": None,
            "maxDate": None,
            "invalidDateCount": int(non_blank.len()),
        }

    return {
        "minDate": str(valid.min()),
        "maxDate": str(valid.max()),
        "invalidDateCount": int(parsed.is_null().sum() or 0),
    }


def get_recommendation(score_percentage, review_null_above, discard_null_at_least):
    if score_percentage >= discard_null_at_least:
        return "discard"

    if score_percentage > review_null_above:
        return "review"

    return "keep"


# Examples make issues actionable without returning full datasets.
def build_column_issue_examples(
    df: pl.DataFrame,
    column_name: str,
    profile_type: str,
    custom_blank_values: List[str],
    statistics: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    indexed_df = df.with_row_index("_rowNumber", offset=1)
    examples = []
    seen = set()

    def add_rows(issue_type: str, rows: List[Dict[str, Any]]):
        for row in rows:
            key = (int(row.get("_rowNumber", 0)), issue_type)

            if key in seen:
                continue

            seen.add(key)
            examples.append(
                {
                    "rowNumber": int(row.get("_rowNumber", 0)),
                    "issueType": issue_type,
                    "value": clean_value(row.get(column_name)),
                    "rowPreview": build_row_preview(row, column_name),
                }
            )

            if len(examples) >= ISSUE_EXAMPLES_LIMIT:
                return

    blank_rows = (
        indexed_df
        .filter(blank_mask_expr(column_name))
        .head(ISSUE_EXAMPLES_LIMIT)
        .to_dicts()
    )
    add_rows("Blank value", blank_rows)

    if len(examples) < ISSUE_EXAMPLES_LIMIT and custom_blank_values:
        custom_blank_rows = (
            indexed_df
            .filter(custom_blank_mask_expr(column_name, custom_blank_values))
            .head(ISSUE_EXAMPLES_LIMIT)
            .to_dicts()
        )
        add_rows("Custom blank value", custom_blank_rows)

    if len(examples) < ISSUE_EXAMPLES_LIMIT and profile_type in ["email", "phone"]:
        rows = (
            indexed_df
            .select(["_rowNumber", *df.columns])
            .to_dicts()
        )
        invalid_rows = []

        for row in rows:
            value = row.get(column_name)
            text_value = "" if value is None else str(value).strip()

            if text_value == "":
                continue

            if profile_type == "email" and not validate_email_text(text_value):
                invalid_rows.append(row)

            if profile_type == "phone" and not validate_phone_text(text_value):
                invalid_rows.append(row)

            if len(invalid_rows) >= ISSUE_EXAMPLES_LIMIT:
                break

        label = "Invalid email format" if profile_type == "email" else "Invalid phone format"
        add_rows(label, invalid_rows)

    if len(examples) < ISSUE_EXAMPLES_LIMIT and profile_type == "datetime":
        text_expr = pl.col(column_name).cast(pl.Utf8, strict=False).str.strip_chars()
        parsed_expr = (
            text_expr.str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S", strict=False)
            .fill_null(text_expr.str.strptime(pl.Datetime, "%Y-%m-%d", strict=False))
            .fill_null(text_expr.str.strptime(pl.Datetime, "%d/%m/%Y", strict=False))
            .fill_null(text_expr.str.strptime(pl.Datetime, "%m/%d/%Y", strict=False))
        )
        invalid_date_rows = (
            indexed_df
            .filter(text_expr.is_not_null() & (text_expr != "") & parsed_expr.is_null())
            .head(ISSUE_EXAMPLES_LIMIT)
            .to_dicts()
        )
        add_rows("Invalid date value", invalid_date_rows)

    if len(examples) < ISSUE_EXAMPLES_LIMIT and profile_type == "numeric" and statistics:
        lower = statistics.get("lowerOutlierBound")
        upper = statistics.get("upperOutlierBound")

        if lower is not None and upper is not None:
            numeric_expr = pl.col(column_name).cast(pl.Float64, strict=False)
            outlier_rows = (
                indexed_df
                .filter(numeric_expr.is_not_null() & ((numeric_expr < lower) | (numeric_expr > upper)))
                .head(ISSUE_EXAMPLES_LIMIT)
                .to_dicts()
            )
            add_rows("Possible outlier", outlier_rows)

    return examples


def build_column_valid_example(
    df: pl.DataFrame,
    column_name: str,
    profile_type: str,
    custom_blank_values: List[str],
    statistics: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    rows = df.with_row_index("_rowNumber", offset=1).to_dicts()
    lower = statistics.get("lowerOutlierBound") if statistics else None
    upper = statistics.get("upperOutlierBound") if statistics else None

    for row in rows:
        value = row.get(column_name)
        text_value = "" if value is None else str(value).strip()

        if text_value == "" or text_value.lower() in custom_blank_values:
            continue

        if profile_type == "email" and not validate_email_text(text_value):
            continue

        if profile_type == "phone" and not validate_phone_text(text_value):
            continue

        if profile_type == "datetime":
            parsed = try_parse_datetime(pl.Series([text_value]))

            if parsed.drop_nulls().is_empty():
                continue

        if profile_type == "numeric":
            numeric_value = pl.Series([value]).cast(pl.Float64, strict=False).item()

            if numeric_value is None:
                continue

            if lower is not None and upper is not None and (numeric_value < lower or numeric_value > upper):
                continue

        return {
            "rowNumber": int(row.get("_rowNumber", 0)),
            "value": clean_value(value),
        }

    return None


def profile_column(
    df: pl.DataFrame,
    column_name: str,
    row_count: int,
    custom_blank_values: List[str],
    review_null_above: float,
    discard_null_at_least: float,
    include_custom_blanks: bool,
    is_mandatory: bool,
    include_examples: bool = True,
):
    series = df[column_name]

    profile_type = detect_profile_type(column_name, series)

    counts = df.select(
        [
            blank_mask_expr(column_name).sum().alias("true_blank_count"),
            custom_blank_mask_expr(column_name, custom_blank_values).sum().alias("custom_blank_count"),
        ]
    ).to_dicts()[0]

    true_blank_count = int(counts["true_blank_count"] or 0)
    custom_blank_count = int(counts["custom_blank_count"] or 0)

    true_blank_percentage = round((true_blank_count / row_count) * 100, 2) if row_count else 0
    custom_blank_percentage = round((custom_blank_count / row_count) * 100, 2) if row_count else 0

    recommendation_score_percentage = true_blank_percentage

    if include_custom_blanks:
        recommendation_score_percentage = min(100, true_blank_percentage + custom_blank_percentage)

    usable = (
        df
        .filter(~blank_mask_expr(column_name) & ~custom_blank_mask_expr(column_name, custom_blank_values))
        .select(pl.col(column_name).cast(pl.Utf8, strict=False).str.strip_chars())
        .to_series()
    )

    unique_count = int(usable.n_unique()) if not usable.is_empty() else 0
    duplicate_count = int(row_count - unique_count)

    issues = []

    if true_blank_percentage > 25:
        issues.append("High missing values")

    if custom_blank_count > 0:
        issues.append("Contains custom blank values")

    if is_mandatory and true_blank_count + custom_blank_count > 0:
        issues.append("Mandatory field has blank values")

    if unique_count == 1 and row_count > 1:
        issues.append("Only one unique value")

    invalid_count = 0
    invalid_percentage = 0

    if profile_type in ["email", "phone"]:
        text_values = series.cast(pl.Utf8, strict=False).str.strip_chars()
        values = text_values.filter(
            text_values.is_not_null() & (text_values != "")
        ).to_list()

        if profile_type == "email":
            invalid_count = sum(1 for value in values if not validate_email_text(value))
            if invalid_count:
                issues.append("Invalid email format")

        if profile_type == "phone":
            invalid_count = sum(1 for value in values if not validate_phone_text(value))
            if invalid_count:
                issues.append("Invalid phone format")

        invalid_percentage = round((invalid_count / len(values)) * 100, 2) if values else 0

    statistics = None
    outlier_indices = set()

    if profile_type == "numeric":
        statistics, outlier_indices = build_numeric_stats(series)

        if statistics:
            if statistics["outlierCount"] > 0:
                issues.append("Contains possible outliers")

            if statistics["negativeCount"] > 0:
                issues.append("Contains negative values")

    elif profile_type == "datetime":
        statistics = build_datetime_stats(series)

        if statistics and statistics["invalidDateCount"] > 0:
            issues.append("Invalid date values")

    else:
        statistics = build_text_stats(series)

    recommendation = get_recommendation(
        recommendation_score_percentage,
        review_null_above,
        discard_null_at_least,
    )
    issue_examples = []
    valid_example = None

    if include_examples:
        issue_examples = build_column_issue_examples(
            df=df,
            column_name=column_name,
            profile_type=profile_type,
            custom_blank_values=custom_blank_values,
            statistics=statistics,
        )
        valid_example = build_column_valid_example(
            df=df,
            column_name=column_name,
            profile_type=profile_type,
            custom_blank_values=custom_blank_values,
            statistics=statistics,
        )

    return {
        "name": column_name,
        "isMandatory": is_mandatory,
        "profileType": profile_type,
        "quality": {
            "nullCount": true_blank_count,
            "nullPercentage": true_blank_percentage,
            "customBlankCount": custom_blank_count,
            "customBlankPercentage": custom_blank_percentage,
            "recommendationScorePercentage": round(recommendation_score_percentage, 2),
            "uniqueCount": unique_count,
            "duplicateCount": duplicate_count,
            "invalidCount": invalid_count,
            "invalidPercentage": invalid_percentage,
        },
        "statistics": statistics,
        "topValues": build_top_values(series),
        "issues": issues,
        "issueExamples": issue_examples,
        "validExample": valid_example,
        "recommendation": recommendation,
    }


# Dataset-level profiling pipeline.
def limit_row_record_columns(record: Dict[str, Any], output_columns: List[str]) -> Dict[str, Any]:
    limited = {}

    if "_rowNumber" in record:
        limited["_rowNumber"] = record["_rowNumber"]

    for column in output_columns:
        if column in record:
            limited[column] = record[column]

    return limited


def build_issue_rows(
    df: pl.DataFrame,
    columns_profile: List[Dict[str, Any]],
    custom_blank_values: List[str],
    output_columns: Optional[List[str]] = None,
):
    # Return a small preview of rows with blank/custom blank issues for quick inspection.
    issue_expr = pl.lit(False)

    for col in columns_profile:
        name = col["name"]

        issue_expr = issue_expr | blank_mask_expr(name) | custom_blank_mask_expr(name, custom_blank_values)

    issue_df = df.with_row_index("_rowNumber", offset=1).filter(issue_expr).head(ISSUE_ROWS_LIMIT)

    records = []

    for row in issue_df.to_dicts():
        reasons = []

        for col in columns_profile:
            name = col["name"]
            label = f"{name} *" if col.get("isMandatory") else name
            value = row.get(name)

            if value is None or str(value).strip() == "":
                reasons.append(f"{label}: blank")
            elif str(value).strip().lower() in custom_blank_values:
                reasons.append(f"{label}: custom blank")

        output_row = limit_row_record_columns(row, output_columns or list(row.keys()))
        output_row["_issueReasons"] = reasons
        records.append(clean_record(output_row))

    return records


def profile_dataframe(
    df: pl.DataFrame,
    file_name: str,
    custom_blank_values: List[str],
    mandatory_fields: List[str],
    review_null_above: float,
    discard_null_at_least: float,
    include_custom_blanks: bool,
):
    # This is the central profiling pipeline used by CSVs, Excel sheets, and re-profile actions.
    df = df.rename({name: str(name) for name in df.columns})
    mandatory_field_set = set(mandatory_fields)

    row_count = df.height
    column_count = df.width
    wide_profile_mode = column_count > WIDE_PROFILE_COLUMN_LIMIT
    preview_columns = df.columns[:PREVIEW_COLUMN_LIMIT] if wide_profile_mode else df.columns

    columns = [
        profile_column(
            df=df,
            column_name=column_name,
            row_count=row_count,
            custom_blank_values=custom_blank_values,
            review_null_above=review_null_above,
            discard_null_at_least=discard_null_at_least,
            include_custom_blanks=include_custom_blanks,
            is_mandatory=column_name in mandatory_field_set,
            include_examples=not wide_profile_mode,
        )
        for column_name in df.columns
    ]

    duplicate_count = int(df.is_duplicated().sum() or 0)

    duplicate_rows = [
        clean_record(row)
        for row in (
            df
            .with_row_index("_rowNumber", offset=1)
            .filter(df.is_duplicated())
            .head(ISSUE_ROWS_LIMIT)
            .to_dicts()
        )
    ]
    duplicate_rows = [limit_row_record_columns(row, preview_columns) for row in duplicate_rows]

    for row in duplicate_rows:
        row["_issueReasons"] = ["Duplicate row"]

    issue_rows = build_issue_rows(df, columns, custom_blank_values, preview_columns)

    recommendation_counts = {
        "keep": sum(1 for col in columns if col["recommendation"] == "keep"),
        "review": sum(1 for col in columns if col["recommendation"] == "review"),
        "discard": sum(1 for col in columns if col["recommendation"] == "discard"),
    }

    total_true_blank_cells = sum(col["quality"]["nullCount"] for col in columns)
    total_custom_blank_cells = sum(col["quality"]["customBlankCount"] for col in columns)

    preview = [
        clean_record(row)
        for row in df.select(preview_columns).head(PREVIEW_ROWS).to_dicts()
    ]

    return {
        "dataset": {
            "fileName": file_name,
            "rowCount": row_count,
            "columnCount": column_count,
            "duplicateRows": duplicate_count,
        },
        "settings": {
            "reviewNullAbove": review_null_above,
            "discardNullAtLeast": discard_null_at_least,
            "includeCustomBlanks": include_custom_blanks,
            "customBlankValues": custom_blank_values,
            "mandatoryFields": mandatory_fields,
        },
        "summary": {
            "recommendationCounts": recommendation_counts,
            "columnsWithIssues": sum(1 for col in columns if len(col["issues"]) > 0),
            "mandatoryColumns": sum(1 for col in columns if col["isMandatory"]),
            "wideProfileMode": wide_profile_mode,
            "wideProfileColumnLimit": WIDE_PROFILE_COLUMN_LIMIT,
            "totalTrueBlankCells": int(total_true_blank_cells),
            "totalCustomBlankCells": int(total_custom_blank_cells),
            "totalBlankCells": int(total_true_blank_cells + total_custom_blank_cells),
            "issueRowsReturned": len(issue_rows),
            "duplicateRowsReturned": len(duplicate_rows),
        },
        "columns": columns,
        "preview": preview,
        "issueRows": issue_rows,
        "duplicateRowsPreview": duplicate_rows,
    }
