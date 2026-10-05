const data = [];

const state = {
  section: 'library',
  folder: 'root',
  search: '',
  filterType: 'any',
  filterFormats: new Set(),
  sizeMinMb: '',
  sizeMaxMb: '',
  uploadDateMode: 'any',
  uploadDateFrom: '',
  uploadDateTo: '',
  view: 'list',
  sortKey: 'modified',
  sortDir: 'desc',
  selected: new Set(),
  visibleColumns: new Set(['size', 'modified']),
  menuTarget: null,
  drawerTarget: null,
  previewVersionId: null,
  trash: [],
  lastDeleted: null,
  pendingUploads: [],
  activeUploadPlan: [],
  uploadTargetFolder: 'root',
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const els = {
  rows: $('#fileRows'), grid: $('#gridView'), list: $('#listView'), empty: $('#emptyState'),
  selectAll: $('#selectAll'), search: $('#searchInput'),
  defaultToolbar: $('#defaultToolbar'), bulkToolbar: $('#bulkToolbar'), selectedCount: $('#selectedCount'),
  bulkActions: $('#bulkActions'), menu: $('#actionMenu'), drawer: $('#detailsDrawer'), drawerContent: $('#drawerContent'),
  title: $('#pageTitle'), breadcrumbs: $('#breadcrumbs'), topActions: $('#topActions'),
  modal: $('#appModal'), modalForm: $('#modalForm'), modalTitle: $('#modalTitle'), modalSubtitle: $('#modalSubtitle'),
  modalBody: $('#modalBody'), modalActions: $('#modalActions'), modalToastStack: $('#modalToastStack'), trashCount: $('#trashCount'),
  inspectorPreview: $('#inspectorPreview'), inspectorFileName: $('#inspectorFileName'), inspectorStageMeta: $('#inspectorStageMeta'),
  drawerHeaderTitle: $('#drawerHeaderTitle'),
  sectionToggle: $('#sectionToggleButton'), newFolder: $('#newFolderButton'), upload: $('#uploadButton'),
  filterSettings: $('#filterSettingsButton'), columnSettings: $('#columnSettingsButton'), filterCount: $('#filterCount'),
  emptyFolder: $('#emptyFolderState'), folderDropZone: $('#folderDropZone'),
  directUpload: $('#directUploadInput'),
  workspaceDropZone: $('#workspaceDropZone'),
  accountButton: $('#accountMenuButton'), accountMenu: $('#accountMenu'),
  productLogo: $('#productLogoButton'),
  settingsSidebar: $('#settingsSidebar'), settingsSidebarTitle: $('#settingsSidebarTitle'),
  settingsSidebarSubtitle: $('#settingsSidebarSubtitle'), settingsSidebarBody: $('#settingsSidebarBody'),
  settingsSidebarActions: $('#settingsSidebarActions'),
};

let workspaceDragDepth = 0;
let uploadRunId = 0;
let uploadTimers = [];
let settingsSidebarMode = null;

const tones = {
  violet: ['#eeeafd', '#6342d8'], blue: ['#e8f2ff', '#2f73c8'], pink: ['#fdebf2', '#cf4d78'],
  red: ['#fff0ef', '#cf4946'], yellow: ['#fff6db', '#ac7b12'], green: ['#e5f7ef', '#16875e'],
};

function plural(number, forms) {
  const n = Math.abs(number) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1e6) return `${Math.round(bytes / 1000)} КБ`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0).replace('.', ',')} МБ`;
  return `${(bytes / 1e9).toFixed(1).replace('.', ',')} ГБ`;
}

function folderSize(folderId) {
  return data.filter(item => item.parent === folderId).reduce((total, item) => {
    return total + (item.kind === 'folder' ? folderSize(item.id) : item.size || 0);
  }, 0);
}

function itemSize(item) {
  if (item.kind !== 'folder') return formatSize(item.size);
  const bytes = folderSize(item.id);
  return bytes ? formatSize(bytes) : '0 Б';
}

function formatDate(value, long = false) {
  const date = new Date(value);
  if (long) return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  const today = new Date('2026-09-25T15:00:00');
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `Сегодня, ${date.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}`;
  if (date.toDateString() === yesterday.toDateString()) return `Вчера, ${date.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}`;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function displayName(item) {
  return item.kind === 'file' ? item.name.replace(/\.[^.]+$/, '') : item.name;
}

function itemCategory(item) {
  if (item.kind === 'folder') return 'folder';
  return item.category || 'document';
}

function itemFormat(item) {
  if (item.kind !== 'file') return '';
  const extension = item.name.includes('.') ? item.name.split('.').pop() : item.type;
  return String(extension || '').toLocaleLowerCase('ru');
}

function iconFor(item) {
  if (item.kind === 'folder') return 'icon-folder';
  if (item.category === 'image') return 'icon-image';
  if (item.category === 'video') return 'icon-play';
  return 'icon-file';
}

function previewStyle(item) {
  if (item.art) return `--art:${item.art};--thumb:#e9e7ef;`;
  const [bg, ink] = tones[item.tone || 'violet'];
  return `--thumb:${bg};--thumb-ink:${ink};`;
}

function visibleItems() {
  let items;
  if (state.section === 'trash') items = state.trash;
  else if (state.section === 'recent') items = data.filter(x => x.kind === 'file').sort((a,b) => new Date(b.modified)-new Date(a.modified));
  else if (state.section === 'favorites') items = data.filter(x => x.favorite);
  else items = data.filter(x => x.parent === state.folder);

  if (state.search) {
    const query = state.search.toLocaleLowerCase('ru');
    items = items.filter(item => `${displayName(item)} ${item.type}`.toLocaleLowerCase('ru').includes(query));
  }
  if (state.filterType !== 'any') items = items.filter(item => item.kind === state.filterType);
  if (state.filterFormats.size) items = items.filter(item => item.kind === 'file' && state.filterFormats.has(itemFormat(item)));
  if (hasSizeFilter()) items = items.filter(matchesSizeRange);
  if (hasUploadDateFilter()) items = items.filter(matchesUploadDate);

  const result = [...items].sort((a, b) => {
    if (a.kind === 'folder' && b.kind !== 'folder') return -1;
    if (b.kind === 'folder' && a.kind !== 'folder') return 1;
    let av = a[state.sortKey], bv = b[state.sortKey];
    if (state.sortKey === 'modified') { av = new Date(av); bv = new Date(bv); }
    if (typeof av === 'string') return av.localeCompare(bv, 'ru') * (state.sortDir === 'asc' ? 1 : -1);
    return (av - bv) * (state.sortDir === 'asc' ? 1 : -1);
  });
  return result;
}

function previewMarkup(item, className = '') {
  const artClass = item.category === 'image' ? 'image-preview' : item.category === 'video' ? 'video-preview' : '';
  const folderClass = item.kind === 'folder' ? 'folder-preview' : '';
  const previewIcon = item.kind === 'folder' ? 'icon-folder' : iconFor(item);
  return `<div class="preview ${artClass} ${folderClass} ${className}" style="${previewStyle(item)}">
    ${item.art ? '' : `<svg aria-hidden="true"><use href="#${previewIcon}"></use></svg>`}
  </div>`;
}

function folderObjectCount(folderId) {
  return data.filter(item => item.parent === folderId).length;
}

function secondaryLabel(item) {
  if (item.kind === 'folder') {
    const count = folderObjectCount(item.id);
    return `${count} ${plural(count, ['объект','объекта','объектов'])}`;
  }
  if (item.dimensions) return item.dimensions;
  if (item.duration) return item.duration;
  if (item.pages) return `${item.pages} ${plural(item.pages, ['страница','страницы','страниц'])}`;
  return 'Файл';
}

function nameMeta(item) {
  const detail = secondaryLabel(item);
  if (item.kind === 'folder') return detail;
  return detail === 'Файл' ? '' : detail;
}

function addedDate(item) {
  return new Date(item.added || item.modified);
}

function itemAuthor(item) {
  return item.author || 'Юлия Мякишева';
}

function itemModifiedBy(item) {
  return item.modifiedBy || item.author || 'Юлия Мякишева';
}

function hasUploadDateFilter() {
  if (state.uploadDateMode === 'single') return Boolean(state.uploadDateFrom);
  if (state.uploadDateMode === 'period') return Boolean(state.uploadDateFrom && state.uploadDateTo);
  return false;
}

function matchesUploadDate(item) {
  if (!hasUploadDateFilter()) return true;
  const itemDate = addedDate(item);
  const start = new Date(`${state.uploadDateFrom}T00:00:00`);
  if (state.uploadDateMode === 'single') {
    const end = new Date(`${state.uploadDateFrom}T23:59:59.999`);
    return itemDate >= start && itemDate <= end;
  }
  const end = new Date(`${state.uploadDateTo}T23:59:59.999`);
  return itemDate >= start && itemDate <= end;
}

function hasSizeFilter() {
  return state.sizeMinMb !== '' || state.sizeMaxMb !== '';
}

function matchesSizeRange(item) {
  if (!hasSizeFilter()) return true;
  if (item.kind !== 'file') return false;
  const sizeMb = (item.size || 0) / 1e6;
  if (state.sizeMinMb !== '' && sizeMb < Number(state.sizeMinMb)) return false;
  if (state.sizeMaxMb !== '' && sizeMb > Number(state.sizeMaxMb)) return false;
  return true;
}

