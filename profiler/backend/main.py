from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware 
import polars as pl
import pandas as pd
import io
import math
import re

app = FastAPI(title="Data Profiler API")

app.add_middleware(
    CORSMiddleware,
     allow_origins=[
         "http://localhost:5173",
         "http://127.0.0.1:5173",
         "https://mvp-nine-woad.vercel.app/",
     ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TYPE_DETECTION_SAMPLE_SIZE = 1000
TOP_VALUES_LIMIT = 10
PREVIEW_ROWS = 50

@app.get("/")
def health_check():
    return {"message": "Data profiler backend is running"}


def clean_value(value):
    if pd.isna(value):
        return None

    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, 2)

    return value


def is_blank(value):
    if pd.isna(value):
        return True

    return str(value).strip() == ""


def detect_profile_type(column_name: str, series: pd.Series):
    name = column_name.lower()
    date_like_name = (
    "date" in name
    or name.endswith("_at")
    or "time" in name
    or "created" in name
    or "updated" in name
    )

    if "email" in name or "mail" in name:
        return "email"

    if "phone" in name or "mobile" in name or "contact" in name:
        return "phone"

    if "date" in name or name.endswith("_at") or "time" in name:
        return "datetime"

    if pd.api.types.is_bool_dtype(series):
        return "boolean"

    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    
    if date_like_name:
        sample = series.dropna().head(TYPE_DETECTION_SAMPLE_SIZE).astype(str).str.strip()
        sample = sample[sample != ""].head(100)

        if not sample.empty:
            parsed_dates = pd.to_datetime(
                sample,
                errors="coerce",
                dayfirst=True,
                format="mixed"
            )

            if parsed_dates.notna().mean() > 0.7:
                return "datetime"
    non_blank = series.dropna().head(TYPE_DETECTION_SAMPLE_SIZE).astype(str).str.strip()
    non_blank = non_blank[non_blank != ""]

    if non_blank.empty:
        return "empty"

    unique_ratio = non_blank.nunique() / len(non_blank)
    avg_length = non_blank.str.len().mean()

    if unique_ratio <= 0.3 and avg_length <= 50:
        return "categorical"

    return "text"



def get_recommendation(null_percentage, unique_count, row_count, issues):
    if row_count == 0:
        return "review"

    if null_percentage >= 98:
        return "discard"

    if null_percentage > 25 and null_percentage < 95:
        return "review"

    if "Only one unique value" in issues:
        return "review"

    return "keep"


def validate_email(value):
    if is_blank(value):
        return True

    value = str(value).strip()
    pattern = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"

    return re.match(pattern, value) is not None


def validate_phone(value):
    if is_blank(value):
        return True

    value = str(value).strip()
    cleaned = re.sub(r"[\s\-\(\)]", "", value)

    return (
        cleaned.startswith("+")
        and cleaned[1:].isdigit()
        and 8 <= len(cleaned[1:]) <= 15
    ) or (
        cleaned.isdigit()
        and 8 <= len(cleaned) <= 15
    )


def count_invalid_values(series, validator):
    values = series.dropna().astype(str).str.strip()
    values = values[values != ""]

    if values.empty:
        return 0, 0

    invalid_count = int(values.apply(lambda value: not validator(value)).sum())
    invalid_percentage = round((invalid_count / len(values)) * 100, 2)

    return invalid_count, invalid_percentage


def build_numeric_stats(series: pd.Series):
    numeric_series = pd.to_numeric(series, errors="coerce").dropna()

    if numeric_series.empty:
        return None

    q1 = numeric_series.quantile(0.25)
    q3 = numeric_series.quantile(0.75)
    iqr = q3 - q1

    lower_bound = q1 - (1.5 * iqr)
    upper_bound = q3 + (1.5 * iqr)

    outliers = numeric_series[
        (numeric_series < lower_bound) | (numeric_series > upper_bound)
    ]

    hist_counts = pd.cut(numeric_series, bins=10).value_counts().sort_index()

    histogram = [
        {
            "range": f"{round(interval.left, 2)} - {round(interval.right, 2)}",
            "count": int(count),
        }
        for interval, count in hist_counts.items()
    ]

    return {
        "min": clean_value(float(numeric_series.min())),
        "max": clean_value(float(numeric_series.max())),
        "mean": clean_value(float(numeric_series.mean())),
        "median": clean_value(float(numeric_series.median())),
        "stdDev": clean_value(float(numeric_series.std())) if len(numeric_series) > 1 else 0,
        "variance": clean_value(float(numeric_series.var())) if len(numeric_series) > 1 else 0,
        "q1": clean_value(float(q1)),
        "q3": clean_value(float(q3)),
        "iqr": clean_value(float(iqr)),
        "range": clean_value(float(numeric_series.max() - numeric_series.min())),
        "zeroCount": int((numeric_series == 0).sum()),
        "negativeCount": int((numeric_series < 0).sum()),
        "outlierCount": int(len(outliers)),
        "histogram": histogram,
    }

def build_text_stats(series: pd.Series):
    values = series.dropna().astype(str)
    trimmed = values.str.strip()
    non_empty = trimmed[trimmed != ""]

    if non_empty.empty:
        return {
            "minLength": 0,
            "maxLength": 0,
            "meanLength": 0,
            "medianLength": 0,
            "emptyStringCount": int((trimmed == "").sum()),
        }

    lengths = non_empty.str.len()

    return {
        "minLength": int(lengths.min()),
        "maxLength": int(lengths.max()),
        "meanLength": clean_value(float(lengths.mean())),
        "medianLength": clean_value(float(lengths.median())),
        "emptyStringCount": int((trimmed == "").sum()),
        "avgWordCount": clean_value(float(non_empty.str.split().str.len().mean())),
    }


def build_datetime_stats(series: pd.Series):
    parsed = pd.to_datetime(series, errors="coerce", dayfirst=True).dropna()

    if parsed.empty:
        return None

    return {
        "minDate": str(parsed.min()),
        "maxDate": str(parsed.max()),
        "invalidDateCount": int(
            pd.to_datetime(series.dropna(), errors="coerce", dayfirst=True).isna().sum()
        ),
    }


def build_top_values(series: pd.Series):
    top_values = series.dropna().astype(str).str.strip()
    top_values = top_values[top_values != ""].value_counts().head(10)

    return [
        {
            "value": str(value),
            "count": int(count),
        }
        for value, count in top_values.items()
    ]


def profile_column(column_name: str, series: pd.Series, row_count: int):
    profile_type = detect_profile_type(column_name, series)

    null_count = int(series.apply(is_blank).sum())
    null_percentage = round((null_count / row_count) * 100, 2) if row_count else 0

    unique_count = int(series.dropna().astype(str).str.strip().nunique())
    duplicate_count = int(row_count - unique_count)

    invalid_count = 0
    invalid_percentage = 0

    issues = []

    if null_percentage > 25:
        issues.append("High missing values")


    if profile_type == "email":
        invalid_count, invalid_percentage = count_invalid_values(series, validate_email)
        if invalid_count > 0:
            issues.append("Invalid email format")

    if profile_type == "phone":
        invalid_count, invalid_percentage = count_invalid_values(series, validate_phone)
        if invalid_count > 0:
            issues.append("Invalid phone format")

    statistics = None

    if profile_type == "numeric":
        statistics = build_numeric_stats(series)

        if statistics:
            if statistics["outlierCount"] > 0:
                issues.append("Contains possible outliers")

            if statistics["negativeCount"] > 0:
                issues.append("Contains negative values")

    elif profile_type in ["text", "categorical", "email", "phone"]:
        statistics = build_text_stats(series)

    elif profile_type == "datetime":
        statistics = build_datetime_stats(series)

        if statistics and statistics["invalidDateCount"] > 0:
            issues.append("Invalid date values")

    recommendation = get_recommendation(
        null_percentage=null_percentage,
        unique_count=unique_count,
        row_count=row_count,
        issues=issues,
    )

    return {
        "name": column_name,
        "profileType": profile_type,
        "quality": {
            "nullCount": null_count,
            "nullPercentage": null_percentage,
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


def profile_dataframe(df: pd.DataFrame, file_name: str):
    row_count = len(df)
    column_count = len(df.columns)

    duplicate_rows = int(df.duplicated().sum())

    columns = [
        profile_column(column_name, df[column_name], row_count)
        for column_name in df.columns
    ]

    recommendation_counts = {
        "keep": sum(1 for col in columns if col["recommendation"] == "keep"),
        "review": sum(1 for col in columns if col["recommendation"] == "review"),
        "discard": sum(1 for col in columns if col["recommendation"] == "discard"),
    }

    preview = df.head(20).fillna("").to_dict(orient="records")

    return {
        "dataset": {
            "fileName": file_name,
            "rowCount": row_count,
            "columnCount": column_count,
            "duplicateRows": duplicate_rows,
        },
        "summary": {
            "recommendationCounts": recommendation_counts,
            "columnsWithIssues": sum(1 for col in columns if len(col["issues"]) > 0),
        },
        "columns": columns,
        "preview": preview,
    }


@app.post("/profile")
async def profile_file(file: UploadFile = File(...)):
    filename = file.filename.lower()
    contents = await file.read()

    try:
        if filename.endswith(".csv"):
            df = pl.read_csv(io.BytesIO(contents))

        elif filename.endswith(".xlsx") or filename.endswith(".xls"):
            df = pl.read_excel(io.BytesIO(contents), engine="calamine")

        else:
            raise HTTPException(
                status_code=400,
                detail="Only CSV and Excel files are supported."
            )

        # temporary: convert to pandas so your existing profile_dataframe works
        return profile_dataframe(df.to_pandas(), file.filename)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
