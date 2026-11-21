'use strict';
// Synthetic, generated fixture bytes only. The decoder below is explicitly a test double.
const zlib=require('node:zlib'),{webcrypto,createHash}=require('node:crypto');
const Media=require('../../src/jobs/jobPhotoFile');const {deterministicCrypto}=require('./jobIndexedDb');
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(tag,bytes){const type=Buffer.from(tag),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc(Buffer.concat([type,bytes])));return Buffer.concat([head,type,bytes,tail]);}
function png(note='test'){const h=Buffer.alloc(13);h.writeUInt32BE(3,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=2;const pixels=Buffer.from([0,255,0,0,0,255,0,0,0,255,0,255,255,0,0,255,255,255,0,255]);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('tEXt',Buffer.from('Fixture\0'+note)),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
function file(name='synthetic.png',note='test'){return new File([png(note)],name,{type:'image/png',lastModified:1700000000000});}
const crypto=start=>Object.assign(deterministicCrypto(start),{subtle:webcrypto.subtle});
async function decode(blob){const h=Media.inspect(new Uint8Array(await blob.arrayBuffer()));if(!h.ok)throw Error('Invalid fixture');return {width:h.width,height:h.height,close(){}};}
const fields=patch=>({label:'Panel Żółć <b>before</b>',location:'Basement\nPanel A',stage:'before',notes:'Synthetic observation.\nNo approval.',state:'active',...patch});
const meta=()=>({name:'synthetic.png',mediaType:'image/png',bytes:png().length,sha256:createHash('sha256').update(png()).digest('hex'),width:3,height:2,fileModifiedMs:1700000000000});
const id=(p,n)=>p+n.toString(16).padStart(32,'0');
module.exports={png,chunk,file,crypto,decode,fields,meta,id};