function rowMarkup(item) {
  return `<tr data-id="${item.id}" class="${state.selected.has(item.id) ? 'selected' : ''}">
    <td class="check-column"><input class="row-check" type="checkbox" aria-label="Выбрать ${escapeHtml(displayName(item))}" ${state.selected.has(item.id) ? 'checked' : ''}></td>
    <td class="name-cell"><button class="asset-name-button" data-open="${item.id}">${previewMarkup(item)}<span class="asset-name-copy"><span class="name-button">${escapeHtml(item.name)}</span>${nameMeta(item) ? `<small>${escapeHtml(nameMeta(item))}</small>` : ''}</span></button></td>
    <td data-column="size">${itemSize(item)}</td>
    <td data-column="modified">${formatDate(item.modified)}</td>
    <td data-column="author">${escapeHtml(itemAuthor(item))}</td>
    <td data-column="created">${formatDate(item.added || item.modified)}</td>
    <td data-column="modifiedBy">${escapeHtml(itemModifiedBy(item))}</td>
    <td class="menu-column"><button class="icon-button row-more" data-menu="${item.id}" aria-label="Действия с ${escapeHtml(displayName(item))}"><svg aria-hidden="true"><use href="#icon-more"></use></svg></button></td>
  </tr>`;
}

function renderRows(items) {
  els.rows.innerHTML = items.map(rowMarkup).join('');
}

function cardMarkup(item) {
  return `<article class="asset-card ${state.selected.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
    <label class="card-check"><input class="row-check" type="checkbox" aria-label="Выбрать ${escapeHtml(displayName(item))}" ${state.selected.has(item.id) ? 'checked' : ''}></label>
    <button class="icon-button card-more" data-menu="${item.id}" aria-label="Действия с ${escapeHtml(displayName(item))}"><svg aria-hidden="true"><use href="#icon-more"></use></svg></button>
    <div class="asset-card-visual ${item.kind === 'folder' ? 'folder-card-visual' : ''}" style="${previewStyle(item)}" data-open="${item.id}"><svg aria-hidden="true"><use href="#${item.kind === 'folder' ? 'icon-folder' : iconFor(item)}"></use></svg></div>
    <div class="asset-card-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.kind === 'folder' ? secondaryLabel(item) : formatSize(item.size))}</small></div>
  </article>`;
}

function renderGrid(items) {
  els.grid.innerHTML = items.map(cardMarkup).join('');
}

function renderHeader() {
  const folder = data.find(x => x.id === state.folder);
  const sectionNames = { library: folder ? folder.name : 'Все файлы', recent: 'Недавние', favorites: 'Избранное', trash: 'Корзина' };
  els.title.textContent = sectionNames[state.section];
  els.topActions.hidden = false;
  els.newFolder.hidden = state.section !== 'library';
  els.upload.hidden = state.section !== 'library';
  els.sectionToggle.innerHTML = state.section === 'trash'
    ? `<svg aria-hidden="true"><use href="#icon-library"></use></svg><span>Все файлы</span>`
    : `<svg aria-hidden="true"><use href="#icon-trash"></use></svg><span>Корзина${state.trash.length ? ` · ${state.trash.length}` : ''}</span>`;
  if (state.section === 'library') {
    const path = [];
    let cursor = folder;
    while (cursor) {
      path.unshift(cursor);
      cursor = cursor.parent === 'root' ? null : data.find(x => x.id === cursor.parent);
    }
    const crumbs = [{ id: 'root', name: 'Все файлы' }, ...path];
    const insideFolder = crumbs.length > 1;
    els.title.hidden = insideFolder;
    els.breadcrumbs.hidden = !insideFolder;
    els.breadcrumbs.innerHTML = crumbs.map((crumb, index) => index === crumbs.length - 1
      ? `<span class="breadcrumb-current" aria-current="page" title="${escapeHtml(crumb.name)}">${escapeHtml(crumb.name)}</span>`
      : `<button class="breadcrumb-button" data-folder="${crumb.id}" title="${escapeHtml(crumb.name)}">${escapeHtml(crumb.name)}</button><span class="breadcrumb-separator" aria-hidden="true">/</span>`).join('');
  } else {
    els.title.hidden = false;
    els.breadcrumbs.hidden = true;
    els.breadcrumbs.innerHTML = '';
  }
  $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.section === state.section));
}

function renderBulk(items) {
  const totalSelected = state.selected.size;
  els.bulkToolbar.hidden = totalSelected === 0;
  els.selectedCount.textContent = `Выбрано ${totalSelected}`;
  els.selectAll.checked = items.length > 0 && items.every(item => state.selected.has(item.id));
  els.selectAll.indeterminate = totalSelected > 0 && !els.selectAll.checked;
  const isTrash = state.section === 'trash';
  els.bulkActions.innerHTML = isTrash ? `
    <button class="icon-button" data-bulk="restore" aria-label="Восстановить" title="Восстановить"><svg aria-hidden="true"><use href="#icon-undo"></use></svg></button>
    <button class="icon-button danger-icon" data-bulk="deleteForever" aria-label="Удалить навсегда" title="Удалить навсегда"><svg aria-hidden="true"><use href="#icon-trash"></use></svg></button>` : `
    <button class="icon-button" data-bulk="download" aria-label="Скачать" title="Скачать"><svg aria-hidden="true"><use href="#icon-download"></use></svg></button>
    <button class="icon-button danger-icon" data-bulk="delete" aria-label="Удалить" title="Удалить"><svg aria-hidden="true"><use href="#icon-trash"></use></svg></button>`;
}

function applyColumnVisibility() {
  ['size', 'modified', 'author', 'created', 'modifiedBy'].forEach(column => {
    $$(`[data-column="${column}"]`).forEach(cell => { cell.hidden = !state.visibleColumns.has(column); });
  });
  const hasOptionalColumns = ['author', 'created', 'modifiedBy'].some(column => state.visibleColumns.has(column));
  els.list.classList.toggle('has-extra-columns', hasOptionalColumns);
}

function render() {
  const items = visibleItems();
  const hasMainFilter = state.filterType !== 'any' || state.filterFormats.size > 0 || hasSizeFilter();
  const isEmptyLibrary = items.length === 0 && state.section === 'library' && !state.search && !hasMainFilter && !hasUploadDateFilter();
  renderHeader();
  renderRows(items);
  renderGrid(items);
  renderBulk(items);
  applyColumnVisibility();
  els.list.classList.toggle('empty-list', isEmptyLibrary);
  els.list.hidden = state.view !== 'list' || (items.length === 0 && !isEmptyLibrary);
  els.grid.hidden = state.view !== 'grid' || items.length === 0;
  els.empty.hidden = items.length > 0 || isEmptyLibrary;
  els.emptyFolder.hidden = !isEmptyLibrary;
  els.trashCount.textContent = state.trash.length;
  const activeFilterCount = (state.filterType !== 'any' ? 1 : 0) + (state.filterFormats.size ? 1 : 0) + (hasSizeFilter() ? 1 : 0) + (hasUploadDateFilter() ? 1 : 0);
  els.filterCount.textContent = activeFilterCount;
  els.filterCount.hidden = activeFilterCount === 0;
  els.filterSettings.classList.toggle('active', activeFilterCount > 0);
  $$('.view-switcher .icon-button').forEach(btn => btn.classList.toggle('active', btn.dataset.view === state.view));
  $$('.sort-button').forEach(btn => {
    btn.classList.toggle('sorted', btn.dataset.sort === state.sortKey);
    const marker = $('span', btn);
    marker.textContent = btn.dataset.sort === state.sortKey ? (state.sortDir === 'asc' ? '↑' : '↓') : '↕';
  });
}

function findItem(id) {
  return data.find(x => x.id === Number(id)) || state.trash.find(x => x.id === Number(id));
}

function selectItem(id, checked) {
  checked ? state.selected.add(Number(id)) : state.selected.delete(Number(id));
  render();
}

function openItem(item) {
  closeMenu();
  if (item.kind === 'folder' && state.section === 'library') {
    state.folder = item.id;
    state.selected.clear();
    render();
    return;
  }
  if (item.kind === 'file') openPreview(item);
}

function setInspectorPreview(item, meta = 'Предпросмотр файла') {
  els.inspectorFileName.textContent = item.name;
  els.inspectorStageMeta.textContent = meta;
  els.inspectorPreview.className = `inspector-preview ${item.art ? 'image-art' : ''}`;
  els.inspectorPreview.style.cssText = item.art ? `--art:${item.art}` : previewStyle(item);
  els.inspectorPreview.innerHTML = item.art ? '' : `<svg aria-hidden="true"><use href="#${iconFor(item)}"></use></svg>`;
}

function showInspector(item, { previewOnly = false, meta = 'Предпросмотр файла' } = {}) {
  closeSettingsSidebar();
  state.drawerTarget = item.id;
  state.previewVersionId = null;
  els.drawer.classList.remove('version-history-mode');
  els.drawer.classList.remove('folder-information');
  els.drawer.classList.remove('information-mode');
  els.drawer.classList.toggle('preview-only', previewOnly);
  setInspectorPreview(item, meta);
  els.drawer.classList.add('open');
  els.drawer.setAttribute('aria-hidden', 'false');
}

function openPreview(item) {
  if (item.kind !== 'file') return;
  showInspector(item, { previewOnly: true });
  els.drawerContent.replaceChildren();
}

function itemLocation(item) {
  if (item.parent === 'root') return 'Все файлы';
  return data.find(folder => folder.id === item.parent)?.name || 'Все файлы';
}

