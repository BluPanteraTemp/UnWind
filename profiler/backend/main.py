import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List, Dict, Any
import polars as pl
import pandas as pd 
import io
import math
import re
import warnings
from uuid import uuid4

FILE_STORE = {}

warnings.filterwarnings("ignore", message="Could not determine dtype")

app = FastAPI(title="Data Profiler API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://data-profiler-mvp.vercel.app/",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TYPE_DETECTION_SAMPLE_SIZE = 1000
TOP_VALUES_LIMIT = 10
PREVIEW_ROWS = 50
ISSUE_ROWS_LIMIT = 100


@app.get("/")
def health_check():
    return {"message": "Data profiler backend is running"}


def parse_custom_blank_values(raw: Optional[str]) -> List[str]:
    if not raw:
        return []

    return [x.strip().lower() for x in raw.split(",") if x.strip()]


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


def read_excel_sheets_fast(contents: bytes) -> Dict[str, pl.DataFrame]:
    workbook = pl.read_excel(
        io.BytesIO(contents),
        sheet_id=0,
        engine="calamine",
    )

    if isinstance(workbook, dict):
        return workbook

    return {"Sheet1": workbook}


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

    unique_count = len(set(values))
    unique_ratio = unique_count / len(values)
    avg_length = sum(len(str(v)) for v in values) / len(values)

    if unique_ratio <= 0.3 and avg_length <= 50:
        return "categorical"

    return "text"

def try_parse_datetime(series: pl.Series) -> pl.Series:
    text = series.cast(pl.Utf8, strict=False)

    return (
        text.str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S", strict=False)
        .fill_null(text.str.strptime(pl.Datetime, "%Y-%m-%d", strict=False))
        .fill_null(text.str.strptime(pl.Datetime, "%d/%m/%Y", strict=False))
        .fill_null(text.str.strptime(pl.Datetime, "%m/%d/%Y", strict=False))
    )

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


def profile_column(
    df: pl.DataFrame,
    column_name: str,
    row_count: int,
    custom_blank_values: List[str],
    review_null_above: float,
    discard_null_at_least: float,
    include_custom_blanks: bool,
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

    if unique_count == 1 and row_count > 1:
        issues.append("Only one unique value")

    invalid_count = 0
    invalid_percentage = 0

    if profile_type in ["email", "phone"]:
        values = (
            series
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
            .drop_nulls()
            .filter(series.cast(pl.Utf8, strict=False).str.strip_chars() != "")
            .to_list()
        )

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

    return {
        "name": column_name,
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
        "recommendation": recommendation,
    }


def build_issue_rows(df: pl.DataFrame, columns_profile: List[Dict[str, Any]], custom_blank_values: List[str]):
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
            value = row.get(name)

            if value is None or str(value).strip() == "":
                reasons.append(f"{name}: blank")
            elif str(value).strip().lower() in custom_blank_values:
                reasons.append(f"{name}: custom blank")

        row["_issueReasons"] = reasons
        records.append(clean_record(row))

    return records


def profile_dataframe(
    df: pl.DataFrame,
    file_name: str,
    custom_blank_values: List[str],
    review_null_above: float,
    discard_null_at_least: float,
    include_custom_blanks: bool,
):
    df = df.rename({name: str(name) for name in df.columns})

    row_count = df.height
    column_count = df.width

    columns = [
        profile_column(
            df=df,
            column_name=column_name,
            row_count=row_count,
            custom_blank_values=custom_blank_values,
            review_null_above=review_null_above,
            discard_null_at_least=discard_null_at_least,
            include_custom_blanks=include_custom_blanks,
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

    for row in duplicate_rows:
        row["_issueReasons"] = ["Duplicate row"]

    issue_rows = build_issue_rows(df, columns, custom_blank_values)

    recommendation_counts = {
        "keep": sum(1 for col in columns if col["recommendation"] == "keep"),
        "review": sum(1 for col in columns if col["recommendation"] == "review"),
        "discard": sum(1 for col in columns if col["recommendation"] == "discard"),
    }

    total_true_blank_cells = sum(col["quality"]["nullCount"] for col in columns)
    total_custom_blank_cells = sum(col["quality"]["customBlankCount"] for col in columns)

    preview = [
        clean_record(row)
        for row in df.head(PREVIEW_ROWS).to_dicts()
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
        },
        "summary": {
            "recommendationCounts": recommendation_counts,
            "columnsWithIssues": sum(1 for col in columns if len(col["issues"]) > 0),
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

def apply_row_filters(df: pl.DataFrame, raw_filters: Optional[str]) -> pl.DataFrame:
    if not raw_filters:
        return df

    filters = json.loads(raw_filters)

    if not filters:
        return df

    expr = pl.lit(True)

    for f in filters:
        column = f.get("column")
        values = f.get("values", [])

        if not column or column not in df.columns or not values:
            continue

        normalized_values = [str(v).strip() for v in values]

        expr = expr & (
            pl.col(column)
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
            .is_in(normalized_values)
        )

    return df.filter(expr)

@app.post("/profile-sheet")
@app.post("/profile-sheet")
async def profile_specific_sheet(
    file_id: str = Form(...),
    sheet_name: str = Form(...),
    review_null_above: float = Form(25),
    discard_null_at_least: float = Form(95),
    include_custom_blanks: bool = Form(False),
    custom_blank_values: Optional[str] = Form(""),
    row_filters: Optional[str] = Form("[]"),
):
    if file_id not in FILE_STORE:
        raise HTTPException(400, "File expired")

    contents = FILE_STORE[file_id]
    parsed_custom_blanks = parse_custom_blank_values(custom_blank_values)

    try:
        df = pl.read_excel(
            io.BytesIO(contents),
            sheet_name=sheet_name,
            engine="calamine",
        )

        filtered_df = apply_row_filters(df, row_filters)

        result = profile_dataframe(
            df=filtered_df,
            file_name=sheet_name,
            custom_blank_values=parsed_custom_blanks,
            review_null_above=review_null_above,
            discard_null_at_least=discard_null_at_least,
            include_custom_blanks=include_custom_blanks,
        )

        return {
            "sheetName": sheet_name,
            **result,
        }

    except Exception as e:
        raise HTTPException(500, str(e))
    
@app.post("/profile")
async def profile_file(
    file: UploadFile = File(...),
    review_null_above: float = Form(25),
    discard_null_at_least: float = Form(95),
    include_custom_blanks: bool = Form(False),
    custom_blank_values: Optional[str] = Form(""),
    row_filters: Optional[str] = Form("[]"),
):
    filename = file.filename or "uploaded-file"
    filename_lower = filename.lower()
    contents = await file.read()

    parsed_custom_blanks = parse_custom_blank_values(custom_blank_values)

    try:
        if filename_lower.endswith(".csv"):
            df = pl.read_csv(io.BytesIO(contents), infer_schema_length=1000)
            filtered_df = apply_row_filters(df, row_filters)

            return profile_dataframe(
                df=filtered_df,
                file_name=filename,
                custom_blank_values=parsed_custom_blanks,
                review_null_above=review_null_above,
                discard_null_at_least=discard_null_at_least,
                include_custom_blanks=include_custom_blanks,
            )

        if filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls"):
            file_id = str(uuid4())

            # store file in memory
            FILE_STORE[file_id] = contents

            excel_file = pd.ExcelFile(io.BytesIO(contents))
            sheet_names = excel_file.sheet_names
            first_sheet_name = sheet_names[0]

            df = pl.read_excel(io.BytesIO(contents),sheet_name=first_sheet_name,engine="calamine",)
            filtered_df = apply_row_filters(df, row_filters)

            first_profile = profile_dataframe(
                df=filtered_df,
                file_name=f"{filename} - {first_sheet_name}",
                custom_blank_values=parsed_custom_blanks,
                review_null_above=review_null_above,
                discard_null_at_least=discard_null_at_least,
                include_custom_blanks=include_custom_blanks,
            )

            return {
                 "fileType": "excel",
                "fileId": file_id,  # 🔥 IMPORTANT
                "sheetNames": sheet_names,
                "activeSheet": first_sheet_name,
                "sheets": {
                    first_sheet_name: first_profile
                },
             **first_profile,
            }
        
        raise HTTPException(
            status_code=400,
            detail="Only CSV and Excel files are supported.",
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@app.post("/column-values")
async def get_column_values(
    file_id: str = Form(...),
    sheet_name: str = Form(...),
    column_name: str = Form(...),
    search: Optional[str] = Form(""),
    limit: int = Form(100),
):
    if file_id not in FILE_STORE:
        raise HTTPException(400, "File expired")

    contents = FILE_STORE[file_id]

    try:
        df = pl.read_excel(
            io.BytesIO(contents),
            sheet_name=sheet_name,
            engine="calamine",
        )

        if column_name not in df.columns:
            raise HTTPException(400, "Invalid column name")

        s = (
            df[column_name]
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
        )

        values_df = (
            pl.DataFrame({"value": s})
            .filter(pl.col("value").is_not_null() & (pl.col("value") != ""))
        )

        if search:
            values_df = values_df.filter(
                pl.col("value").str.to_lowercase().str.contains(search.lower())
            )

        counts = (
            values_df
            .group_by("value")
            .len()
            .sort("len", descending=True)
            .head(limit)
        )

        return {
            "columnName": column_name,
            "values": [
                {"value": row["value"], "count": row["len"]}
                for row in counts.to_dicts()
            ],
        }

    except Exception as e:
        raise HTTPException(500, str(e))


def get_matrix_recommendation(blank_percentage, review_null_above, discard_null_at_least):
    if blank_percentage >= discard_null_at_least:
        return "discard"

    if blank_percentage > review_null_above:
        return "review"

    return "keep"


def build_matrix(
    df: pl.DataFrame,
    group_by: str,
    custom_blank_values: List[str],
    review_null_above: float,
    discard_null_at_least: float,
    include_custom_blanks: bool,
    max_groups: int = 30,
):
    if group_by not in df.columns:
        raise HTTPException(400, "Invalid group by column")

    group_values_df = (
        df
        .select(
            pl.col(group_by)
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
            .alias(group_by)
        )
        .filter(pl.col(group_by).is_not_null() & (pl.col(group_by) != ""))
        .group_by(group_by)
        .len()
        .sort("len", descending=True)
        .head(max_groups)
    )

    group_values = [row[group_by] for row in group_values_df.to_dicts()]

    fields = [col for col in df.columns if col != group_by]

    rows = []

    for field in fields:
        cells = []

        for group_value in group_values:
            group_df = df.filter(
                pl.col(group_by)
                .cast(pl.Utf8, strict=False)
                .str.strip_chars()
                == group_value
            )

            total = group_df.height

            if total == 0:
                blank_count = 0
                custom_blank_count = 0
                blank_percentage = 0
            else:
                counts = group_df.select(
                    [
                        blank_mask_expr(field).sum().alias("blank_count"),
                        custom_blank_mask_expr(field, custom_blank_values)
                        .sum()
                        .alias("custom_blank_count"),
                    ]
                ).to_dicts()[0]

                blank_count = int(counts["blank_count"] or 0)
                custom_blank_count = int(counts["custom_blank_count"] or 0)

                score_count = blank_count

                if include_custom_blanks:
                    score_count += custom_blank_count

                blank_percentage = round((score_count / total) * 100, 2)

            recommendation = get_matrix_recommendation(
                blank_percentage,
                review_null_above,
                discard_null_at_least,
            )

            cells.append(
                {
                    "groupValue": group_value,
                    "totalRows": total,
                    "blankCount": blank_count,
                    "customBlankCount": custom_blank_count,
                    "blankPercentage": blank_percentage,
                    "recommendation": recommendation,
                }
            )

        rows.append(
            {
                "field": field,
                "cells": cells,
            }
        )

    return {
        "groupBy": group_by,
        "groups": [
            {
                "value": row[group_by],
                "rowCount": row["len"],
            }
            for row in group_values_df.to_dicts()
        ],
        "rows": rows,
    }

def build_matrix(
    df: pl.DataFrame,
    group_by: str,
    custom_blank_values: List[str],
    review_null_above: float,
    discard_null_at_least: float,
    include_custom_blanks: bool,
    max_groups: int = 30,
):
    if group_by not in df.columns:
        raise HTTPException(400, "Invalid group by column")

    group_values_df = (
        df
        .select(
            pl.col(group_by)
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
            .alias(group_by)
        )
        .filter(pl.col(group_by).is_not_null() & (pl.col(group_by) != ""))
        .group_by(group_by)
        .len()
        .sort("len", descending=True)
        .head(max_groups)
    )

    group_values = [row[group_by] for row in group_values_df.to_dicts()]

    fields = [col for col in df.columns if col != group_by]

    rows = []

    for field in fields:
        cells = []

        for group_value in group_values:
            group_df = df.filter(
                pl.col(group_by)
                .cast(pl.Utf8, strict=False)
                .str.strip_chars()
                == group_value
            )

            total = group_df.height

            if total == 0:
                blank_count = 0
                custom_blank_count = 0
                blank_percentage = 0
            else:
                counts = group_df.select(
                    [
                        blank_mask_expr(field).sum().alias("blank_count"),
                        custom_blank_mask_expr(field, custom_blank_values)
                        .sum()
                        .alias("custom_blank_count"),
                    ]
                ).to_dicts()[0]

                blank_count = int(counts["blank_count"] or 0)
                custom_blank_count = int(counts["custom_blank_count"] or 0)

                score_count = blank_count

                if include_custom_blanks:
                    score_count += custom_blank_count

                blank_percentage = round((score_count / total) * 100, 2)

            recommendation = get_matrix_recommendation(
                blank_percentage,
                review_null_above,
                discard_null_at_least,
            )

            cells.append(
                {
                    "groupValue": group_value,
                    "totalRows": total,
                    "blankCount": blank_count,
                    "customBlankCount": custom_blank_count,
                    "blankPercentage": blank_percentage,
                    "recommendation": recommendation,
                }
            )

        rows.append(
            {
                "field": field,
                "cells": cells,
            }
        )

    return {
        "groupBy": group_by,
        "groups": [
            {
                "value": row[group_by],
                "rowCount": row["len"],
            }
            for row in group_values_df.to_dicts()
        ],
        "rows": rows,
    }

@app.post("/matrix")
async def get_matrix(
    file_id: str = Form(...),
    sheet_name: str = Form(...),
    group_by: str = Form(...),
    review_null_above: float = Form(25),
    discard_null_at_least: float = Form(95),
    include_custom_blanks: bool = Form(False),
    custom_blank_values: Optional[str] = Form(""),
    row_filters: Optional[str] = Form("[]"),
):
    if file_id not in FILE_STORE:
        raise HTTPException(400, "File expired")

    contents = FILE_STORE[file_id]
    parsed_custom_blanks = parse_custom_blank_values(custom_blank_values)

    try:
        df = pl.read_excel(
            io.BytesIO(contents),
            sheet_name=sheet_name,
            engine="calamine",
        )

        filtered_df = apply_row_filters(df, row_filters)

        matrix = build_matrix(
            df=filtered_df,
            group_by=group_by,
            custom_blank_values=parsed_custom_blanks,
            review_null_above=review_null_above,
            discard_null_at_least=discard_null_at_least,
            include_custom_blanks=include_custom_blanks,
        )

        return matrix

    except Exception as e:
        raise HTTPException(500, str(e))