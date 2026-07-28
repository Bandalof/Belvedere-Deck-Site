const V='2026-07-28-1';
const CACHE='bd-catalog-'+V;
const ASSETS=['./','./index.html','./catalog.js','./manifest.webmanifest',
  './icon-192.png','./icon-512.png','./icon-512-maskable.png'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(
    ks.filter(k=>k.startsWith('bd-catalog-')&&k!==CACHE).map(k=>caches.delete(k))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET') return;
  e.respondWith(
    caches.match(r,{ignoreSearch:true}).then(hit=>{
      const net=fetch(r).then(resp=>{
        if(resp&&resp.status===200&&resp.type==='basic')
          caches.open(CACHE).then(c=>c.put(r,resp.clone()));
        return resp;
      }).catch(()=>hit);
      return hit||net;
    })
  );
});
