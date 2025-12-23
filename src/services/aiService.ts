import { GoogleGenAI } from '@google/genai';
import { ManifestItem, AIProtocolResponse, TaxonomyConfig } from '../types/metadata.v3';

// 分析结果接口
export interface AIAnalysisResult {
    category: string;
    summary: string;
    tags: string[];
    applicability: string;
    reasoning?: string;
    confidence?: number;
}

// 配置接口
export interface AIServiceConfig {
    provider: 'gemini' | 'deepseek';
    apiKey: string;
    model: string;
}

// 辅助函数：判断文件是否可直接读取内容
function isTextReadable(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    // 扩展支持：文本文件、代码文件、以及 Office 文档（虽然是二进制，但 Electron 端可能有解析能力）
    const textExts = [
        'txt', 'md', 'json', 'csv',
        'py', 'js', 'ts', 'tsx', 'jsx', 'vue',
        'html', 'css', 'scss', 'less',
        'sql', 'xml', 'yaml', 'yml',
        'log', 'ini', 'conf', 'env',
        'sh', 'bat', 'ps1',
        'c', 'cpp', 'h', 'java', 'go', 'rs', 'rb', 'php',
        // Office 文档虽然是二进制，但可能有解析支持，若无则会回退到文件名分析
        'docx', 'doc', 'rtf', 'odt'
    ];
    return textExts.includes(ext);
}

/**
 * 使用 DeepSeek API 分析文件内容
 */
export async function analyzeWithDeepSeek(
    file: File,
    apiKey: string,
    modelName: string = 'deepseek-chat',
    rawContent?: string,
    existingCategories: string[] = []
): Promise<AIAnalysisResult> {
    // 🔧 修复：对于二进制文件，使用文件名进行分析而不是跳过
    const canReadContent = isTextReadable(file.name);
    const contentToAnalyze = canReadContent && rawContent
        ? rawContent
        : `[文件名]: ${file.name}\n[备注]: 这是一个二进制文件（如PDF、图片等），无法读取具体内容，请根据文件名推断其用途和分类。`;

    const prompt = `你是一个专业的知识整理助手。请分析以下文件的内容，并将其整理为结构化的知识索引信息。

【已有分类参考】: ${existingCategories.length > 0 ? existingCategories.join(', ') : '无'}
【规则】:
1. 分类: 优先匹配相似的【已有分类】，若不匹配则创建新分类（如：技术文档/前端）。
2. 标签: 严格生成 5-10 个，去重，每个标签 2-4 字。
3. 摘要: 包含一句话概述 + 3个核心要点。
4. reasoning: 解释你为什么选择这个分类（用于用户审核）。
5. confidence: 你对这个分类有多确定（0.0-1.0）。
6. 返回格式: 纯 JSON，不含格式块。

文件名: ${file.name}
文件内容摘要: ${contentToAnalyze.substring(0, 5000)}

请返回 JSON:
{
  "category": "分类名称",
  "summary": "详细摘要",
  "tags": ["标签1", "标签2", "标签3"],
  "applicability": "适用场景",
  "reasoning": "分类理由",
  "confidence": 0.85
}`;

    console.log('🤖 [DeepSeek] Sending request:', {
        model: modelName,
        contentPreview: contentToAnalyze.substring(0, 200) + '...',
        existingCategories
    });

    try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: 'user', content: prompt }],
                response_format: modelName === 'deepseek-chat' ? { type: 'json_object' } : undefined
            })
        });

        const data = await response.json();
        console.log('🤖 [DeepSeek] Response:', data);

        if (!response.ok) {
            throw new Error(`API Error: ${data.error?.message || JSON.stringify(data)}`);
        }

        let resultText = data.choices[0].message.content;
        resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
        const result = JSON.parse(resultText);
        console.log('🤖 [DeepSeek] Parsed result:', result);
        return result;
    } catch (err) {
        console.error('🤖 [DeepSeek] Error:', err);
        throw err;
    }
}

/**
 * 使用 Gemini API 分析文件内容
 */
