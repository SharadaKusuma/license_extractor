import pdf from "@cedrugs/pdf-parse";

export const extractTextFromBuffer = async (buffer) => {
    const data = await pdf(buffer);
    return data.text;
};