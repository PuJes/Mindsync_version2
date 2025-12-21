
import { GoogleGenAI } from '@google/genai';
import fetch from 'node-fetch'; // assuming it's available or use global fetch if node18+

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';

async function testGemini() {
    console.log('Testing Gemini...');
    try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: [{ parts: [{ text: 'Hello, respond with JSON: {"status": "ok"}' }] }],
            config: { responseMimeType: 'application/json' }
        });
        console.log('Gemini Response:', response.text);
    } catch (err) {
        console.error('Gemini Error:', err.message);
    }
}

async function testDeepSeek() {
    console.log('Testing DeepSeek...');
    try {
        const resp = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'Say hello' }],
                response_format: { type: 'json_object' }
            })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        console.log('DeepSeek Response:', data.choices[0].message.content);
    } catch (err) {
        console.error('DeepSeek Error:', err.message);
    }
}

// testGemini();
// testDeepSeek();
console.log('Script loaded. Run with specific keys to test.');
