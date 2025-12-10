
interface CatImage {
  id: string;
  url: string;
  width?: number;
  height?: number;
}

const CAT_API = 'https://api.thecatapi.com/v1/images/search';

function createStyles() {
  const css = `
    :root { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
    .cat-root { padding: 16px; display:flex; flex-direction:column; gap:12px; align-items:stretch; max-width:1200px; margin:0 auto;}
    .cat-grid { display:grid; grid-template-columns: repeat(auto-fill,minmax(180px,1fr)); gap:12px; }
    .cat-card { background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 1px 6px rgba(0,0,0,0.08); display:flex; align-items:center; justify-content:center; min-height:140px; }
    .cat-card img { width:100%; height:100%; object-fit:cover; display:block; }
    .controls { display:flex; gap:8px; align-items:center; justify-content:flex-end; }
    .btn { padding:8px 12px; border-radius:6px; border:1px solid #ddd; background:#f7f7f7; cursor:pointer; }
    .btn:active { transform:translateY(1px); }
    .error { color:#b00020; }
  `;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

async function fetchCatImages(limit = 12): Promise<CatImage[]> {
  const url = `${CAT_API}?limit=${limit}&mime_types=gif,jpg,png`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch cats (${res.status})`);
  const data = await res.json();
  return data as CatImage[];
}

function makeButton(text: string, onClick: () => void) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function renderImages(container: HTMLElement, images: CatImage[]) {
  container.innerHTML = '';
  images.forEach(img => {
    const card = document.createElement('div');
    card.className = 'cat-card';
    const el = document.createElement('img');
    el.src = img.url;
    el.alt = 'Cat';
    el.loading = 'lazy';
    card.appendChild(el);
    container.appendChild(card);
  });
}

async function init() {
  createStyles();

  const root = document.createElement('div');
  root.className = 'cat-root';

  const controls = document.createElement('div');
  controls.className = 'controls';

  const grid = document.createElement('div');
  grid.className = 'cat-grid';

  const loadMore = makeButton('Load more', async () => {
    loadMore.disabled = true;
    loadMore.textContent = 'Loading...';
    try {
      const imgs = await fetchCatImages(12);
      // append new cards
      renderImagesAppend(grid, imgs);
    } catch (e) {
      console.error(e);
      showError(root, (e as Error).message);
    } finally {
      loadMore.disabled = false;
      loadMore.textContent = 'Load more';
    }
  });

  const refresh = makeButton('Refresh', async () => {
    refresh.disabled = true;
    refresh.textContent = 'Refreshing...';
    try {
      const imgs = await fetchCatImages(12);
      renderImages(grid, imgs);
      clearError(root);
    } catch (e) {
      console.error(e);
      showError(root, (e as Error).message);
    } finally {
      refresh.disabled = false;
      refresh.textContent = 'Refresh';
    }
  });

  controls.appendChild(refresh);
  controls.appendChild(loadMore);

  root.appendChild(controls);
  root.appendChild(grid);
  document.body.appendChild(root);

  // initial load
  try {
    const imgs = await fetchCatImages(12);
    renderImages(grid, imgs);
  } catch (e) {
    console.error(e);
    showError(root, (e as Error).message);
  }
}

function renderImagesAppend(container: HTMLElement, images: CatImage[]) {
  images.forEach(img => {
    const card = document.createElement('div');
    card.className = 'cat-card';
    const el = document.createElement('img');
    el.src = img.url;
    el.alt = 'Cat';
    el.loading = 'lazy';
    card.appendChild(el);
    container.appendChild(card);
  });
}

function showError(root: HTMLElement, message: string) {
  clearError(root);
  const p = document.createElement('div');
  p.className = 'error';
  p.textContent = `Error: ${message}`;
  root.prepend(p);
}

function clearError(root: HTMLElement) {
  const prev = root.querySelector('.error');
  if (prev) prev.remove();
}

// Auto-run when included on a page
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}