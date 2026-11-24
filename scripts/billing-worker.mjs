// Deterministic worker; no AI account or desktop session required.
const endpoint=new URL('/internal/billing',process.env.BILLING_APP_URL||'http://app:3000');
const token=process.env.BILLING_WORKER_TOKEN||'';
if(token.length<32)throw Error('BILLING_WORKER_TOKEN doit contenir au moins 32 caractères.');
const interval=Math.max(5000,Number(process.env.BILLING_WORKER_INTERVAL_MS)||60000);
let stopped=false, timer;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;clearTimeout(timer);});
async function tick(){
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(600000)});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const result=await response.json();
  console.log(new Date().toISOString(),JSON.stringify(result));
 }catch{console.error(new Date().toISOString(),'Synchronisation impossible. Vérifiez le serveur et le suivi des factures.');}
 if(!stopped)timer=setTimeout(tick,interval);
}
await tick();
