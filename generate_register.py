#!/usr/bin/env python3
"""Regenerate weight-register.js from the Heavy vehicle axle scale register xlsx.

Usage: python3 generate_register.py "Axle scale register.xlsx"
Reads the 'Calibration register' sheet, finds the header row (first cell 'Asset'),
and writes weight-register.js next to this script.
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

def norm(s):
    return re.sub(r"[^A-Z0-9]", "", str(s).upper())

def num(v):
    try:
        f = float(v)
        return f if f == f else None  # NaN check
    except (TypeError, ValueError):
        return None

def main(xlsx_path):
    df = pd.read_excel(xlsx_path, sheet_name="Calibration register", header=None)
    hdr = next(i for i, row in df.iterrows() if str(row[0]).strip() == "Asset")
    cols = [str(c).strip() for c in df.iloc[hdr]]
    data = df.iloc[hdr + 1:].copy()
    data.columns = cols
    keep = ["Asset", "Type", "Registration", "Tare kg", "GML kg", "GVM kg",
            "Payload kg", "Permit", "Adjusted GML", "Axle configuration"]
    data = data[[c for c in keep if c in data.columns]]
    data = data[data["Asset"].notna() & (data["Asset"].astype(str).str.strip() != "")]

    reg = {}
    for _, r in data.iterrows():
        reg[norm(r["Asset"])] = {
            "asset": str(r["Asset"]).strip(),
            "rego": str(r.get("Registration", "")).strip(),
            "type": str(r.get("Type", "")).strip(),
            "tare": num(r.get("Tare kg")),
            "gml": num(r.get("GML kg")),
            "gvm": num(r.get("GVM kg")),
            "payload": num(r.get("Payload kg")),
            "adjGml": num(r.get("Adjusted GML")),
            "permit": str(r.get("Permit", "")).strip(),
            "axles": str(r.get("Axle configuration", "")).strip(),
        }

    out = Path(__file__).parent / "weight-register.js"
    with open(out, "w") as f:
        f.write("// Generated from " + Path(xlsx_path).name + " \u2014 Heavy vehicle axle scale register\n")
        f.write("// Regenerate with generate_register.py when the register changes.\n")
        f.write("var WEIGHT_REGISTER = ")
        json.dump(reg, f, separators=(",", ":"))
        f.write(";\n")
    print(f"Wrote {out} with {len(reg)} vehicles")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
