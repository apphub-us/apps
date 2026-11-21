'use strict';
/** Bounded raster inspection before native decoding. Original bytes are never re-encoded. */
const M=require('./jobPhoto.js');
const fail=(code,message)=>({ok:false,code,problems:[message]});
function inspect(bytes){
 try{
  if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>M.MAX_FILE_BYTES)return fail('FILE_INVALID','Photo is empty, truncated or exceeds 12 MiB.');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=bytes.length;
  const ascii=(at,count)=>String.fromCharCode(...bytes.subarray(at,at+count));let width,height,type;
  if(bytes[0]===137&&ascii(1,3)==='PNG'&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10){
   type='image/png';let p=8,chunks=0,hasData=false,end=false;
   while(p+12<=n){if(++chunks>20000)throw Error();const length=v.getUint32(p),tag=ascii(p+4,4);if(p+12+length>n)throw Error();if(chunks===1){if(tag!=='IHDR'||length!==13)throw Error();width=v.getUint32(p+8);height=v.getUint32(p+12);}else if(tag==='IHDR')throw Error();
    if(tag==='acTL'||tag==='fcTL'||tag==='fdAT')return fail('FORMAT_UNSUPPORTED','Animated images are not supported. Choose a still JPEG, PNG or WebP.');
    if(tag==='IDAT')hasData=true;p+=12+length;if(tag==='IEND'){if(length!==0||p!==n)throw Error();end=true;break;}
   }if(!end||!hasData)throw Error();
  }else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){
   type='image/jpeg';let p=2,segments=0,scan=false;
   while(p<n){if(++segments>20000||bytes[p++]!==255)throw Error();while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===217)break;if(marker===218){scan=true;break;}if(marker===1||(marker>=208&&marker<=215))continue;
    if(p+2>n)throw Error();const length=v.getUint16(p);if(length<2||p+length>n)throw Error();
    if([192,193,194].includes(marker)){if(length<8||width!==undefined)throw Error();height=v.getUint16(p+3);width=v.getUint16(p+5);}else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))return fail('FORMAT_UNSUPPORTED','This JPEG encoding is not supported. Choose a standard or progressive JPEG.');p+=length;
   }if(!scan||bytes[n-2]!==255||bytes[n-1]!==217)throw Error();
  }else if(ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
   type='image/webp';if(v.getUint32(4,true)+8!==n)throw Error();let p=12,chunks=0,canvas=null,image=null;
   const u24=x=>bytes[x]+bytes[x+1]*256+bytes[x+2]*65536;
   while(p+8<=n){if(++chunks>20000)throw Error();const tag=ascii(p,4),length=v.getUint32(p+4,true),at=p+8;if(at+length+(length%2)>n)throw Error();
    if(tag==='ANIM'||tag==='ANMF')return fail('FORMAT_UNSUPPORTED','Animated WebP is not supported. Choose a still image.');
    if(tag==='VP8X'){if(length!==10||canvas||(bytes[at]&2))return fail('FORMAT_UNSUPPORTED','Unsupported or animated WebP canvas.');canvas=[u24(at+4)+1,u24(at+7)+1];}
    if(tag==='VP8 '){if(image||length<10||bytes[at]&1||bytes[at+3]!==157||bytes[at+4]!==1||bytes[at+5]!==42)throw Error();image=[v.getUint16(at+6,true)&16383,v.getUint16(at+8,true)&16383];}
    if(tag==='VP8L'){if(image||length<5||bytes[at]!==47||(bytes[at+4]>>5)!==0)throw Error();const bits=v.getUint32(at+1,true);image=[(bits&16383)+1,((bits>>>14)&16383)+1];}
    p=at+length+(length%2);
   }if(p!==n||!image||canvas&&(canvas[0]!==image[0]||canvas[1]!==image[1]))throw Error();[width,height]=image;
  }else return fail('FORMAT_UNSUPPORTED','Choose a JPEG, PNG or still WebP. HEIC/HEIF, SVG, GIF and videos are not supported; export a JPEG/PNG copy first.');
  if(!M.dimensions(width,height))return fail('FILE_LIMIT','Image exceeds 16,000 pixels per side or 60 megapixels, or has invalid dimensions.');
  return {ok:true,mediaType:type,width,height};
 }catch(_){return fail('FILE_INVALID','The photo header is truncated, inconsistent or unsupported. Original file was not changed.');}
}
function capture(file){
 try{
  // Calling the native Blob method rejects plain object imitations before reading bytes.
  const raw=Blob.prototype.slice.call(file,0,file.size,file.type);
  if(!raw.size||raw.size>M.MAX_FILE_BYTES)return fail('FILE_LIMIT','Choose a photo no larger than 12 MiB.');
  const name=file.name,modified=file.lastModified===undefined?null:file.lastModified,type=raw.type;
  if(typeof name!=='string'||!name.trim()||name.length>255||/[\x00\r\n]/.test(name))return fail('FILE_INVALID','A valid file name is required.');
  if(!(modified===null||Number.isSafeInteger(modified)&&modified>=0&&modified<=8640000000000000))return fail('FILE_INVALID','Invalid file-modified timestamp.');
  if(type&&!['image/jpeg','image/png','image/webp','application/octet-stream'].includes(type))return fail('FORMAT_UNSUPPORTED','Choose JPEG, PNG or still WebP. HEIC/HEIF, SVG, GIF and videos are not supported; export a JPEG/PNG copy first.');
  return {ok:true,blob:raw,name,modified,claimedType:type};
 }catch(_){return fail('FILE_INVALID','Select a readable local image file.');}
}
async function digest(blob,crypto){if(!crypto||!crypto.subtle)throw Error('Crypto unavailable');const bytes=await Blob.prototype.arrayBuffer.call(blob);const hash=await crypto.subtle.digest('SHA-256',bytes);return {bytes:new Uint8Array(bytes),sha256:Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')};}
async function prepare(file,options={}){
 const captured=capture(file);if(!captured.ok)return captured;
 try{
  const hashed=await digest(captured.blob,options.crypto),header=inspect(hashed.bytes);if(!header.ok)return header;
  if(captured.claimedType&&captured.claimedType!=='application/octet-stream'&&captured.claimedType!==header.mediaType)return fail('FILE_INVALID','The declared image type disagrees with the file bytes.');
  const blob=captured.blob.slice(0,captured.blob.size,header.mediaType);
  if(typeof options.decode!=='function')return fail('UNAVAILABLE','Native image decoding is unavailable. Use a supported browser.');
  let image,width,height;try{image=await options.decode(blob,{imageOrientation:'from-image'});width=image.width;height=image.height;
   if(!M.dimensions(width,height)||!((width===header.width&&height===header.height)||(width===header.height&&height===header.width)))return fail('FILE_INVALID','Decoded dimensions disagree with the bounded photo header.');
  }finally{if(image&&typeof image.close==='function')image.close();}
  const metadata={name:captured.name,mediaType:header.mediaType,bytes:blob.size,sha256:hashed.sha256,width,height,fileModifiedMs:captured.modified};
  const checked=M.validateFile(metadata);return checked.ok?{ok:true,file:checked.file,blob}:checked;
 }catch(_){return fail('FILE_INVALID','This file could not be decoded or hashed. It was not saved; your details are kept.');}
}
async function verify(blob,file,crypto){
 try{
  const f=M.validateFile(file);if(!f.ok)return f;
  const raw=Blob.prototype.slice.call(blob,0,blob.size,blob.type);if(raw.size!==file.bytes||raw.type!==file.mediaType)return fail('CORRUPT','Stored photo size or type does not match its metadata.');
  const h=await digest(raw,crypto),header=inspect(h.bytes);if(!header.ok||header.mediaType!==file.mediaType||h.sha256!==file.sha256||!((header.width===file.width&&header.height===file.height)||(header.width===file.height&&header.height===file.width)))return fail('CORRUPT','Stored original failed its image/digest check. No replacement was selected.');
  return {ok:true,blob:raw};
 }catch(_){return fail('CORRUPT','Stored photo could not be verified. Nothing was changed.');}
}
module.exports={inspect,capture,prepare,verify};
