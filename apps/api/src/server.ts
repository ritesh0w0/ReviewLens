import pino from "pino";
import "dotenv/config";
import { createApp } from "./app.js";

const app = createApp({
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
});
const port = Number(process.env.PORT ?? 3001);
const logger = pino();

app.listen(port, () => {
  logger.info({ port }, "ReviewLens API listening");
});
