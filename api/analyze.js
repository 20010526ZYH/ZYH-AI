require('dotenv').config();
const axios = require('axios');
const multer = require('multer');

// 环境变量配置
const ARK_API_KEY = process.env.ARK_API_KEY;
const MODEL_ID = "ep-20260405192616-2nq8w";
const API_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";

// 极致优化 Multer：2MB/张，最多 6 张，极速处理
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { 
    fileSize: 2 * 1024 * 1024, // 2MB
    files: 6                   // 最多 6 张
  }
});

module.exports = async (req, res) => {
  // CORS 跨域
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST' });

  // 增加 AbortController 确保超时绝对生效
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s 强行中断

  try {
    // 1. 解析上传
    await new Promise((resolve, reject) => {
      upload.any()(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!req.files || req.files.length < 5) {
      return res.status(400).json({ error: '请上传 5-6 张截图' });
    }

    // 2. 极致精简 Prompt：减少 Token 消耗，缩短 AI 思考与响应时长
    const promptText = "分析朋友圈图返回JSON:{mbti,tags:[],description,socialTips,businessStrategy}。要求:用'她/他'称呼，描述与建议各一段话。只出JSON，禁Markdown。";

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

    // 3. 单区域请求 + 30s 超时控制
    const apiRes = await axios.post(API_URL, requestBody, {
      headers: {
        'Authorization': `Bearer ${ARK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal, // 绑定 abort 信号
      timeout: 30000             // axios 内部超时
    });

    clearTimeout(timeoutId); // 成功则清除定时器

    const content = apiRes.data.choices[0].message.content.trim();
    
    // 4. 极简解析
    let jsonStr = content;
    if (content.includes('```')) {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) jsonStr = match[1];
    }
    
    return res.json(JSON.parse(jsonStr));

  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
      return res.status(504).json({ error: '分析超时，请减少图片大小或重试' });
    }
    const status = error.response ? error.response.status : 500;
    return res.status(status).json({ error: '分析失败', details: error.message });
  }
};
