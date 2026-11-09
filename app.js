const $ = (id) => document.getElementById(id);

const DB_NAME = 'totedArchive';
const DB_VERSION = 1;
const MAX_FILE_SIZE = 6 * 1024 * 1024;

let db;
let currentAlbum = null;
let currentPhotos = [];
let currentPhotoIndex = 0;
let objectUrls = [];
let viewerUrl = null;

let albumCache = [];
let albumRenderId = 0;

let scale = 1;
let translateX = 0;
let translateY = 0;

let pointers = new Map();
let startDistance = 0;
let startScale = 1;
let startX = 0;
let startY = 0;
let startTranslateX = 0;
let startTranslateY = 0;
let swipeStartX = 0;
let swipeStartY = 0;
let gestureHadMultiplePointers = false;
let lastTap = 0;

function createId() {
  return crypto.randomUUID();
}

function createObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

function clearUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
}

function clearViewerUrl() {
  if (viewerUrl) {
    URL.revokeObjectURL(viewerUrl);
    viewerUrl = null;
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains('albums')) {
        database.createObjectStore('albums', {
          keyPath: 'id'
        });
      }

      if (!database.objectStoreNames.contains('photos')) {
        const photoStore = database.createObjectStore('photos', {
          keyPath: 'id'
        });

        photoStore.createIndex('albumId', 'albumId', {
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

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAlbumPhotos(albumId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('photos', 'readonly');
    const index = transaction.objectStore('photos').index('albumId');
    const request = index.getAll(albumId);

    request.onsuccess = () => {
      resolve(
        request.result.sort((a, b) => a.sortOrder - b.sortOrder)
      );
    };

    request.onerror = () => reject(request.error);
  });
}

function saveAlbum(album) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('albums', 'readwrite');
    transaction.objectStore('albums').put(album);

    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function savePhotos(photos) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('photos', 'readwrite');
    const store = transaction.objectStore('photos');

    photos.forEach((photo) => store.put(photo));

    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

// 앨범 삭제
async function deleteAlbum(album) {
  const confirmed = confirm(
    `"${album.title}" 앨범과 안에 들어 있는 모든 사진을 삭제할까요?\n삭제한 데이터는 복구할 수 없습니다.`
  );

  if (!confirmed) return;

  try {
    const transaction = db.transaction(
      ['albums', 'photos'],
      'readwrite'
    );

    const albumStore = transaction.objectStore('albums');
    const photoStore = transaction.objectStore('photos');

    albumStore.delete(album.id);

    const request = photoStore.index('albumId').openCursor(
      IDBKeyRange.only(album.id)
    );

    request.onsuccess = () => {
      const cursor = request.result;

      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    currentAlbum = null;
    currentPhotos = [];
    clearUrls();

    await showHome();

  } catch (error) {
    console.error(error);
    alert('앨범 삭제에 실패했습니다.');
  }
}

// 검색어와 일치하는 앨범 찾기
// 검색어 정리
function normalizeSearchText(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLocaleLowerCase();
}

// 검색어와 일치하는 앨범 찾기
function getMatchingAlbums(query) {
  const keyword = normalizeSearchText(query);

  if (!keyword) return albumCache;

  return albumCache.filter((album) =>
    normalizeSearchText(album.title).includes(keyword)
  );
}
// 자동완성 추천 목록 표시
function renderSuggestions(query) {
  const suggestions = $('searchSuggestions');
  const keyword = query.trim();

  suggestions.innerHTML = '';

  if (!keyword) {
    suggestions.classList.add('hidden');
    return;
  }

  const matches = getMatchingAlbums(keyword).slice(0, 6);

  if (matches.length === 0) {
    suggestions.classList.add('hidden');
    return;
  }

  matches.forEach((album) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion-item';
    button.setAttribute('role', 'option');

    const icon = document.createElement('span');
    icon.className = 'suggestion-icon';
    icon.textContent = '⌕';

    const title = document.createElement('span');
    title.className = 'suggestion-title';
    title.textContent = album.title;

    button.append(icon, title);

    button.addEventListener('click', () => {
      $('albumSearch').value = album.title;
      $('clearSearch').classList.remove('hidden');
      suggestions.classList.add('hidden');
      openAlbum(album);
    });

    suggestions.appendChild(button);
  });

  suggestions.classList.remove('hidden');
}

// 앨범 목록 그리기
async function renderAlbumList(query = '') {
  const renderId = ++albumRenderId;

  clearUrls();

  const list = $('albumList');
  const message = $('homeMessage');

  list.innerHTML = '';

  const matchingAlbums = getMatchingAlbums(query);

  if (matchingAlbums.length === 0) {
    message.textContent = query.trim()
      ? '검색 결과가 없습니다.'
      : '아직 등록된 앨범이 없습니다.';

    message.classList.remove('hidden');
    return;
  }

  message.classList.add('hidden');

  // 사진 개수를 미리 가져온다.
  const albumData = await Promise.all(
    matchingAlbums.map(async (album) => ({
      album,
      photos: await getAlbumPhotos(album.id)
    }))
  );

  // 빠르게 검색어를 바꿨을 때 오래된 결과가 덮어쓰지 않도록 한다.
  if (renderId !== albumRenderId) return;

  albumData.forEach(({ album, photos }) => {
    const card = document.createElement('button');
    card.className = 'album-card';
    card.type = 'button';

    const cover = document.createElement('img');
    cover.src = createObjectUrl(album.coverBlob);
    cover.alt = '';

    const title = document.createElement('h2');
    title.textContent = album.title;

    const meta = document.createElement('p');
    meta.className = 'album-meta';
    meta.textContent = `${photos.length} PHOTOS`;

    card.append(cover, title, meta);

    card.addEventListener('click', () => openAlbum(album));

    list.appendChild(card);
  });
}

// 검색 기능
function handleSearch() {
  const query = $('albumSearch').value;

  $('clearSearch').classList.toggle('hidden', !query);

  renderSuggestions(query);
  renderAlbumList(query);
}

// 앨범 목록 불러오기
async function loadAlbums() {
  albumCache = await getAllAlbums();

  albumCache.sort((a, b) => b.createdAt - a.createdAt);

  await renderAlbumList($('albumSearch').value);
}

async function showHome() {
  currentAlbum = null;
  currentPhotos = [];

  clearViewerUrl();

  $('homeView').classList.remove('hidden');
  $('albumView').classList.add('hidden');
  $('viewer').classList.add('hidden');

  await loadAlbums();
}

// 앨범 열기
async function openAlbum(album) {
  currentAlbum = album;
  currentPhotos = await getAlbumPhotos(album.id);

  clearUrls();
  $('searchSuggestions').classList.add('hidden');

  $('homeView').classList.add('hidden');
  $('albumView').classList.remove('hidden');

  $('albumTitle').textContent = album.title;
  $('albumCover').innerHTML = '';

  const coverImage = document.createElement('img');
  coverImage.src = createObjectUrl(album.coverBlob);
  coverImage.alt = '';

  $('albumCover').appendChild(coverImage);

  $('photoCount').textContent = `${currentPhotos.length} PHOTOS`;

  let deleteButton = $('deleteAlbum');

  if (!deleteButton) {
    deleteButton = document.createElement('button');
    deleteButton.id = 'deleteAlbum';
    deleteButton.type = 'button';
    deleteButton.className = 'back-button delete-album-button';
    deleteButton.textContent = '앨범 삭제';

    deleteButton.addEventListener('click', () => {
      if (currentAlbum) deleteAlbum(currentAlbum);
    });
  }

  $('albumTitle').parentElement.appendChild(deleteButton);
  deleteButton.hidden = false;

  const grid = $('photoGrid');
  grid.innerHTML = '';

  currentPhotos.forEach((photo, index) => {
    const button = document.createElement('button');
    button.className = 'photo-cell';
    button.type = 'button';

    const image = document.createElement('img');
    image.src = createObjectUrl(photo.blob);
    image.alt = '';

    button.appendChild(image);

    button.addEventListener('click', () => openViewer(index));

    grid.appendChild(button);
  });
}

function validateImage(file) {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ];

  return allowedTypes.includes(file.type) &&
    file.size <= MAX_FILE_SIZE;
}

// 사진 업로드
async function handleUpload(event) {
  event.preventDefault();

  const albumName = $('albumName').value.trim();
  const coverFile = $('coverFile').files[0];
  const photoFiles = Array.from($('photoFiles').files);
  const status = $('uploadStatus');

  status.textContent = '';

  if (!albumName) {
    status.textContent = '앨범 이름을 입력해 주세요.';
    return;
  }

  if (!coverFile || !validateImage(coverFile)) {
    status.textContent = '올바른 대표 사진을 선택해 주세요. (6MB 이하)';
    return;
  }

  if (photoFiles.length === 0) {
    status.textContent = '사진을 한 장 이상 선택해 주세요.';
    return;
  }

  if (photoFiles.some((file) => !validateImage(file))) {
    status.textContent =
      '사진은 JPG, PNG, WEBP, GIF 형식이며 각각 6MB 이하여야 합니다.';
    return;
  }

  const submitButton = $('submitUpload');
  submitButton.disabled = true;
  status.textContent = '사진을 저장하고 있습니다...';

  try {
    const album = {
      id: createId(),
      title: albumName,
      coverBlob: coverFile,
      createdAt: Date.now()
    };

    const photos = photoFiles.map((file, index) => ({
      id: createId(),
      albumId: album.id,
      blob: file,
      sortOrder: index
    }));

    await saveAlbum(album);
    await savePhotos(photos);

    $('uploadForm').reset();
    $('uploadDialog').close();

    status.textContent = '';

    await showHome();

  } catch (error) {
    console.error(error);
    status.textContent = '저장에 실패했습니다. 저장 공간을 확인해 주세요.';
  } finally {
    submitButton.disabled = false;
  }
}

// 확대 상태 초기화
function resetZoom() {
  scale = 1;
  translateX = 0;
  translateY = 0;

  pointers.clear();
  startDistance = 0;
  gestureHadMultiplePointers = false;

  applyZoom();
}

function applyZoom() {
  $('viewerImage').style.transform =
    `translate(${translateX}px, ${translateY}px) scale(${scale})`;
}

// 사진 뷰어 열기
function openViewer(index) {
  currentPhotoIndex = index;

  $('viewer').classList.remove('hidden');

  resetZoom();
  updateViewer();
}

// 사진 뷰어 닫기
function closeViewer() {
  $('viewer').classList.add('hidden');

  clearViewerUrl();
  resetZoom();
}

// 사진 표시
function updateViewer() {
  const photo = currentPhotos[currentPhotoIndex];

  if (!photo) return;

  resetZoom();
  clearViewerUrl();

  viewerUrl = URL.createObjectURL(photo.blob);
  $('viewerImage').src = viewerUrl;

  $('viewerCounter').textContent =
    `${currentPhotoIndex + 1} / ${currentPhotos.length}`;
}

// 다음 사진
function nextPhoto() {
  if (currentPhotoIndex < currentPhotos.length - 1) {
    currentPhotoIndex++;
    updateViewer();
  }
}

// 이전 사진
function previousPhoto() {
  if (currentPhotoIndex > 0) {
    currentPhotoIndex--;
    updateViewer();
  }
}

function getDistance(a, b) {
  return Math.hypot(
    a.x - b.x,
    a.y - b.y
  );
}

// 더블 탭 확대/축소
function toggleZoom() {
  if (scale > 1) {
    resetZoom();
  } else {
    scale = 2.5;
    translateX = 0;
    translateY = 0;
    applyZoom();
  }
}

// 확대 및 이동 제어
function setupZoom() {
  const stage = $('viewerStage');

  stage.addEventListener('pointerdown', (event) => {
    if ($('viewer').classList.contains('hidden')) return;

    event.preventDefault();

    stage.setPointerCapture(event.pointerId);

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    if (pointers.size === 1) {
      startX = event.clientX;
      startY = event.clientY;

      startTranslateX = translateX;
      startTranslateY = translateY;

      swipeStartX = event.clientX;
      swipeStartY = event.clientY;
    }

    if (pointers.size >= 2) {
      gestureHadMultiplePointers = true;

      const points = [...pointers.values()];

      startDistance = getDistance(points[0], points[1]);
      startScale = scale;
    }
  });

  stage.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;

    event.preventDefault();

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    if (pointers.size >= 2) {
      const points = [...pointers.values()];
      const distance = getDistance(points[0], points[1]);

      if (startDistance > 0) {
        scale = Math.min(
          5,
          Math.max(1, startScale * distance / startDistance)
        );

        applyZoom();
      }

      return;
    }

    if (
      pointers.size === 1 &&
      scale > 1 &&
      !gestureHadMultiplePointers
    ) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      translateX = startTranslateX + dx;
      translateY = startTranslateY + dy;

      applyZoom();
    }
  });

  function pointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;

    const point = pointers.get(event.pointerId);

    pointers.delete(event.pointerId);

    if (pointers.size > 0) {
      return;
    }

    if (!gestureHadMultiplePointers) {
      const dx = point.x - swipeStartX;
      const dy = point.y - swipeStartY;

      const moved = Math.abs(dx) > 10 || Math.abs(dy) > 10;

      // 좌우 밀기로 사진 넘기기
      if (
        scale === 1 &&
        Math.abs(dx) > 50 &&
        Math.abs(dx) > Math.abs(dy)
      ) {
        if (dx < 0) nextPhoto();
        else previousPhoto();

        lastTap = 0;
        startDistance = 0;
        return;
      }

      // 두 번 탭으로 확대/축소
      if (
        event.pointerType === 'touch' &&
        !moved
      ) {
        const now = Date.now();

        if (now - lastTap < 300) {
          toggleZoom();
          lastTap = 0;
        } else {
          lastTap = now;
        }
      }
    }

    startDistance = 0;
    gestureHadMultiplePointers = false;
  }

  stage.addEventListener('pointerup', pointerEnd);
  stage.addEventListener('pointercancel', pointerEnd);
}