function openInformation(item) {
  showInspector(item, { meta: item.kind === 'folder' ? 'Информация о папке' : 'Предпросмотр файла' });
  els.drawer.classList.add('information-mode');
  els.drawer.classList.toggle('folder-information', item.kind === 'folder');
  els.drawerHeaderTitle.textContent = item.kind === 'folder' ? 'Информация о папке' : 'Информация о файле';
  const facts = item.kind === 'folder' ? `
    <div class="file-fact"><span>Тип</span><strong>Папка</strong></div>
    <div class="file-fact"><span>Содержимое</span><strong>${escapeHtml(secondaryLabel(item))}</strong></div>
    <div class="file-fact"><span>Размер</span><strong>${escapeHtml(itemSize(item))}</strong></div>` : `
    <div class="file-fact"><span>Тип файла</span><strong>${escapeHtml(item.type)}</strong></div>
    <div class="file-fact"><span>Размер</span><strong>${formatSize(item.size)}</strong></div>
    ${item.dimensions ? `<div class="file-fact"><span>Разрешение</span><strong>${escapeHtml(item.dimensions)}</strong></div>` : ''}
    ${item.duration ? `<div class="file-fact"><span>Длительность</span><strong>${escapeHtml(item.duration)}</strong></div>` : ''}
    ${item.pages ? `<div class="file-fact"><span>Страниц</span><strong>${item.pages}</strong></div>` : ''}`;
  els.drawerContent.innerHTML = `
    <div class="drawer-copy">
      <div class="settings-section">
        <div class="drawer-name-line">
          <h2>${escapeHtml(item.name)}</h2>
          <button class="icon-button favorite-button ${item.favorite ? 'active' : ''}" data-favorite="${item.id}" aria-label="${item.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}"><svg aria-hidden="true"><use href="#icon-star"></use></svg></button>
        </div>
      </div>
      <div class="settings-section">
        <h3>Описание</h3>
        <p class="information-description">${escapeHtml(item.description || (item.kind === 'folder' ? 'Папка для хранения и организации материалов.' : 'Описание не добавлено.'))}</p>
      </div>
      <div class="settings-section">
        <h3>${item.kind === 'folder' ? 'О папке' : 'О файле'}</h3>
        <div class="file-facts">
          ${facts}
          <div class="file-fact"><span>Расположение</span><strong>${escapeHtml(itemLocation(item))}</strong></div>
          <div class="file-fact"><span>Дата изменения</span><strong>${formatDate(item.modified, true)}</strong></div>
          <div class="file-fact"><span>Автор изменений</span><strong>Юлия Мякишева</strong></div>
        </div>
      </div>
    </div>`;
}

function closeDrawer() {
  els.drawer.classList.remove('open');
  els.drawer.classList.remove('preview-only');
  els.drawer.classList.remove('folder-information');
  els.drawer.classList.remove('version-history-mode');
  els.drawer.classList.remove('information-mode');
  els.drawer.setAttribute('aria-hidden', 'true');
  state.drawerTarget = null;
  state.previewVersionId = null;
}

function openMenu(item, button) {
  state.menuTarget = item.id;
  const isTrash = state.section === 'trash';
  els.menu.innerHTML = isTrash ? `
    <button class="menu-item" data-action="information"><svg><use href="#icon-info"></use></svg>Информация</button>
    <button class="menu-item" data-action="restore"><svg><use href="#icon-undo"></use></svg>Восстановить</button>
    <button class="menu-item danger" data-action="deleteForever"><svg><use href="#icon-trash"></use></svg>Удалить навсегда</button>` : `
    <button class="menu-item" data-action="download"><svg><use href="#icon-download"></use></svg>Скачать</button>
    <button class="menu-item" data-action="copyLink"><svg><use href="#icon-link"></use></svg>Копировать ссылку</button>
    <button class="menu-item" data-action="information"><svg><use href="#icon-info"></use></svg>Информация</button>
    <button class="menu-item" data-action="rename"><svg><use href="#icon-file"></use></svg>Переименовать</button>
    <div class="menu-separator"></div>
    <button class="menu-item danger" data-action="delete"><svg><use href="#icon-trash"></use></svg>Удалить</button>`;
  const rect = button.getBoundingClientRect();
  els.menu.hidden = false;
  const width = 205;
  const left = Math.min(rect.right - width, window.innerWidth - width - 12);
  const height = els.menu.offsetHeight;
  const top = Math.min(rect.bottom + 5, window.innerHeight - height - 12);
  els.menu.style.left = `${Math.max(12, left)}px`;
  els.menu.style.top = `${Math.max(12, top)}px`;
}

function closeMenu() { els.menu.hidden = true; state.menuTarget = null; }

function showModal({ title, subtitle = '', body, actions, wide = false, auth = false }) {
  els.modal.classList.toggle('modal-wide', wide);
  els.modal.classList.toggle('modal-auth', auth);
  els.modalTitle.textContent = title;
  els.modalSubtitle.textContent = subtitle;
  els.modalBody.innerHTML = body;
  els.modalActions.innerHTML = actions;
  if (!els.modal.open) els.modal.showModal();
}

function closeModal() {
  if (els.modal.open) els.modal.close();
  els.modalToastStack.replaceChildren();
}

function openSettingsSidebar({ mode, title, subtitle = '', body, actions }) {
  closeMenu();
  closeDrawer();
  settingsSidebarMode = mode;
  els.settingsSidebarTitle.textContent = title;
  els.settingsSidebarSubtitle.textContent = subtitle;
  els.settingsSidebarBody.innerHTML = body;
  els.settingsSidebarActions.innerHTML = actions;
  els.settingsSidebar.classList.add('open');
  els.settingsSidebar.setAttribute('aria-hidden', 'false');
  els.filterSettings.classList.toggle('active', mode === 'filters');
  els.columnSettings.classList.toggle('active', mode === 'columns');
}

function closeSettingsSidebar() {
  settingsSidebarMode = null;
  els.settingsSidebar.classList.remove('open');
  els.settingsSidebar.setAttribute('aria-hidden', 'true');
  els.filterSettings.classList.remove('active');
  els.columnSettings.classList.remove('active');
}

function openAllFiles() {
  closeMenu();
  closeSettingsSidebar();
  state.section = 'library';
  state.folder = 'root';
  state.selected.clear();
  state.search = '';
  els.search.value = '';
  closeDrawer();
  render();
}

function loginModal() {
  document.body.classList.add('signed-out');
  showModal({
    title: 'Вход в Медиахранилище',
    subtitle: 'Продолжите с помощью Сбер ID',
    auth: true,
    body: `<div class="sber-login">
      <span class="sber-login-mark" aria-hidden="true">✓</span>
      <div class="sber-login-copy">
        <strong>Один аккаунт для удобного входа</strong>
        <p>Войдите через Сбер ID, чтобы вернуться к файлам и папкам.</p>
      </div>
    </div>`,
    actions: `<button class="sber-id-button" type="button" id="sberIdLogin"><span class="sber-id-button-mark" aria-hidden="true">✓</span><span>Войти по Сбер ID</span></button>`,
  });
}

const availableFileFormats = ['ai', 'svg', 'png', 'pdf', 'mp4', 'zip', 'gif', 'jpg', 'mov', 'mb', 'xlsx', 'cube', 'c4d', 'tif', 'tiff', 'wav', 'otf', 'ttf', 'web', 'aep', 'rar'];

function formatSelectionText(values) {
  const selected = [...values];
  if (!selected.length) return 'Выберите формат файла';
  if (selected.length <= 3) return selected.map(value => value.toUpperCase()).join(', ');
  return `Выбрано форматов: ${selected.length}`;
}

function formatSelectionMarkup(values, disabled = false) {
  const selected = [...values];
  if (disabled) return '<span class="format-placeholder">Для папок формат не применяется</span>';
  if (!selected.length) return '<span class="format-placeholder">Выберите формат файла</span>';
  return selected.map(value => `<button class="format-chip" type="button" data-remove-format="${value}" aria-label="Убрать формат ${value.toUpperCase()}"><span>${value.toUpperCase()}</span><svg aria-hidden="true"><use href="#icon-close"></use></svg></button>`).join('');
}

function updateFormatMultiselect() {
  const inputs = $$('input[name="fileFormat"]:checked', els.settingsSidebarBody);
  const values = inputs.map(input => input.value);
  const value = $('#formatMultiselectValue', els.settingsSidebarBody);
  const isFolder = $('#assetTypeSelect', els.settingsSidebarBody)?.value === 'folder';
  if (value) value.innerHTML = formatSelectionMarkup(values, isFolder);
  const control = $('#formatMultiselectControl', els.settingsSidebarBody);
  const button = $('#formatMultiselectButton', els.settingsSidebarBody);
  control?.classList.toggle('disabled', isFolder);
  if (button) {
    button.disabled = isFolder;
    button.setAttribute('aria-label', isFolder ? 'Для папок формат не применяется' : formatSelectionText(values));
  }
  const clearButton = $('#clearAllFormats', els.settingsSidebarBody);
  if (clearButton) clearButton.disabled = values.length === 0;
  $$('.format-option', els.settingsSidebarBody).forEach(option => {
    option.classList.toggle('selected', $('input', option).checked);
  });
}

