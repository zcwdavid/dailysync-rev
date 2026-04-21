import { BARK_KEY_DEFAULT } from './constant';
import { exportIGPSportGarminFitFiles } from './utils/igpsport';

const axios = require('axios');
const core = require('@actions/core');

const BARK_KEY = process.env.BARK_KEY ?? BARK_KEY_DEFAULT;

export const exportIGPSportGarminFit = async () => {
    const exportedFiles = await exportIGPSportGarminFitFiles();
    if (exportedFiles.length === 0) {
        console.log('no iGPSPORT activities to export');
        return;
    }

    console.log('exported iGPSPORT Garmin FIT files:');
    for (const filePath of exportedFiles) {
        console.log(`- ${filePath}`);
    }
};

(async () => {
    try {
        await exportIGPSportGarminFit();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (BARK_KEY) {
            await axios.get(`https://api.day.app/${BARK_KEY}/iGPSPORT FIT 导出失败/${message}`);
        }
        core.setFailed(message);
        throw e;
    }
})();