export async function analyzeWithGemini(
    file: File,
    apiKey: string,
    modelName: string = 'gemini-2.0-flash-exp',
    rawContent?: string,
    existingCategories: string[] = []
): Promise<AIAnalysisResult> {
    // 🔧 修复：对于二进制文件，使用文件名进行分析而不是跳过
    const canReadContent = isTextReadable(file.name);
    const contentToAnalyze = canReadContent && rawContent
        ? rawContent
        : `[文件名]: ${file.name}\n[备注]: 这是一个二进制文件（如PDF、图片等），无法读取具体内容，请根据文件名推断其用途和分类。`;

    console.log('🤖 [Gemini] Sending request:', {
        model: modelName,
        contentPreview: contentToAnalyze.substring(0, 200) + '...',
        existingCategories
    });

    try {
        const client = new GoogleGenAI({ apiKey });
        const result = await (client as any).models.generateContent({
            model: modelName,
            contents: [{
                role: 'user', parts: [{
                    text: `分析文件并返回 JSON。已有分类：${existingCategories.join(', ') || '无'}。
要求：分类优先匹配已有；标签精准 3-5 个；摘要包含核心点；reasoning 解释分类理由；confidence 0.0-1.0。
文件名: ${file.name}
预览: ${contentToAnalyze.substring(0, 5000)}`
                }]
            }],
            config: { responseMimeType: 'application/json' }
        });

        let text = '';
        if (result.response && typeof result.response.text === 'function') {
            text = await result.response.text();
        } else if (result.text && typeof result.text === 'string') {
            text = result.text;
        }

        console.log('🤖 [Gemini] Response text:', text);
        let parsed = JSON.parse(text);

        // 🔧 修复：Gemini 可能返回数组，取第一个元素
        if (Array.isArray(parsed)) {
            console.log('🤖 [Gemini] Response is array, extracting first element');
            parsed = parsed[0] || {};
        }

        // 🔧 修复：统一字段名称（Gemini 可能返回 classification 而非 category）
        if (parsed.classification && !parsed.category) {
            console.log('🤖 [Gemini] Normalizing field: classification → category');
            parsed.category = parsed.classification;
        }

        console.log('🤖 [Gemini] Parsed result:', parsed);
        return parsed;
    } catch (err: any) {
        console.error('🤖 [Gemini] Error:', err);
        // 如果是 404 错误，提供更有意义的信息
        if (err.message?.includes('404') || err.message?.includes('NOT_FOUND')) {
            throw new Error(`Gemini 模型 "${modelName}" 不存在或不可用，请在设置中更换模型`);
        }
        throw err;
    }
}

/**
 * 通用分析入口 - 根据配置选择 AI 提供商
 */
export async function analyzeFile(
    file: File,
    config: AIServiceConfig,
    rawContent?: string,
    existingCategories: string[] = []
): Promise<AIAnalysisResult> {
    if (config.provider === 'deepseek') {
        return analyzeWithDeepSeek(file, config.apiKey, config.model, rawContent, existingCategories);
    } else {
        return analyzeWithGemini(file, config.apiKey, config.model, rawContent, existingCategories);
    }
}

/**
 * 3.3. Phase 1: 批量元数据预审 (Manifest Analysis)
 */
export async function analyzeManifest(
    items: ManifestItem[],
    config: AIServiceConfig,
    existingCategories: string[] = [],
    taxonomyConfig?: TaxonomyConfig
): Promise<AIProtocolResponse> {
    const maxDepth = taxonomyConfig?.maxDepth || 3;
    const maxChildren = taxonomyConfig?.maxChildren || 10;
    const targetCount = taxonomyConfig?.targetCategoryCount;
    const vocabulary = taxonomyConfig?.categoryVocabulary || [];
    const language = taxonomyConfig?.categoryLanguage || 'auto';

    const languageInstruction = language === 'zh'
        ? '\n【语言要求】: 所有分类名称必须使用**中文**命名（如：工作/财务、生活/旅行）'
        : language === 'en'
            ? '\n【语言要求】: All category names MUST be in **English** (e.g., Work/Finance, Life/Travel)'
            : ''; // auto 不添加限制

    const prompt = `你是一个智能文件归档助手。你需要对一批文件进行快速预审。
这是 Phase 1 阶段：仅根据文件名和大小判断是否可以直接分类。

【已有分类参考】: ${existingCategories.length > 0 ? existingCategories.join(', ') : '无 (可创建新分类)'}
${vocabulary.length > 0 ? `\n【分类词汇表】(优先使用): ${vocabulary.join(', ')}` : ''}
${targetCount ? `\n【目标分类数量】: 请尽量将所有文件聚合到约 ${targetCount} 个分类中，避免创建过多细碎分类` : ''}${languageInstruction}

【分类规则限制】:
1. **层级深度限制**: 分类路径最多 ${maxDepth} 级 (例如: /Work/Finance/2024 是3级)
2. **同级数量限制**: 每个父目录下最多 ${maxChildren} 个子分类
3. 优先复用【已有分类】和【分类词汇表】，避免创建过多新分类

【指令说明】:
1. **Direct**: 如果根据文件名非常有把握（置信度>0.8），直接给出分类建议。
   - **summary 要求**: 约100字的详细摘要，包含：文件用途、核心内容概述、适用场景或价值。
2. **Need_Info**: 如果文件名含糊（如 "image.png", "data.json", "未命名.docx"），请请求查看内容。
   - text_preview: 文本/代码文件
   - image_vision: 图片文件
   - full_text: 短文本文件

${taxonomyConfig?.forceDeepAnalysis ? `\n【特殊强制指令】:
用户已开启【强制深度分析模式】(Force Deep Analysis)。
请忽略所有 "Direct" 判断，对 **每一个文件** 都必须返回 "Need_Info" 指令。
你需要请求查看文件内容 (text_preview / image_vision / full_text) 才能进行准确分类和生成详细摘要。
绝对不要返回 "Direct"，除非文件无法读取 (如过大的二进制文件)。` : ''}

【输入文件清单】:
${JSON.stringify(items.map(i => ({ id: i.id, name: i.name, size: `${Math.ceil(i.size / 1024)}KB` })), null, 2)}

【输出格式】:
请返回一个 JSON 对象，key 为文件ID，value 为处理指令。
示例:
{
  "items": {
    "file_1": {
      "instruction": "Direct",
      "category": "/Work/Finance",
      "summary": "这是2024年1月的财务报表文件，记录了公司当月的收入、支出和利润情况。报表涵盖了各部门的预算执行情况和年度财务目标对比分析，适用于财务审计和管理层决策参考。",
      "tags": ["报表", "财务", "2024"],
      "reasoning": "文件名明确指出了时间和类型",
      "confidence": 0.95
    },
    "file_2": {
      "instruction": "Need_Info",
      "reason": "文件名 '截图.png' 无法判断内容",
      "requestType": "image_vision"
    }
  }
}`;

    const systemMessage = "你是一个无需废话的 JSON API，只返回合法的 JSON 数据。";

    // 统一调用逻辑（复用 DeepSeek/Gemini）
    if (config.provider === 'deepseek') {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            })
        });

        const data = await response.json();
        const content = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(content);
    } else {
        // Gemini
        const client = new GoogleGenAI({ apiKey: config.apiKey });
        const result = await (client as any).models.generateContent({
            model: config.model,
            contents: [{
                role: 'user',
                parts: [{ text: systemMessage + "\n" + prompt }]
            }],
            config: { responseMimeType: 'application/json' }
        });

        let text = '';
        if (result.response && typeof result.response.text === 'function') {
            text = await result.response.text();
        } else if (result.text) {
            text = typeof result.text === 'function' ? await result.text() : result.text;
        }

        if (!text) {
            console.error('❌ [analyzeManifest] Gemini returned empty response:', result);
            throw new Error('Gemini 返回了空响应，请检查 API Key 和模型配置。');
        }
        return JSON.parse(text);
    }
}

