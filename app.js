
(() => {
  const $ = (id) => document.getElementById(id);

  const homeView = $('homeView');
  const albumView = $('albumView');
  const albumList = $('albumList');
  const photoGrid = $('photoGrid');

  let db;
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

  const objectUrls = new Set();

  function makeUrl(blob) {
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    return url;
  }

  function clearUrls() {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls.clear();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('totedArchive', 1);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains('albums')) {
          database.createObjectStore('albums', {
            keyPath: 'id'
          });
        }

        if (!database.objectStoreNames.contains('photos')) {
          const store = database.createObjectStore('photos', {
            keyPath: 'id'
          });

          store.createIndex('albumId', 'albumId', {
            unique: false
          });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getAllAlbums() {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('albums', 'readonly');
      const request = transaction.objectStore('albums').getAll();

      request.onsuccess = () => {
        resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
      };

      request.onerror = () => reject(request.error);
    });
  }

  function getAlbumPhotos(albumId) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('photos', 'readonly');
      const index = transaction.objectStore('photos').index('albumId');
      const request = index.getAll(albumId);

      request.onsuccess = () => {
        resolve(request.result.sort((a, b) => a.sortOrder - b.sortOrder));
      };

      request.onerror = () => reject(request.error);
    });
  }

  async function loadAlbums() {
    clearUrls();

    try {
      const albums = await getAllAlbums();

      albumList.innerHTML = '';
      $('homeMessage').classList.toggle('hidden', albums.length !== 0);

      albums.forEach(album => {
        const button = document.createElement('button');
        button.className = 'album-card';
        button.type = 'button';

        const imageUrl = makeUrl(album.coverBlob);

        button.innerHTML = `
          <img loading="lazy" src="${imageUrl}" alt="">
          <h2>${escapeHtml(album.title)}</h2>
          <p class="album-meta">PHOTO COLLECTION</p>
        `;

        button.addEventListener('click', () => openAlbum(album));
        albumList.append(button);
      });
    } catch (error) {
      albumList.innerHTML =
        '<p class="loading">앨범을 불러오지 못했어요.</p>';
      console.error(error);
    }
  }

  async function openAlbum(album) {
    clearUrls();

    currentAlbum = album;
    homeView.classList.add('hidden');
    albumView.classList.remove('hidden');

    $('albumTitle').textContent = album.title;
    $('albumCover').innerHTML =
      `<img src="${makeUrl(album.coverBlob)}" alt="">`;

    photoGrid.innerHTML =
      '<p class="loading">사진을 불러오는 중…</p>';

    try {
      const photos = await getAlbumPhotos(album.id);

      currentPhotos = photos.map(photo => ({
        ...photo,
        url: makeUrl(photo.blob)
      }));

      $('photoCount').textContent =
        `${photos.length} PHOTOS`;

      photoGrid.innerHTML = '';

      currentPhotos.forEach((photo, index) => {
        const button = document.createElement('button');
        button.className = 'photo-cell';
        button.type = 'button';

        button.innerHTML =
          `<img loading="lazy" src="${photo.url}" alt="사진 ${index + 1}">`;

        button.addEventListener('click', () => showViewer(index));
        photoGrid.append(button);
      });
    } catch (error) {
      photoGrid.innerHTML =
        '<p class="loading">사진을 불러오지 못했어요.</p>';
      console.error(error);
    }
  }

  function showHome() {
    albumView.classList.add('hidden');
    homeView.classList.remove('hidden');

    currentAlbum = null;
    currentPhotos = [];

    history.replaceState(null, '', '#home');
    loadAlbums();
  }

  $('backHome').addEventListener('click', showHome);

  $('openUpload').addEventListener('click', () => {
    $('uploadStatus').textContent = '';
    $('uploadDialog').showModal();
  });

  $('closeUpload').addEventListener('click', () => {
    $('uploadDialog').close();
  });

  $('uploadForm').addEventListener('submit', async event => {
    event.preventDefault();

    const status = $('uploadStatus');
    const submit = $('submitUpload');

    const title = $('albumName').value.trim();
    const cover = $('coverFile').files[0];
    const files = [...$('photoFiles').files];

    if (!title) {
      status.textContent = '앨범 제목을 입력해 주세요.';
      return;
    }

    if (!cover || !files.length) {
      status.textContent =
        '대표 사진과 앨범 사진을 선택해 주세요.';
      return;
    }

    if (files.length > 20) {
      status.textContent =
        '앨범 사진은 최대 20장까지 올릴 수 있어요.';
      return;
    }

    const allFiles = [cover, ...files];

    if (allFiles.some(file =>
      !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
      file.size > 6 * 1024 * 1024
    )) {
      status.textContent =
        'JPG, PNG, WEBP, GIF만 가능하며 사진 한 장은 6MB 이하여야 해요.';
      return;
    }

    submit.disabled = true;
    status.textContent = '사진을 저장하는 중…';

    const albumId = crypto.randomUUID();

    const album = {
      id: albumId,
      title,
      coverBlob: cover,
      createdAt: Date.now()
    };

    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(
          ['albums', 'photos'],
          'readwrite'
        );

        const albumStore = transaction.objectStore('albums');
        const photoStore = transaction.objectStore('photos');

        albumStore.add(album);

        files.forEach((file, index) => {
          photoStore.add({
            id: crypto.randomUUID(),
            albumId,
            blob: file,
            sortOrder: index
          });
        });

        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });

      status.textContent = '저장 완료!';

      $('uploadForm').reset();

      setTimeout(() => {
        $('uploadDialog').close();
        status.textContent = '';
        loadAlbums();
      }, 700);

    } catch (error) {
      console.error(error);
      status.textContent =
        '저장에 실패했어요. 브라우저 저장 공간을 확인해 주세요.';
    } finally {
      submit.disabled = false;
    }
  });

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
    if (scale > 1.01 || !currentPhotos.length) return;

    viewerIndex =
      (viewerIndex + delta + currentPhotos.length) %
      currentPhotos.length;

    img.src = currentPhotos[viewerIndex].url;

    $('viewerCounter').textContent =
      `${viewerIndex + 1} / ${currentPhotos.length}`;

    resetZoom();
  }

  $('closeViewer').addEventListener('click', closeViewer);

  stage.addEventListener('pointerdown', event => {
    stage.setPointerCapture(event.pointerId);

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    if (pointers.size === 1) {
      startPoint = {
        x: event.clientX,
        y: event.clientY,
        time: Date.now()
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

  stage.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    if (pointers.size === 2) {
      const points = [...pointers.values()];

      const distance = Math.hypot(
        points[0].x - points[1].x,
        points[0].y - points[1].y
      );

      scale = Math.max(
        1,
        Math.min(5, pinchStart * distance / (pinchDistance || distance))
      );

      applyTransform();

    } else if (pointers.size === 1 && scale > 1) {
      const dx = event.clientX - (startPoint?.x ?? event.clientX);
      const dy = event.clientY - (startPoint?.y ?? event.clientY);

      tx += dx;
      ty += dy;

      startPoint = {
        x: event.clientX,
        y: event.clientY
      };

      applyTransform();
    }
  });

  function pointerEnd(event) {
    if (pointers.size === 1 && startPoint && scale === 1) {
      const dx = event.clientX - startPoint.x;
      const dy = event.clientY - startPoint.y;

      if (Math.abs(dy) > 55 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        if (dy < 0) {
          movePhoto(-1);
        } else {
          movePhoto(1);
        }
      }
    }

    pointers.delete(event.pointerId);

    if (pointers.size < 2) pinchDistance = 0;
    if (pointers.size === 0) startPoint = null;

    if (scale < 1.03) {
      scale = 1;
      tx = 0;
      ty = 0;
      applyTransform();
    }
  }

  stage.addEventListener('pointerup', pointerEnd);
  stage.addEventListener('pointercancel', pointerEnd);
  stage.addEventListener('contextmenu', event => event.preventDefault());

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!viewer.classList.contains('hidden')) {
        closeViewer();
      }
    }
  });

  async function startArchive() {
    try {
      if (!('indexedDB' in window)) {
        throw new Error('이 브라우저는 내부 저장 기능을 지원하지 않습니다.');
      }

      db = await openDatabase();
      await loadAlbums();

    } catch (error) {
      console.error(error);
      albumList.innerHTML =
        '<p class="loading">저장소를 열지 못했어요. 브라우저를 확인해 주세요.</p>';
    }
  }

  startArchive();
})();
