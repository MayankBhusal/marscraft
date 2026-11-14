
import csv
import json
import statistics
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / "validation" / "slope_validation_cells.csv"
OUTPUT = ROOT / "validation" / "slope_validation_analysis.json"

CLASS_ORDER = ["low", "moderate", "high"]


def percentile(values, p):
    """Calculate a percentile using linear interpolation."""
    values = sorted(values)

    if not values:
        return None

    position = (len(values) - 1) * p / 100
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    fraction = position - lower

    return values[lower] * (1 - fraction) + values[upper] * fraction


def summarize(values):
    if not values:
        return {}

    return {
        "count": len(values),
        "mean": statistics.mean(values),
        "median": statistics.median(values),
        "p90": percentile(values, 90),
        "p95": percentile(values, 95),
        "maximum": max(values),
    }


def main():
    if not INPUT.exists():
        raise FileNotFoundError(
            f"Could not find validation CSV: {INPUT}"
        )

    with INPUT.open("r", newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)

        required = {
            "row",
            "col",
            "coarse_slope_deg",
            "fine_median_deg",
            "fine_p90_deg",
            "fine_max_deg",
            "difference_deg",
            "absolute_difference_deg",
            "coarse_class",
            "fine_median_class",
        }

        missing = required - set(reader.fieldnames or [])

        if missing:
            raise ValueError(
                f"CSV is missing required columns: {sorted(missing)}"
            )

        records = list(reader)

    if not records:
        raise ValueError("The validation CSV contains no records.")

    # Convert numeric columns.
    numeric_columns = [
        "coarse_slope_deg",
        "fine_median_deg",
        "fine_p90_deg",
        "fine_max_deg",
        "difference_deg",
        "absolute_difference_deg",
    ]

    for record in records:
        for column in numeric_columns:
            record[column] = float(record[column])

        record["row"] = int(record["row"])
        record["col"] = int(record["col"])

        record["coarse_class"] = record["coarse_class"].lower()
        record["fine_median_class"] = (
            record["fine_median_class"].lower()
        )

    total = len(records)

    # 1. Confusion matrix:
    # Rows = fine-resolution class
    # Columns = coarse-resolution class
    matrix = {
        fine: {coarse: 0 for coarse in CLASS_ORDER}
        for fine in CLASS_ORDER
    }

    transitions = Counter()

    for record in records:
        fine = record["fine_median_class"]
        coarse = record["coarse_class"]

        if fine not in CLASS_ORDER or coarse not in CLASS_ORDER:
            continue

        matrix[fine][coarse] += 1
        transitions[f"{fine} -> {coarse}"] += 1

    # 2. Threshold crossing analysis.
    threshold_results = {}

    for threshold in [5, 15]:
        fine_at_or_above = [
            r for r in records
            if r["fine_median_deg"] >= threshold
        ]

        coarse_below = [
            r for r in records
            if r["coarse_slope_deg"] < threshold
        ]

        hidden = [
            r for r in records
            if r["fine_median_deg"] >= threshold
            and r["coarse_slope_deg"] < threshold
        ]

        threshold_results[str(threshold)] = {
            "threshold_degrees": threshold,
            "fine_at_or_above_count": len(fine_at_or_above),
            "coarse_below_count": len(coarse_below),
            "fine_at_or_above_but_coarse_below_count": len(hidden),
            "percent_of_all_cells": (
                100 * len(hidden) / total
            ),
            "percent_of_fine_at_or_above": (
                100 * len(hidden) / len(fine_at_or_above)
                if fine_at_or_above else 0
            ),
        }

    # 3. Compare coarse slope against fine-scale summaries.
    coarse_vs_fine_median = [
        r["coarse_slope_deg"] - r["fine_median_deg"]
        for r in records
    ]

    coarse_vs_fine_p90 = [
        r["coarse_slope_deg"] - r["fine_p90_deg"]
        for r in records
    ]

    coarse_vs_fine_max = [
        r["coarse_slope_deg"] - r["fine_max_deg"]
        for r in records
    ]

    # 4. Largest discrepancies.
    largest = sorted(
        records,
        key=lambda r: r["absolute_difference_deg"],
        reverse=True
    )[:20]

    largest_discrepancies = []

    for r in largest:
        largest_discrepancies.append({
            "row": r["row"],
            "col": r["col"],
            "fine_median_deg": r["fine_median_deg"],
            "coarse_slope_deg": r["coarse_slope_deg"],
            "difference_deg": r["difference_deg"],
            "fine_p90_deg": r["fine_p90_deg"],
            "fine_max_deg": r["fine_max_deg"],
            "fine_class": r["fine_median_class"],
            "coarse_class": r["coarse_class"],
        })

    report = {
        "experiment": "MarsCraft DEM slope-resolution analysis",
        "total_compared_cells": total,

        "confusion_matrix": {
            "row_definition": "Fine-resolution median class",
            "column_definition": "Coarse-resolution class",
            "class_order": CLASS_ORDER,
            "counts": matrix,
        },

        "class_transitions": dict(transitions),

        "threshold_crossings": threshold_results,

        "slope_difference_statistics": {
            "coarse_minus_fine_median_deg": summarize(
                coarse_vs_fine_median
            ),
            "coarse_minus_fine_p90_deg": summarize(
                coarse_vs_fine_p90
            ),
            "coarse_minus_fine_max_deg": summarize(
                coarse_vs_fine_max
            ),
        },

        "largest_20_discrepancies": largest_discrepancies,

        "interpretation_note": (
            "Fine-resolution statistics and coarse-resolution "
            "slope values represent different spatial supports. "
            "These comparisons measure resolution sensitivity, "
            "not absolute accuracy against ground truth."
        ),
    }

    with OUTPUT.open("w", encoding="utf-8") as file:
        json.dump(report, file, indent=2)

    print("\n=== SLOPE VALIDATION ANALYSIS ===")
    print(f"Compared cells: {total:,}")

    print("\nCONFUSION MATRIX")
    print("Rows = fine-resolution class")
    print("Columns = coarse-resolution class")
    print(f"{'Fine / Coarse':<18}", end="")

    for name in CLASS_ORDER:
        print(f"{name:>12}", end="")

    print()

    for fine in CLASS_ORDER:
        print(f"{fine:<18}", end="")

        for coarse in CLASS_ORDER:
            print(f"{matrix[fine][coarse]:>12,}", end="")

        print()

    print("\nCLASS TRANSITIONS")

    for transition, count in transitions.most_common():
        print(
            f"{transition:<25} "
            f"{count:>10,} "
            f"({100 * count / total:.2f}%)"
        )

    print("\nTHRESHOLD CROSSINGS")

    for threshold, result in threshold_results.items():
        print(
            f"{threshold} degrees: "
            f"{result['fine_at_or_above_but_coarse_below_count']:,} "
            f"cells "
            f"({result['percent_of_all_cells']:.2f}% of all cells)"
        )

    print("\nSLOPE DIFFERENCES")

    for name, stats in report["slope_difference_statistics"].items():
        print(f"\n{name}")

        for metric, value in stats.items():
            print(f"  {metric}: {value:.3f}")

    print("\nTOP 5 DISCREPANCIES")

    for item in largest_discrepancies[:5]:
        print(
            f"Cell ({item['row']}, {item['col']}): "
            f"fine={item['fine_median_deg']:.2f}°, "
            f"coarse={item['coarse_slope_deg']:.2f}°, "
            f"difference={item['difference_deg']:.2f}°"
        )

    print(f"\nFull report saved to: {OUTPUT}")


if __name__ == "__main__":
    main()
