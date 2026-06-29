// 머니페이스 Service Worker
// 역할: 토스 캡처 공유 받기 (share_target) → IndexedDB 저장 → 앱으로 리다이렉트
// 캐싱은 하지 않음 (index.html 수정이 항상 즉시 반영되도록)

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mp_share', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('files'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function saveShared(dataUrl) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(dataUrl, 'shared');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const file = formData.get('image');
        if (file && file.size > 0) {
          const dataUrl = await blobToDataURL(file);
          await saveShared(dataUrl);
        }
      } catch (e) {}
      return Response.redirect('/money-pace/index.html?shared=1', 303);
    })());
    return;
  }
});
