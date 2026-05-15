import express from "express";
import multer from "multer";
import { analyzeLicense } from "../controllers/license.controller.js";

const router = express.Router();
const upload = multer();  //multer({ dest: 'uploads/' })

router.post("/analyze-license", upload.single("file"), analyzeLicense);

export default router;