const axios = require('axios');
const multer = require('multer');

// 环境变量配置
const ARK_API_KEY = process.env.ARK_API_KEY;
const MODEL_ID = "ep-20260405192616-2nq8w";
const API_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";

// 基础 Multer 配置
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB 限制
});

module.exports = async (req, res) => {
  // CORS 跨域处理
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. 检查环境变量
    if (!ARK_API_KEY) {
      console.error('[Config Error] ARK_API_KEY is missing');
      return res.status(500).json({ error: '服务器配置错误：缺少 API Key' });
    }

    // 2. 解析文件上传
    await new Promise((resolve, reject) => {
      upload.any()(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!req.files || req.files.length < 5) {
      return res.status(400).json({ error: '请上传至少 5 张朋友圈截图' });
    }

    // 3. 构建 Prompt
    const promptText = "你是一个资深的 MBTI 心理学家。请分析上传的朋友圈截图，并以 JSON 格式返回分析结果。JSON 结构必须包含：mbti (性格类型), tags (4个关键词数组), description (性格画像), socialTips (社交破冰建议，一段话), businessStrategy (商务转化策略，一段话)。在描述中使用'她/他'来称呼被分析者。请直接返回 JSON，不要包含 Markdown 格式。";

    const requestBody = {
      model: MODEL_ID,
      messages: [
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
      ]
    };

    // 4. 发起 AI 请求 (使用最稳健的基础 axios 调用)
    const apiRes = await axios.post(API_URL, requestBody, {
      headers: {
        'Authorization': `Bearer ${ARK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 保持 60s 超时
    });

    if (!apiRes.data || !apiRes.data.choices || !apiRes.data.choices[0]) {
      throw new Error('AI 服务返回数据格式错误');
    }

    const content = apiRes.data.choices[0].message.content.trim();
    
    // 5. 解析结果
    try {
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) jsonStr = match[1];
      }
      const aiResult = JSON.parse(jsonStr);
      return res.json(aiResult);
    } catch (parseErr) {
      console.error('[Parse Error] AI Content:', content);
      return res.status(500).json({ error: '解析 AI 回复失败', raw: content });
    }

  } catch (error) {
    console.error('[Server Error]:', error.message);
    
    // 提取 API 详细错误
    const status = error.response ? error.response.status : 500;
    const errorData = error.response ? error.response.data : error.message;

    return res.status(status).json({
      error: '分析请求失败，请重试',
      details: errorData
    });
  }
};
