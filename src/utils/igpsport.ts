import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import {
    IGPSPORT_FIT_DIR,
    IGPSPORT_IMPORT_NUM,
    IGPSPORT_IMPORT_START,
    IGPSPORT_PATCHED_FIT_DIR,
    IGPSPORT_PATCH_SCRIPT,
} from '../constant';

const execFileAsync = promisify(execFile);

const ensureDir = (dir: string) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

export const selectIGPSportFitFiles = (
    files: string[],
    start = IGPSPORT_IMPORT_START,
    num = IGPSPORT_IMPORT_NUM,
): string[] => {
    const sortedFiles = [...files].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    const sliced = num > 0
        ? sortedFiles.slice(start, start + num)
        : sortedFiles.slice(start);

    if (sliced.length === 0) {
        throw new Error(`no .fit files selected after slicing, start=${start}, num=${num}`);
    }

    return sliced;
};

export const listIGPSportFitFiles = async (): Promise<string[]> => {
    ensureDir(IGPSPORT_FIT_DIR);

    const fitFiles = fs.readdirSync(IGPSPORT_FIT_DIR)
        .filter(file => file.toLowerCase().endsWith('.fit'))
        .map(file => path.join(IGPSPORT_FIT_DIR, file));

    if (fitFiles.length === 0) {
        throw new Error(`no .fit files found in ${IGPSPORT_FIT_DIR}`);
    }

    return selectIGPSportFitFiles(fitFiles);
};

export const patchIGPSportFitFile = async (inputPath: string): Promise<string> => {
    ensureDir(IGPSPORT_PATCHED_FIT_DIR);

    const outputPath = path.join(IGPSPORT_PATCHED_FIT_DIR, path.basename(inputPath));
    const { stdout, stderr } = await execFileAsync('python3', [
        IGPSPORT_PATCH_SCRIPT,
        inputPath,
        outputPath,
    ]);

    if (stdout.trim()) {
        console.log(stdout.trim());
    }

    if (stderr.trim()) {
        console.error(stderr.trim());
    }

    if (!fs.existsSync(outputPath)) {
        throw new Error(`patched fit not found: ${outputPath}`);
    }

    return outputPath;
};

export const prepareIGPSportFitFiles = async (): Promise<string[]> => {
    const fitFiles = await listIGPSportFitFiles();
    const patchedFiles: string[] = [];

    for (let i = 0; i < fitFiles.length; i++) {
        const fitFile = fitFiles[i];
        console.log(`patching ${i + 1}/${fitFiles.length}: ${fitFile}`);
        patchedFiles.push(await patchIGPSportFitFile(fitFile));
    }

    return patchedFiles;
};
