import express from "express";
import cors from "cors";
import licenseRoutes from "./routes/license.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/v1/license", licenseRoutes);

export default app;