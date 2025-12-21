import { GoogleGenAI } from '@google/genai';

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
