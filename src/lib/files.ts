import "server-only";
import { rename, writeFile } from "node:fs/promises";

/**
 * Write `file` through a temporary file, so readers never see it half written. On Windows the
 * rename fails while another process has the file open (OBS's script reads it every second),
 * so it is retried briefly.
 */
export async function replaceFile(file: string, data: string, tmp = `${file}.tmp`) {
  await writeFile(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(tmp, file);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 10 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