function filterSettingsModal() {
  openSettingsSidebar({
    mode: 'filters', title: 'Фильтры', subtitle: 'Настройте тип, формат, размер и дату загрузки',
    body: `<section class="filter-settings-section">
      <label class="filter-control-label" for="assetTypeSelect">Тип</label>
      <div class="filter-select-shell">
        <select class="filter-select" id="assetTypeSelect">
          <option value="any" ${state.filterType === 'any' ? 'selected' : ''}>Выберите тип</option>
          <option value="file" ${state.filterType === 'file' ? 'selected' : ''}>Файл</option>
          <option value="folder" ${state.filterType === 'folder' ? 'selected' : ''}>Папка</option>
        </select>
        <svg aria-hidden="true"><use href="#icon-chevron"></use></svg>
      </div>
      <div class="filter-control-group">
        <span class="filter-control-label">Формат</span>
        <div class="filter-multiselect" id="formatMultiselect">
          <div class="filter-select-button ${state.filterType === 'folder' ? 'disabled' : ''}" id="formatMultiselectControl">
            <div class="format-selected-values" id="formatMultiselectValue">${formatSelectionMarkup(state.filterFormats, state.filterType === 'folder')}</div>
            <button class="format-multiselect-toggle" id="formatMultiselectButton" type="button" aria-expanded="false" aria-controls="formatMultiselectMenu" aria-label="${state.filterType === 'folder' ? 'Для папок формат не применяется' : formatSelectionText(state.filterFormats)}" ${state.filterType === 'folder' ? 'disabled' : ''}>
              <svg aria-hidden="true"><use href="#icon-chevron"></use></svg>
            </button>
          </div>
          <div class="filter-multiselect-menu" id="formatMultiselectMenu" hidden>
            <div class="format-menu-header"><strong>Форматы файлов</strong><button id="clearAllFormats" type="button" ${state.filterFormats.size ? '' : 'disabled'}>Сбросить все</button></div>
            <div class="format-option-list">${availableFileFormats.map(format => `<label class="format-option ${state.filterFormats.has(format) ? 'selected' : ''}"><input type="checkbox" name="fileFormat" value="${format}" ${state.filterFormats.has(format) ? 'checked' : ''}><span>${format.toUpperCase()}</span></label>`).join('')}</div>
          </div>
        </div>
      </div>
      <div class="filter-control-group ${state.filterType === 'folder' ? 'disabled' : ''}" id="sizeFilterGroup">
        <span class="filter-control-label">Диапазон размера файла в МБ</span>
        <div class="size-filter-range">
          <label class="size-filter-input"><input id="sizeMinMb" type="number" min="0" step="0.1" inputmode="decimal" placeholder="От" aria-label="Минимальный размер файла в МБ" value="${state.sizeMinMb}" ${state.filterType === 'folder' ? 'disabled' : ''}><span>МБ</span></label>
          <span class="size-filter-separator" aria-hidden="true">—</span>
          <label class="size-filter-input"><input id="sizeMaxMb" type="number" min="0" step="0.1" inputmode="decimal" placeholder="До" aria-label="Максимальный размер файла в МБ" value="${state.sizeMaxMb}" ${state.filterType === 'folder' ? 'disabled' : ''}><span>МБ</span></label>
        </div>
        <p class="size-filter-hint">Можно указать обе границы или только одну.</p>
      </div>
    </section>
    <section class="filter-settings-section">
      <div class="filter-settings-heading"><strong>Дата загрузки</strong><small>День или период</small></div>
      <div class="date-filter-modes" role="radiogroup" aria-label="Режим фильтра по дате загрузки">
        <label class="date-filter-mode ${state.uploadDateMode === 'any' ? 'selected' : ''}"><input type="radio" name="uploadDateMode" value="any" ${state.uploadDateMode === 'any' ? 'checked' : ''}><span>Любая дата</span></label>
        <label class="date-filter-mode ${state.uploadDateMode === 'single' ? 'selected' : ''}"><input type="radio" name="uploadDateMode" value="single" ${state.uploadDateMode === 'single' ? 'checked' : ''}><span>Дата</span></label>
        <label class="date-filter-mode ${state.uploadDateMode === 'period' ? 'selected' : ''}"><input type="radio" name="uploadDateMode" value="period" ${state.uploadDateMode === 'period' ? 'checked' : ''}><span>Период</span></label>
      </div>
      <div class="date-filter-fields" data-date-fields="single" ${state.uploadDateMode === 'single' ? '' : 'hidden'}>
        <label class="date-filter-field"><span>Дата загрузки</span><input id="uploadDateSingle" type="date" value="${state.uploadDateMode === 'single' ? state.uploadDateFrom : ''}"></label>
      </div>
      <div class="date-filter-fields date-filter-range" data-date-fields="period" ${state.uploadDateMode === 'period' ? '' : 'hidden'}>
        <label class="date-filter-field"><span>С</span><input id="uploadDateFrom" type="date" value="${state.uploadDateMode === 'period' ? state.uploadDateFrom : ''}"></label>
        <label class="date-filter-field"><span>По</span><input id="uploadDateTo" type="date" value="${state.uploadDateMode === 'period' ? state.uploadDateTo : ''}"></label>
      </div>
    </section>`,
    actions: `<button class="button button-secondary" type="button" id="resetFilterSettings">Сбросить</button><button class="button button-primary" type="button" id="applyFilterSettings">Применить</button>`,
  });
}

