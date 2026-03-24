// ---------- 全局变量 ----------
let currentFilter = 'all';
let folders = [];
let videos = [];
let pendingVideoInfo = null;
let isConfirmMode = false;
let expandedVideoIds = new Set();
let editingPointId = null;

// ---------- 辅助函数 ----------
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 200);
}

function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateVideoMarkdown(video) {
  let md = `# ${video.title || '无标题视频'}\n\n`;
  if (video.points.length === 0) return md;
  const sortedPoints = [...video.points].sort((a, b) => a.time - b.time);
  for (const point of sortedPoints) {
    const timeStr = formatTime(point.time);
    md += `## ⏱️ ${timeStr}\n`;
    if (point.note) md += `**备注**：${point.note}\n\n`;
    if (point.markdown && point.markdown.trim()) md += `**笔记**：\n${point.markdown}\n\n`;
    else md += `*暂无笔记*\n\n`;
    md += `---\n\n`;
  }
  return md;
}

function exportSingleVideo(video) {
  downloadMarkdown(generateVideoMarkdown(video), sanitizeFilename(video.title) + '_notes.md');
}

// 生成视频所有笔记的合并文本（用于预览）
function generateVideoPreviewContent(video) {
  let content = `# ${video.title || '无标题视频'} 所有笔记汇总\n\n`;
  if (video.points.length === 0) return content + '*无记忆点*';
  const sortedPoints = [...video.points].sort((a, b) => a.time - b.time);
  for (const point of sortedPoints) {
    const timeStr = formatTime(point.time);
    content += `## ⏱️ ${timeStr}\n`;
    if (point.note) content += `**备注**：${point.note}\n\n`;
    if (point.markdown && point.markdown.trim()) {
      content += `**笔记**：\n${point.markdown}\n\n`;
    } else {
      content += `*暂无笔记*\n\n`;
    }
    content += `---\n\n`;
  }
  return content;
}

// 简单的 Markdown 转 HTML（用于内联预览和预览模态框）
function markdownToHtml(markdown) {
  if (!markdown) return '';
  let html = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
    .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
    .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/^- (.*?)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.*?)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
  html = html.replace(/(<li>.*?<\/li>\n?)+/g, '<ul>$&</ul>');
  return html;
}

