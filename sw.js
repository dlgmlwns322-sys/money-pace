// 머니페이스 Service Worker
// 역할: 토스 캡처 공유 받기 (share_target) → IndexedDB 저장 → 앱으로 리다이렉트
// 캐싱은 하지 않음 (index.html 수정이 항상 즉시 반영되도록)

self.addEventListener('install', (e) => {
  self.skipWaiting(); // 새 SW 즉시 활성화
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// ── IndexedDB 헬퍼 ──
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

// Blob을 dataURL로 변환
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ── 공유 받기 처리 ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // share_target POST 요청 가로채기
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const file = formData.get('image');
        if (file && file.size > 0) {
          const dataUrl = await blobToDataURL(file);
          await saveShared(dataUrl);
        }
      } catch (e) {
        // 실패해도 앱은 열어줌
      }
      // 앱을 열면서 공유 플래그 전달
      return Response.redirect('./index.html?shared=1', 303);
    })());
    return;
  }

  // 그 외 요청은 그냥 네트워크로 (캐싱 안 함)
});
