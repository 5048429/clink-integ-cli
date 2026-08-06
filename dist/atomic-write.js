import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
const PRIVATE_FILE_MODE = 0o600;
export async function writePrivateTextFileAtomically(filePath, content) {
    const directory = dirname(filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = temporaryFilePath(filePath, "tmp");
    try {
        await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: PRIVATE_FILE_MODE });
        await setPrivateFileMode(temporaryPath);
        await rename(temporaryPath, filePath);
        await verifyPrivateFileMode(filePath);
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
        await writeFile(probePath, "", { encoding: "utf8", flag: "wx", mode: PRIVATE_FILE_MODE });
    }
    finally {
        await rm(probePath, { force: true }).catch(() => undefined);
    }
}
async function setPrivateFileMode(filePath) {
    try {
        await chmod(filePath, PRIVATE_FILE_MODE);
    }
    catch (error) {
        if (process.platform === "win32")
            return;
        throw error;
    }
}
async function verifyPrivateFileMode(filePath) {
    if (process.platform === "win32")
        return;
    const mode = (await stat(filePath)).mode & 0o777;
    if (mode !== PRIVATE_FILE_MODE) {
        throw new Error(`Private file permissions must be 0600: ${filePath}`);
    }
}
function temporaryFilePath(filePath, suffix) {
    return join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.${suffix}`);
}
//# sourceMappingURL=atomic-write.js.map