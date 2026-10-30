const fs=require('node:fs');
const {Readable}=require('node:stream');
// Serve byte ranges explicitly: file:// forwarding does not guarantee 206 responses.
async function mediaResponse(file,request){
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
  const {size}=await fs.promises.stat(file);
  const headers={'Accept-Ranges':'bytes','Content-Type':/\.png$/i.test(file)?'image/png':/\.mp4$/i.test(file)?'video/mp4':'video/webm'};
  let start=0,end=size-1,status=200;
  const range=request.headers.get('range');
  if(range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${size}`}});
    start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
    end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${size}`}});
    status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length']=String(Math.max(0,end-start+1));
  return new Response(request.method==='HEAD'||!size?null:Readable.toWeb(fs.createReadStream(file,{start,end})),{status,headers});
}
module.exports={mediaResponse};
