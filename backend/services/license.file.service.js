import pdf from "@cedrugs/pdf-parse";
import sharp from "sharp";
import Groq from "groq-sdk";

// ============================================================
// Lazy Groq client
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
// Preprocess a buffer at a given rotation
// ============================================================
const processAtDegree = async (buffer, degree) => {
    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata;
    const targetWidth = Math.max(Math.max(width, height) * 2, 1200);

    return await sharp(buffer)
        .rotate(degree)
        .resize({ width: targetWidth, kernel: sharp.kernel.lanczos3 })
        .normalize()
        .sharpen()
        .jpeg({ quality: 95 })
        .toBuffer();
};

// ============================================================
// Send one image to Groq Vision and get raw text back
// ============================================================
const visionExtract = async (imageBuffer) => {
    const groq = getGroqClient();
    const base64Image = imageBuffer.toString("base64");

    const response = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0,
        max_tokens: 1024,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/jpeg;base64,${base64Image}`,
                        },
                    },
                    {
                        type: "text",
                        text: `This is a driving license image. Extract ALL visible text exactly as it appears.
Put each field on its own line like:
Name: <value>
License No: <value>
DOB: <value>
Date of Issue: <value>
Date of Expiry: <value>
Address: <value>
Vehicle Class: <value>
Issuing Authority: <value>
Return only extracted text. If the image is blank, unreadable, or sideways, say "UNREADABLE".`,
                    },
                ],
            },
        ],
    });

    return response.choices[0].message.content || "";
};

// ============================================================
// Score how confident we are that the extracted text is correct
// Higher = more likely to be the correct orientation
// ============================================================
const scoreExtractedText = (text) => {
    if (!text || text.includes("UNREADABLE")) return -1;

    let score = 0;
    const upper = text.toUpperCase();

    // Strong signals — these only appear in correctly oriented license text
    const strongKeywords = [
        "LICENSE NO", "LICENCE NO", "DL NO", "DL NUMBER",
        "DATE OF BIRTH", "DATE OF ISSUE", "DATE OF EXPIRY",
        "VEHICLE CLASS", "ISSUING AUTHORITY", "AUTHORIZATION TO DRIVE",
        "TRANSPORT", "NON-TRANSPORT", "LMV", "MCWG", "RTO", "ASST"
    ];
    strongKeywords.forEach(kw => { if (upper.includes(kw)) score += 3; });

    // Indian DL number pattern: 2 letters + 2 digits + 4 digits + 7 digits
    if (/[A-Z]{2}\d{2}\s?\d{4}\s?\d{7}/.test(upper)) score += 10;

    // Date patterns
    const dateMatches = text.match(/\d{2}[-\/]\d{2}[-\/]\d{4}/g) || [];
    score += dateMatches.length * 2;

    // General license keywords
    const generalKeywords = ["NAME", "DOB", "ADDRESS", "VALID", "HOLDER"];
    generalKeywords.forEach(kw => { if (upper.includes(kw)) score += 1; });

    console.log(`   Score: ${score} | Dates found: ${dateMatches.length} | DL pattern: ${/[A-Z]{2}\d{2}\s?\d{4}\s?\d{7}/.test(upper)}`);
    return score;
};

// ============================================================
// Try all 4 rotations, pick the one Vision reads best
// ============================================================
const extractWithBestOrientation = async (buffer) => {
    const orientations = [0, 90, 180, 270];
    let bestText = "";
    let bestScore = -1;
    let bestDegree = 0;

    for (const degree of orientations) {
        console.log(`🔄 Trying ${degree}°...`);
        const rotatedBuffer = await processAtDegree(buffer, degree);
        const text = await visionExtract(rotatedBuffer);

        console.log(`👁️ Vision at ${degree}°:\n`, text);
        const score = scoreExtractedText(text);
        console.log(`📊 ${degree}° score: ${score}`);

        if (score > bestScore) {
            bestScore = score;
            bestText = text;
            bestDegree = degree;
        }

        // Early exit if we found a strong match (DL number pattern found)
        if (score >= 10) {
            console.log(`✅ Strong match at ${degree}° (score ${score}) — stopping early`);
            break;
        }
    }

    console.log(`📌 Best orientation: ${bestDegree}° with score ${bestScore}`);
    console.log(`📄 Final Vision text:\n`, bestText);
    return bestText;
};

// ============================================================
// MAIN EXPORT
// ============================================================
export const extractLicenseText = async (file) => {
    const { mimetype } = file;

    // PDF: use pdf-parse directly
    if (mimetype === "application/pdf") {
        const data = await pdf(file.buffer);
        console.log("📄 PDF extracted text:\n", data.text);
        return data.text;
    }

    // Image: try all orientations, pick best
    if (mimetype.startsWith("image/")) {
        // Normalize EXIF first
        const normalized = await sharp(file.buffer).rotate().toBuffer();
        return await extractWithBestOrientation(normalized);
    }

    throw new Error(`Unsupported file type: ${mimetype}`);
};