import express from "express";
import cors from "cors";
import userRoutes from "./routes/user.routes.js";
import errorMiddleware from "./middlewares/error.middleware.js";
import { requestLogger } from "./middlewares/logger.middleware.js";
import pasteRoutes from "./routes/paste.routes.js";

const app = express();

app.use(requestLogger);
app.use(cors());
app.use(express.json());

app.use("/api/users", userRoutes);
app.use("/api/pastes", pasteRoutes);

app.use(errorMiddleware);

export default app;
