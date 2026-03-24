// content.js - 全屏悬浮版，支持截图功能
let currentVideoUrl = window.location.href;
let currentVideoTitle = document.title;
let videosData = [];
let editingPointId = null;
let btn = null;
let panel = null;
let inputBox = null;
let isWaitingForNote = false;
let originalPlayState = false;

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

async function loadVideosData() {
  const data = await chrome.storage.local.get('videos');
  videosData = data.videos || [];
  console.log('[记忆点] 加载数据成功，视频数量:', videosData.length);
}

function getCurrentVideo() {
  return videosData.find(v => v.url === currentVideoUrl);
}

async function saveVideosData() {
  await chrome.storage.local.set({ videos: videosData });
  console.log('[记忆点] 数据已保存');
}

async function doSave(note, screenshot = null) {
  const videoElem = document.querySelector('video');
  if (!videoElem) {
    console.error('[记忆点] 未找到视频元素');
    return false;
  }
  const currentTime = videoElem.currentTime;
  console.log(`[记忆点] 保存时间点 ${formatTime(currentTime)}，备注：${note}`);
  let video = getCurrentVideo();
  if (!video) {
    video = {
      id: currentVideoUrl,
      url: currentVideoUrl,
      title: currentVideoTitle,
      folderId: null,
      updatedAt: Date.now(),
      points: []
    };
    videosData.push(video);
  }
  // 如果提供了截图，则使用，否则保留原有
  const newPoint = {
    id: Date.now(),
    time: currentTime,
    note: note.trim(),
    markdown: '',
    screenshot: screenshot || null,
    createdAt: Date.now()
  };
  video.points.push(newPoint);
  video.updatedAt = Date.now();
  await saveVideosData();
  renderPoints();
  return true;
}

// 截图函数
async function captureVideoFrame() {
  const videoElem = document.querySelector('video');
  if (!videoElem) return null;
  const canvas = document.createElement('canvas');
  canvas.width = videoElem.videoWidth;
  canvas.height = videoElem.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElem, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8); // 返回 base64
}

// 为已有记忆点添加截图
async function addScreenshotToPoint(videoId, pointId) {
  const video = videosData.find(v => v.id === videoId);
  if (!video) return;
  const point = video.points.find(p => p.id === pointId);
  if (!point) return;
  const screenshot = await captureVideoFrame();
  if (screenshot) {
    point.screenshot = screenshot;
    await saveVideosData();
    renderPoints(); // 刷新显示
  } else {
    alert('截图失败，请确保视频正在播放');
  }
}

function createInputBox() {
  console.log('[记忆点] 开始创建输入框');
  if (inputBox) {
    inputBox.remove();
    console.log('[记忆点] 移除已有输入框');
  }
  inputBox = document.createElement('div');
  inputBox.className = 'note-input-box';
  inputBox.style.position = 'absolute';
  inputBox.style.background = 'white';
  inputBox.style.border = '1px solid #ccc';
  inputBox.style.borderRadius = '8px';
  inputBox.style.padding = '8px';
  inputBox.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
  inputBox.style.zIndex = '10000000';
  inputBox.style.display = 'flex';
  inputBox.style.flexDirection = 'column';
  inputBox.style.gap = '6px';
  inputBox.style.minWidth = '200px';
  inputBox.style.visibility = 'hidden';
  inputBox.innerHTML = `
    <input type="text" id="note-input-field" placeholder="输入备注（可选），按回车保存" style="width:100%; padding:6px; border:1px solid #ddd; border-radius:4px; font-size:12px;" />
    <div style="display:flex; justify-content:flex-end; gap:6px;">
      <button id="cancel-note-btn" style="background:#e9ecef; border:1px solid #ced4da; padding:4px 8px; border-radius:4px; cursor:pointer;">取消</button>
    </div>
  `;

  const parent = getCurrentParent();
  parent.appendChild(inputBox);
  console.log('[记忆点] 输入框已添加到:', parent === document.body ? 'body' : 'fullscreen element');

  const boxWidth = inputBox.offsetWidth;
  const boxHeight = inputBox.offsetHeight;
  console.log(`[记忆点] 输入框尺寸: ${boxWidth} x ${boxHeight}`);

  const parentRect = parent.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const relativeLeft = btnRect.left - parentRect.left;
  const relativeTop = btnRect.top - parentRect.top;

  let left = relativeLeft - boxWidth - 10;
  if (left < 10) left = relativeLeft + btnRect.width + 10;
  if (left + boxWidth > parentRect.width - 10) left = parentRect.width - boxWidth - 10;
  let top = relativeTop - boxHeight - 10;
  if (top < 10) top = relativeTop + btnRect.height + 10;

  inputBox.style.left = `${left}px`;
  inputBox.style.top = `${top}px`;
  inputBox.style.visibility = 'visible';

  const input = inputBox.querySelector('#note-input-field');
  const cancelBtn = inputBox.querySelector('#cancel-note-btn');
  input.focus();

  input.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      console.log('[记忆点] 按回车保存');
      const note = input.value;
      const screenshot = await captureVideoFrame(); // 自动截图
      await doSave(note, screenshot);
      const videoElem = document.querySelector('video');
      if (videoElem && originalPlayState) videoElem.play();
      cleanupInput();
    }
  });

  cancelBtn.addEventListener('click', () => {
    console.log('[记忆点] 点击取消');
    cleanupInput();
  });

  const outsideClickListener = (e) => {
    if (!inputBox.contains(e.target) && e.target !== btn) {
      console.log('[记忆点] 点击外部，取消输入');
      cleanupInput();
      document.removeEventListener('click', outsideClickListener);
    }
  };
  document.addEventListener('click', outsideClickListener);
}

