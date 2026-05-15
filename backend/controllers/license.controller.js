import { extractTextFromBuffer } from "../services/pdf.service.js";
import { llamaClient } from "../config/groq.js";

export const analyzeLicense = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const buffer = req.file.buffer;

        const pdfText = await extractTextFromBuffer(buffer);
        console.log(pdfText);

        const response = await llamaClient.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: "You extract structured data from driving licenses."
                },
                {
                    role: "user",
                    content: `You are an AI system specialized in extracting structured data from driving licenses.

Analyze the provided document text and extract key fields into a structured JSON format.

IMPORTANT GUIDELINES:
- Use field labels (e.g., "Name", "DOB", "License No.", "Date of Issue", etc.) as the primary source of truth.
- Do NOT infer or merge values from nearby fields.
- Do NOT include unrelated information (e.g., father's name, S/O, W/O, S/W/D) in the NAME field.
- Extract only the value corresponding to the correct label.
- If multiple similar fields exist, choose the most relevant official field.
- Preserve spacing in names (e.g., "R D", not "RD").
- Dates must be converted to ISO format: YYYY-MM-DD.
- If a field is missing or unclear, return null.
- Do not hallucinate or guess values.

EXPECTED OUTPUT FORMAT (STRICT JSON ONLY):

{
  "NAME": null,
  "LICENSE_NUMBER": null,
  "DATE_OF_BIRTH": null,
  "ISSUE_DATE": null,
  "EXPIRY_DATE": null,
  "ADDRESS": null,
  "VEHICLE_CLASS": null,
  "ISSUING_AUTHORITY": null
}

FIELD DEFINITIONS:
- NAME: Value explicitly labeled as "Name"
- LICENSE_NUMBER: Value labeled as "License No." or similar
- DATE_OF_BIRTH: Value labeled as "DOB" or "Date of Birth"
- ISSUE_DATE: Value labeled as "Date of Issue"
- EXPIRY_DATE: Value labeled as "Date of Expiry"
- ADDRESS: Prefer "Present Address" or full address block
- VEHICLE_CLASS: Value under "Authorization to Drive"
- ISSUING_AUTHORITY: Authority issuing the license

OUTPUT RULES:
- Return ONLY valid JSON
- No explanation, no extra text
- No markdown formatting
- No trailing commas

DOCUMENT TEXT:
${pdfText}
                    `
                }
            ]
        });

        const output = response.choices[0].message.content;
        const cleaned = output.replace(/```/g, '').trim();

        let parsed;
        try {
            parsed = JSON.parse(cleaned);
        } catch (err) {
            return res.status(500).json({ error: "Invalid JSON from AI" });
        }

        res.json(parsed);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Processing failed" });
    }
};