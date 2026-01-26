// 自定义 AI API 调用服务
// 当用户配置了自定义 API 时，直接从浏览器调用

export interface CustomApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

/** 从 localStorage 加载配置（使用统一的 manimcat_settings） */
export function loadCustomConfig(): CustomApiConfig | null {
  const saved = localStorage.getItem('manimcat_settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // 从统一的 settings 中读取 API 配置
      if (parsed.api && parsed.api.apiUrl && parsed.api.apiKey) {
        return {
          apiUrl: parsed.api.apiUrl,
          apiKey: parsed.api.apiKey,
          model: parsed.api.model || ''
        };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * 使用自定义 API 生成 Manim 代码
 * 返回提取出的代码
 */
export async function generateWithCustomApi(
  concept: string,
  config: CustomApiConfig,
  signal?: AbortSignal
): Promise<string> {
  const apiUrl = config.apiUrl.trim().replace(/\/+$/, '');
  const model = config.model.trim() || 'gpt-4o-mini';

  // 简化的 prompt
  const userPrompt = `生成一个 Manim 动画代码，用于演示：${concept}

要求：
1. 核心类名固定为 MainScene
2. 纯代码输出，不要 Markdown 标记
3. 使用中文注释
4. 背景使用深色调
5. 确保代码可运行

请直接输出 Python 代码，不要任何解释。`;

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ],
      max_tokens: 2000,
      temperature: 0.7,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('API 返回空响应');
  }

  // 提取代码
  return extractCodeFromResponse(content);
}

/**
 * 从 AI 响应中提取代码
 */
function extractCodeFromResponse(text: string): string {
  if (!text) return '';

  // 尝试匹配带语言标识的代码块
  const match = text.match(/```(?:python)?\n([\s\S]*?)```/i);
  if (match) {
    return match[1].trim();
  }

  return text.trim();
}
