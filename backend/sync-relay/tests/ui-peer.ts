// Opt-in synthetic companion for browser UI checks. Invitation is read from a temporary private file.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parseInvitation, SyncClient, base64 } from '../../../Shared/Sync/protocol';
const pair = parseInvitation(await readFile('/tmp/do-sync-ui-invitation.txt','utf8'), {id:'native-ui-validation',name:'Mac clipboard test'});
const operation=process.argv[2];
if(operation==='revoke') { await new SyncClient(pair).revoke(); console.log('Test pairing revoked.'); }
else {
 const input:Record<string,unknown>={pair,operation:operation==='image'||operation==='text'?'send':operation};
 if(operation==='image') { input.mime='image/png'; input.bytes=base64(new Uint8Array(await readFile(new URL('../../../macos/SyncValidation/transparency.png',import.meta.url)))); }
 if(operation==='text') { input.mime='text/plain'; input.bytes=base64(new TextEncoder().encode('Dictation Operative Sync — normal paste test 123.')); }
 const child=spawn('/tmp/do-sync-native-validation',[],{stdio:['pipe','inherit','inherit']}); child.stdin.end(JSON.stringify(input)); child.on('close',code=>process.exit(code??1));
}
