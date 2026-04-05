import { BARK_KEY_DEFAULT } from './constant';
import { uploadGarminActivity } from './utils/garmin_common';
import { getGaminCNClient } from './utils/garmin_cn';
import { downloadIGPSportFitFiles, prepareIGPSportFitFiles } from './utils/igpsport';

const axios = require('axios');
const core = require('@actions/core');

const BARK_KEY = process.env.BARK_KEY ?? BARK_KEY_DEFAULT;

const isDuplicateActivityError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('Duplicate Activity.');
};

export const migrateIGPSportToGarminCN = async () => {
    const clientCN = await getGaminCNClient();
    await downloadIGPSportFitFiles();
    const patchedFiles = await prepareIGPSportFitFiles();

    for (let i = 0; i < patchedFiles.length; i++) {
        const filePath = patchedFiles[i];
        console.log(`uploading ${i + 1}/${patchedFiles.length}: ${filePath}`);
        try {
            await uploadGarminActivity(filePath, clientCN);
        } catch (e) {
            if (isDuplicateActivityError(e)) {
                console.log(`skip duplicate activity: ${filePath}`);
                continue;
            }
            throw e;
        }
    }
};

(async () => {
    try {
        await migrateIGPSportToGarminCN();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (BARK_KEY) {
            await axios.get(`https://api.day.app/${BARK_KEY}/iGPSPORT -> Garmin CN 导入失败/${message}`);
        }
        core.setFailed(message);
        throw e;
    }
})();