// 뷰어 설정
function setupViewer() {
  $('closeViewer').addEventListener('click', closeViewer);

  document.addEventListener('keydown', (event) => {
    if ($('viewer').classList.contains('hidden')) return;

    if (event.key === 'Escape') closeViewer();

    if (scale === 1) {
      if (event.key === 'ArrowRight') nextPhoto();
      if (event.key === 'ArrowLeft') previousPhoto();
    }
  });

  setupZoom();
}

// 검색 설정
function setupSearch() {
  const searchInput = $('albumSearch');
  const clearButton = $('clearSearch');
  const suggestions = $('searchSuggestions');

  searchInput.addEventListener('input', handleSearch);

  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    clearButton.classList.add('hidden');
    suggestions.classList.add('hidden');

    renderAlbumList('');
    searchInput.focus();
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      suggestions.classList.add('hidden');
      return;
    }

    if (event.key === 'Enter') {
      const matches = getMatchingAlbums(searchInput.value);

      if (matches.length > 0) {
        event.preventDefault();
        suggestions.classList.add('hidden');
        openAlbum(matches[0]);
      }
    }
  });

  document.addEventListener('click', (event) => {
    if (
      !event.target.closest('.search-section')
    ) {
      suggestions.classList.add('hidden');
    }
  });
}

// 업로드 창
function setupUploadDialog() {
  $('openUpload').addEventListener('click', () => {
    $('uploadDialog').showModal();
  });

  $('closeUpload').addEventListener('click', () => {
    $('uploadDialog').close();
  });

  $('uploadForm').addEventListener('submit', handleUpload);
}

// 시작
async function init() {
  try {
    db = await openDatabase();

    $('backHome').addEventListener('click', showHome);

    setupSearch();
    setupUploadDialog();
    setupViewer();

    await showHome();

  } catch (error) {
    console.error(error);

    $('homeMessage').textContent =
      '저장소를 불러오지 못했습니다. 브라우저 설정을 확인해 주세요.';
  }
}

init();
