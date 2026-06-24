import io
import warnings
from typing import Optional

import pandas as pd
import polars as pl
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

try:
    from .services import (
        apply_row_filters,
        build_matrix,
        get_stored_file,
        inspect_workbook_lineage,
        parse_custom_blank_values,
        parse_json_list,
        profile_dataframe,
        read_document_columns,
        read_excel_dataframe,
        read_stored_dataframe,
        store_file,
    )
except ImportError:
    from services import (
        apply_row_filters,
        build_matrix,
        get_stored_file,
        inspect_workbook_lineage,
        parse_custom_blank_values,
        parse_json_list,
        profile_dataframe,
        read_document_columns,
        read_excel_dataframe,
        read_stored_dataframe,
        store_file,
    )


warnings.filterwarnings("ignore", message="Could not determine dtype")

app = FastAPI(title="Data Profiler API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://data-profiler-mvp.vercel.app",
    ],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    return {"message": "Data profiler backend is running"}


@app.post("/document-columns")
async def get_document_columns(file: UploadFile = File(...)):
    # Lightweight pre-profile endpoint used to show mandatory-field choices after file selection.
    filename = file.filename or "uploaded-file"
    contents = await file.read()

    try:
        return read_document_columns(contents, filename)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/profile-sheet")
async def profile_specific_sheet(
    file_id: str = Form(...),
    sheet_name: str = Form(...),
    review_null_above: float = Form(25),
    discard_null_at_least: float = Form(95),
    include_custom_blanks: bool = Form(False),
    custom_blank_values: Optional[str] = Form(""),
    mandatory_fields: Optional[str] = Form("[]"),
    row_filters: Optional[str] = Form("[]"),
):
    # Re-profile a stored file. Excel uses the selected sheet; CSV ignores sheet_name.
    parsed_custom_blanks = parse_custom_blank_values(custom_blank_values)
    parsed_mandatory_fields = parse_json_list(mandatory_fields)

    try:
        df = read_stored_dataframe(file_id, sheet_name)
        stored_file = get_stored_file(file_id)
        filtered_df = apply_row_filters(df, row_filters)

        result = profile_dataframe(
            df=filtered_df,
            file_name=sheet_name if stored_file["fileType"] == "excel" else stored_file["fileName"],
            custom_blank_values=parsed_custom_blanks,
            mandatory_fields=parsed_mandatory_fields,
            review_null_above=review_null_above,
            discard_null_at_least=discard_null_at_least,
            include_custom_blanks=include_custom_blanks,
        )

        return {
            "sheetName": sheet_name,
            **result,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/profile")
async def profile_file(
    file: UploadFile = File(...),
    review_null_above: float = Form(25),
    discard_null_at_least: float = Form(95),
    include_custom_blanks: bool = Form(False),
    custom_blank_values: Optional[str] = Form(""),
    mandatory_fields: Optional[str] = Form("[]"),
    row_filters: Optional[str] = Form("[]"),
    sheet_name: Optional[str] = Form(None),
):
    # First full profile of an uploaded file. Store both CSV and Excel so matrices can run later.
    filename = file.filename or "uploaded-file"
    filename_lower = filename.lower()
    contents = await file.read()

    parsed_custom_blanks = parse_custom_blank_values(custom_blank_values)
    parsed_mandatory_fields = parse_json_list(mandatory_fields)
    lineage = inspect_workbook_lineage(contents, filename)

    try:
        if filename_lower.endswith(".csv"):
            file_id = store_file(contents, "csv", filename)
            df = pl.read_csv(io.BytesIO(contents), infer_schema=False)
            filtered_df = apply_row_filters(df, row_filters)

            profile = profile_dataframe(
                df=filtered_df,
                file_name=filename,
                custom_blank_values=parsed_custom_blanks,
                mandatory_fields=parsed_mandatory_fields,
                review_null_above=review_null_above,
                discard_null_at_least=discard_null_at_least,
                include_custom_blanks=include_custom_blanks,
            )

            return {
                "fileType": "csv",
                "fileId": file_id,
                "sheetNames": ["CSV"],
                "activeSheet": "CSV",
                "lineage": lineage,
                **profile,
            }

        if filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls"):
            file_id = store_file(contents, "excel", filename)

            excel_file = pd.ExcelFile(io.BytesIO(contents))
            sheet_names = excel_file.sheet_names
            active_sheet_name = sheet_name if sheet_name in sheet_names else sheet_names[0]

            df = read_excel_dataframe(contents, active_sheet_name, filename)
            filtered_df = apply_row_filters(df, row_filters)

            first_profile = profile_dataframe(
                df=filtered_df,
                file_name=f"{filename} - {active_sheet_name}",
                custom_blank_values=parsed_custom_blanks,
                mandatory_fields=parsed_mandatory_fields,
                review_null_above=review_null_above,
                discard_null_at_least=discard_null_at_least,
                include_custom_blanks=include_custom_blanks,
            )

            return {
                "fileType": "excel",
                "fileId": file_id,
                "sheetNames": sheet_names,
                "activeSheet": active_sheet_name,
                "sheets": {
                    active_sheet_name: first_profile
                },
                "lineage": lineage,
                **first_profile,
            }

        raise HTTPException(
            status_code=400,
            detail="Only CSV and Excel files are supported.",
        )

    except HTTPException:
        raise
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
    try:
        df = read_stored_dataframe(file_id, sheet_name)

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

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


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
    parsed_custom_blanks = parse_custom_blank_values(custom_blank_values)

    try:
        df = read_stored_dataframe(file_id, sheet_name)
        filtered_df = apply_row_filters(df, row_filters)

        return build_matrix(
            df=filtered_df,
            group_by=group_by,
            custom_blank_values=parsed_custom_blanks,
            review_null_above=review_null_above,
            discard_null_at_least=discard_null_at_least,
            include_custom_blanks=include_custom_blanks,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
