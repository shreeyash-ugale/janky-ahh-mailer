import pandas as pd
import glob

EMAIL_COL = "E-mail 1 - Value"

seen_emails = set()

files = sorted(glob.glob("ccs-2025-*.csv"))


for file in files:
    df = pd.read_csv(file)

    df[EMAIL_COL] = df[EMAIL_COL].astype(str).str.strip().str.lower()

    mask = ~df[EMAIL_COL].isin(seen_emails)
    cleaned_df = df[mask]

    seen_emails.update(cleaned_df[EMAIL_COL])

    cleaned_df.to_csv(file, index=False)

    print(f"{file}: removed {len(df) - len(cleaned_df)} duplicate rows")


total_rows = 0

for file in files:
    rows = len(pd.read_csv(file))
    print(f"{file}: {rows} rows")
    total_rows += rows

print("Total rows across all files:", total_rows)