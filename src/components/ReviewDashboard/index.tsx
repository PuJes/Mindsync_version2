import React, { useState } from 'react';
import { useStagingStore, StagedFile } from '../../store/stagingStore';
import { fileOpsService } from '../../services/fileOps';
import { batchProcessor } from '../../services/batchProcessor';
import { ArrowRight, FileText, Check, AlertTriangle, X, Loader2, Undo2 } from 'lucide-react';
import './ReviewDashboard.css';

// 左侧：文件列表
const SourceList = () => {
    const { files, selectedFileId, selectedFileIds, selectFile, toggleFileSelection, selectAllFiles, clearSelection } = useStagingStore();

    const handleItemClick = (e: React.MouseEvent, fileId: string) => {
        const multiSelect = e.shiftKey || e.metaKey || e.ctrlKey;
        if (multiSelect) {
            toggleFileSelection(fileId, true);
        } else {
            selectFile(fileId);
            toggleFileSelection(fileId, false);
        }
    };

    return (
        <div className="rd-column rd-source">
            <div className="rd-header">
                <span>待处理文件 ({files.length})</span>
                {selectedFileIds.size > 0 && (
                    <span className="selection-badge">{selectedFileIds.size} 已选</span>
                )}
            </div>
            <div className="rd-select-actions">
                <button onClick={selectAllFiles}>全选</button>
                <button onClick={clearSelection}>取消选择</button>
            </div>
            <div className="rd-list">
                {files.map(file => (
                    <div
                        key={file.id}
                        className={`rd-item ${selectedFileId === file.id ? 'active' : ''} ${selectedFileIds.has(file.id) ? 'multi-selected' : ''}`}
                        onClick={(e) => handleItemClick(e, file.id)}
                    >
                        <div className="rd-item-checkbox">
                            <input
                                type="checkbox"
                                checked={selectedFileIds.has(file.id)}
                                onChange={() => toggleFileSelection(file.id, true)}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                        <div className="rd-item-icon">
                            {file.status === 'duplicate' ? <AlertTriangle size={16} color="orange" /> :
                                file.status === 'success' ? <Check size={16} color="green" /> :
                                    file.status === 'analyzing' ? <Loader2 size={16} className="animate-spin" /> :
                                        file.status === 'error' ? <X size={16} color="red" /> :
                                            <FileText size={16} />}
                        </div>
                        <div className="rd-item-info">
                            <div className="rd-item-name">{file.file.name}</div>
                            <div className="rd-item-path">{file.originalPath}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// 中间：AI 建议
const AIProposal = () => {
    const { files, selectedFileId } = useStagingStore();
    const selectedFile = files.find(f => f.id === selectedFileId);

    if (!selectedFile) return <div className="rd-column rd-proposal empty">请选择文件查看建议</div>;

    const proposal = selectedFile.proposal;
    const userEdit = selectedFile.userEdit;
    const finalPath = userEdit?.targetPath || proposal?.targetPath || '等待分析...';

    return (
        <div className="rd-column rd-proposal">
            <div className="rd-header">AI 分类建议</div>

            <div className="proposal-card">
                <div className="path-visualization">
                    <div className="path-box source">{selectedFile.originalPath}</div>
                    <ArrowRight className="arrow-icon" />
                    <div className="path-box target">{finalPath}</div>
                </div>

                {proposal && (
                    <div className="ai-reasoning">
                        <h4>AI 思考过程:</h4>
                        <p>{proposal.reasoning}</p>
                        <div className="confidence-badge" data-level={proposal.confidence > 0.7 ? 'high' : 'low'}>
                            置信度: {Math.round(proposal.confidence * 100)}%
                        </div>
                    </div>
                )}

                {selectedFile.status === 'analyzing' && (
                    <div className="analyzing-indicator">
                        <Loader2 className="animate-spin" size={20} />
                        <span>正在分析中...</span>
                    </div>
                )}
            </div>
        </div>
    );
};

// 右侧：属性编辑
const MetadataEditor = () => {
    const { files, selectedFileId, updateUserEdit, removeFile } = useStagingStore();
    const selectedFile = files.find(f => f.id === selectedFileId);
    const [newTag, setNewTag] = React.useState('');

    // 🔧 方案 3.1: 路径自动完成
    const [pathInput, setPathInput] = React.useState('');
    const [showSuggestions, setShowSuggestions] = React.useState(false);
    const [highlightedIndex, setHighlightedIndex] = React.useState(-1);

    // 从所有文件的 proposal 中提取分类作为建议
    const existingCategories = React.useMemo(() => {
        const categories = new Set<string>();
        files.forEach(f => {
            if (f.proposal?.targetPath) {
                categories.add(f.proposal.targetPath);
            }
            if (f.userEdit?.targetPath) {
                categories.add(f.userEdit.targetPath);
            }
        });
        // 添加一些默认分类
        ['Work', 'Life', 'Archive', '技术文档', '学习资料', '项目资料'].forEach(c => categories.add(c));
        return Array.from(categories).filter(c => c && c !== '等待分析...');
    }, [files]);

    // 模糊匹配过滤
    const filteredSuggestions = React.useMemo(() => {
        if (!pathInput) return existingCategories.slice(0, 10);
        const query = pathInput.toLowerCase();
        return existingCategories
            .filter(cat => cat.toLowerCase().includes(query))
            .slice(0, 10);
    }, [pathInput, existingCategories]);

    React.useEffect(() => {
        if (selectedFile) {
            setPathInput(selectedFile.userEdit?.targetPath || selectedFile.proposal?.targetPath || '');
        }
    }, [selectedFileId, selectedFile]);

    if (!selectedFile) return <div className="rd-column rd-editor empty"></div>;

    const baseTags = selectedFile.userEdit?.tags || selectedFile.proposal?.tags || [];

    const handleAddTag = () => {
        if (newTag.trim() && !baseTags.includes(newTag.trim())) {
            updateUserEdit(selectedFile.id, { tags: [...baseTags, newTag.trim()] });
            setNewTag('');
        }
    };

    const handleRemoveTag = (index: number) => {
        const newTags = baseTags.filter((_, i) => i !== index);
        updateUserEdit(selectedFile.id, { tags: newTags });
    };

    const handlePathChange = (value: string) => {
        setPathInput(value);
        updateUserEdit(selectedFile.id, { targetPath: value });
        setShowSuggestions(true);
    };

    const handleSelectSuggestion = (suggestion: string) => {
        setPathInput(suggestion);
        updateUserEdit(selectedFile.id, { targetPath: suggestion });
        setShowSuggestions(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showSuggestions || filteredSuggestions.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(prev => Math.min(prev + 1, filteredSuggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && highlightedIndex >= 0) {
            e.preventDefault();
            handleSelectSuggestion(filteredSuggestions[highlightedIndex]);
        } else if (e.key === 'Escape') {
            setShowSuggestions(false);
        }
    };

    return (
        <div className="rd-column rd-editor">
            <div className="rd-header">属性编辑</div>

            <div className="editor-form">
                <label>目标路径</label>
                {/* 🔧 方案 3.1: 路径自动完成 */}
                <div className="path-autocomplete">
                    <input
                        type="text"
                        value={pathInput}
                        onChange={(e) => handlePathChange(e.target.value)}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        onKeyDown={handleKeyDown}
                        placeholder="输入或选择分类..."
                    />
                    {showSuggestions && filteredSuggestions.length > 0 && (
                        <div className="path-autocomplete-dropdown">
                            {filteredSuggestions.map((suggestion, index) => (
                                <div
                                    key={suggestion}
                                    className={`path-autocomplete-item ${index === highlightedIndex ? 'highlighted' : ''}`}
                                    onMouseDown={() => handleSelectSuggestion(suggestion)}
                                    onMouseEnter={() => setHighlightedIndex(index)}
                                >
                                    <span className="folder-icon">📁</span>
                                    {suggestion}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <label>摘要</label>
                <textarea
                    value={selectedFile.userEdit?.summary || selectedFile.proposal?.summary || ''}
                    onChange={(e) => updateUserEdit(selectedFile.id, { summary: e.target.value })}
                    rows={3}
                />

                <label>标签</label>
                <div className="tags-container">
                    {baseTags.map((tag, i) => (
                        <span key={i} className="tag-pill">
                            {tag}
                            <button
                                className="tag-remove-btn"
                                onClick={() => handleRemoveTag(i)}
                                title="删除标签"
                            >×</button>
                        </span>
                    ))}
                </div>
                <div className="tag-input-row">
                    <input
                        type="text"
                        placeholder="添加标签..."
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                    />
                    <button className="btn-add-tag" onClick={handleAddTag}>添加</button>
                </div>

                <button
                    className="btn-remove"
                    onClick={() => removeFile(selectedFile.id)}
                >
                    <X size={14} /> 移除此文件
                </button>
            </div>
        </div>
    );
};

export const ReviewDashboard: React.FC = () => {
    const { clearAll, files, workflowStatus, selectedFileIds, batchUpdateTargetPath, batchAddTag, batchRemoveFiles, clearSelection, reanalyzeFiles } = useStagingStore();
    const [isExecuting, setIsExecuting] = useState(false);
    const [result, setResult] = useState<{ success: number; fail: number } | null>(null);

    // 🔧 批量操作状态
    const [batchPath, setBatchPath] = React.useState('');
    const [batchTag, setBatchTag] = React.useState('');
    const isBatchMode = selectedFileIds.size >= 1; // 选中 ≥1 个文件就启用

    const handleCancel = () => {
        if (confirm('确定取消所有待处理文件吗？')) {
            clearAll();
        }
    };

    // 🔧 修复：只执行选中的文件（如果有选中），否则执行所有已就绪的文件
    const handleExecute = async () => {
        setIsExecuting(true);
        try {
            // 如果有选中文件且大于等于 1 个，只执行选中的文件
            const idsToExecute = selectedFileIds.size >= 1 ? selectedFileIds : undefined;
            const { successCount, failCount } = await fileOpsService.executeCommit(idsToExecute);
            setResult({ success: successCount, fail: failCount });
        } catch (e) {
            console.error('Execute failed', e);
        } finally {
            setIsExecuting(false);
        }
    };

    const handleUndo = async () => {
        const { successCount } = await fileOpsService.executeUndo();
        alert(`已撤销 ${successCount} 个文件操作`);
    };

    // 🔧 新增：暂时返回主界面（保留数据）
    const handleTempReturn = () => {
        const store = useStagingStore.getState();
        store.setWorkflowStatus('idle');
    };

    // 🔧 修改：完成并返回主界面（清除数据）
    const handleGoHome = () => {
        if (files.length > 0 && !confirm('确定清除所有待处理文件并返回吗？')) {
            return;
        }
        clearAll(); // 清除所有状态
        setResult(null);
        // 触发自定义事件，通知主界面刷新数据
        window.dispatchEvent(new CustomEvent('refresh-knowledge-base'));
    };

    // 🔧 重新分析功能
    const handleReanalyze = async () => {
        if (!confirm(`确定重新分析选中的 ${selectedFileIds.size} 个文件吗？`)) {
            return;
        }
        reanalyzeFiles(selectedFileIds);
        const fileIdsArray = Array.from(selectedFileIds);
        if (fileIdsArray.length > 0) {
            await batchProcessor.processFiles(fileIdsArray);
        }
    };

    const readyCount = files.filter(f => f.status === 'success').length;
    const analyzingCount = files.filter(f => f.status === 'analyzing').length;
    const duplicateCount = files.filter(f => f.status === 'duplicate').length;
    const errorCount = files.filter(f => f.status === 'error').length;
    const pendingCount = files.filter(f => f.status === 'pending').length;

    return (
        <div className="review-dashboard">
            <div className="rd-toolbar">
                <h3>
                    {isBatchMode
                        ? `已选择 ${selectedFileIds.size} 个文件`
                        : `确认归档 (${readyCount}/${files.length} 已就绪)`
                    }
                </h3>
                <div className="rd-actions">
                    {/* 🔧 选中文件时显示批量操作 */}
                    {isBatchMode && (
                        <>
                            {/* 只有 ≥2 个文件才显示批量路径和标签 */}
                            {selectedFileIds.size >= 2 && (
                                <>
                                    <div className="inline-action-group">
                                        <input
                                            type="text"
                                            placeholder="批量路径..."
                                            value={batchPath}
                                            onChange={(e) => setBatchPath(e.target.value)}
                                            className="inline-input"
                                        />
                                        <button className="btn-inline" onClick={() => { batchUpdateTargetPath(batchPath); setBatchPath(''); }}>
                                            应用
                                        </button>
                                    </div>

                                    <div className="inline-action-group">
                                        <input
                                            type="text"
                                            placeholder="批量标签..."
                                            value={batchTag}
                                            onChange={(e) => setBatchTag(e.target.value)}
                                            className="inline-input"
                                        />
                                        <button className="btn-inline" onClick={() => { batchAddTag(batchTag); setBatchTag(''); }}>
                                            添加
                                        </button>
                                    </div>
                                </>
                            )}

                            <button className="btn-reanalyze" onClick={handleReanalyze}>
                                🔄 重新分析
                            </button>
                            <button className="btn-remove" onClick={batchRemoveFiles}>
                                {selectedFileIds.size >= 2 ? '批量移除' : '移除'}
                            </button>
                            <button className="btn-clear" onClick={clearSelection}>
                                取消选择
                            </button>

                            {/* 分隔线 */}
                            <div className="toolbar-divider"></div>
                        </>
                    )}

                    {/* 🔧 主要操作按钮：始终显示 */}
                    {result && (
                        <span className="result-badge">
                            ✅ {result.success} 成功 {result.fail > 0 && `❌ ${result.fail} 失败`}
                        </span>
                    )}
                    <button className="btn-undo" onClick={handleUndo} title="撤销上次操作">
                        <Undo2 size={16} />
                    </button>
                    <button className="btn-cancel" onClick={handleCancel}>取消</button>
                    <button
                        className="btn-confirm"
                        onClick={handleExecute}
                        disabled={isExecuting || readyCount === 0}
                    >
                        {isExecuting ? <Loader2 className="animate-spin" size={16} /> : null}
                        执行变更
                    </button>

                    {/* 🔧 暂时返回：始终显示 */}
                    <button className="btn-temp-return" onClick={handleTempReturn}>
                        暂时返回
                    </button>

                    {/* 🔧 完成并返回：执行完成后显示 */}
                    {result && (
                        <button className="btn-home" onClick={handleGoHome}>
                            完成并返回
                        </button>
                    )}
                </div>
            </div>

            {/* 🔧 方案 1.1: 进度统计仪表板 */}
            <div className="rd-stats-bar">
                <div className="rd-stat pending" title="等待分析">
                    <span className="rd-stat-value">{pendingCount}</span>
                    <span className="rd-stat-label">等待中</span>
                </div>
                <div className="rd-stat analyzing" title="正在分析">
                    <span className="rd-stat-value">{analyzingCount}</span>
                    <span className="rd-stat-label">分析中</span>
                </div>
                <div className="rd-stat success" title="分析完成">
                    <span className="rd-stat-value">{readyCount}</span>
                    <span className="rd-stat-label">已就绪</span>
                </div>
                <div className="rd-stat duplicate" title="发现重复">
                    <span className="rd-stat-value">{duplicateCount}</span>
                    <span className="rd-stat-label">重复</span>
                </div>
                <div className="rd-stat error" title="分析失败">
                    <span className="rd-stat-value">{errorCount}</span>
                    <span className="rd-stat-label">失败</span>
                </div>
                {/* 进度条 */}
                <div className="rd-progress-bar">
                    <div
                        className="rd-progress-fill success"
                        style={{ width: `${files.length > 0 ? (readyCount / files.length) * 100 : 0}%` }}
                    />
                    <div
                        className="rd-progress-fill duplicate"
                        style={{ width: `${files.length > 0 ? (duplicateCount / files.length) * 100 : 0}%` }}
                    />
                    <div
                        className="rd-progress-fill error"
                        style={{ width: `${files.length > 0 ? (errorCount / files.length) * 100 : 0}%` }}
                    />
                </div>
            </div>

            <div className="rd-body">
                <SourceList />
                <AIProposal />
                <MetadataEditor />
            </div>

            {/* 执行完成后的提示 */}
            {result && files.length === 0 && (
                <div className="rd-complete-overlay">
                    <div className="rd-complete-card">
                        <h3>✅ 操作完成</h3>
                        <p>{result.success} 个文件成功 {result.fail > 0 && `，${result.fail} 个失败`}</p>
                        <button className="btn-confirm" onClick={handleGoHome}>
                            返回主界面
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

