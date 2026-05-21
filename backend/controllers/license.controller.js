import Groq from "groq-sdk";
import { extractLicenseText } from "../services/license.file.service.js";

// ============================================================
// Lazy Groq client — same pattern as passport controller
// ============================================================
let groqClient = null;
const getGroqClient = () => {
    if (!groqClient) {
        if (!process.env.GROQ_API_KEY) {
            throw new Error("GROQ_API_KEY is missing from environment variables.");
        }
        groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return groqClient;
};

// ============================================================
// Regex safety net — fix common OCR mistakes on licenses
// ============================================================
const applyLicenseRegexFixes = (data, rawText) => {
    // Fix license number: remove spaces/noise
    if (data.LICENSE_NUMBER) {
        data.LICENSE_NUMBER = data.LICENSE_NUMBER.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
    }

    // Fix dates: normalize to DD/MM/YYYY
    const normDate = (val) => {
        if (!val) return null;
        // Already DD/MM/YYYY
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return val;
        // YYYY-MM-DD → DD/MM/YYYY
        const iso = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
        // DD-MM-YYYY → DD/MM/YYYY
        const dmy = val.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dmy) return `${dmy[1]}/${dmy[2]}/${dmy[3]}`;
        return val;
    };

    data.DATE_OF_BIRTH = normDate(data.DATE_OF_BIRTH);
    data.ISSUE_DATE    = normDate(data.ISSUE_DATE);
    data.EXPIRY_DATE   = normDate(data.EXPIRY_DATE);

    // Extract license number from raw text if LLM missed it
    if (!data.LICENSE_NUMBER) {
        // Indian DL format: XX00 YYYYNNNNNNN
        const dlMatch = rawText.match(/[A-Z]{2}\d{2}\s?\d{4}\d{7}/);
        if (dlMatch) data.LICENSE_NUMBER = dlMatch[0].replace(/\s/g, "");
    }

    // Extract PLACE_OF_ISSUE if missing
    if (!data.ISSUING_AUTHORITY) {
        const rtoMatch = rawText.match(/(?:RTO|Licencing Authority|Issuing Authority)[:\s]+([A-Z\s,]+)/i);
        if (rtoMatch) data.ISSUING_AUTHORITY = rtoMatch[1].trim();
    }

    return data;
};

// ============================================================
// MAIN CONTROLLER
// ============================================================
export const analyzeLicense = async (req, res) => {
    console.log("📥 License request received:", req.file?.originalname);

    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const groq = getGroqClient();

        // Extract text (handles PDF + image + rotation)
        const rawText = await extractLicenseText(req.file);
        if (!rawText) {
            return res.status(500).json({ error: "OCR returned empty text" });
        }

        // LLM extraction
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: `You are a Driving License OCR expert. Return data ONLY as a JSON object.
Fields: NAME, LICENSE_NUMBER, DATE_OF_BIRTH, ISSUE_DATE, EXPIRY_DATE, ADDRESS, VEHICLE_CLASS, ISSUING_AUTHORITY.
Rules:
- Dates must be DD/MM/YYYY format.
- NAME: only the license holder's name — never include father/husband name or S/O, W/O, D/O prefixes.
- LICENSE_NUMBER: alphanumeric only, no spaces.
- VEHICLE_CLASS: list all vehicle classes authorized (e.g. "LMV, MCWG").
- ADDRESS: full address block, prefer permanent address if both present.
- If a field is missing, return null.
- Return ONLY the JSON object, no explanation.`
                },
                {
                    role: "user",
                    content: `TEXT:\n${rawText}`
                }
            ],
            response_format: { type: "json_object" }
        });

        let data = JSON.parse(response.choices[0].message.content);

        // Apply regex fixes
        data = applyLicenseRegexFixes(data, rawText);

        console.log("📤 Final License Data:", data);
        res.json(data);

    } catch (err) {
        console.error("❌ Fatal Error:", err.message);
        res.status(500).json({ error: "Processing failed", details: err.message });
    }
};