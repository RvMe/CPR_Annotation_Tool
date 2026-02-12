// 医学影像标注工具 - 前端交互逻辑

// ===== 全局状态 =====
const appState = {
    doctorName: '',
    currentDirectory: '',
    currentFile: null,
    currentData: null,
    annotations: [],
    selectedAnnotation: null,
    editingAnnotation: null,

    // Z轴选择
    selectionStart: null,
    selectionEnd: null,
    currentZ: 0,

    // X和Y轴选择框
    selectionBoxes: {
        x: { isDrawing: false, startX: 0, startY: 0, endX: 0, endY: 0 },
        y: { isDrawing: false, startX: 0, startY: 0, endX: 0, endY: 0 }
    },

    // 视图状态 - 每个轴独立的平移
    zoom: 1.0,
    panState: {
        x: { panX: 0, panY: 0 },
        y: { panX: 0, panY: 0 },
        z: { panX: 0, panY: 0 }
    },

    // 拖动状态
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragButton: null,  // 'left', 'middle', 'right', or null

    // 窗宽窗位设置（仅用于Z轴视图）
    windowWidth: 400,
    windowLevel: 40,
    defaultWindowWidth: 400,
    defaultWindowLevel: 40,
    minIntensity: null,  // 图像数据的最小值
    maxIntensity: null,  // 图像数据的最大值

    // 保存状态
    hasUnsavedChanges: false,
    fileStates: {}  // 记录每个文件的保存状态
};

// Canvas元素
const canvases = {
    x: null,
    y: null,
    z: null
};

// 图像数据
const images = {
    x: null,
    y: null,
    z: null
};

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    initializeElements();
    initializeEventListeners();
    loadInitialState();
});

function initializeElements() {
    canvases.x = document.getElementById('xCanvas');
    canvases.y = document.getElementById('yCanvas');
    canvases.z = document.getElementById('zCanvas');
}

function initializeEventListeners() {
    // 医生信息
    document.getElementById('setDoctorBtn').addEventListener('click', setDoctor);

    // 目录设置
    document.getElementById('browseBtn').addEventListener('click', browseDirectory);
    document.getElementById('setDirBtn').addEventListener('click', setDirectory);

    // 保存
    document.getElementById('saveBtn').addEventListener('click', saveAnnotations);

    // 缩放
    document.getElementById('zoomInBtn').addEventListener('click', () => adjustZoom(1.2));
    document.getElementById('zoomOutBtn').addEventListener('click', () => adjustZoom(0.8));
    document.getElementById('resetZoomBtn').addEventListener('click', resetZoom);

    // Z轴滑块
    document.getElementById('zSlider').addEventListener('input', (e) => {
        updateZSlice(parseInt(e.target.value));
    });

    // Z轴范围输入
    document.getElementById('zStartInput').addEventListener('change', updateSelectionFromInputs);
    document.getElementById('zEndInput').addEventListener('change', updateSelectionFromInputs);
    document.getElementById('clearRangeBtn').addEventListener('click', clearSelection);

    // 标注按钮
    document.getElementById('addAnnotationBtn').addEventListener('click', addAnnotation);
    document.getElementById('updateAnnotationBtn').addEventListener('click', updateAnnotation);
    document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);
    document.getElementById('quickNormalBtn').addEventListener('click', quickAnnotateNormal);

    // Canvas交互
    setupCanvasInteraction();

    // 窗宽窗位触控板
    setupWindowLevelControl();

    // 右键菜单
    setupContextMenu();

    // 标注总结监听器
    setupAnnotationSummaryListeners();

    // 窗口大小改变时重绘
    window.addEventListener('resize', () => {
        ['x', 'y', 'z'].forEach(axis => {
            if (images[axis]) {
                drawCanvas(axis);
            }
        });
    });
}

// ===== 医生信息 =====
function setDoctor() {
    const doctorName = document.getElementById('doctorName').value.trim();
    if (!doctorName) {
        showMessage('请输入医生名字', 'error');
        return;
    }

    fetch('/api/set_doctor', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({doctor_name: doctorName})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            appState.doctorName = data.doctor_name;
            document.getElementById('doctorDisplay').innerHTML =
                `<strong>当前医生:</strong> ${data.doctor_name}`;
            showMessage(`医生设置为: ${data.doctor_name}`, 'success');
        } else {
            showMessage('设置失败: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showMessage('设置失败: ' + error, 'error');
    });
}

// ===== 目录和文件管理 =====
function browseDirectory() {
    // 显示文件夹浏览对话框
    showDirectoryBrowser();
}

