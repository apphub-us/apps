// Local runtime — server-side key reader. A port of readServerKey() in the WORKSPACE-4 openai-provider.cjs (that module
// does not export it): the same file convention (~/.config/empire-code/openai-api-key) and the same hardening — the
// directory and the file must be owned by this user, closed to group and others and not symbolic links; the file is
// opened with O_NOFOLLOW, re-checked on the descriptor, 20–1024 bytes, and must have the key format.
// Nothing is read at import or when a reader is created. The key is returned to the caller only: it is never cached,
// logged, copied or written, and no error carries any part of it or of the file system detail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY_FORMAT=/^sk-[A-Za-z0-9_-]{20,}$/;
// Shown by the accepted frontend as it is (a known code, under 300 characters). REQUEST_FAILED on purpose: the read
// happens after the attempt was reserved, and the frontend treats this code as "counting unknown", never as free.
export const KEY_MESSAGE='The saved API key cannot be read safely on this computer. Do not paste it into the chat. The draft is unchanged; there is no automatic retry.';
const unavailable=()=>Object.assign(new Error(KEY_MESSAGE),{code:'REQUEST_FAILED',status:503,safe:true,reason:'KEY_UNAVAILABLE'});

// `dir` exists for tests only (a synthetic temporary directory). The runtime calls createKeyReader() with no argument;
// no flag, environment variable or request value can select another location.
// All or nothing: the real location is used ONLY by the call with no argument at all. Any argument — also undefined,
// null or {} — must be {dir: <non-empty absolute path>}; anything else throws here, before a reader exists. An absent
// or invalid `dir` never falls back to the real location.
export function createKeyReader(...args){
 const explicit=args.length!==0,options=args[0];
 if(explicit&&(args.length!==1||options===null||typeof options!=='object'||typeof options.dir!=='string'||options.dir.length===0||options.dir.includes('\0')||!path.isAbsolute(options.dir)))
  throw new Error('createKeyReader needs an explicit absolute directory: {dir}');
 const dir=explicit?options.dir:null;
 return function readKey(){
  try{
   const base=explicit?dir:path.join(os.homedir(),'.config','empire-code'),file=path.join(base,'openai-api-key');
   for(const p of [base,file]){const st=fs.lstatSync(p);if(st.isSymbolicLink()||(st.mode&0o077)!==0||st.uid!==process.getuid())throw Error('unsafe');}
   const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   try{
    const st=fs.fstatSync(fd);
    if(!st.isFile()||st.size>1024||st.size<20||(st.mode&0o077)!==0||st.uid!==process.getuid())throw Error('unsafe');
    const key=fs.readFileSync(fd,'utf8').trim();
    if(!KEY_FORMAT.test(key))throw Error('format');
    return key;
   }finally{fs.closeSync(fd);}
  }catch{throw unavailable();}
 };
}
