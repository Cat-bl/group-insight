import BaseAnalyzer from './BaseAnalyzer.js'
import { logger } from '#lib'

/**
 * 情绪分析器
 * 使用 AI 分析群聊整体氛围
 */
export default class MoodAnalyzer extends BaseAnalyzer {
  constructor(aiService, config = {}) {
    super(aiService, config)
  }

  /**
   * 分析群聊情绪氛围
   * @param {Array} messages - 消息列表
   * @param {Object} stats - 统计信息
   * @returns {Promise<Object>} { mood, score, keywords, summary, usage }
   */
  async analyze(messages, stats) {
    const emptyResult = {
      mood: '中性',
      score: 50,
      keywords: [],
      summary: '无法分析群聊氛围',
      usage: null
    }

    if (!messages || messages.length === 0) {
      return emptyResult
    }

    // 采样消息（最多200条，均匀分布）
    const sampleMessages = this.sampleMessages(messages, 200)
    const { text: formattedMessages } = this.formatMessages(sampleMessages, {
      includeTime: false
    })

    const prompt = `你是一个群聊氛围分析专家。请分析以下群聊消息的整体情绪氛围。

## 群聊消息
${formattedMessages}

## 分析要求
1. 判断整体氛围是"积极"、"中性"还是"消极"
2. 给出情绪分数（0-100，0最消极，100最积极）
3. 提取3-5个情绪关键词（如：欢乐、吐槽、调侃、焦虑、友好等）
4. 总结今日群聊氛围

## 返回格式（JSON）
{
  "mood": "积极/中性/消极",
  "score": 75,
  "keywords": ["欢乐", "调侃", "友好"],
  "summary": "今天群里氛围很活跃，大家聊得很开心"
}

请只返回JSON格式，不要有其他内容。`

    try {
      const result = await this.callAI(prompt, 20000, 0.5)

      if (!result?.content) {
        logger.warn('[MoodAnalyzer] AI 返回内容为空')
        return emptyResult
      }

      const parsed = this.parseJSON(result.content)

      if (!parsed) {
        logger.warn('[MoodAnalyzer] 解析情绪分析结果失败')
        return emptyResult
      }

      // 验证并规范化结果
      const mood = ['积极', '中性', '消极'].includes(parsed.mood) ? parsed.mood : '中性'
      const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50
      const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : []
      const summary = typeof parsed.summary === 'string' ? parsed.summary : '暂无总结'

      logger.info(`[MoodAnalyzer] 情绪分析完成 - 氛围: ${mood}, 分数: ${score}`)

      return {
        mood,
        score,
        keywords,
        summary,
        usage: result.usage || null
      }
    } catch (err) {
      logger.error(`[MoodAnalyzer] 情绪分析失败: ${err.message}`)
      return emptyResult
    }
  }

  /**
   * 均匀采样消息
   * @param {Array} messages - 原始消息列表
   * @param {number} count - 采样数量
   */
  sampleMessages(messages, count) {
    if (messages.length <= count) {
      return messages
    }

    const step = messages.length / count
    const sampled = []

    for (let i = 0; i < count; i++) {
      const index = Math.floor(i * step)
      sampled.push(messages[index])
    }

    return sampled
  }
}
