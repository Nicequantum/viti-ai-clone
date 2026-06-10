export const RO_EXTRACTION_PROMPT = `Use OCR to carefully analyze ALL provided repair order image(s). Extract vehicle header fields from the top section AND extract EVERY customer complaint line from the complaint/labor section.

VEHICLE FIELDS (top header):
- RO Number: top center (near "RO #", "Repair Order", "Work Order")
- Customer Name: customer section
- Service Advisor Name: the service advisor / writer on the RO (often labeled "Service Advisor", "Svc Advisor", "SA", or "Writer" — NOT the technician)
- Year / Make / Model: vehicle information row
- VIN: exactly 17 characters
- Mileage IN: from MILEAGE IN/OUT or odometer (numbers only)

CUSTOMER COMPLAINTS (HIGHEST PRIORITY — EXTRACT EVERY # A THROUGH # F):
The complaint block starts immediately AFTER the header row that reads:
  LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
(or close variants: LINE OPCODE TECH TYPE HOURS, LINE OP CODE TECH TYPE DESCRIPTION)

CRITICAL FORMAT — vertical column of hashtag labels (NO commas on the RO):
Immediately below that header, the dealership prints complaint labels in a column:

    # A
    # B
    # C
    # D
    # E
    # F

Each label is: hashtag + space + single capital letter (A through F). NO commas between labels.

The complaint TEXT is beside these labels (to the right) OR on the same line:
    # A RHODE ISLAND STATE INSPECTION
    # B CHECK ENGINE LIGHT ON

MULTI-PAGE RULES:
- Search ALL pages/images. Complaints often continue on page 2+.
- Page 2 may begin with leftover/continuation text from the previous complaint — that text belongs to the PRIOR letter (e.g. end of C), NOT a new line.
- Still extract every # letter printed on later pages (D, E, F, etc.).

INCLUDE ALL LINES — DO NOT SKIP:
- Extract EVERY printed label # A, # B, # C, # D, # E, # F even if the text is short, "Quality Control", a placeholder, or hard to read.
- Line A is ALWAYS the first # A in the column — NEVER skip Line A.
- Include QC / shop lines verbatim. The technician will delete unneeded lines.
- Do NOT invent letters from words inside complaint text (e.g. "RHODE ISLAND" does NOT create lines E, I, L, N).
- Lines WITHOUT a leading # letter (e.g. "RISI ...", "619 CDEF", "130132 PASSED") are inspection detail — attach to the prior letter mentally; output only lettered lines A–F.
- Also capture text after "Customer states...", "C/S", "Concern" when paired with a # letter.

Output ONLY this exact format:

RO Number: [value]
Customer Name: [value]
Service Advisor Name: [value or blank if not visible]
Year: [value]
Make: [value]
Model: [value]
VIN: [exact 17 char]
Mileage IN: [numbers only]
Customer Complaints:
A. [exact text for # A]
B. [exact text for # B]
C. [exact text for # C]
D. [exact text for # D]
E. [exact text for # E]
F. [exact text for # F]

Output only letters actually printed on the RO (skip letters not present). Use "A." prefix in output even if the RO shows "# A" without a period. Be extremely precise on VIN (fix O/0 I/1), mileage, and RO number.`;