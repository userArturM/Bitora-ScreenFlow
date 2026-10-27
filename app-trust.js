const path=require('node:path');
const {fileURLToPath}=require('node:url');
// Chromium and Node may serialize the same file URL differently.
// Compare decoded absolute paths, never prefixes or URL substrings.
function isAppPageURL(value,appFile,platform=process.platform) {
  try {
    if(typeof value!=='string'||typeof appFile!=='string') return false;
    const url=new URL(value);
    if(url.protocol!=='file:'||url.search||url.hash||url.username||url.password) return false;
    const windows=platform==='win32',paths=windows?path.win32:path.posix;
    if(!paths.isAbsolute(appFile)) return false;
    const actual=paths.normalize(fileURLToPath(url,{windows}));
    const expected=paths.normalize(appFile);
    return windows?actual.toLowerCase()===expected.toLowerCase():actual===expected;
  }catch{return false;}
}
function isTrustedFrame(contents,frame,appFile,platform=process.platform) {
  return !!contents && !!frame && frame===contents.mainFrame && isAppPageURL(frame.url,appFile,platform);
}
function isTrustedSender(event,contents,appFile,platform=process.platform) {
  return !!event && event.sender===contents && isTrustedFrame(contents,event.senderFrame,appFile,platform);
}
module.exports={isAppPageURL,isTrustedFrame,isTrustedSender};
