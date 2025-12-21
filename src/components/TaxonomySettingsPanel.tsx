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
                        推荐 3 级：领域 → 项目 → 上下文
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
                        限制每个目录下的子文件夹数量，防止过度膨胀
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
