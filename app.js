
const $ = (id) => document.getElementById(id);

const DB_NAME = 'totedArchive';
const DB_VERSION = 1;
const MAX_PHOTOS = 20;
const MAX_FILE_SIZE = 6 * 1024 * 1024;

let db;
let currentAlbum = null;
let currentPhotos = [];
let currentPhotoIndex = 0;
let objectUrls = [];

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
      const photos = request.result.sort(
        (a, b) => a.sortOrder - b.sortOrder
      );
      resolve(photos);
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
    const photoIndex = photoStore.index('albumId');

    albumStore.delete(album.id);

    const request = photoIndex.openCursor(
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

function showHomeView() {
  $('homeView').classList.remove('hidden');
  $('albumView').classList.add('hidden');
}

function showAlbumView() {
  $('homeView').classList.add('hidden');
  $('albumView').classList.remove('hidden');
}

async function loadAlbums() {
  clearUrls();

  const albums = await getAllAlbums();
  const list = $('albumList');

  list.innerHTML = '';

  if (albums.length === 0) {
    $('homeMessage').textContent = '아직 등록된 앨범이 없습니다.';
    return;
  }

  $('homeMessage').textContent = '';

  albums.sort((a, b) => b.createdAt - a.createdAt);

  for (const album of albums) {
    const photos = await getAlbumPhotos(album.id);

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

    card.addEventListener('click', () => {
      openAlbum(album);
    });

    list.appendChild(card);
  }
}

async function showHome() {
  currentAlbum = null;
  currentPhotos = [];

  $('homeView').classList.remove('hidden');
  $('albumView').classList.add('hidden');

  await loadAlbums();
}

async function openAlbum(album) {
  currentAlbum = album;
  currentPhotos = await getAlbumPhotos(album.id);

  clearUrls();

  showAlbumView();

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
    deleteButton.className = 'back-button delete-album-button';
    deleteButton.type = 'button';
    deleteButton.textContent = '앨범 삭제';

    $('photoCount').after(deleteButton);

    deleteButton.addEventListener('click', () => {
      if (currentAlbum) {
        deleteAlbum(currentAlbum);
      }
    });
  }

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

    button.addEventListener('click', () => {
      openViewer(index);
    });

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

  return (
    allowedTypes.includes(file.type) &&
    file.size <= MAX_FILE_SIZE
  );
}

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

  if (!coverFile) {
    status.textContent = '앨범 대표 사진을 선택해 주세요.';
    return;
  }

  if (!validateImage(coverFile)) {
    status.textContent = '대표 사진은 JPG, PNG, WEBP, GIF 형식이며 6MB 이하여야 합니다.';
    return;
  }

  if (photoFiles.length === 0) {
    status.textContent = '사진을 한 장 이상 선택해 주세요.';
    return;
  }

  if (photoFiles.length > MAX_PHOTOS) {
    status.textContent = `사진은 한 번에 최대 ${MAX_PHOTOS}장까지 등록할 수 있습니다.`;
    return;
  }

  const invalidFile = photoFiles.find((file) => !validateImage(file));

  if (invalidFile) {
    status.textContent = '사진은 JPG, PNG, WEBP, GIF 형식이며 각각 6MB 이하여야 합니다.';
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

function openViewer(index) {
  currentPhotoIndex = index;

  $('viewer').classList.remove('hidden');
  updateViewer();

  $('viewer').focus();
}

function closeViewer() {
  $('viewer').classList.add('hidden');
}

function updateViewer() {
  const photo = currentPhotos[currentPhotoIndex];

  if (!photo) return;

  $('viewerImage').src = createObjectUrl(photo.blob);
  $('viewerCounter').textContent =
    `${currentPhotoIndex + 1} / ${currentPhotos.length}`;
}

function nextPhoto() {
  if (currentPhotoIndex < currentPhotos.length - 1) {
    currentPhotoIndex++;
    updateViewer();
  }
}

function previousPhoto() {
  if (currentPhotoIndex > 0) {
    currentPhotoIndex--;
    updateViewer();
  }
}

function setupViewer() {
  $('closeViewer').addEventListener('click', closeViewer);

  $('viewer').addEventListener('click', (event) => {
    if (event.target === $('viewer')) {
      closeViewer();
    }
  });

  document.addEventListener('keydown', (event) => {
    if ($('viewer').classList.contains('hidden')) return;

    if (event.key === 'Escape') closeViewer();
    if (event.key === 'ArrowRight') nextPhoto();
    if (event.key === 'ArrowLeft') previousPhoto();
  });

  let startX = 0;
  let startY = 0;

  $('viewerStage').addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
  }, { passive: true });

  $('viewerStage').addEventListener('touchend', (event) => {
    const touch = event.changedTouches[0];
    const diffX = touch.clientX - startX;
    const diffY = touch.clientY - startY;

    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX < 0) nextPhoto();
      else previousPhoto();
    }
  }, { passive: true });
}

function setupUploadDialog() {
  $('openUpload').addEventListener('click', () => {
    $('uploadDialog').showModal();
  });

  $('closeUpload').addEventListener('click', () => {
    $('uploadDialog').close();
  });

  $('uploadForm').addEventListener('submit', handleUpload);
}

async function init() {
  try {
    db = await openDatabase();

    $('backHome').addEventListener('click', showHome);

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
