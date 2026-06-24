"""Grouped blankness matrix generation."""

from typing import List

import polars as pl
from fastapi import HTTPException

from .profiling import blank_mask_expr, custom_blank_mask_expr


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
