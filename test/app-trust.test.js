const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {isAppPageURL,isTrustedSender}=require('../app-trust');
const file=String.raw`C:\Users\Артур\Bitora 'экран' #100%\resources\app.asar\index.html`;
const nodeURL=pathToFileURL(file,{windows:true}).href;
test('encoded Cyrillic, apostrophes, spaces, hash and percent identify same file',()=>{
 const chromiumURL=nodeURL.replaceAll("'",'%27');
 assert.notEqual(chromiumURL,nodeURL);
 assert.equal(isAppPageURL(nodeURL,file,'win32'),true);
 assert.equal(isAppPageURL(chromiumURL,file,'win32'),true);
 assert.equal(isAppPageURL(chromiumURL.replace('C:','c:'),file,'win32'),true);
 assert.equal(isAppPageURL(chromiumURL.replaceAll(/%[A-F0-9]{2}/g,s=>s.toLowerCase()),file,'win32'),true);
});
test('only the exact app page is accepted',()=>{
 for(const value of ['https://example.com/index.html','about:blank','data:text/html,x',nodeURL+'?x=1',nodeURL+'#other',nodeURL.replace('index.html','other.html'),nodeURL.replace('app.asar','app.asar.bak'),'file:///C:/%ZZ/index.html',null])
  assert.equal(isAppPageURL(value,file,'win32'),false,String(value));
 assert.equal(isAppPageURL('file:///tmp/Index.html','/tmp/index.html','linux'),false);
 assert.equal(isAppPageURL('file:///tmp/index.html','/tmp/index.html','linux'),true);
});
test('deny foreign contents and subframes even with identical URLs',()=>{
 const frame={url:nodeURL.replaceAll("'",'%27')},contents={mainFrame:frame};
 assert.equal(isTrustedSender({sender:contents,senderFrame:frame},contents,file,'win32'),true);
 assert.equal(isTrustedSender({sender:{},senderFrame:frame},contents,file,'win32'),false);
 assert.equal(isTrustedSender({sender:contents,senderFrame:{url:frame.url}},contents,file,'win32'),false);
 assert.equal(isTrustedSender({sender:contents,senderFrame:null},contents,file,'win32'),false);
});