function cleanupInput() {
  if (inputBox) {
    inputBox.remove();
    inputBox = null;
    console.log('[记忆点] 输入框已移除');
  }
  isWaitingForNote = false;
  const videoElem = document.querySelector('video');
  if (videoElem && originalPlayState) {
    videoElem.play();
    console.log('[记忆点] 恢复视频播放');
  }
}

function onBtnClick() {
  console.log('[记忆点] 按钮点击，当前等待状态:', isWaitingForNote);
  if (isWaitingForNote) {
    const input = document.getElementById('note-input-field');
    const note = input ? input.value : '';
    console.log('[记忆点] 二次点击，保存备注:', note);
    // 二次点击时也自动截图
    (async () => {
      const screenshot = await captureVideoFrame();
      await doSave(note, screenshot);
      cleanupInput();
    })();
  } else {
    const videoElem = document.querySelector('video');
    if (videoElem) {
      originalPlayState = !videoElem.paused;
      if (!videoElem.paused) {
        videoElem.pause();
        console.log('[记忆点] 视频已暂停');
      }
    }
    isWaitingForNote = true;
    createInputBox();
  }
}

function createUI() {
  if (btn && btn.isConnected) {
    console.log('[记忆点] UI已存在，跳过创建');
    return;
  }
  console.log('[记忆点] 创建UI');
  btn = document.createElement('div');
  btn.className = 'video-memory-float-btn';
  btn.innerHTML = '📌';
  btn.title = '视频记忆点';
  btn.style.position = 'fixed';
  btn.style.bottom = '80px';
  btn.style.right = '20px';
  btn.style.width = '50px';
  btn.style.height = '50px';
  btn.style.background = '#1a73e8';
  btn.style.borderRadius = '50%';
  btn.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
  btn.style.cursor = 'pointer';
  btn.style.zIndex = '999999';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.fontSize = '24px';
  btn.style.color = 'white';
  btn.style.transition = 'transform 0.2s';
  document.body.appendChild(btn);
  console.log('[记忆点] 按钮已添加到body');

  panel = document.createElement('div');
  panel.className = 'video-memory-panel';
  panel.style.position = 'fixed';
  panel.style.bottom = '140px';
  panel.style.right = '20px';
  panel.style.width = '360px';
  panel.style.maxHeight = '500px';
  panel.style.background = 'white';
  panel.style.borderRadius = '8px';
  panel.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
  panel.style.zIndex = '999999';
  panel.style.display = 'none';
  panel.style.flexDirection = 'column';
  panel.style.overflow = 'hidden';
  panel.style.fontFamily = 'system-ui, sans-serif';
  panel.style.fontSize = '12px';
  panel.style.border = '1px solid #ddd';
  panel.innerHTML = `
    <div class="panel-header" style="background:#f0f0f0; padding:8px 12px; display:flex; justify-content:space-between; align-items:center; font-weight:bold; border-bottom:1px solid #ddd;">
      <span>📌 记忆点</span>
      <button class="close-panel" style="background:none; border:none; font-size:18px; cursor:pointer;">&times;</button>
    </div>
    <div class="panel-content" style="flex:1; overflow-y:auto; padding:12px;"></div>
  `;
  document.body.appendChild(panel);
  console.log('[记忆点] 面板已添加到body');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.style.display === 'flex') panel.style.display = 'none';
    onBtnClick();
  });
  panel.querySelector('.close-panel').addEventListener('click', () => {
    panel.style.display = 'none';
  });
}

