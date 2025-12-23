import React, { useState, useEffect } from 'react';
import { Settings, Shield, ShieldOff, Layers, FolderTree, X, Plus, Trash2, Save } from 'lucide-react';
import { taxonomyService } from '../services/taxonomyService';
import { TaxonomyConfig } from '../types/metadata.v3';
import './TaxonomySettingsPanel.css';

interface TaxonomySettingsPanelProps {
    onClose: () => void;
}

export const TaxonomySettingsPanel: React.FC<TaxonomySettingsPanelProps> = ({ onClose }) => {
    const [config, setConfig] = useState<TaxonomyConfig>(taxonomyService.getConfig());
    const [newPattern, setNewPattern] = useState('');
    const [saved, setSaved] = useState(false);

    // 更新配置
    const handleConfigChange = (updates: Partial<TaxonomyConfig>) => {
        const newConfig = { ...config, ...updates };
        setConfig(newConfig);
        // 🔧 修复：切换模式时自动保存
        taxonomyService.updateConfig(newConfig);
        console.log('🔧 [TaxonomySettings] Config updated:', newConfig);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    };

    // 保存配置
    const handleSave = () => {
        console.log('🔧 [TaxonomySettings] Saving config:', config);
        taxonomyService.updateConfig(config);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    // 添加忽略规则
    const handleAddPattern = () => {
        if (newPattern.trim() && !config.ignorePatterns.includes(newPattern.trim())) {
            handleConfigChange({
                ignorePatterns: [...config.ignorePatterns, newPattern.trim()]
            });
            setNewPattern('');
        }
    };

    // 移除忽略规则
    const handleRemovePattern = (pattern: string) => {
        handleConfigChange({
            ignorePatterns: config.ignorePatterns.filter(p => p !== pattern)
        });
    };

    return (
        <div className="taxonomy-settings-panel">
            <div className="panel-header">
                <div className="header-title">
                    <Settings size={20} />
                    <h3>分类控制中心</h3>
                </div>
                <button className="close-btn" onClick={onClose}>
                    <X size={20} />
                </button>
            </div>

            <div className="panel-body">
                {/* 模式切换 */}
                <div className="setting-section">
                    <div className="section-title">
                        <span>分类模式</span>
                    </div>
                    <div className="mode-toggle">
                        <button
                            className={`mode-btn ${config.mode === 'strict' ? 'active' : ''}`}
                            onClick={() => handleConfigChange({ mode: 'strict' })}
                        >
                            <Shield size={18} />
                            <div className="mode-info">
                                <span className="mode-name">严格模式</span>
                                <span className="mode-desc">仅允许已有分类</span>
                            </div>
                        </button>
                        <button
                            className={`mode-btn ${config.mode === 'flexible' ? 'active' : ''}`}
                            onClick={() => handleConfigChange({ mode: 'flexible' })}
                        >
                            <ShieldOff size={18} />
                            <div className="mode-info">
                                <span className="mode-name">灵活模式</span>
                                <span className="mode-desc">允许 AI 创建新分类</span>
                            </div>
                        </button>
                    </div>
                </div>

                {/* 分类语言 */}
                <div className="setting-section">
                    <div className="section-title">
                        <span>🌐 分类命名语言</span>
                    </div>
                    <div className="language-toggle">
                        <button
                            className={`lang-btn ${config.categoryLanguage === 'zh' ? 'active' : ''}`}
                            onClick={() => handleConfigChange({ categoryLanguage: 'zh' })}
                        >
                            中文
                        </button>
                        <button
                            className={`lang-btn ${config.categoryLanguage === 'en' ? 'active' : ''}`}
                            onClick={() => handleConfigChange({ categoryLanguage: 'en' })}
                        >
                            English
                        </button>
                        <button
                            className={`lang-btn ${(!config.categoryLanguage || config.categoryLanguage === 'auto') ? 'active' : ''}`}
                            onClick={() => handleConfigChange({ categoryLanguage: 'auto' })}
                        >
                            自动
                        </button>
                    </div>
                    <p className="setting-hint">
                        指定 AI 生成分类名称使用的语言。"自动"会根据文件名语言自动选择。
                    </p>
                </div>

                {/* 深度限制 */}
                <div className="setting-section">
                    <div className="section-title">
                        <Layers size={16} />
                        <span>分类层级深度</span>
                    </div>
                    <div className="depth-control">
                        <input
                            type="range"
                            min="2"
                            max="5"
                            value={config.maxDepth}
                            onChange={(e) => handleConfigChange({ maxDepth: parseInt(e.target.value) })}
                        />
                        <span className="depth-value">{config.maxDepth} 级</span>
                    </div>
                    <p className="setting-hint">
                        限制分类路径的层数。例如 3 级 = “工作/项目/文档”。<br />
                        层级越深分类越细，但也越难查找。推荐 2-3 级。
                    </p>
                </div>

                {/* 子项数量限制 */}
                <div className="setting-section">
                    <div className="section-title">
                        <FolderTree size={16} />
                        <span>单层最大子项数</span>
                    </div>
                    <div className="children-control">
                        <input
                            type="number"
                            min="5"
                            max="20"
                            value={config.maxChildren}
                            onChange={(e) => handleConfigChange({ maxChildren: parseInt(e.target.value) })}
                        />
                        <span>个</span>
                    </div>
                    <p className="setting-hint">
                        限制每个文件夹下最多能创建几个子文件夹。<br />
                        例如设为 10，则 /Work 下最多 10 个子目录，超出会合并到已有分类。
                    </p>
                </div>

                {/* 目标分类数量 (新增) */}
                {config.mode === 'flexible' && (
                    <div className="setting-section">
                        <div className="section-title">
                            <span>🎯 目标分类数量</span>
                        </div>
                        <div className="target-count-control">
                            <input
                                type="number"
                                min="3"
                                max="30"
                                placeholder="如: 8"
                                value={config.targetCategoryCount || ''}
                                onChange={(e) => handleConfigChange({
                                    targetCategoryCount: e.target.value ? parseInt(e.target.value) : undefined
                                })}
                            />
                            <span>个分类</span>
                        </div>
                        <p className="setting-hint">
                            告诉 AI “我希望最终大概有 X 个分类”。<br />
                            AI 会尽量把文件聚合到这个数量，而不是创建太多细碎的分类。
                        </p>
                    </div>
                )}

                {/* 强制深度分析 (新增) */}
                <div className="setting-section">
                    <div className="section-title">
                        <span>🧠 强制深度分析</span>
                    </div>
                    <div className="mode-toggle">
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={config.forceDeepAnalysis || false}
                                onChange={(e) => handleConfigChange({ forceDeepAnalysis: e.target.checked })}
                            />
                            <span className="slider round"></span>
                        </label>
                        <span className="toggle-label" style={{ marginLeft: '10px', fontSize: '14px' }}>
                            {config.forceDeepAnalysis ? '已开启 (所有文件均深度读取内容)' : '已关闭 (简单文件快速分类)'}
                        </span>
                    </div>
                    <p className="setting-hint">
                        开启后，AI 将被强制读取每一个文件里的详细内容（Phase 2），不再仅凭文件名快速判断。<br />
                        这会增加 API 消耗和处理时间，但分类准确性更高。
                    </p>
                </div>

                {/* 分类词汇表 (新增) */}
                <div className="setting-section">
                    <div className="section-title">
                        <span>📚 分类词汇表</span>
                    </div>
                    <div className="vocabulary-list">
                        {(config.categoryVocabulary || []).map((vocab, i) => (
                            <div key={i} className="pattern-tag">
                                <code>{vocab}</code>
                                <button onClick={() => {
                                    const newVocab = (config.categoryVocabulary || []).filter(v => v !== vocab);
                                    handleConfigChange({ categoryVocabulary: newVocab });
                                }}>
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="add-pattern">
                        <input
                            type="text"
                            placeholder="添加分类名，如 Work/Projects"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.target as HTMLInputElement).value) {
                                    const newVocab = [...(config.categoryVocabulary || []), (e.target as HTMLInputElement).value];
                                    handleConfigChange({ categoryVocabulary: newVocab });
                                    (e.target as HTMLInputElement).value = '';
                                }
                            }}
                        />
                        <button onClick={(e) => {
                            const input = (e.currentTarget.previousSibling as HTMLInputElement);
                            if (input.value) {
                                const newVocab = [...(config.categoryVocabulary || []), input.value];
                                handleConfigChange({ categoryVocabulary: newVocab });
                                input.value = '';
                            }
                        }}>
                            <Plus size={16} />
                        </button>
                    </div>
                    <p className="setting-hint">
                        预设你希望使用的分类名称。AI 会优先匹配这些名称。<br />
                        例如添加 "工作/财务"，AI 遇到报销类文件会自动归入此分类。
                    </p>
                </div>

                {/* 忽略规则 */}
                <div className="setting-section">
                    <div className="section-title">
                        <span>忽略规则 (.aiignore)</span>
                    </div>
                    <div className="ignore-patterns">
                        {config.ignorePatterns.map((pattern, i) => (
                            <div key={i} className="pattern-tag">
                                <code>{pattern}</code>
                                <button onClick={() => handleRemovePattern(pattern)}>
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="add-pattern">
                        <input
                            type="text"
                            placeholder="添加规则，如 *.log 或 temp/"
                            value={newPattern}
                            onChange={(e) => setNewPattern(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddPattern()}
                        />
                        <button onClick={handleAddPattern}>
                            <Plus size={16} />
                        </button>
                    </div>
                </div>


            </div>

            <div className="panel-footer">
                <button className="btn-cancel" onClick={onClose}>取消</button>
                <button className="btn-save" onClick={handleSave}>
                    <Save size={16} />
                    {saved ? '已保存!' : '保存设置'}
                </button>
            </div>
        </div>
    );
};
