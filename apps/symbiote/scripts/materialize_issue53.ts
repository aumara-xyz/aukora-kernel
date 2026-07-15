import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

try {
  const fx = JSON.parse(readFileSync("core/tests/fixtures/issue53-validation-attachment.json", "utf8"));
  const out = join("/tmp", fx.filename);
  writeFileSync(out, fx.content);
  console.log("Materialized successfully!");
  console.log("File path:", out);
  console.log("Size:", Buffer.byteLength(fx.content, "utf8"), "bytes");
} catch (e: any) {
  console.error("Failed to materialize validation fixture:", e.message);
}
