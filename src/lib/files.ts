import "server-only";
import { rename, unlink, writeFile } from "node:fs/promises";

let seq = 0;

/**
 * Write `file` through a temporary file, so readers never see it half written. Each write gets
 * its own temporary file, so two writes at once don't rename each other's away. On Windows the
 * rename fails while another process has the file open (OBS's script reads it every second),
 * so it is retried briefly.
 */
export async function replaceFile(file: string, data: string, tmpPrefix = `${file}.tmp`) {
  const tmp = `${tmpPrefix}-${process.pid}-${++seq}`;
  await writeFile(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(tmp, file);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 10 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) {
        await unlink(tmp).catch(() => {});
        throw e;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
