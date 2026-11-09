
(() => {
  const $ = (id) => document.getElementById(id);

  const homeView = $('homeView');
  const albumView = $('albumView');
  const albumList = $('albumList');
  const photoGrid = $('photoGrid');

  let archiveDB;
  let currentAlbum = null;
  let currentPhotos = [];
  let viewerIndex = 0;

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let pointers = new Map();
  let startPoint = null;
  let pinchStart = 0;
  let pinchDistance = 0;

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));

  // IndexedDB 열기
  function openArchiveDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('totedArchive', 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('albums')) {
          db.createObjectStore('albums', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('photos')) {
          const photos = db.createObjectStore('photos', {
            keyPath: 'id'
          });

          photos.createIndex('albumId', 'albumId', {
            unique: false
          });
        }
      };

      request.onsuccess = () => {
        archiveDB = request.result;
        resolve(archiveDB);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 데이터 저장
  function saveRecord(storeName, record) {
    return new Promise((resolve, reject) => {
      const tx = archiveDB.transaction(storeName, 'readwrite');

      tx.objectStore(storeName).put(record);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // 데이터 전체 불러오기
  function getAllRecords(storeName) {
    return new Promise((resolve, reject) => {
      const tx = archiveDB.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 특정 앨범의 사진 불러오기
  function getAlbumPhotos(albumId) {
    return new Promise((resolve, reject) => {
      const tx = archiveDB.transaction('photos', 'readonly');

      const request = tx.objectStore('photos')
        .index('albumId')
        .getAll(albumId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 이전 화면에서 만든 임시 이미지 주소 정리
  function clearPhotoUrls() {
    currentPhotos.forEach(photo => {
      if (photo.url) URL.revokeObjectURL(photo.url);
    });

    currentPhotos = [];
  }

  // 앨범 목록
  async function loadAlbums() {
    const albums = await getAllRecords('albums');

    albumList.innerHTML = '';

    $('homeMessage').classList.toggle(
      'hidden',
      albums.length !== 0
    );

    albums.sort((a, b) => b.createdAt - a.createdAt);

    albums.forEach(album => {
      const button = document.createElement('button');
      button.className = 'album-card';
      button.type = 'button';

      const imageUrl = URL.createObjectURL(album.cover);

      button.innerHTML = `
        <img loading="lazy" src="${imageUrl}" alt="">
        <h2>${escapeHtml(album.title)}</h2>
        <p class="album-meta">PHOTO COLLECTION</p>
      `;

      button.addEventListener('click', () => openAlbum(album));

      albumList.append(button);
    });
  }

  // 앨범 열기
  async function openAlbum(album) {
    currentAlbum = album;

    clearPhotoUrls();

    homeView.classList.add('hidden');
    albumView.classList.remove('hidden');

    $('albumTitle').textContent = album.title;
    $('albumCover').innerHTML = '';

    const coverUrl = URL.createObjectURL(album.cover);
    const coverImage = document.createElement('img');

    coverImage.src = coverUrl;

    $('albumCover').append(coverImage);

    photoGrid.innerHTML =
      '<div class="loading">사진을 불러오는 중…</div>';

    try {
      const photos = await getAlbumPhotos(album.id);

      currentPhotos = photos
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(photo => ({
          ...photo,
          url: URL.createObjectURL(photo.image)
        }));

      $('photoCount').textContent =
        `${currentPhotos.length} PHOTOS`;

      photoGrid.innerHTML = '';

      currentPhotos.forEach((photo, index) => {
        const button = document.createElement('button');

        button.className = 'photo-cell';
        button.type = 'button';

        button.innerHTML = `
          <img loading="lazy"
            src="${photo.url}"
            alt="사진 ${index + 1}">
        `;

        button.addEventListener('click', () => showViewer(index));

        photoGrid.append(button);
      });

    } catch (error) {
      photoGrid.innerHTML =
        '<p class="loading">사진을 불러오지 못했어요.</p>';
    }
  }

  // 홈으로 돌아가기
  function showHome() {
    clearPhotoUrls();

    albumView.classList.add('hidden');
    homeView.classList.remove('hidden');

    currentAlbum = null;

    history.replaceState(null, '', '#home');
  }

  $('backHome').addEventListener('click', showHome);

  // 업로드 창 열기
  $('openUpload').addEventListener('click', () => {
    $('uploadDialog').showModal();
  });

  $('closeUpload').addEventListener('click', () => {
    $('uploadDialog').close();
  });

  // 사진 업로드 및 저장
  $('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const status = $('uploadStatus');
    const submit = $('submitUpload');

    const title = $('albumName').value.trim();
    const cover = $('coverFile').files[0];
    const files = [...$('photoFiles').files];

    if (!title) {
      status.textContent = '앨범 이름을 입력해 주세요.';
      return;
    }

    if (!cover || files.length === 0) {
      status.textContent =
        '대표 사진과 앨범 사진을 선택해 주세요.';
      return;
    }

    if (files.length > 20) {
      status.textContent =
        '앨범 사진은 최대 20장까지 가능해요.';
      return;
    }

    const allFiles = [cover, ...files];

    if (allFiles.some(file =>
      !file.type.startsWith('image/') ||
      file.size > 15 * 1024 * 1024
    )) {
      status.textContent =
        '이미지 파일만 가능하며 사진 한 장은 15MB 이하여야 해요.';
      return;
    }

    submit.disabled = true;

    try {
      const albumId = crypto.randomUUID();

      status.textContent = '앨범 저장 중…';

      await saveRecord('albums', {
        id: albumId,
        title,
        cover,
        createdAt: Date.now()
      });

      for (let i = 0; i < files.length; i++) {
        status.textContent =
          `사진 저장 중… ${i + 1}/${files.length}`;

        await saveRecord('photos', {
          id: crypto.randomUUID(),
          albumId,
          image: files[i],
          sortOrder: i
        });
      }

      status.textContent = '저장 완료!';

      $('uploadForm').reset();

      setTimeout(async () => {
        $('uploadDialog').close();
        status.textContent = '';

        await loadAlbums();
      }, 900);

    } catch (error) {
      status.textContent =
        '저장 중 문제가 발생했어요: ' + error.message;

    } finally {
      submit.disabled = false;
    }
  });

  // 사진 뷰어
  const viewer = $('viewer');
  const stage = $('viewerStage');
  const img = $('viewerImage');

  function applyTransform() {
    img.style.transform =
      `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function resetZoom() {
    scale = 1;
    tx = 0;
    ty = 0;

    applyTransform();
  }

  function showViewer(index) {
    if (!currentPhotos[index]) return;

    viewerIndex = index;

    img.src = currentPhotos[index].url;

    viewer.classList.remove('hidden');

    $('viewerCounter').textContent =
      `${index + 1} / ${currentPhotos.length}`;

    resetZoom();
  }

  function closeViewer() {
    viewer.classList.add('hidden');

    pointers.clear();

    resetZoom();
  }

  function movePhoto(delta) {
    if (scale > 1.01 || currentPhotos.length === 0) return;

    viewerIndex =
      (viewerIndex + delta + currentPhotos.length) %
      currentPhotos.length;

    img.src = currentPhotos[viewerIndex].url;

    $('viewerCounter').textContent =
      `${viewerIndex + 1} / ${currentPhotos.length}`;

    resetZoom();
  }

  $('closeViewer').addEventListener('click', closeViewer);

  // 터치 및 마우스 조작
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId);

    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY
    });

    if (pointers.size === 1) {
      startPoint = {
        x: e.clientX,
        y: e.clientY
      };
    }

    if (pointers.size === 2) {
      const points = [...pointers.values()];

      pinchDistance = Math.hypot(
        points[0].x - points[1].x,
        points[0].y - points[1].y
      );

      pinchStart = scale;
      startPoint = null;
    }
  });

  stage.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;

    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY
    });

    if (pointers.size === 2) {
      const points = [...pointers.values()];

      const distance = Math.hypot(
        points[0].x - points[1].x,
        points[0].y - points[1].y
      );

      scale = Math.max(
        1,
        Math.min(
          5,
          pinchStart * distance / (pinchDistance || distance)
        )
      );

      applyTransform();

    } else if (pointers.size === 1 && scale > 1) {
      const dx = e.clientX -
        (startPoint?.x ?? e.clientX);

      const dy = e.clientY -
        (startPoint?.y ?? e.clientY);

      tx += dx;
      ty += dy;

      startPoint = {
        x: e.clientX,
        y: e.clientY
      };

      applyTransform();
    }
  });

  function pointerEnd(e) {
    if (
      pointers.size === 1 &&
      startPoint &&
      scale === 1
    ) {
      const dx = e.clientX - startPoint.x;
      const dy = e.clientY - startPoint.y;

      if (
        Math.abs(dy) > 55 &&
        Math.abs(dy) > Math.abs(dx) * 1.2
      ) {
        if (dy < 0) {
          movePhoto(-1);
        } else {
          movePhoto(1);
        }
      }
    }

    pointers.delete(e.pointerId);

    if (pointers.size < 2) {
      pinchDistance = 0;
    }

    if (pointers.size === 0) {
      startPoint = null;
    }

    if (scale < 1.03) {
      resetZoom();
    }
  }

  stage.addEventListener('pointerup', pointerEnd);
  stage.addEventListener('pointercancel', pointerEnd);

  stage.addEventListener('contextmenu', e => {
    e.preventDefault();
  });

  document.addEventListener('keydown', e => {
    if (
      e.key === 'Escape' &&
      !viewer.classList.contains('hidden')
    ) {
      closeViewer();
    }
  });

  // 데이터베이스 초기화 후 사이트 시작
  async function startArchive() {
    try {
      await openArchiveDB();
      await loadAlbums();

    } catch (error) {
      console.error('IndexedDB 오류:', error);

      albumList.innerHTML =
        '<div class="loading">저장소를 열지 못했어요. Safari 설정을 확인해 주세요.</div>';
    }
  }

  startArchive();

})();
