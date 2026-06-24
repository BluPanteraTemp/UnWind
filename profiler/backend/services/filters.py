"""Row-level filter helpers shared by profile and matrix endpoints."""

import json
from typing import Optional

import polars as pl


def apply_row_filters(df: pl.DataFrame, raw_filters: Optional[str]) -> pl.DataFrame:
    # Row filters keep only records where selected columns match selected values.
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
