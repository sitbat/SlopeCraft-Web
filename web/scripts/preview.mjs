/** Development QA server only. Production hosting is the deployer's responsibility. */
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stat,readFile} from 'node:fs/promises';

const root=path.resolve(fileURLToPath(new URL(process.argv.includes('--dist')?'../dist/':'../',import.meta.url)));
const port=Number(process.env.PORT || 4173);
const isolationHeaders=!process.argv.includes('--no-isolation');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.gz':'application/gzip','.png':'image/png','.svg':'image/svg+xml','.zip':'application/zip','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(request,response)=>{
  if(isolationHeaders){
    response.setHeader('Cross-Origin-Opener-Policy','same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    response.setHeader('Cross-Origin-Resource-Policy','same-origin');
  }
  response.setHeader('Cache-Control','no-store');
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const target=path.resolve(root,'.'+pathname);
    if(target!==root&&!target.startsWith(root.endsWith(path.sep)?root:root+path.sep)){response.writeHead(403);response.end();return;}
    const info=await stat(target),file=info.isDirectory()?path.join(target,'index.html'):target;
    const data=await readFile(file);
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':data.length});
    response.end(request.method==='HEAD'?undefined:data);
  }catch{response.writeHead(404);response.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
