import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
const axios = require('axios');

import {
    IGPSPORT_EXPORT_NUM,
    IGPSPORT_EXPORT_START,
    IGPSPORT_FIT_DIR,
    IGPSPORT_IMPORT_NUM,
    IGPSPORT_IMPORT_START,
    IGPSPORT_PATCHED_FIT_DIR,
    IGPSPORT_PATCH_SCRIPT,
    IGPSPORT_USERNAME,
    IGPSPORT_PASSWORD,
} from '../constant';

const IGPSPORT_BASE_URL = 'https://prod.zh.igpsport.com/service';

const pad2 = (value: string | number): string => String(value).padStart(2, '0');

const igpsportLogin = async (username: string, password: string): Promise<string> => {
    const url = `${IGPSPORT_BASE_URL}/auth/account/login`;
    console.log(`iGPSPORT login: POST ${url}`);
    const response = await axios.post(url, {
        appId: 'igpsport-web',
        username,
        password,
    }).catch((e: any) => {
        throw new Error(`iGPSPORT login failed [${e.response?.status}] ${url}: ${JSON.stringify(e.response?.data)}`);
    });
    const token = response.data?.data?.access_token;
    if (!token) {
        throw new Error(`iGPSPORT login failed: ${JSON.stringify(response.data)}`);
    }
    return token;
};

const igpsportGetActivities = async (
    token: string,
    start = IGPSPORT_IMPORT_START,
    num = IGPSPORT_IMPORT_NUM,
): Promise<any[]> => {
    const totalNeeded = start + (num > 0 ? num : 100);
    const pageSize = 100;
    let allActivities: any[] = [];
    let page = 1;

    while (allActivities.length < totalNeeded) {
        const listUrl = `${IGPSPORT_BASE_URL}/web-gateway/web-analyze/activity/queryMyActivity`;
        console.log(`iGPSPORT activities: GET ${listUrl} pageNo=${page}`);
        const response = await axios.get(listUrl, {
                headers: { Authorization: `Bearer ${token}` },
                params: { pageNo: page, pageSize, sort: '1', reqType: '0' },
            }
        ).catch((e: any) => {
            throw new Error(`iGPSPORT getActivities failed [${e.response?.status}] ${listUrl}: ${JSON.stringify(e.response?.data)}`);
        });
        console.log('iGPSPORT activities response:', JSON.stringify(response.data).slice(0, 500));
        const data = response.data?.data;
        const list: any[] = data?.rows ?? data?.list ?? data?.records ?? [];
        allActivities = allActivities.concat(list);
        if (list.length < pageSize) break;
        page++;
    }

    const end = num > 0 ? start + num : undefined;
    return allActivities.slice(start, end);
};

const igpsportGetDownloadUrl = async (token: string, activityId: string | number): Promise<string> => {
    const response = await axios.get(
        `${IGPSPORT_BASE_URL}/web-gateway/web-analyze/activity/getDownloadUrl/${activityId}`,
        {
            headers: { Authorization: `Bearer ${token}` },
            params: { reqType: 0 },
        }
    );
    const url = response.data?.data;
    if (!url) {
        throw new Error(`iGPSPORT: no download URL for activity ${activityId}: ${JSON.stringify(response.data)}`);
    }
    return url;
};

export const downloadIGPSportFitFiles = async (): Promise<void> => {
    if (!IGPSPORT_USERNAME || !IGPSPORT_PASSWORD) {
        throw new Error('IGPSPORT_USERNAME and IGPSPORT_PASSWORD are required');
    }

    ensureDir(IGPSPORT_FIT_DIR);

    const token = await igpsportLogin(IGPSPORT_USERNAME, IGPSPORT_PASSWORD);
    console.log('iGPSPORT login success');

    const activities = await igpsportGetActivities(token);
    console.log(`iGPSPORT: ${activities.length} activities to download`);
    if (activities.length > 0) {
        console.log('iGPSPORT activity sample keys:', Object.keys(activities[0]));
    }

    for (let i = 0; i < activities.length; i++) {
        const act = activities[i];
        const actId = act.rideId ?? act.id ?? act.activityId;
        const filePath = path.join(IGPSPORT_FIT_DIR, `${actId}.fit`);

        if (fs.existsSync(filePath)) {
            console.log(`skip existing: ${filePath}`);
            continue;
        }

        console.log(`downloading ${i + 1}/${activities.length}: activity ${actId}`);
        const downloadUrl = await igpsportGetDownloadUrl(token, actId);
        const fileResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(filePath, fileResponse.data);
        console.log(`saved: ${filePath}`);
    }
};

