import {execFileSync} from 'node:child_process';
const branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();if(branch!=='production')throw new Error('Production deploys are permitted only from the protected production branch.');
