import assert from 'assert';

import { selectIGPSportFitFiles } from './utils/igpsport';

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

const run = () => {
    testSelectIGPSportFitFiles();
    console.log('igpsport tests passed');
};

run();
