import csv
from pathlib import Path

input_files = [
    "ccs-3.csv",
    "ccs-2025-1.csv",
    "ccs-2025-2.csv",
    "ccs-2025-3.csv",
    "ccs-2025-4.csv",
    "ccs-2025-5.csv",
    "test.csv"
]

email_order = []
seen = set()

for file in input_files:
    with open(file, newline='', encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            email = row.get("E-mail 1 - Value")
            if not email:
                continue
            email = email.strip()

            if email in seen:
                email_order.remove(email)

            seen.add(email)
            email_order.append(email)

with open("master-2025.csv", "w", newline='', encoding="utf-8") as out:
    writer = csv.writer(out)
    writer.writerow(["E-mail 1 - Value"])
    for email in email_order:
        writer.writerow([email])