async function renderPoints() {
  const container = document.querySelector('.video-memory-panel .panel-content');
  if (!container) return;
  const video = getCurrentVideo();
  if (!video || !video.points.length) {
    container.innerHTML = '<div style="text-align:center; padding:20px;">暂无记忆点</div>';
    return;
  }
  const sortedPoints = [...video.points].sort((a, b) => a.time - b.time);
  let html = '';
  sortedPoints.forEach(point => {
    const isEditing = editingPointId === point.id;
    html += `
      <div class="point-item" style="margin-bottom:12px; border-bottom:1px solid #eee; padding-bottom:8px;">
        <div class="point-time" style="font-weight:bold; color:#1a73e8; margin-bottom:4px;">⏱️ ${formatTime(point.time)}</div>
        ${point.note ? `<div class="point-note" style="font-size:11px; color:#666; margin-bottom:4px;">📝 ${escapeHtml(point.note)}</div>` : ''}
        ${point.screenshot ? `<div class="point-screenshot" style="margin:4px 0;"><img src="${point.screenshot}" style="max-width:100%; max-height:100px; border-radius:4px; cursor:pointer;" onclick="window.open('${point.screenshot}', '_blank');" /></div>` : ''}
        <div class="point-notes">
          <textarea class="note-editor" data-point-id="${point.id}" ${isEditing ? '' : 'readonly'} rows="2" style="width:100%; font-size:11px; font-family:monospace; padding:4px; border:1px solid #ccc; border-radius:4px; margin:4px 0;">${escapeHtml(point.markdown || '')}</textarea>
        </div>
        <div class="point-actions" style="display:flex; gap:6px; margin-top:6px;">
    `;
    if (isEditing) {
      html += `
        <button class="save-note" data-point-id="${point.id}" style="background:#28a745; color:white; border:none; padding:2px 6px; border-radius:3px; cursor:pointer;">保存</button>
        <button class="cancel-edit" data-point-id="${point.id}" style="background:#dc3545; color:white; border:none; padding:2px 6px; border-radius:3px; cursor:pointer;">取消</button>
      `;
    } else {
      html += `
        <button class="jump-point" data-time="${point.time}" style="background:#e9ecef; border:1px solid #ced4da; padding:2px 6px; border-radius:3px; cursor:pointer;">▶️ 跳转</button>
        <button class="add-screenshot" data-point-id="${point.id}" data-video-id="${video.id}" style="background:#e9ecef; border:1px solid #ced4da; padding:2px 6px; border-radius:3px; cursor:pointer;">📸 截图</button>
        <button class="edit-note" data-point-id="${point.id}" style="background:#e9ecef; border:1px solid #ced4da; padding:2px 6px; border-radius:3px; cursor:pointer;">✏️ 编辑</button>
        <button class="delete-point" data-point-id="${point.id}" style="background:#e9ecef; border:1px solid #ced4da; padding:2px 6px; border-radius:3px; cursor:pointer;">❌ 删除</button>
      `;
    }
    html += `</div></div>`;
  });
  container.innerHTML = html;

  container.querySelectorAll('.jump-point').forEach(btn => {
    btn.addEventListener('click', () => {
      const time = parseFloat(btn.dataset.time);
      const videoElem = document.querySelector('video');
      if (videoElem) videoElem.currentTime = time;
    });
  });
  container.querySelectorAll('.add-screenshot').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pointId = parseInt(btn.dataset.pointId);
      const videoId = btn.dataset.videoId;
      await addScreenshotToPoint(videoId, pointId);
    });
  });
  container.querySelectorAll('.edit-note').forEach(btn => {
    btn.addEventListener('click', () => {
      editingPointId = parseInt(btn.dataset.pointId);
      renderPoints();
    });
  });
  container.querySelectorAll('.save-note').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pointId = parseInt(btn.dataset.pointId);
      const textarea = container.querySelector(`.note-editor[data-point-id="${pointId}"]`);
      if (!textarea) return;
      const newMarkdown = textarea.value;
      const video = getCurrentVideo();
      if (video) {
        const point = video.points.find(p => p.id === pointId);
        if (point) {
          point.markdown = newMarkdown;
          await saveVideosData();
        }
      }
      editingPointId = null;
      renderPoints();
    });
  });
  container.querySelectorAll('.cancel-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      editingPointId = null;
      renderPoints();
    });
  });
  container.querySelectorAll('.delete-point').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pointId = parseInt(btn.dataset.pointId);
      const video = getCurrentVideo();
      if (!video) return;
      if (confirm('删除此记忆点？')) {
        video.points = video.points.filter(p => p.id !== pointId);
        if (video.points.length === 0) {
          videosData = videosData.filter(v => v.url !== currentVideoUrl);
        }
        await saveVideosData();
        editingPointId = null;
        renderPoints();
      }
    });
  });
}