/**
 * 3.3 Phase 2: 补充信息分析 (Analyze with Supplements)
 */
export async function analyzeWithSupplements(
    file: File,
    supplementContent: string, // 文本片段 或 Base64
    requestType: 'text_preview' | 'image_vision' | 'full_text' | 'pdf_document', // Added pdf_document
    config: AIServiceConfig,
    existingCategories: string[] = [],
    taxonomyConfig?: TaxonomyConfig
): Promise<AIAnalysisResult> {
    const isImage = requestType === 'image_vision';
    const isPdf = requestType === 'pdf_document' || file.name.toLowerCase().endsWith('.pdf');
    const maxDepth = taxonomyConfig?.maxDepth || 3;
    const maxChildren = taxonomyConfig?.maxChildren || 10;

    // DeepSeek 限制检查
    if (config.provider === 'deepseek') {
        if (isImage) {
            throw new Error("DeepSeek 模型暂不支持视觉分析 (Vision)，请切换至 Gemini Pro Vision 或类似模型。");
        }
        if (isPdf) {
            throw new Error("DeepSeek 模型暂不支持 PDF 原生分析，请切换至 Gemini Pro 1.5/2.0 等支持长上下文的模型。");
        }
    }

    const promptText = `这是 Phase 2 阶段：根据补充的内容进行最终分类。
文件名: ${file.name}
${isImage ? '【图片内容已提供】' : isPdf ? '【PDF内容已提供】' : `【补充文本内容】:\n${supplementContent.substring(0, 8000)}`}

【已有分类参考】: ${existingCategories.join(', ') || '无'}

【分类规则限制】:
1. 分类路径最多 ${maxDepth} 级
2. 每个父目录下最多 ${maxChildren} 个子分类
3. 优先复用【已有分类】

请返回标准 JSON 分析结果:
{
  "category": "...",
  "summary": "...",
  "tags": [...],
  "reasoning": "...",
  "confidence": ...
}`;

    if (config.provider === 'gemini') {
        const client = new GoogleGenAI({ apiKey: config.apiKey });
        const parts: any[] = [{ text: promptText }];

        if (isImage || isPdf) {
            // supplementContent 应该是 base64 字符串
            parts.push({
                inlineData: {
                    mimeType: isPdf ? 'application/pdf' : (file.type || 'image/jpeg'),
                    data: supplementContent
                }
            });
        }

        const result = await (client as any).models.generateContent({
            model: config.model,
            contents: [{ role: 'user', parts }],
            config: { responseMimeType: 'application/json' }
        });

        let text = '';
        if (result.response && typeof result.response.text === 'function') {
            text = await result.response.text();
        } else if (result.text) {
            text = typeof result.text === 'function' ? await result.text() : result.text;
        }

        if (!text) {
            console.error('❌ [analyzeWithSupplements] Gemini returned empty response:', result);
            throw new Error('Gemini Vision 返回了空响应，请检查 API Key 和模型配置。');
        }
        // 兼容处理：Gemini 有时返回数组
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed[0] : parsed;
    } else {
        // DeepSeek (Text only)
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [{ role: 'user', content: promptText }],
                response_format: { type: 'json_object' }
            })
        });

        const data = await response.json();
        return JSON.parse(data.choices[0].message.content);
    }
}
