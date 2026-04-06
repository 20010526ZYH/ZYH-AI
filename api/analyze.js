require('dotenv').config();
const axios = require('axios');
const multer = require('multer');

// 环境变量配置
const ARK_API_KEY = process.env.ARK_API_KEY;
const MODEL_ID = "ep-20260405192616-2nq8w";
const REGIONS = [
  "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  "https://ark.cn-shanghai.volces.com/api/v3/chat/completions"
];

// 优化 Multer 配置：限制单文件 3MB，最多 8 张图，减少 Vercel 处理负载
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { 
    fileSize: 3 * 1024 * 1024, // 3MB
    files: 8                   // 最多 8 张
  }
});

module.exports = async (req, res) => {
  // CORS 跨域处理
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST 请求' });

  try {
    // 1. 解析文件上传
    await new Promise((resolve, reject) => {
      upload.any()(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!req.files || req.files.length < 5) {
      return res.status(400).json({ error: '请上传 5-8 张朋友圈截图' });
    }

    // 2. 精简 Prompt，减少 AI 思考时间，降低超时风险
    const promptText = "作为 MBTI 专家，请分析朋友圈截图并返回 JSON：{mbti, tags:[], description, socialTips, businessStrategy}。要求：1.性格描述用'她/他'称呼。2.社交建议与商务策略各写成一段话。直接输出 JSON，禁止 Markdown。";

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

    // 3. 多区域快速重试逻辑：单区域 20s 超时，总时长控制在 60s 内
    let response = null;
    let lastError = null;

    for (const url of REGIONS) {
      try {
        console.log(`[API] 尝试区域: ${url}`);
        const apiRes = await axios.post(url, requestBody, {
          headers: {
            'Authorization': `Bearer ${ARK_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000 // 缩短为 20s，以便在 Vercel 60s 限制内尝试多个区域
        });
        response = apiRes;
        break;
      } catch (err) {
        lastError = err;
        const status = err.response ? err.response.status : 500;
        console.warn(`[Warn] 区域失败 (${url}): ${status}`);
        if (status !== 404) throw err; // 非 404 错误（如 401/400）不重试
      }
    }

    if (!response) throw lastError;

    // 4. 解析 AI 返回内容
    const content = response.data.choices[0].message.content;
    try {
      let jsonStr = content.trim();
      // 容错处理：提取 JSON 代码块
      if (jsonStr.includes('```')) {
        const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) jsonStr = match[1];
      }
      return res.json(JSON.parse(jsonStr));
    } catch (e) {
      console.error('[Error] 解析失败:', content);
      return res.status(500).json({ error: 'AI 格式异常', raw: content });
    }

  } catch (error) {
    const status = error.response ? error.response.status : 500;
    const details = error.response ? error.response.data : error.message;
    console.error(`[Error] ${status}:`, details);
    return res.status(status).json({ error: '分析失败，请稍后重试', details });
  }
};
