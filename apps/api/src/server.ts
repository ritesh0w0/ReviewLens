import pino from "pino";
import { createApp } from "./app.js";

const app = createApp();
const port = Number(process.env.PORT ?? 3001);
const logger = pino();

app.listen(port, () => {
  logger.info({ port }, "ReviewLens API listening");
});
