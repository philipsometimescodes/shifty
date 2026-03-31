import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "./app.js";
import { ensureDefaultFestivalSetup } from "./bootstrap.js";
import { config } from "./config.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(currentDir, "../../data");
fs.mkdirSync(dataDirectory, { recursive: true });

await ensureDefaultFestivalSetup();

app.listen(config.port, () => {
  console.log(`Shifty server listening on http://localhost:${config.port}`);
});