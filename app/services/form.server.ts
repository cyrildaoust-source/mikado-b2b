// Enforce the limit while reading, including requests without Content-Length.
export async function readForm(request:Request){
 const limit=1_000_000,reader=request.body?.getReader();
 if(!reader)return new FormData();
 const chunks:Uint8Array[]=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new Response("Devis trop volumineux. Réduisez les descriptions ou répartissez le projet.",{status:413});}chunks.push(value)}
 const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return new Response(bytes,{headers:{"Content-Type":request.headers.get("Content-Type")||"application/x-www-form-urlencoded"}}).formData();
}