const execFileAsync = promisify(execFile);

const ensureDir = (dir: string) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

export const getIGPSportActivityId = (activity: any): string | number => {
    const actId = activity?.rideId ?? activity?.id ?? activity?.activityId;
    if (actId === undefined || actId === null || actId === '') {
        throw new Error(`iGPSPORT activity id not found, keys=${Object.keys(activity ?? {}).join(',')}`);
    }
    return actId;
};

const getIGPSportActivityTime = (activity: any): string | number | Date => {
    const timeFields = [
        'startTime',
        'startTimeLocal',
        'start_time',
        'beginTime',
        'begin_time',
        'rideTime',
        'sportStartTime',
        'startDate',
        'workoutTime',
        'createTime',
    ];

    for (const field of timeFields) {
        const value = activity?.[field];
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }

    throw new Error(`iGPSPORT activity time not found, keys=${Object.keys(activity ?? {}).join(',')}`);
};

export const getIGPSportActivityTimeFileName = (activity: any): string => {
    const value = getIGPSportActivityTime(activity);

    if (typeof value === 'string') {
        const match = value.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
        if (match) {
            const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
            return `${year}-${pad2(month)}-${pad2(day)}-${pad2(hour)}-${pad2(minute)}-${pad2(second)}.fit`;
        }
    }

    const timestamp = typeof value === 'number' && value < 100000000000 ? value * 1000 : value;
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`invalid iGPSPORT activity time: ${value}`);
    }

    return [
        date.getFullYear(),
        pad2(date.getMonth() + 1),
        pad2(date.getDate()),
        pad2(date.getHours()),
        pad2(date.getMinutes()),
        pad2(date.getSeconds()),
    ].join('-') + '.fit';
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

export const patchIGPSportFitFileTo = async (inputPath: string, outputPath: string): Promise<string> => {
    ensureDir(path.dirname(outputPath));
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

export const patchIGPSportFitFile = async (inputPath: string): Promise<string> => {
    ensureDir(IGPSPORT_PATCHED_FIT_DIR);

    const outputPath = path.join(IGPSPORT_PATCHED_FIT_DIR, path.basename(inputPath));
    return patchIGPSportFitFileTo(inputPath, outputPath);
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

export const exportIGPSportGarminFitFiles = async (): Promise<string[]> => {
    if (!IGPSPORT_USERNAME || !IGPSPORT_PASSWORD) {
        throw new Error('IGPSPORT_USERNAME and IGPSPORT_PASSWORD are required');
    }

    ensureDir(IGPSPORT_FIT_DIR);
    const rawDir = path.join(IGPSPORT_PATCHED_FIT_DIR, '_raw');
    ensureDir(rawDir);

    const token = await igpsportLogin(IGPSPORT_USERNAME, IGPSPORT_PASSWORD);
    console.log('iGPSPORT login success');

    const activities = await igpsportGetActivities(token, IGPSPORT_EXPORT_START, IGPSPORT_EXPORT_NUM);
    console.log(`iGPSPORT: ${activities.length} activities to export`);
    if (activities.length > 0) {
        console.log('iGPSPORT activity sample keys:', Object.keys(activities[0]));
    }

    const exportedFiles: string[] = [];

    for (let i = 0; i < activities.length; i++) {
        const activity = activities[i];
        const actId = getIGPSportActivityId(activity);
        const outputPath = path.join(IGPSPORT_FIT_DIR, getIGPSportActivityTimeFileName(activity));

        if (fs.existsSync(outputPath)) {
            console.log(`skip existing: ${outputPath}`);
            exportedFiles.push(outputPath);
            continue;
        }

        const rawPath = path.join(rawDir, `${actId}.fit`);
        console.log(`exporting ${i + 1}/${activities.length}: activity ${actId}`);
        const downloadUrl = await igpsportGetDownloadUrl(token, actId);
        const fileResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(rawPath, fileResponse.data);
        exportedFiles.push(await patchIGPSportFitFileTo(rawPath, outputPath));
        console.log(`exported: ${outputPath}`);
    }

    return exportedFiles;
};
