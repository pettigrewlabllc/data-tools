"""Builds laus_style.xlsx, a small workbook shaped like BLS county files: a notes sheet first, title rows
above the header, codes stored as text, a date column, and footnotes under the data. Run with openpyxl."""
import datetime
from openpyxl import Workbook

wb = Workbook()
notes = wb.active
notes.title = "Notes"
notes["A1"] = "Read me: figures are not seasonally adjusted."
ws = wb.create_sheet("Data")
ws["A1"] = "Labor force data by county, 2024 annual averages"
ws["A2"] = "(Not seasonally adjusted)"
ws.append([])
ws.append(["State FIPS Code", "County FIPS Code", "County Name", "Year", "Released", "Unemployment Rate"])
rows = [("01", "001", "Autauga County, AL", 2024, datetime.date(2025, 4, 18), 2.9),
        ("01", "003", "Baldwin County, AL", 2024, datetime.date(2025, 4, 18), 3.0),
        ("06", "037", "Los Angeles County, CA", 2024, datetime.date(2025, 4, 18), 5.6),
        ("48", "201", "Harris County, TX", 2024, datetime.date(2025, 4, 18), 4.4),
        ("06", "001", "Alameda County, CA", 2024, datetime.date(2025, 4, 18), 5.1)]
for r in rows:
    ws.append(list(r))
ws.append([])
ws.append(["Footnotes: (p) preliminary."])
ws.append(["SOURCE: test fixture, not real data."])
wb.save("laus_style.xlsx")
