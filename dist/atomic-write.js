import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
export async function writeTextFileAtomically(filePath, content) {
    const directory = dirname(filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = temporaryFilePath(filePath, "tmp");
    try {
        await writeFile(temporaryPath, content, "utf8");
        await rename(temporaryPath, filePath);
    }
    finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
}
export async function assertAtomicTextFileTarget(filePath) {
    try {
        const target = await stat(filePath);
        if (!target.isFile()) {
            throw new Error(`Local secret destination must be a file path: ${filePath}`);
        }
        await access(filePath, constants.W_OK);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    const directory = dirname(filePath);
    await mkdir(directory, { recursive: true });
    const probePath = temporaryFilePath(filePath, "probe");
    try {
        await writeFile(probePath, "", "utf8");
    }
    finally {
        await rm(probePath, { force: true }).catch(() => undefined);
    }
}
function temporaryFilePath(filePath, suffix) {
    return join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.${suffix}`);
}
//# sourceMappingURL=atomic-write.js.map