function showDirectoryBrowser(startPath = '') {
    // 创建模态对话框
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'directoryBrowserModal';

    modal.innerHTML = `
        <div class="modal-content directory-browser">
            <div class="modal-header">
                <h3>选择数据目录</h3>
                <button class="modal-close" onclick="closeDirectoryBrowser()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="path-bar">
                    <button id="parentDirBtn" class="btn btn-small btn-secondary" title="上级目录">↑ 上级</button>
                    <input type="text" id="currentPathInput" readonly>
                </div>
                <div class="directory-list" id="directoryList">
                    <div class="loading">加载中...</div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeDirectoryBrowser()">取消</button>
                <button id="selectDirBtn" class="btn btn-primary">选择当前目录</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 绑定事件
    document.getElementById('parentDirBtn').addEventListener('click', navigateToParent);
    document.getElementById('selectDirBtn').addEventListener('click', selectCurrentDirectory);

    // 加载初始目录
    loadDirectoryContent(startPath);
}

function closeDirectoryBrowser() {
    const modal = document.getElementById('directoryBrowserModal');
    if (modal) {
        modal.remove();
    }
}

let currentBrowsePath = '';

function loadDirectoryContent(path) {
    fetch('/api/browse_directory', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({path: path})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            currentBrowsePath = data.current_path;
            document.getElementById('currentPathInput').value = data.current_path;

            const listContainer = document.getElementById('directoryList');
            listContainer.innerHTML = '';

            if (data.directories.length === 0) {
                listContainer.innerHTML = '<p class="placeholder">此目录下没有子文件夹</p>';
                return;
            }

            data.directories.forEach(dir => {
                const dirItem = document.createElement('div');
                dirItem.className = 'directory-item';

                const icon = document.createElement('span');
                icon.className = 'dir-icon';
                icon.textContent = '📁';

                const name = document.createElement('span');
                name.className = 'dir-name';
                name.textContent = dir.name;

                const badge = document.createElement('span');
                badge.className = 'dir-badge';
                if (dir.nrrd_count > 0) {
                    badge.textContent = `${dir.nrrd_count} 文件`;
                    badge.style.color = '#5cb85c';
                } else {
                    badge.textContent = '空';
                    badge.style.color = '#888';
                }

                dirItem.appendChild(icon);
                dirItem.appendChild(name);
                dirItem.appendChild(badge);

                // 双击进入目录
                dirItem.addEventListener('dblclick', () => {
                    loadDirectoryContent(dir.path);
                });

                // 单击选中
                dirItem.addEventListener('click', () => {
                    document.querySelectorAll('.directory-item').forEach(item => {
                        item.classList.remove('selected');
                    });
                    dirItem.classList.add('selected');
                    currentBrowsePath = dir.path;
                    document.getElementById('currentPathInput').value = dir.path;
                });

                listContainer.appendChild(dirItem);
            });

            // 启用/禁用上级按钮
            const parentBtn = document.getElementById('parentDirBtn');
            if (data.parent_path) {
                parentBtn.disabled = false;
                parentBtn.onclick = () => loadDirectoryContent(data.parent_path);
            } else {
                parentBtn.disabled = true;
            }
        } else {
            showMessage('浏览目录失败: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showMessage('浏览目录失败: ' + error, 'error');
    });
}

function navigateToParent() {
    const parentBtn = document.getElementById('parentDirBtn');
    if (!parentBtn.disabled) {
        parentBtn.click();
    }
}

function selectCurrentDirectory() {
    if (!currentBrowsePath) {
        showMessage('请选择一个目录', 'error');
        return;
    }

    document.getElementById('dataDirectory').value = currentBrowsePath;
    closeDirectoryBrowser();

    // 自动加载目录
    setDirectory();
}

function setDirectory() {
    const directory = document.getElementById('dataDirectory').value.trim();
    if (!directory) {
        showMessage('请输入目录路径', 'error');
        return;
    }

    fetch('/api/set_directory', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({directory: directory})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            appState.currentDirectory = data.directory;
            displayFileList(data.files);
            document.getElementById('fileCount').innerHTML =
                `<strong>找到 ${data.count} 个NRRD文件</strong>`;
            showMessage(`成功加载目录,找到 ${data.count} 个文件`, 'success');
        } else {
            showMessage('加载失败: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showMessage('加载失败: ' + error, 'error');
    });
}

function displayFileList(files) {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';

    if (files.length === 0) {
        fileList.innerHTML = '<p class="placeholder">目录中没有NRRD文件</p>';
        return;
    }

    files.forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';

        // 创建文件名和状态指示器
        const fileName = document.createElement('span');
        fileName.textContent = file.name;
        fileName.className = 'file-name';

        const statusIndicator = document.createElement('span');
        statusIndicator.className = 'file-status';

        // 如果后端返回了 has_annotation 标记，初始化 fileStates
        if (file.has_annotation && !appState.fileStates[file.path]) {
            appState.fileStates[file.path] = { saved: true };
        }

        // 检查是否有保存的标注
        const hasSavedAnnotation = appState.fileStates[file.path]?.saved;
        if (hasSavedAnnotation === true) {
            statusIndicator.textContent = ' ✓';
            statusIndicator.style.color = '#5cb85c';
            statusIndicator.title = '已保存标注';
        } else if (hasSavedAnnotation === false) {
            statusIndicator.textContent = ' ●';
            statusIndicator.style.color = '#d9534f';
            statusIndicator.title = '未保存标注';
        } else if (file.has_annotation) {
            // 如果后端说有标注但 fileStates 中没有记录，显示为已保存
            statusIndicator.textContent = ' ✓';
            statusIndicator.style.color = '#5cb85c';
            statusIndicator.title = '已保存标注';
        }

        fileItem.appendChild(fileName);
        fileItem.appendChild(statusIndicator);

        fileItem.title = file.path;
        fileItem.addEventListener('click', () => loadFile(file.path));
        fileList.appendChild(fileItem);
    });
}

function loadFile(filePath) {
    showMessage('正在加载文件...', 'info');

    fetch('/api/load_file', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({file_path: filePath})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            appState.currentFile = filePath;
            appState.currentData = data.info;
            appState.annotations = data.annotations || [];
            appState.currentZ = data.info.center.z;

            // 更新UI
            updateCurrentFileInfo(data.info);
            loadImages(data.slices);
            updateAnnotationsList();

            // 设置Z轴滑块
            const zSlider = document.getElementById('zSlider');
            zSlider.max = data.info.shape.z - 1;
            zSlider.value = appState.currentZ;

            // 设置Z轴输入范围
            document.getElementById('zStartInput').max = data.info.shape.z - 1;
            document.getElementById('zEndInput').max = data.info.shape.z - 1;

            // 初始化窗宽窗位（使用CT软组织窗的默认值）
            appState.windowWidth = 400;
            appState.windowLevel = 40;
            appState.defaultWindowWidth = 400;
            appState.defaultWindowLevel = 40;
            updateWindowLevelDisplay();

            // 启用保存按钮
            document.getElementById('saveBtn').disabled = false;

            // 高亮选中的文件
            document.querySelectorAll('.file-item').forEach(item => {
                item.classList.remove('active');
                if (item.title === filePath) {
                    item.classList.add('active');
                }
            });

            showMessage('文件加载成功', 'success');
        } else {
            showMessage('加载失败: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showMessage('加载失败: ' + error, 'error');
    });
}

function updateCurrentFileInfo(info) {
    const infoDiv = document.getElementById('currentFileInfo');
    infoDiv.innerHTML = `
        <strong>文件名:</strong> ${info.filename}<br>
        <strong>尺寸:</strong> ${info.shape.x} × ${info.shape.y} × ${info.shape.z}<br>
        <strong>间距:</strong> ${info.spacing.x.toFixed(2)} × ${info.spacing.y.toFixed(2)} × ${info.spacing.z.toFixed(2)} mm
    `;

    // 更新轴信息
    document.getElementById('xAxisInfo').textContent =
        `X=${info.center.x} (固定中心)`;
    document.getElementById('yAxisInfo').textContent =
        `Y=${info.center.y} (固定中心)`;
    updateZAxisInfo();
}

function updateZAxisInfo() {
    if (!appState.currentData) return;
    const info = appState.currentData;
    document.getElementById('zAxisInfo').textContent =
        `Z=${appState.currentZ} / ${info.shape.z - 1}`;
}

// ===== 图像显示 =====
function loadImages(slices) {
    loadImage('x', slices.x);
    loadImage('y', slices.y);
    loadImage('z', slices.z);
}

function loadImage(axis, base64Data) {
    const img = new Image();
    img.onload = () => {
        images[axis] = img;
        drawCanvas(axis);
    };
    img.src = base64Data;
}

function drawCanvas(axis) {
    const canvas = canvases[axis];
    const img = images[axis];

    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');

    // 设置canvas尺寸为容器大小
    const wrapper = canvas.parentElement;
    const containerWidth = wrapper.clientWidth;
    const containerHeight = wrapper.clientHeight;

    // 计算缩放后的图像尺寸
    const scale = Math.min(containerWidth / img.width, containerHeight / img.height) * appState.zoom;
    const scaledWidth = img.width * scale;
    const scaledHeight = img.height * scale;

    // 设置canvas尺寸
    canvas.width = containerWidth;
    canvas.height = containerHeight;

    // 清空
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 计算居中位置并应用平移（每个轴独立）
    const x = (containerWidth - scaledWidth) / 2 + appState.panState[axis].panX;
    const y = (containerHeight - scaledHeight) / 2 + appState.panState[axis].panY;

    // 绘制图像
    ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

    // 对所有轴应用窗宽窗位
    applyWindowLevel(ctx, x, y, scaledWidth, scaledHeight);

    // 在X和Y轴CPR视图上绘制标注区间和当前Z线
    if (axis === 'x' || axis === 'y') {
        drawAnnotationsOnCPR(ctx, axis, x, y, scaledWidth, scaledHeight);
        drawCurrentZLine(ctx, axis, x, y, scaledWidth, scaledHeight);
        drawSelectionBoundaries(ctx, axis, x, y, scaledWidth, scaledHeight);  // 绘制框选边界
        drawSelectionBox(ctx, axis, x, y, scaledWidth, scaledHeight);
    }

    // 在Z轴视图上绘制标注和选择
    if (axis === 'z') {
        drawAnnotationsOnZ(ctx, x, y, scaledWidth, scaledHeight);
        drawSelectionOnZ(ctx, x, y, scaledWidth, scaledHeight);
    }
}

// 应用窗宽窗位到Z轴图像
function applyWindowLevel(ctx, imgX, imgY, imgWidth, imgHeight) {
    try {
        // 读取图像像素数据
        const imageData = ctx.getImageData(imgX, imgY, imgWidth, imgHeight);
        const data = imageData.data;

        // 计算窗宽窗位的显示范围
        const minValue = appState.windowLevel - appState.windowWidth / 2;
        const maxValue = appState.windowLevel + appState.windowWidth / 2;

        // 遍历所有像素
        for (let i = 0; i < data.length; i += 4) {
            // 获取灰度值（假设R=G=B）
            const gray = data[i];

            // 应用窗宽窗位映射
            let newGray;
            if (gray <= minValue) {
                newGray = 0;  // 低于窗口下限，显示为黑色
            } else if (gray >= maxValue) {
                newGray = 255;  // 高于窗口上限，显示为白色
            } else {
                // 线性映射到 [0, 255]
                newGray = ((gray - minValue) / (maxValue - minValue)) * 255;
            }

            // 更新RGB值（保持灰度图）
            data[i] = newGray;      // R
            data[i + 1] = newGray;  // G
            data[i + 2] = newGray;  // B
            // data[i + 3] 是 alpha，保持不变
        }

        // 将处理后的图像数据写回canvas
        ctx.putImageData(imageData, imgX, imgY);
    } catch (e) {
        // 如果出错（例如跨域问题），静默失败
        console.error('应用窗宽窗位失败:', e);
    }
}

function drawAnnotationsOnZ(ctx, imgX, imgY, imgWidth, imgHeight) {
    if (!appState.currentData) return;

    // 绘制已保存的标注
    appState.annotations.forEach(ann => {
        if (ann.z_start <= appState.currentZ && appState.currentZ <= ann.z_end) {
            // 当前Z在标注范围内,绘制边框
            ctx.strokeStyle = getAnnotationColor(ann);
            ctx.lineWidth = 3;
            ctx.strokeRect(imgX, imgY, imgWidth, imgHeight);
        }
    });
}

function drawSelectionOnZ(ctx, imgX, imgY, imgWidth, imgHeight) {
    if (appState.selectionStart === null || appState.selectionEnd === null) return;

    // 绘制黄色选择指示
    if (appState.selectionStart <= appState.currentZ &&
        appState.currentZ <= appState.selectionEnd) {
        ctx.strokeStyle = '#ffeb3b';
        ctx.lineWidth = 4;
        ctx.strokeRect(imgX + 2, imgY + 2, imgWidth - 4, imgHeight - 4);
    }
}

// 在X/Y CPR视图上绘制已标注区间(彩色条块)
function drawAnnotationsOnCPR(ctx, axis, imgX, imgY, imgWidth, imgHeight) {
    if (!appState.currentData || !appState.annotations.length) return;

    const zMax = appState.currentData.shape.z - 1;

    appState.annotations.forEach(ann => {
        // 计算标注区间在图像上的Y坐标(垂直方向是Z轴)
        const startY = imgY + (ann.z_start / zMax) * imgHeight;
        const endY = imgY + (ann.z_end / zMax) * imgHeight;
        const height = endY - startY;

        // 根据标注类型选择颜色
        const color = getAnnotationDisplayColor(ann);

        // 绘制半透明色块
        ctx.fillStyle = color + '60';  // 添加透明度
        ctx.fillRect(imgX, startY, imgWidth, height);

        // 绘制边框
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(imgX, startY, imgWidth, height);

        // 如果是选中的标注,高亮显示
        if (appState.selectedAnnotation &&
            appState.selectedAnnotation.annotation_id === ann.annotation_id) {
            ctx.strokeStyle = '#ffeb3b';
            ctx.lineWidth = 4;
            ctx.strokeRect(imgX - 2, startY - 2, imgWidth + 4, height + 4);
        }
    });
}

// 在X/Y CPR视图上绘制当前Z位置的红线
function drawCurrentZLine(ctx, axis, imgX, imgY, imgWidth, imgHeight) {
    if (!appState.currentData) return;

    const zMax = appState.currentData.shape.z - 1;
    const lineY = imgY + (appState.currentZ / zMax) * imgHeight;

    // 保存上下文状态
    ctx.save();

    // 绘制阴影效果（使线条更突出但不遮挡内容）
    ctx.shadowColor = 'rgba(255, 0, 0, 0.6)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // 绘制虚线红线，半透明
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.1)';  // 红色，10%不透明（和绿线一样）
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);  // 虚线样式：8px实线，4px间隔
    ctx.beginPath();
    ctx.moveTo(imgX, lineY);
    ctx.lineTo(imgX + imgWidth, lineY);
    ctx.stroke();

    // 恢复上下文状态
    ctx.restore();
}

// 在X/Y CPR视图上绘制选择区间的边界线（z-start和z-end）
function drawSelectionBoundaries(ctx, axis, imgX, imgY, imgWidth, imgHeight) {
    if (!appState.currentData) return;

    // 检查是否有选择区间
    if (appState.selectionStart === null || appState.selectionEnd === null) return;

    const zMax = appState.currentData.shape.z - 1;
    const zStart = Math.min(appState.selectionStart, appState.selectionEnd);
    const zEnd = Math.max(appState.selectionStart, appState.selectionEnd);

    // 计算两条边界线的Y位置
    const startLineY = imgY + (zStart / zMax) * imgHeight;
    const endLineY = imgY + (zEnd / zMax) * imgHeight;

    // 保存上下文状态
    ctx.save();

    // 绘制绿色边界线，表示选择区间
    ctx.shadowColor = 'rgba(0, 255, 0, 0.6)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = 'rgba(0, 255, 0, 0.1)';  // 绿色，10%不透明
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);  // 虚线样式：6px实线，3px间隔

    // 绘制起始线
    ctx.beginPath();
    ctx.moveTo(imgX, startLineY);
    ctx.lineTo(imgX + imgWidth, startLineY);
    ctx.stroke();

    // 绘制结束线
    ctx.beginPath();
    ctx.moveTo(imgX, endLineY);
    ctx.lineTo(imgX + imgWidth, endLineY);
    ctx.stroke();

    // 在线条旁边添加标签
    ctx.setLineDash([]);
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
    ctx.shadowBlur = 2;

    // Z-start标签
    const startLabel = `Z-start: ${zStart}`;
    const startLabelWidth = ctx.measureText(startLabel).width;
    ctx.fillText(startLabel, imgX + imgWidth - startLabelWidth - 5, startLineY - 5);

    // Z-end标签
    const endLabel = `Z-end: ${zEnd}`;
    const endLabelWidth = ctx.measureText(endLabel).width;
    ctx.fillText(endLabel, imgX + imgWidth - endLabelWidth - 5, endLineY + 15);

    // 恢复上下文状态
    ctx.restore();
}

// 根据标注属性返回显示颜色
function getAnnotationDisplayColor(ann) {
    // 优先按presence显示
    if (ann.presence === -1) return '#808080';  // 无斑块:灰色
    if (ann.presence === 1) {
        // 有斑块,按type_main显示
        if (ann.type_main === 1) return '#87CEEB';  // 钙化:天蓝色
        if (ann.type_main === 2) return '#FFA500';  // 非钙化:橙色
        if (ann.type_main === 3) return '#9370DB';  // 混合:紫色
        return '#FFD700';  // 不确定:金色
    }
    if (ann.presence === 0) return '#FFFF00';  // 怀疑有:黄色
    return '#A9A9A9';  // 无法判断:深灰色
}

// 在X和Y轴视图上绘制选择框
function drawSelectionBox(ctx, axis, imgX, imgY, imgWidth, imgHeight) {
    const selectionBox = appState.selectionBoxes[axis];
    if (!selectionBox || !selectionBox.isDrawing) return;

    const { startX, startY, endX, endY } = selectionBox;

    // 绘制选择框
    ctx.strokeStyle = '#ffeb3b';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    ctx.strokeRect(x, y, width, height);

    // 半透明填充
    ctx.fillStyle = 'rgba(255, 235, 59, 0.1)';
    ctx.fillRect(x, y, width, height);

    ctx.setLineDash([]);
}

function getAnnotationColor(ann) {
    // 根据标注属性返回颜色
    if (ann.confidence === 2) return '#4caf50';  // 高置信度:绿色
    if (ann.confidence === 1) return '#2196f3';  // 中置信度:蓝色
    return '#ff9800';  // 低置信度:橙色
}

// ===== Z轴切片更新 =====
function updateZSlice(z) {
    appState.currentZ = z;
    updateZAxisInfo();

    // 重新绘制X和Y轴视图以更新当前Z位置的红线
    ['x', 'y'].forEach(axis => {
        if (images[axis]) {
            drawCanvas(axis);
        }
    });

    // 重新加载Z轴切片
    fetch('/api/get_slice', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({axis: 'z', index: z})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadImage('z', data.slice);
        }
    })
    .catch(error => {
        console.error('获取切片失败:', error);
    });
}

// ===== 工具和交互 =====
function adjustZoom(factor) {
    appState.zoom *= factor;
    appState.zoom = Math.max(0.5, Math.min(appState.zoom, 5.0));

    // 重新绘制所有canvas
    ['x', 'y', 'z'].forEach(axis => {
        if (images[axis]) {
            drawCanvas(axis);
        }
    });
}

function resetZoom() {
    appState.zoom = 1.0;
    appState.panState.x = { panX: 0, panY: 0 };
    appState.panState.y = { panX: 0, panY: 0 };
    appState.panState.z = { panX: 0, panY: 0 };

    ['x', 'y', 'z'].forEach(axis => {
        if (images[axis]) {
            drawCanvas(axis);
        }
    });
}

// ===== Canvas交互 =====
function setupCanvasInteraction() {
    // 为每个canvas设置交互
    ['x', 'y', 'z'].forEach(axis => {
        const canvas = canvases[axis];

        // 鼠标滚轮缩放
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            appState.zoom *= zoomFactor;
            appState.zoom = Math.max(0.5, Math.min(appState.zoom, 5.0));
            drawCanvas(axis);
        });

        // 鼠标按下
        canvas.addEventListener('mousedown', (e) => {
            e.preventDefault();
            appState.isDragging = true;
            appState.dragStartX = e.offsetX;
            appState.dragStartY = e.offsetY;

            // 左键: 框选（在X/Y轴）
            if (e.button === 0) {
                appState.dragButton = 'left';

                if (axis === 'x' || axis === 'y') {
                    appState.selectionBoxes[axis] = {
                        isDrawing: true,
                        startX: e.offsetX,
                        startY: e.offsetY,
                        endX: e.offsetX,
                        endY: e.offsetY
                    };
                }
            }
            // 中键: 平移
            else if (e.button === 1) {
                appState.dragButton = 'middle';
                canvas.style.cursor = 'move';
            }
            // 右键: 拖动Z轴滑块
            else if (e.button === 2) {
                appState.dragButton = 'right';
            }
        });

        // 鼠标移动
        canvas.addEventListener('mousemove', (e) => {
            // 显示悬停信息
            updateHoverInfo(e, axis, canvas);

            if (!appState.isDragging) return;

            const deltaX = e.offsetX - appState.dragStartX;
            const deltaY = e.offsetY - appState.dragStartY;

            // 左键拖动 - 框选
            if (appState.dragButton === 'left') {
                if ((axis === 'x' || axis === 'y') && appState.selectionBoxes[axis].isDrawing) {
                    appState.selectionBoxes[axis].endX = e.offsetX;
                    appState.selectionBoxes[axis].endY = e.offsetY;
                    drawCanvas(axis);
                }
            }
            // 中键拖动 - 平移（独立平移每个轴）
            else if (appState.dragButton === 'middle') {
                appState.panState[axis].panX += deltaX;
                appState.panState[axis].panY += deltaY;
                appState.dragStartX = e.offsetX;
                appState.dragStartY = e.offsetY;
                // 只重绘当前轴
                drawCanvas(axis);
            }
            // 右键拖动 - Z轴调整
            else if (appState.dragButton === 'right') {
                if (!appState.currentData) return;

                // 根据垂直移动量调整Z轴
                const sensitivity = 0.5;
                const zChange = Math.round(-deltaY * sensitivity);

                if (zChange !== 0) {
                    let newZ = appState.currentZ + zChange;
                    newZ = Math.max(0, Math.min(newZ, appState.currentData.shape.z - 1));

                    if (newZ !== appState.currentZ) {
                        document.getElementById('zSlider').value = newZ;
                        updateZSlice(newZ);
                        appState.dragStartY = e.offsetY;
                    }
                }
            }
        });

        // 鼠标松开
        canvas.addEventListener('mouseup', (e) => {
            if (!appState.isDragging) return;

            // 左键松开 - 完成框选
            if (appState.dragButton === 'left') {
                if ((axis === 'x' || axis === 'y') && appState.selectionBoxes[axis].isDrawing) {
                    // 计算选择框对应的Z轴范围
                    calculateZRangeFromBox(axis);

                    // 清除选择框
                    appState.selectionBoxes[axis].isDrawing = false;
                    drawCanvas(axis);
                }
            }

            // 中键松开 - 恢复光标
            if (appState.dragButton === 'middle') {
                canvas.style.cursor = 'grab';
            }

            appState.isDragging = false;
            appState.dragButton = null;
        });

        // 右键菜单（用于选择已标记色块并编辑/删除）
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // 如果不是拖动操作，显示右键菜单
            if (!appState.isDragging) {
                // TODO: 添加右键菜单逻辑，检测是否点击在标注色块上
                // 目前保持原有逻辑
            }
        });

        // 设置默认光标
        canvas.style.cursor = 'grab';
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        if (!appState.currentData) return;

        // 上下箭头调整Z
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            let newZ = appState.currentZ;
            if (e.key === 'ArrowUp') newZ++;
            if (e.key === 'ArrowDown') newZ--;

            newZ = Math.max(0, Math.min(newZ, appState.currentData.shape.z - 1));

            document.getElementById('zSlider').value = newZ;
            updateZSlice(newZ);
        }
    });
}

// ===== 窗宽窗位控制 =====
function setupWindowLevelControl() {
    const touchpad = document.getElementById('wlTouchpad');
    const resetBtn = document.getElementById('wlResetBtn');

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startLevel = 0;

    // 鼠标按下
    touchpad.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = appState.windowWidth;
        startLevel = appState.windowLevel;
        e.preventDefault();
    });

    // 鼠标移动
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        // 计算拖动距离
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        // 左右拖动调整窗宽（对比度）
        // 灵敏度：每移动1像素，窗宽改变2
        const widthSensitivity = 2;
        appState.windowWidth = Math.max(1, startWidth + deltaX * widthSensitivity);

        // 上下拖动调整窗位（亮度）
        // 注意：向下拖动（deltaY正）应该减小窗位（图像变亮）
        // 灵敏度：每移动1像素，窗位改变1
        const levelSensitivity = 1;
        appState.windowLevel = startLevel - deltaY * levelSensitivity;

        // 更新显示
        updateWindowLevelDisplay();

        // 重绘所有视图
        ['x', 'y', 'z'].forEach(axis => {
            if (images[axis]) {
                drawCanvas(axis);
            }
        });
    });

    // 鼠标松开
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
        }
    });

    // 重置按钮
    resetBtn.addEventListener('click', () => {
        appState.windowWidth = appState.defaultWindowWidth;
        appState.windowLevel = appState.defaultWindowLevel;
        updateWindowLevelDisplay();
        // 重绘所有视图
        ['x', 'y', 'z'].forEach(axis => {
            if (images[axis]) {
                drawCanvas(axis);
            }
        });
    });
}

function updateWindowLevelDisplay() {
    const wlText = `窗宽: ${Math.round(appState.windowWidth)} | 窗位: ${Math.round(appState.windowLevel)}`;
    document.getElementById('wlInfoText').textContent = wlText;
}

// 更新悬停信息显示
function updateHoverInfo(e, axis, canvas) {
    if (!appState.currentData || !images[axis]) return;

    const img = images[axis];
    const containerWidth = canvas.width;
    const containerHeight = canvas.height;
    const scale = Math.min(containerWidth / img.width, containerHeight / img.height) * appState.zoom;
    const scaledWidth = img.width * scale;
    const scaledHeight = img.height * scale;
    const imgX = (containerWidth - scaledWidth) / 2 + appState.panState[axis].panX;
    const imgY = (containerHeight - scaledHeight) / 2 + appState.panState[axis].panY;

    // 检查鼠标是否在图像范围内
    if (e.offsetX < imgX || e.offsetX > imgX + scaledWidth ||
        e.offsetY < imgY || e.offsetY > imgY + scaledHeight) {
        document.getElementById('hoverInfo').textContent = '悬停: --';
        return;
    }

    // 计算在原始图像上的坐标
    const relX = (e.offsetX - imgX) / scaledWidth;
    const relY = (e.offsetY - imgY) / scaledHeight;
    const pixelX = Math.floor(relX * img.width);
    const pixelY = Math.floor(relY * img.height);

    // 对于X/Y轴视图,Y方向对应Z轴
    let infoText = '';
    if (axis === 'x' || axis === 'y') {
        const z = Math.floor(relY * appState.currentData.shape.z);
        infoText = `Z=${z} | X=${pixelX} | Y=${pixelY}`;
    } else {
        infoText = `Z=${appState.currentZ} | X=${pixelX} | Y=${pixelY}`;
    }

    document.getElementById('hoverInfo').textContent = infoText;
}

// 计算标注覆盖率
function calculateAnnotationProgress() {
    if (!appState.currentData || appState.annotations.length === 0) {
        return 0;
    }

    const zMax = appState.currentData.shape.z;
    const covered = new Set();

    // 标记所有被标注覆盖的z索引
    appState.annotations.forEach(ann => {
        for (let z = ann.z_start; z <= ann.z_end; z++) {
            covered.add(z);
        }
    });

    const coverage = (covered.size / zMax) * 100;
    return Math.round(coverage);
}

// 更新进度条显示
function updateProgressBar() {
    const progress = calculateAnnotationProgress();
    document.getElementById('progressBar').style.width = progress + '%';
    document.getElementById('progressText').textContent = progress + '%';
}
function calculateZRangeFromBox(axis) {
    if (!appState.currentData) return;

    const box = appState.selectionBoxes[axis];
    const canvas = canvases[axis];
    const img = images[axis];

    if (!img) return;

    // 计算图像在canvas上的位置和尺寸
    const containerWidth = canvas.width;
    const containerHeight = canvas.height;
    const scale = Math.min(containerWidth / img.width, containerHeight / img.height) * appState.zoom;
    const scaledWidth = img.width * scale;
    const scaledHeight = img.height * scale;
    const imgX = (containerWidth - scaledWidth) / 2 + appState.panState[axis].panX;
    const imgY = (containerHeight - scaledHeight) / 2 + appState.panState[axis].panY;

    // 将选择框坐标转换为图像坐标
    const boxStartY = Math.min(box.startY, box.endY) - imgY;
    const boxEndY = Math.max(box.startY, box.endY) - imgY;

    // 转换为Z轴索引(Y轴对应Z轴)
    const zStart = Math.floor((boxStartY / scaledHeight) * img.height);
    const zEnd = Math.floor((boxEndY / scaledHeight) * img.height);

    // 设置选择范围
    appState.selectionStart = Math.max(0, Math.min(zStart, appState.currentData.shape.z - 1));
    appState.selectionEnd = Math.max(0, Math.min(zEnd, appState.currentData.shape.z - 1));

    updateSelectionDisplay();
    enableAnnotationButton();

    // 如果当前处于编辑模式，自动退出编辑，进入添加标注模式
    if (appState.editingAnnotation) {
        cancelEdit();
    }
}

// ===== 选择管理 =====
function updateSelectionDisplay() {
    if (appState.selectionStart === null || appState.selectionEnd === null) {
        return;
    }

    const start = Math.min(appState.selectionStart, appState.selectionEnd);
    const end = Math.max(appState.selectionStart, appState.selectionEnd);

    document.getElementById('zStartInput').value = start;
    document.getElementById('zEndInput').value = end;

    // 重绘所有视图以显示选择边界线
    ['x', 'y', 'z'].forEach(axis => {
        if (images[axis]) {
            drawCanvas(axis);
        }
    });
}

function updateSelectionFromInputs() {
    const start = parseInt(document.getElementById('zStartInput').value);
    const end = parseInt(document.getElementById('zEndInput').value);

    if (!isNaN(start) && !isNaN(end)) {
        appState.selectionStart = start;
        appState.selectionEnd = end;
        updateSelectionDisplay();
        enableAnnotationButton();
    }
}

function clearSelection() {
    appState.selectionStart = null;
    appState.selectionEnd = null;
    document.getElementById('zStartInput').value = 0;
    document.getElementById('zEndInput').value = 0;
    document.getElementById('addAnnotationBtn').disabled = true;

    // 重绘所有视图以清除选择边界线
    ['x', 'y', 'z'].forEach(axis => {
        if (images[axis]) {
            drawCanvas(axis);
        }
    });
}

function enableAnnotationButton() {
    const hasSelection = appState.selectionStart !== null &&
                        appState.selectionEnd !== null;
    document.getElementById('addAnnotationBtn').disabled = !hasSelection;
    document.getElementById('quickNormalBtn').disabled = !hasSelection;
}

// ===== 快速标注功能 =====
function quickAnnotateNormal() {
    if (appState.selectionStart === null || appState.selectionEnd === null) {
        showMessage('请先选择Z轴范围', 'error');
        return;
    }

    // 设置典型正常段的值
    document.querySelector('input[name="presence"][value="-1"]').checked = true;  // 无斑块
    document.querySelector('input[name="typeMain"][value="0"]').checked = true;   // 不确定(因为无斑块)
    document.querySelectorAll('input[name="typeExclude"]').forEach(cb => cb.checked = false);
    document.querySelector('input[name="stenosis"][value="0"]').checked = true;   // <25%
    document.querySelector('input[name="confidence"][value="2"]').checked = true; // 高置信度

    // 自动添加标注
    addAnnotation();
}

// ===== 标注管理 =====
function addAnnotation() {
    if (appState.selectionStart === null || appState.selectionEnd === null) {
        showMessage('请先选择Z轴范围', 'error');
        return;
    }

    const annotationData = collectAnnotationData();

    fetch('/api/add_annotation', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(annotationData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            appState.annotations.push(data.annotation);
            appState.hasUnsavedChanges = true;
            markFileAsUnsaved(appState.currentFile);
            updateAnnotationsList();
            clearSelection();
            clearAnnotationForm();
            showMessage('标注已添加', 'success');
        } else {
            showMessage('添加失败: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showMessage('添加失败: ' + error, 'error');
    });
}

// 标记文件为未保存状态
function markFileAsUnsaved(filePath) {
    if (filePath) {
        appState.fileStates[filePath] = { saved: false };
        // 重新显示文件列表以更新状态指示器
        if (appState.currentDirectory) {
            // 不重新加载,只更新UI
            document.querySelectorAll('.file-item').forEach(item => {
                if (item.title === filePath) {
                    const statusIndicator = item.querySelector('.file-status');
                    if (statusIndicator) {
                        statusIndicator.textContent = ' ●';
                        statusIndicator.style.color = '#d9534f';
                        statusIndicator.title = '未保存标注';
                    }
                }
            });
        }
    }
}

// 标记文件为已保存状态
function markFileAsSaved(filePath) {
    if (filePath) {
        appState.fileStates[filePath] = { saved: true };
        // 更新UI
        document.querySelectorAll('.file-item').forEach(item => {
            if (item.title === filePath) {
                const statusIndicator = item.querySelector('.file-status');
                if (statusIndicator) {
                    statusIndicator.textContent = ' ✓';
                    statusIndicator.style.color = '#5cb85c';
                    statusIndicator.title = '已保存标注';
                }
            }
        });
    }
}

function updateAnnotation() {
    if (!appState.editingAnnotation) return;

    const annotationData = collectAnnotationData();

    fetch('/api/update_annotation', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            annotation_id: appState.editingAnnotation.annotation_id,
            data: annotationData
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // 刷新标注列表
            refreshAnnotations();
            cancelEdit();
            showMessage('标注已更新', 'success');
        } else {
            showMessage('更新失败: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showMessage('更新失败: ' + error, 'error');
    });
}

function deleteAnnotation(annotationId) {
    fetch('/api/delete_annotation', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({annotation_id: annotationId})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            refreshAnnotations();
            showMessage('标注已删除', 'success');
        } else {
            showMessage('删除失败: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showMessage('删除失败: ' + error, 'error');
    });
}

function collectAnnotationData() {
    const start = Math.min(appState.selectionStart, appState.selectionEnd);
    const end = Math.max(appState.selectionStart, appState.selectionEnd);

    // 收集表单数据
    const presence = getRadioValue('presence');
    const typeMain = getRadioValue('typeMain');
    const typeExclude = getCheckboxValues('typeExclude');
    const stenosis = getRadioValue('stenosis');
    const confidence = getRadioValue('confidence');

    return {
        z_start: start,
        z_end: end,
        presence: presence === 'null' ? null : parseInt(presence),
        type_main: parseInt(typeMain),
        type_exclude: typeExclude,
        stenosis: parseInt(stenosis),
        confidence: parseInt(confidence)
    };
}

function getRadioValue(name) {
    const radio = document.querySelector(`input[name="${name}"]:checked`);
    return radio ? radio.value : null;
}

function getCheckboxValues(name) {
    const checkboxes = document.querySelectorAll(`input[name="${name}"]:checked`);
    return Array.from(checkboxes).map(cb => cb.value);
}

function clearAnnotationForm() {
    // 重置为优化后的默认值
    document.querySelector('input[name="presence"][value="1"]').checked = true;  // 有斑块
    // 维度B: 不设置默认值（取消所有选中）
    document.querySelectorAll('input[name="typeMain"]').forEach(rb => rb.checked = false);
    // 维度C: 清空多选框
    document.querySelectorAll('input[name="typeExclude"]').forEach(cb => cb.checked = false);
    // 维度D: 不设置默认值（取消所有选中）
    document.querySelectorAll('input[name="stenosis"]').forEach(rb => rb.checked = false);
    // 维度E: 高置信度
    document.querySelector('input[name="confidence"][value="2"]').checked = true;

    // 更新标注总结
    updateAnnotationSummary();
}

// 更新标注总结显示
function updateAnnotationSummary() {
    const summaryDiv = document.getElementById('annotationSummary');

    // 获取各维度的值
    const presenceVal = getRadioValue('presence');
    const typeMainVal = getRadioValue('typeMain');
    const typeExcludeVals = getCheckboxValues('typeExclude');
    const stenosisVal = getRadioValue('stenosis');
    const confidenceVal = getRadioValue('confidence');

    // 映射维度E (置信度)
    const confidenceMap = {
        '2': '高',
        '1': '中',
        '0': '低'
    };

    // 映射维度A (斑块存在性)
    const presenceMap = {
        '1': '有斑块',
        '0': '怀疑有斑块',
        '-1': '无斑块',
        'null': '无法判断是否有斑块'
    };

    // 映射维度B (斑块类型)
    const typeMainMap = {
        '0': '不确定类型',
        '1': '钙化',
        '2': '非钙化',
        '3': '混合'
    };

    // 映射维度C (排除类型)
    const typeExcludeMap = {
        'not_CP': '钙化',
        'not_NCP': '非钙化',
        'not_MP': '混合'
    };

    // 映射维度D (狭窄程度)
    const stenosisMap = {
        '0': '<25%',
        '1': '25-49%',
        '2': '50-69%',
        '3': '≥70%',
        '4': '无法判断'
    };

    // 检查是否有足够的选择来生成总结
    if (!confidenceVal || !presenceVal) {
        summaryDiv.className = 'summary-placeholder';
        summaryDiv.textContent = '请完成上述选项以生成总结';
        return;
    }

    // 构建总结文本
    let summary = `我${confidenceMap[confidenceVal]}置信度认为,该区间${presenceMap[presenceVal]}`;

    // 添加类型信息 (维度B)
    if (typeMainVal) {
        summary += `,是${typeMainMap[typeMainVal]}斑块`;
    }

    // 添加排除类型 (维度C)
    if (typeExcludeVals.length > 0) {
        const excludeTypes = typeExcludeVals.map(v => typeExcludeMap[v]).join('、');
        summary += `,确定不是${excludeTypes}`;
    }

    // 添加狭窄程度 (维度D)
    if (stenosisVal) {
        if (stenosisVal === '4') {
            summary += `,狭窄程度无法判断`;
        } else {
            summary += `,狭窄程度大约为${stenosisMap[stenosisVal]}`;
        }
    }

    summary += '。';

    summaryDiv.className = 'summary-text';
    summaryDiv.textContent = summary;
}

// 设置标注总结的事件监听器
function setupAnnotationSummaryListeners() {
    // 监听所有单选按钮变化
    document.querySelectorAll('input[name="presence"], input[name="typeMain"], input[name="stenosis"], input[name="confidence"]').forEach(radio => {
        radio.addEventListener('change', updateAnnotationSummary);
    });

    // 监听所有复选框变化
    document.querySelectorAll('input[name="typeExclude"]').forEach(checkbox => {
        checkbox.addEventListener('change', updateAnnotationSummary);
    });
}

function cancelEdit() {
    appState.editingAnnotation = null;
    clearSelection();
    clearAnnotationForm();

    document.getElementById('addAnnotationBtn').style.display = 'block';
    document.getElementById('updateAnnotationBtn').style.display = 'none';
    document.getElementById('cancelEditBtn').style.display = 'none';
}

// ===== 标注列表显示 =====
function updateAnnotationsList() {
    const listContainer = document.getElementById('annotationsList');
    listContainer.innerHTML = '';

    if (appState.annotations.length === 0) {
        listContainer.innerHTML = '<p class="placeholder">暂无标注</p>';
        updateProgressBar();
        return;
    }

    appState.annotations.forEach(ann => {
        const item = createAnnotationListItem(ann);
        listContainer.appendChild(item);
    });

    // 更新进度条
    updateProgressBar();

    // 重绘X和Y视图以显示标注
    ['x', 'y'].forEach(axis => {
        if (images[axis]) {
            drawCanvas(axis);
        }
    });
}

function createAnnotationListItem(ann) {
    const item = document.createElement('div');
    item.className = 'annotation-item';
    item.dataset.annotationId = ann.annotation_id;

    const presenceText = getPresenceText(ann.presence);
    const typeText = getTypeText(ann.type_main);
    const stenosisText = getStenosisText(ann.stenosis);
    const confidenceText = getConfidenceText(ann.confidence);

    item.innerHTML = `
        <div class="ann-range">Z: ${ann.z_start} - ${ann.z_end}</div>
        <div class="ann-details">
            ${presenceText} | ${typeText}<br>
            狭窄: ${stenosisText} | 置信: ${confidenceText}
        </div>
    `;

    // 点击列表项:选中并高亮显示
    item.addEventListener('click', (e) => {
        // 如果不是右键菜单事件
        if (!e.defaultPrevented) {
            selectAnnotation(ann);
        }
    });

    // 右键菜单
    item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, ann);
    });

    return item;
}

// 选中标注并高亮显示
function selectAnnotation(ann) {
    appState.selectedAnnotation = ann;

    // 高亮列表项
    document.querySelectorAll('.annotation-item').forEach(item => {
        item.classList.remove('selected');
        if (item.dataset.annotationId === ann.annotation_id) {
            item.classList.add('selected');
        }
    });

    // 跳转到标注的中间Z位置
    const midZ = Math.floor((ann.z_start + ann.z_end) / 2);
    document.getElementById('zSlider').value = midZ;
    updateZSlice(midZ);

    // 重绘X和Y视图以显示高亮
    ['x', 'y'].forEach(axis => {
        if (images[axis]) {
            drawCanvas(axis);
        }
    });

    // 自动进入编辑模式
    editAnnotation(ann);
}

function getPresenceText(presence) {
    if (presence === 1) return '有斑块';
    if (presence === -1) return '无斑块';
    if (presence === 0) return '怀疑有';
    return '无法判断';
}

function getTypeText(typeMain) {
    const types = ['不确定', '钙化', '非钙化', '混合'];
    return types[typeMain] || '未知';
}

function getStenosisText(stenosis) {
    const levels = ['<25%', '25-49%', '50-69%', '≥70%', '无法判断'];
    return levels[stenosis] || '未知';
}

function getConfidenceText(confidence) {
    const levels = ['低', '中', '高'];
    return levels[confidence] || '未知';
}

// ===== 右键菜单 =====
function setupContextMenu() {
    const contextMenu = document.getElementById('contextMenu');

    document.getElementById('deleteAnnotationMenu').addEventListener('click', () => {
        if (appState.selectedAnnotation) {
            deleteAnnotation(appState.selectedAnnotation.annotation_id);
        }
        hideContextMenu();
    });

    // 点击其他地方关闭菜单
    document.addEventListener('click', hideContextMenu);
}

function showContextMenu(x, y, annotation) {
    appState.selectedAnnotation = annotation;
    const menu = document.getElementById('contextMenu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
}

function hideContextMenu() {
    document.getElementById('contextMenu').style.display = 'none';
}

function editAnnotation(ann) {
    appState.editingAnnotation = ann;

    // 设置选择范围
    appState.selectionStart = ann.z_start;
    appState.selectionEnd = ann.z_end;
    updateSelectionDisplay();

    // 填充表单
    if (ann.presence === null) {
        document.querySelector('input[name="presence"][value="null"]').checked = true;
    } else {
        document.querySelector(`input[name="presence"][value="${ann.presence}"]`).checked = true;
    }
    document.querySelector(`input[name="typeMain"][value="${ann.type_main}"]`).checked = true;
    document.querySelector(`input[name="stenosis"][value="${ann.stenosis}"]`).checked = true;
    document.querySelector(`input[name="confidence"][value="${ann.confidence}"]`).checked = true;

    // 设置多选
    document.querySelectorAll('input[name="typeExclude"]').forEach(cb => {
        cb.checked = ann.type_exclude.includes(cb.value);
    });

    // 更新标注总结
    updateAnnotationSummary();

    // 切换按钮
    document.getElementById('addAnnotationBtn').style.display = 'none';
    document.getElementById('updateAnnotationBtn').style.display = 'block';
    document.getElementById('cancelEditBtn').style.display = 'block';
}

// ===== 保存标注 =====
function saveAnnotations() {
    fetch('/api/save_annotations', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'}
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            appState.annotations = data.annotations;
            appState.hasUnsavedChanges = false;
            markFileAsSaved(appState.currentFile);
            updateAnnotationsList();

            const statusDiv = document.getElementById('saveStatus');
            statusDiv.className = 'status-message success';
            statusDiv.textContent = `标注已保存: ${data.file}`;

            setTimeout(() => {
                statusDiv.textContent = '';
                statusDiv.className = 'status-message';
            }, 3000);
        } else {
            showMessage('保存失败: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showMessage('保存失败: ' + error, 'error');
    });
}

// ===== 刷新标注 =====
function refreshAnnotations() {
    fetch('/api/get_annotations')
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            appState.annotations = data.annotations;
            updateAnnotationsList();
            drawCanvas('z');
        }
    })
    .catch(error => {
        console.error('刷新标注失败:', error);
    });
}

// ===== 初始状态加载 =====
function loadInitialState() {
    fetch('/api/get_info')
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            if (data.doctor_name) {
                appState.doctorName = data.doctor_name;
                document.getElementById('doctorName').value = data.doctor_name;
                document.getElementById('doctorDisplay').innerHTML =
                    `<strong>当前医生:</strong> ${data.doctor_name}`;
            } else {
                // 第一次打开,提示输入医生名字
                setTimeout(() => {
                    const doctorName = prompt('请输入医生名字(推荐拼音缩写):', '');
                    if (doctorName && doctorName.trim()) {
                        document.getElementById('doctorName').value = doctorName.trim();
                        setDoctor();
                    }
                }, 500);
            }
            if (data.directory) {
                appState.currentDirectory = data.directory;
                document.getElementById('dataDirectory').value = data.directory;
            }
        }
        // 初始化标注总结显示
        updateAnnotationSummary();
    })
    .catch(error => {
        console.error('加载初始状态失败:', error);
    });
}

// ===== 工具函数 =====
function showMessage(message, type = 'info') {
    // Toast通知系统
    console.log(`[${type.toUpperCase()}] ${message}`);

    const container = document.getElementById('toastContainer');

    // 创建toast元素
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    toast.innerHTML = `
        <div class="toast-icon"></div>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);

    // 3秒后移除
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300); // 等待动画完成
    }, 3000);
}