function getCurrentParent() {
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  return fullscreenElement || document.body;
}

function moveToFullscreenContainer() {
  const parent = getCurrentParent();
  if (btn && btn.parentNode !== parent) {
    parent.appendChild(btn);
    if (parent === document.body) {
      btn.style.position = 'fixed';
      btn.style.bottom = '80px';
    } else {
      btn.style.position = 'absolute';
      btn.style.bottom = '60px';
    }
    btn.style.right = '20px';
    console.log('[记忆点] 按钮移动到', parent === document.body ? 'body' : '全屏容器');
  }
  if (panel && panel.parentNode !== parent) {
    parent.appendChild(panel);
    if (parent === document.body) {
      panel.style.position = 'fixed';
      panel.style.bottom = '140px';
    } else {
      panel.style.position = 'absolute';
      panel.style.bottom = '120px';
    }
    panel.style.right = '20px';
  }
  if (inputBox && inputBox.parentNode !== parent) {
    parent.appendChild(inputBox);
    const parentRect = parent.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const relativeLeft = btnRect.left - parentRect.left;
    const relativeTop = btnRect.top - parentRect.top;
    const boxWidth = inputBox.offsetWidth;
    const boxHeight = inputBox.offsetHeight;
    let left = relativeLeft - boxWidth - 10;
    if (left < 10) left = relativeLeft + btnRect.width + 10;
    if (left + boxWidth > parentRect.width - 10) left = parentRect.width - boxWidth - 10;
    let top = relativeTop - boxHeight - 10;
    if (top < 10) top = relativeTop + btnRect.height + 10;
    inputBox.style.left = `${left}px`;
    inputBox.style.top = `${top}px`;
    console.log('[记忆点] 输入框已移动到新容器并重新定位');
  }
}

document.addEventListener('fullscreenchange', moveToFullscreenContainer);
document.addEventListener('webkitfullscreenchange', moveToFullscreenContainer);

const titleObserver = new MutationObserver(() => {
  if (document.title !== currentVideoTitle) {
    currentVideoTitle = document.title;
    const video = getCurrentVideo();
    if (video) {
      video.title = currentVideoTitle;
      saveVideosData();
    }
  }
});
titleObserver.observe(document.querySelector('title'), { subtree: true, characterData: true, childList: true });

const ensureUI = setInterval(() => {
  if (!btn || !btn.isConnected) {
    createUI();
  } else {
    moveToFullscreenContainer();
  }
}, 3000);

(async () => {
  await loadVideosData();
  createUI();
  renderPoints();
})();

window.addEventListener('beforeunload', () => clearInterval(ensureUI));