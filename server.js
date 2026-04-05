const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = 3000;

// 设置上传目录
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit per file
});

// 静态文件服务
app.use(express.static('.'));
app.use(express.json());

// 豆包 API 配置 (从环境变量读取)
const ARK_API_KEY = process.env.ARK_API_KEY;
// 已更新为您的推理接入点 ID (Endpoint ID)
const MODEL_ID = "ep-20260405192616-2nq8w"; 
const BASE_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";

console.log('ARK_API_KEY:', ARK_API_KEY ? '已加载 (***' + ARK_API_KEY.slice(-4) + ')' : '未找到');
console.log('MODEL_ID (Endpoint ID):', MODEL_ID);
console.log('BASE_URL:', BASE_URL);

app.post('/api/analyze', upload.any(), async (req, res) => {
    try {
        console.log('--- 收到分析请求 ---');
        console.log('图片数量:', req.files ? req.files.length : 0);
        
        if (!req.files || req.files.length < 5) {
            console.log('错误: 图片数量不足');
            return res.status(400).json({ error: '请至少上传 5 张截图' });
        }

        // 构造发送给大模型的内容
        const promptText = "你是一个资深的心理学家和社交专家，精通 MBTI 性格分析。用户上传了多张朋友圈截图，请你通过分析这些内容，给出对方的 MBTI 分析。要求包括：1. 识别 MBTI 类型。2. 性格关键词标签。3. 详细性格描述。4. 社交破冰建议（请写成一段连贯的话，包含具体的开场白和建议）。5. 商务转化策略（请写成一段连贯的话）。请直接返回 JSON 格式结果，包含 mbti, tags, description, socialTips, businessStrategy 字段，不要包含任何 Markdown 格式。";

        const messages = [
            {
                role: "user",
                content: [
                    { type: "text", text: promptText },
                    ...req.files.map(file => ({
                        type: "image_url",
                        image_url: {
                            url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
                        }
                    }))
                ]
            }
        ];

        console.log(`正在请求 API... 模型/接入点: ${MODEL_ID}`);

        // 调用豆包 API
        const response = await axios.post(BASE_URL, {
            model: MODEL_ID,
            messages: messages,
        }, {
            headers: {
                'Authorization': `Bearer ${ARK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 120000 
        });

        console.log('API 响应成功');
        let content = response.data.choices[0].message.content;
        console.log('AI 返回内容预览:', content.substring(0, 100) + '...');
        
        try {
            // 兼容各种可能的返回格式
            let jsonStr = content;
            if (content.includes('```json')) {
                jsonStr = content.match(/```json\n([\s\S]*?)\n```/)[1];
            } else if (content.includes('```')) {
                jsonStr = content.match(/```([\s\S]*?)```/)[1];
            }
            const aiResult = JSON.parse(jsonStr);
            res.json(aiResult);
        } catch (parseError) {
            console.error('JSON 解析失败:', content);
            res.status(500).json({ error: 'AI 结果格式错误', raw: content });
        }

    } catch (error) {
        const errorDetail = error.response ? error.response.data : error.message;
        const statusCode = error.response ? error.response.status : 500;
        
        console.error(`API 请求失败 (状态码 ${statusCode}):`, JSON.stringify(errorDetail, null, 2));
        
        let errorMessage = 'AI 分析服务暂时不可用';
        if (error.response) {
            errorMessage = `API 返回错误 (${statusCode}): ${JSON.stringify(errorDetail.error || errorDetail)}`;
        } else if (error.request) {
            errorMessage = '未收到 API 响应，请检查网络连接或 API 地址是否正确';
        } else {
            errorMessage = error.message;
        }

        res.status(500).json({ 
            error: errorMessage,
            details: errorDetail
        });
    }
});

app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
    console.log(`请确保已在环境变量中设置 ARK_API_KEY`);
});
