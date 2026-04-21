import assert from 'assert';

import {
    getIGPSportActivityId,
    getIGPSportActivityTimeFileName,
    selectIGPSportFitFiles,
} from './utils/igpsport';

const testSelectIGPSportFitFiles = () => {
    const selected = selectIGPSportFitFiles(
        [
            '/tmp/b.fit',
            '/tmp/a.fit',
            '/tmp/c.fit',
        ],
        1,
        1,
    );

    assert.deepStrictEqual(selected, ['/tmp/b.fit']);
};

const testGetIGPSportActivityId = () => {
    assert.strictEqual(getIGPSportActivityId({ rideId: 123 }), 123);
    assert.strictEqual(getIGPSportActivityId({ id: 'abc' }), 'abc');
    assert.strictEqual(getIGPSportActivityId({ activityId: 456 }), 456);
};

const testGetIGPSportActivityTimeFileName = () => {
    assert.strictEqual(
        getIGPSportActivityTimeFileName({ startTime: '2026-03-27 20:08:12' }),
        '2026-03-27-20-08-12.fit',
    );

    assert.strictEqual(
        getIGPSportActivityTimeFileName({ beginTime: '2026/03/27 20:08:12' }),
        '2026-03-27-20-08-12.fit',
    );
};

const run = () => {
    testSelectIGPSportFitFiles();
    testGetIGPSportActivityId();
    testGetIGPSportActivityTimeFileName();
    console.log('igpsport tests passed');
};

run();