function columnSettingsModal() {
  const columns = [
    ['size', 'Размер'],
    ['modified', 'Дата изменения'],
    ['author', 'Автор'],
    ['created', 'Дата создания'],
    ['modifiedBy', 'Кем изменено'],
  ];
  openSettingsSidebar({
    mode: 'columns', title: 'Колонки', subtitle: 'Выберите данные, которые будут показаны в таблице',
    body: `<div class="column-option-list"><label class="column-option locked"><input type="checkbox" checked disabled><span>Название с превью</span><small>Обязательная колонка</small></label>${columns.map(([value, label]) => `<label class="column-option"><input type="checkbox" name="visibleColumn" value="${value}" ${state.visibleColumns.has(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>`,
    actions: `<button class="button button-secondary" type="button" id="cancelColumnSettings">Отмена</button><button class="button button-primary" type="button" id="applyColumnSettings">Применить</button>`,
  });
}

function resetFilterSettings() {
  state.filterType = 'any';
  state.filterFormats.clear();
  state.sizeMinMb = '';
  state.sizeMaxMb = '';
  state.uploadDateMode = 'any';
  state.uploadDateFrom = '';
  state.uploadDateTo = '';
  state.selected.clear();
  closeSettingsSidebar();
  render();
  toast('Фильтры сброшены');
}

function applyFilterSettings() {
  const filterType = $('#assetTypeSelect', els.settingsSidebarBody)?.value || 'any';
  const sizeMinMb = filterType === 'folder' ? '' : ($('#sizeMinMb', els.settingsSidebarBody)?.value || '');
  const sizeMaxMb = filterType === 'folder' ? '' : ($('#sizeMaxMb', els.settingsSidebarBody)?.value || '');
  const uploadDateMode = $('input[name="uploadDateMode"]:checked', els.settingsSidebarBody)?.value || 'any';
  const singleDate = $('#uploadDateSingle', els.settingsSidebarBody)?.value || '';
  const periodFrom = $('#uploadDateFrom', els.settingsSidebarBody)?.value || '';
  const periodTo = $('#uploadDateTo', els.settingsSidebarBody)?.value || '';
  if (uploadDateMode === 'single' && !singleDate) { toast('Выберите дату загрузки'); return; }
  if (uploadDateMode === 'period' && (!periodFrom || !periodTo)) { toast('Укажите начало и конец периода'); return; }
  if (uploadDateMode === 'period' && periodFrom > periodTo) { toast('Начало периода должно быть раньше окончания'); return; }
  if ((sizeMinMb !== '' && Number(sizeMinMb) < 0) || (sizeMaxMb !== '' && Number(sizeMaxMb) < 0)) { toast('Размер не может быть отрицательным'); return; }
  if (sizeMinMb !== '' && sizeMaxMb !== '' && Number(sizeMinMb) > Number(sizeMaxMb)) { toast('Минимальный размер должен быть меньше максимального'); return; }
  state.filterType = filterType;
  state.filterFormats = state.filterType === 'folder' ? new Set() : new Set($$('input[name="fileFormat"]:checked', els.settingsSidebarBody).map(input => input.value));
  state.sizeMinMb = sizeMinMb;
  state.sizeMaxMb = sizeMaxMb;
  state.uploadDateMode = uploadDateMode;
  state.uploadDateFrom = uploadDateMode === 'single' ? singleDate : uploadDateMode === 'period' ? periodFrom : '';
  state.uploadDateTo = uploadDateMode === 'period' ? periodTo : '';
  state.selected.clear();
  closeSettingsSidebar();
  render();
  toast('Настройки применены');
}

function applyColumnSettings() {
  state.visibleColumns = new Set($$('input[name="visibleColumn"]:checked', els.settingsSidebarBody).map(input => input.value));
  closeSettingsSidebar();
  render();
  toast('Колонки обновлены');
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  toast(successMessage);
}

function copyItemLink(item) {
  const link = `${location.origin}${location.pathname}#asset-${item.id}`;
  copyText(link, `Ссылка на «${displayName(item)}» скопирована`);
}

function copySelectionLinks(ids) {
  const links = ids.map(id => `${location.origin}${location.pathname}#asset-${id}`).join('\n');
  copyText(links, `${ids.length} ${plural(ids.length, ['ссылка скопирована', 'ссылки скопированы', 'ссылок скопировано'])}`);
}

function accessRoleOptions(selected = 'view') {
  return [
    ['view', 'Просмотр'],
    ['comment', 'Комментирование'],
    ['edit', 'Редактирование'],
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function accessInitials(email) {
  return email.split('@')[0].replace(/[^a-zа-яё0-9]/gi, '').slice(0, 2).toUpperCase() || 'У';
}

function accessModal(item) {
  item.accessPeople ||= [];
  const objectLabel = item.kind === 'folder' ? 'папке' : 'файлу';
  const linkLabel = item.kind === 'folder' ? 'Ссылка на папку' : 'Ссылка на файл';
  showModal({
    title: `Доступ к ${objectLabel}`,
    subtitle: item.name,
    body: `<div class="access-panel">
      <section class="access-section">
        <label class="access-section-title" for="accessEmail">Электронная почта</label>
        <div class="access-invite-row">
          <input id="accessEmail" type="email" placeholder="name@company.ru" autocomplete="off">
          <button class="button button-primary" type="button" id="inviteByEmail" data-id="${item.id}">Пригласить</button>
        </div>
      </section>
      <section class="access-section">
        <div class="access-section-title">Участники</div>
        <div class="access-people-list">
          <div class="access-person"><span class="access-avatar">ЮМ</span><div><strong>Юлия Мякишева</strong><small>Владелец</small></div><span>Полный доступ</span></div>
          ${item.accessPeople.map(person => `<div class="access-person" data-access-email="${escapeHtml(person.email)}"><span class="access-avatar soft">${escapeHtml(accessInitials(person.email))}</span><div><strong>${escapeHtml(person.email)}</strong><small>Приглашён по почте</small></div><select class="participant-role-select" data-id="${item.id}" data-email="${escapeHtml(person.email)}" aria-label="Права для ${escapeHtml(person.email)}">${accessRoleOptions(person.role)}</select></div>`).join('')}
        </div>
      </section>
    </div>`,
    actions: `<button class="access-copy-link" type="button" id="copyAccessLink" data-id="${item.id}"><svg aria-hidden="true"><use href="#icon-link"></use></svg>${linkLabel}</button><span class="modal-action-spacer"></span><button class="button button-secondary" value="cancel">Отмена</button><button class="button button-primary" value="cancel">Готово</button>`,
  });
}

function newFolderModal() {
  showModal({
    title: 'Новая папка', subtitle: 'Папка появится в текущем разделе',
    body: `<label class="field-label">Название папки<input class="field-input" id="folderName" maxlength="80" placeholder="Например, Материалы кампании" autofocus></label><p class="field-help">Название должно быть уникальным внутри текущей папки.</p>`,
    actions: `<button class="button button-secondary" value="cancel">Отмена</button><button class="button button-primary" type="button" id="createFolder">Создать папку</button>`
  });
  setTimeout(() => $('#folderName')?.focus(), 50);
}

function uploadModal() {
  showModal({
    title: 'Загрузить файлы', subtitle: 'Поддерживаются изображения, видео, документы и архивы',
    body: `<div class="drop-zone" id="dropZone"><span class="drop-zone-icon"><svg><use href="#icon-upload"></use></svg></span><strong>Перетащите файлы сюда</strong><p>или выберите их на компьютере</p><button class="button button-secondary" type="button" id="chooseFiles">Выбрать файлы</button><input id="fileInput" type="file" multiple hidden><button class="demo-link" type="button" id="demoDuplicate">Показать сценарий с дубликатом</button></div>`,
    actions: `<button class="button button-secondary" value="cancel">Закрыть</button>`
  });
}

function processFiles(files) {
  if (!files.length) return;
  const duplicate = files.find(file => data.some(item => item.name.toLowerCase() === file.name.toLowerCase()));
  if (duplicate) return duplicateModal(duplicate.name);
  els.modalBody.innerHTML = files.map((file, i) => `<div class="history-item"><span class="history-dot"></span><div><strong>${escapeHtml(file.name)}</strong><small>Загрузка завершена</small></div><time>${formatSize(file.size)}</time></div>`).join('');
  els.modalActions.innerHTML = `<button class="button button-primary" type="button" id="finishUpload">Готово</button>`;
  files.forEach((file, index) => {
    const now = new Date().toISOString();
    data.push({ id: Date.now() + index, parent: state.folder, kind: 'file', name: file.name, type: file.name.split('.').pop().toUpperCase() || 'Файл', category: file.type.startsWith('image') ? 'image' : file.type.startsWith('video') ? 'video' : 'document', modified: now, added: now, author: 'Юлия Мякишева', modifiedBy: 'Юлия Мякишева', size: file.size, favorite: false, tone: 'blue' });
  });
  render();
}

function queueUploadFiles(files, append = false, autoStart = false) {
  const validFiles = files.filter(file => file && typeof file.name === 'string' && file.name.trim());
  const rejectedCount = files.length - validFiles.length;
  if (rejectedCount) toast(`${rejectedCount} ${plural(rejectedCount, ['объект не удалось добавить', 'объекта не удалось добавить', 'объектов не удалось добавить'])}`, null, null, 'error');
  if (!validFiles.length) {
    toast('Не удалось распознать файлы. Попробуйте выбрать их через кнопку «Загрузить»', null, null, 'error');
    return;
  }
  if (!append) state.uploadTargetFolder = state.folder;
  const previous = append ? state.pendingUploads : [];
  const stamp = Date.now();
  const next = validFiles.map((file, index) => {
    const duplicate = data.find(item => item.parent === state.uploadTargetFolder && item.kind === 'file' && item.name.toLowerCase() === file.name.toLowerCase());
    return {
      id: `${stamp}-${index}`,
      file,
      name: file.name,
      size: file.size,
      selected: true,
      duplicateId: duplicate?.id || null,
      action: duplicate ? 'version' : 'new',
    };
  });
  state.pendingUploads = [...previous, ...next];
  els.directUpload.value = '';
  if (autoStart && !next.some(item => item.duplicateId)) startUploadProgress();
  else showUploadSelectionModal();
}

function uploadActionOptions(selected = 'version') {
  return [
    ['version', 'Загрузить новую версию'],
    ['separate', 'Сохранить как отдельный файл'],
    ['skip', 'Не загружать'],
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function uploadFileIcon(name) {
  const extension = name.includes('.') ? name.split('.').pop().toUpperCase() : 'FILE';
  return `<span class="upload-file-icon"><svg aria-hidden="true"><use href="#icon-file"></use></svg><small>${escapeHtml(extension.slice(0, 4))}</small></span>`;
}

function showUploadSelectionModal() {
  const selected = state.pendingUploads.filter(item => item.selected);
  const duplicates = selected.filter(item => item.duplicateId);
  const regularCount = selected.length - duplicates.length;
  const duplicateBlock = duplicates.length ? `
    <div class="duplicate-alert">
      <span class="duplicate-alert-icon">!</span>
      <div><strong>${duplicates.length} ${plural(duplicates.length, ['файл уже есть', 'файла уже есть', 'файлов уже есть'])} в этой папке</strong><p>Выберите, что с ними сделать. ${regularCount ? `Остальные ${regularCount} ${plural(regularCount, ['файл загрузится', 'файла загрузятся', 'файлов загрузятся'])} как обычно.` : ''}</p></div>
    </div>
    <label class="duplicate-global-action"><span>Для всех совпадений</span><select id="allDuplicateAction">${uploadActionOptions()}</select></label>` : '';
  showModal({
    title: 'Загрузка и публикация файлов',
    subtitle: `${selected.length} ${plural(selected.length, ['файл выбран', 'файла выбрано', 'файлов выбрано'])}`,
    wide: true,
    body: `${duplicateBlock}<div class="upload-selection-list" id="uploadSelectionList">${state.pendingUploads.map(item => {
      const existing = item.duplicateId ? findItem(item.duplicateId) : null;
      return `<div class="upload-selection-row ${item.duplicateId ? 'has-duplicate' : ''}" data-upload-id="${item.id}">
        <input class="pending-upload-check" type="checkbox" ${item.selected ? 'checked' : ''} aria-label="Добавить ${escapeHtml(item.name)} в загрузку">
        ${uploadFileIcon(item.name)}
        <div class="upload-file-copy"><strong>${escapeHtml(item.name)}</strong><small>${formatSize(item.size)}${existing ? ` · совпадает с файлом от ${formatDate(existing.modified)}` : ' · готов к загрузке'}</small></div>
        ${item.duplicateId ? `<select class="duplicate-action-select" aria-label="Действие для ${escapeHtml(item.name)}">${uploadActionOptions(item.action)}</select>` : '<span aria-hidden="true"></span>'}
        <button class="icon-button remove-upload" type="button" data-remove-upload="${item.id}" aria-label="Убрать ${escapeHtml(item.name)}"><svg aria-hidden="true"><use href="#icon-close"></use></svg></button>
      </div>`;
    }).join('')}</div>`,
    actions: `<button class="button button-secondary upload-add-more" type="button" id="addMoreUploads"><svg aria-hidden="true"><use href="#icon-upload"></use></svg>Добавить файлы</button><span class="modal-action-spacer"></span><button class="button button-secondary" value="cancel">Отмена</button><button class="button button-primary" type="button" id="continueUpload" ${selected.length ? '' : 'disabled'}>Продолжить</button>`,
  });
}

function uniqueUploadName(name, folderId = state.uploadTargetFolder) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let index = 1;
  let candidate = `${base} (${index})${extension}`;
  while (data.some(item => item.parent === folderId && item.name.toLowerCase() === candidate.toLowerCase())) {
    index += 1;
    candidate = `${base} (${index})${extension}`;
  }
  return candidate;
}

function createUploadedItem(file, name = file.name, index = 0, folderId = state.uploadTargetFolder) {
  const now = new Date().toISOString();
  return {
    id: Date.now() + index,
    parent: folderId,
    kind: 'file',
    name,
    type: name.split('.').pop().toUpperCase() || 'Файл',
    category: file.type.startsWith('image') ? 'image' : file.type.startsWith('video') ? 'video' : 'document',
    modified: now,
    added: now,
    author: 'Юлия Мякишева',
    modifiedBy: 'Юлия Мякишева',
    size: file.size,
    favorite: false,
    tone: 'blue',
  };
}

function startUploadProgress() {
  const plan = state.pendingUploads.filter(item => item.selected && item.action !== 'skip');
  if (!plan.length) { toast('Выберите хотя бы один файл для загрузки'); return; }
  clearUploadTimers();
  const currentRunId = ++uploadRunId;
  state.activeUploadPlan = plan;
  showModal({
    title: 'Очередь загрузки', subtitle: `${plan.length} ${plural(plan.length, ['файл загружается', 'файла загружаются', 'файлов загружаются'])} в текущую папку`, wide: true,
    body: `<div class="upload-progress-list">${plan.map(item => `<div class="upload-progress-row" data-progress-id="${item.id}">${uploadFileIcon(item.name)}<div class="upload-progress-copy"><strong>${escapeHtml(item.name)}</strong><div class="upload-progress-track"><span style="width:6%"></span></div></div><small class="upload-progress-status">Подготовка</small></div>`).join('')}</div>`,
    actions: `<button class="button button-secondary" value="cancel">Отменить</button>`,
  });
  const steps = [28, 61, 86, 100];
  steps.forEach((value, stepIndex) => uploadTimers.push(setTimeout(() => {
    if (currentRunId !== uploadRunId) return;
    $$('.upload-progress-row').forEach((row, rowIndex) => {
      const adjusted = Math.min(100, Math.max(8, value - rowIndex * 5));
      const bar = $('.upload-progress-track span', row);
      const status = $('.upload-progress-status', row);
      if (bar) bar.style.width = `${adjusted}%`;
      if (status) status.textContent = adjusted === 100 ? 'Готово' : `${adjusted}%`;
    });
  }, 260 * (stepIndex + 1))));
  uploadTimers.push(setTimeout(() => completeUploadPlan(currentRunId), 1400));
}

function clearUploadTimers() {
  uploadTimers.forEach(timer => clearTimeout(timer));
  uploadTimers = [];
}

function showUploadError(message = 'Не удалось завершить загрузку. Попробуйте ещё раз') {
  clearUploadTimers();
  uploadRunId += 1;
  state.activeUploadPlan = [];
  els.modalTitle.textContent = 'Ошибка загрузки';
  els.modalSubtitle.textContent = message;
  $$('.upload-progress-row').forEach(row => {
    const bar = $('.upload-progress-track span', row);
    const status = $('.upload-progress-status', row);
    if (bar) bar.style.background = 'var(--danger)';
    if (status) {
      status.textContent = 'Ошибка';
      status.classList.add('error');
    }
  });
  els.modalActions.innerHTML = `<button class="button button-secondary" value="cancel">Закрыть</button><button class="button button-primary" type="button" id="retryUpload">Повторить</button>`;
  toast(message, null, null, 'error');
}

function completeUploadPlan(currentRunId) {
  if (currentRunId !== uploadRunId) return;
  try {
    const targetFolder = state.uploadTargetFolder;
    const completed = state.activeUploadPlan.map((item, index) => {
      if (item.action === 'version' && item.duplicateId) {
        const existing = findItem(item.duplicateId);
        if (existing) {
          const versions = ensureVersions(existing);
          const now = new Date().toISOString();
          const uploadedVersion = { id: `${existing.id}-${Date.now()}-${index}`, uploadedAt: now, author: 'Юлия Мякишева', size: item.file.size, type: existing.type };
          versions.unshift(uploadedVersion);
          existing.currentVersionId = uploadedVersion.id;
          existing.modified = now;
          existing.size = item.file.size;
          return { ...item, result: 'Новая версия опубликована' };
        }
      }
      const name = item.action === 'separate' ? uniqueUploadName(item.name, targetFolder) : item.name;
      data.push(createUploadedItem(item.file, name, index, targetFolder));
      return { ...item, name, result: 'Файл опубликован' };
    });
    clearUploadTimers();
    state.pendingUploads = [];
    state.activeUploadPlan = [];
    render();
    closeModal();
    toast(`${completed.length} ${plural(completed.length, ['файл загружен', 'файла загружены', 'файлов загружено'])}`);
  } catch (error) {
    showUploadError();
  }
}

function duplicateModal(name = 'Главный баннер.jpg') {
  showModal({
    title: 'Найден похожий файл', subtitle: 'В этой папке уже есть файл с таким названием',
    body: `<div class="duplicate-card">${previewMarkup(data.find(x => x.name === 'Главный баннер.jpg') || data[3])}<div><strong>${escapeHtml(name)}</strong><span>Изменён сегодня · 2,8 МБ</span></div></div><p class="field-help">Замените существующий файл новой версией или сохраните оба файла.</p>`,
    actions: `<button class="button button-secondary" type="button" id="keepBoth">Сохранить оба</button><button class="button button-primary" type="button" id="replaceFile">Заменить файл</button>`
  });
}

function renameModal(item) {
  showModal({ title: 'Переименовать', body: `<label class="field-label">Новое название<input class="field-input" id="renameInput" value="${escapeHtml(item.name)}" maxlength="120"></label>`, actions: `<button class="button button-secondary" value="cancel">Отмена</button><button class="button button-primary" type="button" id="saveRename" data-id="${item.id}">Сохранить</button>` });
  $('#renameInput')?.select();
}

function moveModal(ids) {
  const folders = data.filter(x => x.kind === 'folder' && x.parent === 'root' && !ids.includes(x.id));
  showModal({ title: 'Переместить', subtitle: `${ids.length} ${plural(ids.length, ['объект','объекта','объектов'])}`, body: `<div class="folder-options">${folders.map((folder, i) => `<label class="folder-option ${i === 0 ? 'selected' : ''}"><input type="radio" name="moveFolder" value="${folder.id}" ${i === 0 ? 'checked' : ''} hidden><svg><use href="#icon-folder"></use></svg><span>${escapeHtml(folder.name)}</span></label>`).join('')}</div>`, actions: `<button class="button button-secondary" value="cancel">Отмена</button><button class="button button-primary" type="button" id="confirmMove" data-ids="${ids.join(',')}">Переместить</button>` });
}

function formatVersionDate(value) {
  const date = new Date(value);
  const today = new Date('2026-09-25T15:00:00');
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return `Сегодня, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Вчера, ${time}`;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(date);
}

function ensureVersions(item) {
  if (item.versions?.length) return item.versions;
  const currentDate = new Date(item.added || item.modified);
  const previousDate = new Date(currentDate); previousDate.setDate(currentDate.getDate() - 2); previousDate.setHours(14, 26);
  const firstDate = new Date(currentDate); firstDate.setDate(currentDate.getDate() - 9); firstDate.setHours(11, 8);
  item.versions = [
    { id: `${item.id}-current`, uploadedAt: item.modified, author: 'Юлия Мякишева', size: item.size, type: item.type },
    { id: `${item.id}-previous`, uploadedAt: previousDate.toISOString(), author: 'Алексей Воронов', size: Math.max(1000, Math.round(item.size * .94)), type: item.type },
    { id: `${item.id}-first`, uploadedAt: firstDate.toISOString(), author: 'Юлия Мякишева', size: Math.max(1000, Math.round(item.size * .88)), type: item.type },
  ];
  item.currentVersionId = item.versions[0].id;
  return item.versions;
}

function renderVersionHistory(item) {
  const versions = ensureVersions(item);
  const current = versions.find(version => version.id === item.currentVersionId) || versions[0];
  const previewed = versions.find(version => version.id === state.previewVersionId) || current;
  state.previewVersionId = previewed.id;
  setInspectorPreview(item, `${previewed.id === item.currentVersionId ? 'Текущая загрузка' : 'Предпросмотр'} · ${formatVersionDate(previewed.uploadedAt)}`);
  els.drawerContent.innerHTML = `<div class="version-history">
    <div class="version-history-intro">
      <strong>${escapeHtml(item.name)}</strong>
      <p>Все загрузки сохранены. Старую можно снова сделать текущей — нынешняя останется в истории.</p>
    </div>
    <div class="version-list">${versions.map(version => {
      const isCurrent = version.id === item.currentVersionId;
      const isPreviewed = version.id === state.previewVersionId;
      return `<article class="version-card ${isCurrent ? 'current' : ''} ${isPreviewed ? 'previewing' : ''}">
        <button class="version-thumb-button" type="button" data-preview-version="${version.id}" aria-label="Показать загрузку от ${escapeHtml(formatVersionDate(version.uploadedAt))}">${previewMarkup(item, 'version-preview')}</button>
        <div class="version-card-copy">
          <div class="version-card-heading"><strong>${escapeHtml(formatVersionDate(version.uploadedAt))}</strong>${isCurrent ? '<span class="current-version-badge">Текущая</span>' : ''}</div>
          <span>${escapeHtml(version.author)}</span>
          <small>${escapeHtml(version.type)} · ${formatSize(version.size)}</small>
          ${version.restoredFrom ? `<small class="restored-note">Восстановлено из загрузки от ${escapeHtml(formatVersionDate(version.restoredFrom))}</small>` : ''}
          ${isCurrent ? '' : `<button class="version-restore-button" type="button" data-make-current="${version.id}"><svg aria-hidden="true"><use href="#icon-undo"></use></svg>Сделать текущей</button>`}
        </div>
      </article>`;
    }).join('')}</div>
  </div>`;
}

function openVersionHistory(item) {
  if (item.kind !== 'file') return;
  closeSettingsSidebar();
  state.drawerTarget = item.id;
  ensureVersions(item);
  state.previewVersionId = item.currentVersionId;
  els.drawer.classList.remove('preview-only');
  els.drawer.classList.remove('information-mode');
  els.drawer.classList.add('version-history-mode');
  els.drawerHeaderTitle.textContent = 'История версий';
  renderVersionHistory(item);
  els.drawer.classList.add('open');
  els.drawer.setAttribute('aria-hidden', 'false');
}

function restoreVersion(item, versionId) {
  const versions = ensureVersions(item);
  const source = versions.find(version => version.id === versionId);
  if (!source || source.id === item.currentVersionId) return;
  const now = new Date().toISOString();
  const restored = {
    ...source,
    id: `${item.id}-${Date.now()}`,
    uploadedAt: now,
    author: 'Юлия Мякишева',
    restoredFrom: source.uploadedAt,
  };
  versions.unshift(restored);
  item.currentVersionId = restored.id;
  item.modified = now;
  item.modifiedBy = 'Юлия Мякишева';
  item.size = restored.size;
  state.previewVersionId = restored.id;
  render();
  openVersionHistory(item);
  toast('Выбранная загрузка стала текущей. Предыдущая сохранена в истории');
}

function confirmDelete(ids, forever = false) {
  showModal({ title: forever ? 'Удалить навсегда?' : 'Переместить в корзину?', subtitle: forever ? 'Это действие нельзя отменить' : 'Объекты можно будет восстановить из корзины', body: `<p style="margin:0;font-size:13px;line-height:1.6">Будет удалено: <strong>${ids.length} ${plural(ids.length, ['объект','объекта','объектов'])}</strong>.</p>`, actions: `<button class="button button-secondary" value="cancel">Отмена</button><button class="button button-danger-quiet" type="button" id="confirmDelete" data-ids="${ids.join(',')}" data-forever="${forever}">${forever ? 'Удалить навсегда' : 'В корзину'}</button>` });
}

function deleteItems(ids) {
  const removed = [];
  ids.forEach(id => {
    const index = data.findIndex(x => x.id === id);
    if (index >= 0) removed.push(...data.splice(index, 1));
  });
  state.trash.push(...removed.map(item => ({ ...item, previousParent: item.parent, deletedAt: new Date().toISOString() })));
  state.lastDeleted = removed;
  state.selected.clear();
  closeDrawer();
  render();
  toast(`${removed.length} ${plural(removed.length, ['объект перемещён','объекта перемещены','объектов перемещено'])} в корзину`, 'Отменить', () => {
    const idsToRestore = removed.map(x => x.id);
    restoreItems(idsToRestore);
  });
}

function restoreItems(ids) {
  const restored = [];
  state.trash = state.trash.filter(item => {
    if (ids.includes(item.id)) { restored.push({ ...item, parent: item.previousParent || 'root' }); return false; }
    return true;
  });
  restored.forEach(item => { delete item.previousParent; delete item.deletedAt; data.push(item); });
  state.selected.clear(); render(); toast('Объекты восстановлены');
}

function deleteForever(ids) {
  state.trash = state.trash.filter(x => !ids.includes(x.id));
  state.selected.clear(); render(); toast('Объекты удалены навсегда');
}

function toast(message, actionText, action, variant = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${variant === 'error' ? 'toast-error' : ''}`;
  el.innerHTML = `<span class="toast-icon"><svg><use href="#${variant === 'error' ? 'icon-close' : 'icon-check'}"></use></svg></span><span>${escapeHtml(message)}</span>${actionText ? `<button type="button">${escapeHtml(actionText)}</button>` : ''}`;
  if (actionText) $('button', el).addEventListener('click', () => { action?.(); el.remove(); });
  (els.modal.open ? els.modalToastStack : $('#toastStack')).append(el);
  setTimeout(() => el.remove(), 4500);
}

document.addEventListener('click', event => {
  const accountButton = event.target.closest('#accountMenuButton');
  if (accountButton) {
    const willOpen = els.accountMenu.hidden;
    els.accountMenu.hidden = !willOpen;
    els.accountButton.setAttribute('aria-expanded', String(willOpen));
    return;
  }

  if (event.target.closest('#logoutButton')) {
    els.accountMenu.hidden = true;
    els.accountButton.setAttribute('aria-expanded', 'false');
    closeDrawer();
    closeSettingsSidebar();
    loginModal();
    return;
  }

  if (!event.target.closest('.account-menu-wrap')) {
    els.accountMenu.hidden = true;
    els.accountButton.setAttribute('aria-expanded', 'false');
  }

  const nav = event.target.closest('[data-section]');
  if (nav) { closeMenu(); closeSettingsSidebar(); state.section = nav.dataset.section; state.folder = 'root'; state.selected.clear(); state.search = ''; els.search.value = ''; closeDrawer(); render(); return; }

  const folderCrumb = event.target.closest('[data-folder]');
  if (folderCrumb) { closeMenu(); closeSettingsSidebar(); state.folder = folderCrumb.dataset.folder === 'root' ? 'root' : Number(folderCrumb.dataset.folder); state.section = 'library'; state.selected.clear(); render(); return; }

  const inlineAccessButton = event.target.closest('[data-inline-access]');
  if (inlineAccessButton) {
    const item = findItem(inlineAccessButton.dataset.id); if (!item) return;
    if (inlineAccessButton.dataset.inlineAccess === 'copy') copyItemLink(item);
    if (inlineAccessButton.dataset.inlineAccess === 'manage') accessModal(item);
    return;
  }

  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { state.view = viewButton.dataset.view; render(); return; }

  const openButton = event.target.closest('[data-open]');
  if (openButton) { const item = findItem(openButton.dataset.open); if (item) openItem(item); return; }

  const menuButton = event.target.closest('[data-menu]');
  if (menuButton) { event.stopPropagation(); const item = findItem(menuButton.dataset.menu); if (item) openMenu(item, menuButton); return; }

  const actionButton = event.target.closest('[data-action]');
  if (actionButton && els.menu.contains(actionButton)) {
    const item = findItem(state.menuTarget); const action = actionButton.dataset.action; closeMenu();
    if (!item) return;
    if (action === 'open') openItem(item);
    if (action === 'information') openInformation(item);
    if (action === 'copyLink') copyItemLink(item);
    if (action === 'shareAccess') accessModal(item);
    if (action === 'rename') renameModal(item);
    if (action === 'move') moveModal([item.id]);
    if (action === 'download') toast(`Скачивание «${displayName(item)}» начато`);
    if (action === 'history') openVersionHistory(item);
    if (action === 'delete') confirmDelete([item.id]);
    if (action === 'restore') restoreItems([item.id]);
    if (action === 'deleteForever') confirmDelete([item.id], true);
    return;
  }

  const sortButton = event.target.closest('[data-sort]');
  if (sortButton) { const key = sortButton.dataset.sort; state.sortDir = state.sortKey === key && state.sortDir === 'asc' ? 'desc' : 'asc'; state.sortKey = key; render(); return; }

  const favorite = event.target.closest('[data-favorite]');
  if (favorite) { const item = findItem(favorite.dataset.favorite); item.favorite = !item.favorite; openInformation(item); render(); toast(item.favorite ? 'Добавлено в избранное' : 'Удалено из избранного'); return; }

  const previewVersionButton = event.target.closest('[data-preview-version]');
  if (previewVersionButton) {
    const item = findItem(state.drawerTarget); if (!item) return;
    state.previewVersionId = previewVersionButton.dataset.previewVersion;
    renderVersionHistory(item);
    return;
  }

  const makeCurrentButton = event.target.closest('[data-make-current]');
  if (makeCurrentButton) {
    const item = findItem(state.drawerTarget); if (!item) return;
    restoreVersion(item, makeCurrentButton.dataset.makeCurrent);
    return;
  }

  const bulk = event.target.closest('[data-bulk]');
  if (bulk) { const ids = [...state.selected]; if (!ids.length) return; const action = bulk.dataset.bulk; if (action === 'copyLink') copySelectionLinks(ids); if (action === 'download') toast(`Подготовка ${ids.length} ${plural(ids.length, ['объекта', 'объектов', 'объектов'])} к скачиванию`); if (action === 'move') moveModal(ids); if (action === 'delete') confirmDelete(ids); if (action === 'restore') restoreItems(ids); if (action === 'deleteForever') confirmDelete(ids, true); return; }

  if (!event.target.closest('#actionMenu')) closeMenu();
});

document.addEventListener('change', event => {
  if (event.target.matches('.row-check')) {
    const holder = event.target.closest('[data-id]'); if (holder) selectItem(holder.dataset.id, event.target.checked);
  }
  if (event.target.name === 'moveFolder') $$('.folder-option').forEach(label => label.classList.toggle('selected', $('input', label).checked));
});

els.search.addEventListener('input', () => { state.search = els.search.value.trim(); state.selected.clear(); render(); });
els.selectAll.addEventListener('change', () => { visibleItems().forEach(item => els.selectAll.checked ? state.selected.add(item.id) : state.selected.delete(item.id)); render(); });
$('#clearSelection').addEventListener('click', () => { state.selected.clear(); render(); });
$('#newFolderButton').addEventListener('click', newFolderModal);
$('#uploadButton').addEventListener('click', () => els.directUpload.click());
els.productLogo.addEventListener('click', openAllFiles);
els.filterSettings.addEventListener('click', filterSettingsModal);
els.columnSettings.addEventListener('click', columnSettingsModal);
$('#closeSettingsSidebar').addEventListener('click', closeSettingsSidebar);
els.settingsSidebar.addEventListener('click', event => {
  if (event.target === els.settingsSidebar) { closeSettingsSidebar(); return; }
  const removeFormat = event.target.closest('[data-remove-format]');
  if (removeFormat) {
    const input = $(`input[name="fileFormat"][value="${removeFormat.dataset.removeFormat}"]`, els.settingsSidebarBody);
    if (input) input.checked = false;
    updateFormatMultiselect();
    return;
  }
  if (event.target.closest('#clearAllFormats')) {
    $$('input[name="fileFormat"]', els.settingsSidebarBody).forEach(input => { input.checked = false; });
    updateFormatMultiselect();
    return;
  }
  const formatControl = event.target.closest('#formatMultiselectControl');
  const formatToggle = event.target.closest('#formatMultiselectButton') || (formatControl ? $('#formatMultiselectButton', els.settingsSidebarBody) : null);
  if (formatToggle) {
    if (formatToggle.disabled) return;
    const menu = $('#formatMultiselectMenu', els.settingsSidebarBody);
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    formatToggle.setAttribute('aria-expanded', String(willOpen));
    formatToggle.closest('.filter-multiselect')?.classList.toggle('open', willOpen);
    return;
  }
  if (!event.target.closest('#formatMultiselect')) {
    const menu = $('#formatMultiselectMenu', els.settingsSidebarBody);
    const button = $('#formatMultiselectButton', els.settingsSidebarBody);
    if (menu && button) {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.closest('.filter-multiselect')?.classList.remove('open');
    }
  }
  if (event.target.closest('#resetFilterSettings')) resetFilterSettings();
  if (event.target.closest('#applyFilterSettings')) applyFilterSettings();
  if (event.target.closest('#cancelColumnSettings')) closeSettingsSidebar();
  if (event.target.closest('#applyColumnSettings')) applyColumnSettings();
});
els.settingsSidebar.addEventListener('change', event => {
  if (event.target.name === 'fileFormat') updateFormatMultiselect();
  if (event.target.id === 'assetTypeSelect') {
    const formatButton = $('#formatMultiselectButton', els.settingsSidebarBody);
    const isFolder = event.target.value === 'folder';
    const sizeInputs = $$('#sizeMinMb, #sizeMaxMb', els.settingsSidebarBody);
    if (isFolder) {
      $$('input[name="fileFormat"]', els.settingsSidebarBody).forEach(input => { input.checked = false; });
      sizeInputs.forEach(input => { input.value = ''; });
      $('#formatMultiselectMenu', els.settingsSidebarBody).hidden = true;
      formatButton.setAttribute('aria-expanded', 'false');
      formatButton.closest('.filter-multiselect')?.classList.remove('open');
    }
    sizeInputs.forEach(input => { input.disabled = isFolder; });
    $('#sizeFilterGroup', els.settingsSidebarBody)?.classList.toggle('disabled', isFolder);
    updateFormatMultiselect();
  }
  if (event.target.name === 'uploadDateMode') {
    $$('.date-filter-mode', els.settingsSidebarBody).forEach(label => label.classList.toggle('selected', $('input', label).checked));
    $$('[data-date-fields]', els.settingsSidebarBody).forEach(fields => { fields.hidden = fields.dataset.dateFields !== event.target.value; });
  }
});
$('#sectionToggleButton').addEventListener('click', () => {
  closeMenu();
  closeSettingsSidebar();
  state.section = state.section === 'trash' ? 'library' : 'trash';
  state.folder = 'root';
  state.selected.clear();
  closeDrawer();
  render();
});
$('#closeDrawer').addEventListener('click', closeDrawer);
$('#closePreview').addEventListener('click', closeDrawer);
els.drawer.addEventListener('click', event => {
  if (els.drawer.classList.contains('information-mode') && event.target === els.drawer) closeDrawer();
});
$('#resetFilters').addEventListener('click', () => { state.search = ''; state.filterType = 'any'; state.filterFormats.clear(); state.sizeMinMb = ''; state.sizeMaxMb = ''; state.uploadDateMode = 'any'; state.uploadDateFrom = ''; state.uploadDateTo = ''; els.search.value = ''; render(); });

els.modal.addEventListener('close', () => {
  els.modalToastStack.replaceChildren();
  if (state.activeUploadPlan.length) {
    clearUploadTimers();
    uploadRunId += 1;
    state.activeUploadPlan = [];
    toast('Загрузка отменена', null, null, 'error');
  }
});

els.modal.addEventListener('cancel', event => {
  if (els.modal.classList.contains('modal-auth')) event.preventDefault();
});

els.modal.addEventListener('click', event => {
  if (event.target === els.modal && !els.modal.classList.contains('modal-auth')) closeModal();
  const sberIdLoginButton = event.target.closest('#sberIdLogin');
  if (sberIdLoginButton) {
    document.body.classList.remove('signed-out');
    els.modal.classList.remove('modal-auth');
    closeModal();
    openAllFiles();
    toast('Вход через Сбер ID выполнен');
    return;
  }
  const copyAccessButton = event.target.closest('#copyAccessLink');
  if (copyAccessButton) {
    const item = findItem(copyAccessButton.dataset.id); if (item) copyItemLink(item);
    return;
  }
  const inviteButton = event.target.closest('#inviteByEmail');
  if (inviteButton) {
    const item = findItem(inviteButton.dataset.id); if (!item) return;
    const emailInput = $('#accessEmail');
    const email = emailInput.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.classList.add('invalid');
      emailInput.focus();
      toast('Укажите корректный адрес электронной почты');
      return;
    }
    item.accessPeople ||= [];
    if (item.accessPeople.some(person => person.email === email)) {
      toast('Этот участник уже добавлен');
      return;
    }
    item.accessPeople.push({ email, role: 'view' });
    accessModal(item);
    toast(`Приглашение для ${email} добавлено`);
    return;
  }
  const removeUploadButton = event.target.closest('[data-remove-upload]');
  if (removeUploadButton) {
    state.pendingUploads = state.pendingUploads.filter(item => item.id !== removeUploadButton.dataset.removeUpload);
    showUploadSelectionModal();
    return;
  }
  if (event.target.closest('#addMoreUploads')) { els.directUpload.click(); return; }
  if (event.target.closest('#continueUpload')) { startUploadProgress(); return; }
  if (event.target.closest('#retryUpload')) { startUploadProgress(); return; }
  if (event.target.id === 'createFolder') {
    const name = $('#folderName').value.trim();
    if (!name) { $('#folderName').focus(); return; }
    if (data.some(x => x.parent === state.folder && x.name.toLowerCase() === name.toLowerCase())) { toast('Папка с таким названием уже существует'); return; }
    const now = new Date().toISOString();
    data.push({ id: Date.now(), parent: state.folder, kind: 'folder', name, type: 'Папка', modified: now, added: now, author: 'Юлия Мякишева', modifiedBy: 'Юлия Мякишева', size: 0, count: 0, favorite: false, tone: 'violet' });
    closeModal(); render(); toast('Папка создана');
  }
  if (event.target.id === 'chooseFiles') $('#fileInput').click();
  if (event.target.id === 'demoDuplicate') duplicateModal();
  if (event.target.id === 'keepBoth') { const source = data[3]; const now = new Date().toISOString(); data.push({ ...source, id: Date.now(), name: 'Главный баннер (1).jpg', modified: now, added: now }); closeModal(); render(); toast('Оба файла сохранены'); }
  if (event.target.id === 'replaceFile') {
    const existing = data[3];
    const versions = ensureVersions(existing);
    const now = new Date().toISOString();
    const uploadedVersion = { id: `${existing.id}-${Date.now()}`, uploadedAt: now, author: 'Юлия Мякишева', size: existing.size, type: existing.type };
    versions.unshift(uploadedVersion);
    existing.currentVersionId = uploadedVersion.id;
    existing.modified = now;
    existing.modifiedBy = 'Юлия Мякишева';
    closeModal(); render(); toast('Файл заменён, версия сохранена в истории');
  }
  if (event.target.id === 'finishUpload') { closeModal(); toast('Файлы успешно загружены'); }
  if (event.target.id === 'saveRename') { const item = findItem(event.target.dataset.id); const name = $('#renameInput').value.trim(); if (item && name) { item.name = name; item.modified = new Date().toISOString(); item.modifiedBy = 'Юлия Мякишева'; closeModal(); render(); toast('Название изменено'); } }
  if (event.target.id === 'confirmMove') { const ids = event.target.dataset.ids.split(',').map(Number); const target = Number($('input[name="moveFolder"]:checked').value); const now = new Date().toISOString(); ids.forEach(id => { const item = findItem(id); if (item) { item.parent = target; item.modified = now; item.modifiedBy = 'Юлия Мякишева'; } }); state.selected.clear(); closeModal(); render(); toast('Объекты перемещены'); }
  if (event.target.id === 'confirmDelete') { const ids = event.target.dataset.ids.split(',').map(Number); const forever = event.target.dataset.forever === 'true'; closeModal(); forever ? deleteForever(ids) : deleteItems(ids); }
});

els.modal.addEventListener('change', event => {
  if (event.target.id === 'fileInput') processFiles([...event.target.files]);
  if (event.target.id === 'linkAccessSelect') {
    const item = findItem(event.target.dataset.id);
    if (item) { item.linkAccess = event.target.value; toast('Доступ по ссылке обновлён'); }
  }
  if (event.target.matches('.participant-role-select')) {
    const item = findItem(event.target.dataset.id);
    const person = item?.accessPeople?.find(entry => entry.email === event.target.dataset.email);
    if (person) { person.role = event.target.value; toast('Права участника обновлены'); }
  }
  if (event.target.matches('.pending-upload-check')) {
    const row = event.target.closest('[data-upload-id]');
    const item = state.pendingUploads.find(upload => upload.id === row?.dataset.uploadId);
    if (item) item.selected = event.target.checked;
  }
  if (event.target.matches('.duplicate-action-select')) {
    const row = event.target.closest('[data-upload-id]');
    const item = state.pendingUploads.find(upload => upload.id === row?.dataset.uploadId);
    if (item) item.action = event.target.value;
  }
  if (event.target.id === 'allDuplicateAction') {
    state.pendingUploads.filter(item => item.duplicateId).forEach(item => { item.action = event.target.value; });
    $$('.duplicate-action-select').forEach(select => { select.value = event.target.value; });
  }
});

els.folderDropZone.addEventListener('click', () => els.directUpload.click());
els.folderDropZone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    els.directUpload.click();
  }
});

function hasDraggedFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files');
}

function setWorkspaceDropZone(active) {
  els.workspaceDropZone.classList.toggle('active', active);
  els.workspaceDropZone.setAttribute('aria-hidden', String(!active));
}

function resetWorkspaceDrag() {
  workspaceDragDepth = 0;
  setWorkspaceDropZone(false);
}

document.addEventListener('dragenter', event => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  workspaceDragDepth += 1;
  if (state.section === 'library' && !els.modal.open && !state.activeUploadPlan.length) setWorkspaceDropZone(true);
});

document.addEventListener('dragover', event => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = state.section === 'library' && !state.activeUploadPlan.length ? 'copy' : 'none';
});

document.addEventListener('dragleave', event => {
  if (!workspaceDragDepth) return;
  workspaceDragDepth = Math.max(0, workspaceDragDepth - 1);
  if (workspaceDragDepth === 0) setWorkspaceDropZone(false);
});

document.addEventListener('drop', event => {
  if (!hasDraggedFiles(event) && !workspaceDragDepth) return;
  event.preventDefault();
  resetWorkspaceDrag();
  if (state.section !== 'library') {
    toast('Загрузка доступна только в разделе «Все файлы»', null, null, 'error');
    return;
  }
  if (state.activeUploadPlan.length) {
    toast('Дождитесь завершения текущей загрузки', null, null, 'error');
    return;
  }
  const append = els.modal.open && !!$('#uploadSelectionList');
  if (els.modal.open && !append) {
    toast('Закройте текущее окно перед загрузкой файлов', null, null, 'error');
    return;
  }
  queueUploadFiles([...(event.dataTransfer?.files || [])], append, !append);
});

window.addEventListener('blur', resetWorkspaceDrag);

els.directUpload.addEventListener('change', event => {
  const append = els.modal.open && !!$('#uploadSelectionList');
  queueUploadFiles([...event.target.files], append);
});

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); els.search.focus(); }
  if (event.key === 'Escape') { closeMenu(); closeDrawer(); closeSettingsSidebar(); }
});

render();
