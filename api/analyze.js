require('dotenv').config();
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');

// 环境变量配置（Vercel会自动读取后台配置的环境变量）
const ARK_API_KEY = process.env.ARK_API_KEY;
const MODEL_ID = "ep-20260405192616-2nq8w";
const REGIONS = [
  "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  "https://ark.cn-shanghai.volces.com/api/v3/chat/completions"
];

// 适配Vercel的multer配置（处理文件上传）
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB限制
});

// Vercel Serverless 函数入口（必须用这个格式）
module.exports = async (req, res) => {
  // 处理CORS跨域（Vercel必须配置）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理OPTIONS预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 只允许POST请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. 用multer解析文件上传（适配Vercel）
    await new Promise((resolve, reject) => {
      upload.any()(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 2. 校验文件数量
    if (!req.files || req.files.length < 5) {
      return res.status(400).json({ error: '请至少上传 5 张截图' });
    }

    console.log(`\n[Analyze] 收到分析请求，图片数量: ${req.files.length}`);

    // 3. 构建prompt和请求体（完全保留你的原有逻辑）
    const promptText = "你是一个资深的心理学家和社交专家，精通 MBTI 性格分析。用户上传了多张朋友圈截图，请你通过分析这些内容，给出对方的 MBTI 分析。要求包括：1. 识别 MBTI 类型。2. 性格关键词标签。3. 详细性格描述（在描述中请使用“她/他”来称呼被分析者，语气要专业且富有洞察力）。4. 社交破冰建议（请写成一段连贯的话，包含具体的开场白和建议）。5. 商务转化策略（请写成一段连贯的话）。请直接返回 JSON 格式结果，包含 mbti, tags, description, socialTips, businessStrategy 字段，不要包含任何 Markdown 格式。";

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

    // 4. 多区域重试逻辑（完全保留你的原有逻辑）
    let response = null;
    let lastError = null;

    for (const url of REGIONS) {
      try {
        console.log(`[API] 尝试请求区域 -> ${url}`);
        const apiRes = await axios.post(url, requestBody, {
          headers: {
            'Authorization': `Bearer ${ARK_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 120000
        });
        response = apiRes;
        break;
      } catch (err) {
        lastError = err;
        const status = err.response ? err.response.status : 500;
        console.warn(`[Warn] 区域请求失败 (${url})，状态码: ${status}`);
        if (status !== 404) throw err;
      }
    }

    if (!response) throw lastError;

    console.log('[API] 请求成功');
    let content = response.data.choices[0].message.content;

    // 5. JSON解析逻辑（完全保留你的原有逻辑）
    try {
      let jsonStr = content;
      if (content.includes('```json')) {
        jsonStr = content.match(/```json\n([\s\S]*?)\n```/)[1];
      } else if (content.includes('```')) {
        jsonStr = content.match(/```([\s\S]*?)```/)[1];
      }
      const aiResult = JSON.parse(jsonStr);
      return res.json(aiResult);
    } catch (parseError) {
      console.error('[Error] JSON 解析失败:', content);
      return res.status(500).json({ error: 'AI 返回内容格式解析失败', raw: content });
    }

  } catch (error) {
    const errorData = error.response ? error.response.data : error;
    const statusCode = error.response ? error.response.status : 500;
    console.error(`[Error] 分析失败 (状态码 ${statusCode}):`, JSON.stringify(errorData));
    return res.status(statusCode).json({
      error: error.response ? `API 错误 (${statusCode})` : error.message,
      details: errorData
    });
  }
};