// 预览模态框
function showPreviewModal(content) {
  // 移除已存在的模态框
  const existing = document.getElementById('preview-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'preview-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    z-index: 1000000;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white;
    width: 80%;
    max-width: 800px;
    max-height: 80%;
    border-radius: 8px;
    overflow: auto;
    padding: 20px;
    font-family: system-ui, sans-serif;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  `;
  dialog.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
      <h3 style="margin:0;">📝 笔记预览</h3>
      <button id="close-preview-btn" style="background:none; border:none; font-size:20px; cursor:pointer;">&times;</button>
    </div>
    <div id="preview-content" style="line-height:1.5;"></div>
  `;
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  const previewDiv = dialog.querySelector('#preview-content');
  previewDiv.innerHTML = markdownToHtml(content);

  const closeBtn = dialog.querySelector('#close-preview-btn');
  closeBtn.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// ---------- 预览功能（内部模态框）----------
function previewVideo(videoId) {
  console.log('[预览] 请求预览视频ID:', videoId);
  const video = videos.find(v => v.id === videoId);
  if (!video) {
    alert(`未找到视频 (ID: ${videoId})`);
    return;
  }
  const content = generateVideoPreviewContent(video);
  showPreviewModal(content);
}

// ---------- 数据迁移 ----------
async function migrateOldData() {
  const oldData = await chrome.storage.local.get(['memories', 'folders']);
  if (oldData.memories && oldData.memories.length > 0) {
    console.log('正在迁移旧数据...');
    const newVideos = {};
    for (const mem of oldData.memories) {
      const url = normalizeUrl(mem.url);
      if (!newVideos[url]) {
        newVideos[url] = {
          id: url,
          url: url,
          title: mem.title,
          folderId: mem.folderId || null,
          updatedAt: mem.timestamp,
          points: []
        };
      }
      newVideos[url].points.push({
        id: mem.id,
        time: mem.time,
        note: mem.note,
        markdown: '',
        createdAt: mem.timestamp
      });
      if (mem.timestamp > newVideos[url].updatedAt) {
        newVideos[url].updatedAt = mem.timestamp;
      }
    }
    await chrome.storage.local.set({ videos: Object.values(newVideos) });
    await chrome.storage.local.remove('memories');
    console.log('迁移完成');
  }
  const { folders: existingFolders } = await chrome.storage.local.get('folders');
  if (!existingFolders || existingFolders.length === 0) {
    await chrome.storage.local.set({ folders: [{ id: 'default', name: '默认' }] });
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch (e) {
    return url;
  }
}

async function loadData() {
  await migrateOldData();
  const data = await chrome.storage.local.get(['folders', 'videos']);
  folders = data.folders || [];
  videos = data.videos || [];
  videos.forEach(v => {
    if (v.folderId === undefined) v.folderId = null;
    v.points.forEach(p => { if (p.markdown === undefined) p.markdown = ''; });
  });
  renderFolderSelector();
  renderFolderManager();
  renderVideos();
}

async function saveData() {
  await chrome.storage.local.set({ folders, videos });
}

// ---------- 渲染文件夹下拉 ----------
function renderFolderSelector() {
  const select = document.getElementById('folderFilter');
  if (!select) return;
  let html = '<option value="all">📂 所有视频</option><option value="uncategorized">📁 未分类</option>';
  folders.forEach(f => html += `<option value="${f.id}">📁 ${escapeHtml(f.name)}</option>`);
  select.innerHTML = html;
  select.value = currentFilter;
  select.onchange = (e) => { currentFilter = e.target.value; renderVideos(); };
}

function renderFolderManager() {
  const container = document.getElementById('foldersList');
  if (!container) return;
  if (folders.length === 0) {
    container.innerHTML = '<div class="empty">暂无文件夹，请添加</div>';
    return;
  }
  let html = '';
  folders.forEach(folder => {
    html += `
      <div class="folder-item" data-id="${folder.id}">
        <span class="folder-name" data-id="${folder.id}">📁 ${escapeHtml(folder.name)}</span>
        <div class="folder-actions">
          <button class="rename-folder" data-id="${folder.id}">✏️</button>
          <button class="delete-folder" data-id="${folder.id}">🗑️</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
  document.querySelectorAll('.folder-name').forEach(el => {
    el.addEventListener('click', () => {
      currentFilter = el.dataset.id;
      document.getElementById('folderFilter').value = currentFilter;
      renderVideos();
    });
  });
  document.querySelectorAll('.rename-folder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const folder = folders.find(f => f.id === id);
      if (!folder) return;
      const newName = prompt('新名称:', folder.name);
      if (newName && newName.trim()) {
        folder.name = newName.trim();
        await saveData();
        renderFolderSelector();
        renderFolderManager();
        renderVideos();
      }
    });
  });
  document.querySelectorAll('.delete-folder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const folder = folders.find(f => f.id === id);
      if (confirm(`删除“${folder?.name}”？其中的视频将移到“未分类”。`)) {
        videos.forEach(v => { if (v.folderId === id) v.folderId = null; });
        folders = folders.filter(f => f.id !== id);
        await saveData();
        if (currentFilter === id) currentFilter = 'all';
        renderFolderSelector();
        renderFolderManager();
        renderVideos();
      }
    });
  });
}

function renderVideos() {
  const container = document.getElementById('memoriesList');
  if (!container) return;

  let filteredVideos = [...videos];
  if (currentFilter === 'uncategorized') filteredVideos = filteredVideos.filter(v => !v.folderId);
  else if (currentFilter !== 'all') filteredVideos = filteredVideos.filter(v => v.folderId === currentFilter);
  filteredVideos.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (filteredVideos.length === 0) {
    container.innerHTML = '<div class="empty">暂无视频记忆点</div>';
    return;
  }

  let html = '';
  filteredVideos.forEach((video, idx) => {
    const groupId = `video-group-${idx}`;
    const pointsSorted = [...video.points].sort((a, b) => a.time - b.time);
    html += `
      <div class="video-group" data-video-id="${video.id}">
        <div class="video-header" data-group-id="${groupId}">
          <span class="video-title">🎬 ${escapeHtml(video.title || '未知视频')}</span>
          <span class="expand-icon">${expandedVideoIds.has(video.id) ? '▲' : '▼'}</span>
          <div class="video-actions">
            <button class="preview-video-btn" data-video-id="${video.id}">🔍 预览</button>
            <button class="export-video-btn" data-video-id="${video.id}">📄 导出</button>
            <button class="move-video-btn" data-video-id="${video.id}">📂 移动</button>
            <button class="delete-video-btn" data-video-id="${video.id}">🗑️ 删除</button>
          </div>
        </div>
        <div class="points-list" id="${groupId}" style="display: ${expandedVideoIds.has(video.id) ? 'block' : 'none'};">
    `;
    pointsSorted.forEach(point => {
      const isEditing = editingPointId === `${video.id}_${point.id}`;
      const noteContent = point.markdown || '';
      html += `
        <div class="point-item" data-point-id="${point.id}" data-video-id="${video.id}">
          <div class="point-time">⏱️ ${formatTime(point.time)}</div>
          ${point.note ? `<div class="point-note">📝 ${escapeHtml(point.note)}</div>` : ''}
          <div class="point-content-row">
            <div class="point-notes">
              <textarea class="point-note-editor" data-point-id="${point.id}" data-video-id="${video.id}" rows="4" ${isEditing ? '' : 'readonly'}>${escapeHtml(noteContent)}</textarea>
            </div>
            <div class="point-actions">
      `;
      if (isEditing) {
        html += `
          <button class="save-note-btn" data-point-id="${point.id}" data-video-id="${video.id}">保存</button>
          <button class="cancel-edit-btn" data-point-id="${point.id}" data-video-id="${video.id}">取消</button>
        `;
      } else {
        html += `
          <button class="jump-point" data-video-id="${video.id}" data-time="${point.time}">▶️ 跳转</button>
          <button class="edit-note-inline" data-point-id="${point.id}" data-video-id="${video.id}">✏️ 编辑</button>
          <button class="delete-point" data-point-id="${point.id}" data-video-id="${video.id}">❌ 删除</button>
        `;
      }
      html += `
            </div>
          </div>
        </div>
      `;
    });
    html += `</div></div>`;
  });
  container.innerHTML = html;

  // 绑定折叠/展开
  document.querySelectorAll('.video-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const videoId = header.closest('.video-group').dataset.videoId;
      const groupId = header.dataset.groupId;
      const pointsList = document.getElementById(groupId);
      if (pointsList) {
        const isExpanded = pointsList.style.display !== 'none';
        if (isExpanded) {
          pointsList.style.display = 'none';
          expandedVideoIds.delete(videoId);
          header.querySelector('.expand-icon').textContent = '▼';
        } else {
          pointsList.style.display = 'block';
          expandedVideoIds.add(videoId);
          header.querySelector('.expand-icon').textContent = '▲';
        }
      }
    });
  });

  // 预览视频
  document.querySelectorAll('.preview-video-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const videoId = btn.dataset.videoId;
      previewVideo(videoId);
    });
  });

  // 导出单个视频
  document.querySelectorAll('.export-video-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const videoId = btn.dataset.videoId;
      const video = videos.find(v => v.id === videoId);
      if (video) exportSingleVideo(video);
    });
  });

  // 跳转点
  document.querySelectorAll('.jump-point').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const videoId = btn.dataset.videoId;
      const targetTime = parseFloat(btn.dataset.time);
      const video = videos.find(v => v.id === videoId);
      if (video) jumpToVideo(video, targetTime);
    });
  });

  // 内联编辑
  document.querySelectorAll('.edit-note-inline').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pointId = btn.dataset.pointId;
      const videoId = btn.dataset.videoId;
      editingPointId = `${videoId}_${pointId}`;
      renderVideos();
    });
  });

  // 保存笔记
  document.querySelectorAll('.save-note-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pointId = btn.dataset.pointId;
      const videoId = btn.dataset.videoId;
      const textarea = document.querySelector(`.point-note-editor[data-point-id="${pointId}"][data-video-id="${videoId}"]`);
      if (!textarea) return;
      const newMarkdown = textarea.value;
      const video = videos.find(v => v.id === videoId);
      if (video) {
        const point = video.points.find(p => p.id == pointId);
        if (point) {
          point.markdown = newMarkdown;
          video.updatedAt = Date.now();
          await saveData();
        }
      }
      editingPointId = null;
      renderVideos();
    });
  });

  // 取消编辑
  document.querySelectorAll('.cancel-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editingPointId = null;
      renderVideos();
    });
  });

  // 删除点
  document.querySelectorAll('.delete-point').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pointId = btn.dataset.pointId;
      const videoId = btn.dataset.videoId;
      const video = videos.find(v => v.id === videoId);
      if (!video) return;
      if (confirm('确定删除这个记忆点吗？')) {
        video.points = video.points.filter(p => p.id != pointId);
        if (video.points.length === 0) videos = videos.filter(v => v.id !== videoId);
        else video.updatedAt = Date.now();
        await saveData();
        editingPointId = null;
        renderVideos();
      }
    });
  });

  // 移动视频
  document.querySelectorAll('.move-video-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const videoId = btn.dataset.videoId;
      const video = videos.find(v => v.id === videoId);
      if (!video) return;
      const options = [{ id: null, name: '未分类' }, ...folders.map(f => ({ id: f.id, name: f.name }))];
      const choice = prompt(`选择文件夹：\n${options.map((f, i) => `${i+1}. ${f.name}`).join('\n')}\n编号：`, '1');
      const idx = parseInt(choice) - 1;
      if (idx >= 0 && idx < options.length) {
        video.folderId = options[idx].id;
        video.updatedAt = Date.now();
        await saveData();
        renderVideos();
      }
    });
  });

  // 删除视频
  document.querySelectorAll('.delete-video-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const videoId = btn.dataset.videoId;
      if (confirm('删除整个视频的所有记忆点？')) {
        videos = videos.filter(v => v.id !== videoId);
        await saveData();
        renderVideos();
      }
    });
  });
}

// ---------- 跳转到视频时间点 ----------
async function jumpToVideo(video, targetTime) {
  const tabs = await chrome.tabs.query({ url: video.url });
  if (tabs.length) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (time) => { const v = document.querySelector('video'); if (v) v.currentTime = time; },
      args: [targetTime]
    });
  } else {
    const newTab = await chrome.tabs.create({ url: video.url });
    setTimeout(async () => {
      await chrome.scripting.executeScript({
        target: { tabId: newTab.id },
        func: (time) => { const v = document.querySelector('video'); if (v) v.currentTime = time; },
        args: [targetTime]
      });
    }, 3000);
  }
}

// ---------- 保存当前点 ----------
async function prepareSave() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('无法获取当前标签页');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        function deepFindVideo(root = document) {
          let v = root.querySelector('video');
          if (v) return v;
          for (const tag of ['bwp-video', 'video-player', 'ytd-player', 'jw-video']) {
            const els = root.querySelectorAll(tag);
            for (const el of els) {
              if (el.shadowRoot) { const sv = deepFindVideo(el.shadowRoot); if (sv) return sv; }
            }
          }
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) { const sv = deepFindVideo(el.shadowRoot); if (sv) return sv; }
          }
          return null;
        }
        const video = deepFindVideo();
        if (!video) return { success: false, error: '未找到视频元素' };
        return { success: true, time: video.currentTime, title: document.title, url: window.location.href };
      }
    });
    const result = results[0]?.result;
    if (!result || !result.success) throw new Error(result?.error || '无法获取视频信息');
    pendingVideoInfo = {
      url: normalizeUrl(result.url),
      title: result.title,
      time: result.time
    };
    document.getElementById('quickSavePanel').style.display = 'block';
    document.getElementById('quickNote').value = '';
    document.getElementById('quickNote').focus();
    isConfirmMode = true;
    document.getElementById('saveBtn').textContent = '✅ 确认保存';
  } catch (err) {
    alert(`保存失败：${err.message}`);
  }
}

async function executeSave() {
  if (!pendingVideoInfo) return;
  const note = document.getElementById('quickNote').value.trim();
  let video = videos.find(v => v.id === pendingVideoInfo.url);
  if (!video) {
    video = {
      id: pendingVideoInfo.url,
      url: pendingVideoInfo.url,
      title: pendingVideoInfo.title,
      folderId: null,
      updatedAt: Date.now(),
      points: []
    };
    videos.push(video);
  }
  video.points.push({
    id: Date.now(),
    time: pendingVideoInfo.time,
    note,
    markdown: '',
    createdAt: Date.now()
  });
  video.updatedAt = Date.now();
  await saveData();
  document.getElementById('quickSavePanel').style.display = 'none';
  document.getElementById('saveBtn').textContent = '+ 保存当前点';
  isConfirmMode = false;
  pendingVideoInfo = null;
  renderVideos();
}

function onSaveClick() {
  if (!isConfirmMode) prepareSave();
  else executeSave();
}

// ---------- 添加文件夹 ----------
async function addFolder() {
  const input = document.getElementById('newFolderName');
  const name = input.value.trim();
  if (!name) { alert('请输入文件夹名称'); return; }
  folders.push({ id: 'folder_' + Date.now(), name });
  await saveData();
  input.value = '';
  renderFolderSelector();
  renderFolderManager();
  renderVideos();
}

// ---------- 导出笔记 ----------
async function exportNotes() {
  let exportVideos = [...videos];
  if (currentFilter === 'uncategorized') exportVideos = exportVideos.filter(v => !v.folderId);
  else if (currentFilter !== 'all') exportVideos = exportVideos.filter(v => v.folderId === currentFilter);
  if (exportVideos.length === 0) { alert('没有可导出的笔记'); return; }
  if (exportVideos.length === 1) exportSingleVideo(exportVideos[0]);
  else if (confirm(`将导出 ${exportVideos.length} 个视频的独立笔记文件，是否继续？`)) {
    for (const video of exportVideos) exportSingleVideo(video);
  }
}

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  document.getElementById('saveBtn').addEventListener('click', onSaveClick);
  document.getElementById('exportBtn').addEventListener('click', exportNotes);
  document.getElementById('addFolderBtn').addEventListener('click', addFolder);
  document.getElementById('quickSavePanel').style.display = 'none';
});
