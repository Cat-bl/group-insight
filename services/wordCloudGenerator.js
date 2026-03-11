/**
 * 词云生成器
 * 使用 Puppeteer 渲染 HTML 模板生成词云图片
 */

import moment from 'moment'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import Renderer from '../../../lib/renderer/loader.js'
import TextProcessor from '../utils/textProcessor.js'
import { WORDCLOUD_TEMPLATE_PATH, WORDCLOUD_GIF_TEMPLATE_PATH, PLUGIN_ROOT } from '#paths'
import { logger } from '#lib'

const _path = process.cwd()

export default class WordCloudGenerator {
  constructor(config) {
    this.config = config || {}
    this.textProcessor = new TextProcessor()
  }

  /**
   * 处理消息生成词云数据（复用逻辑）
   */
  async _processWordData(messages, options = {}) {
    const {
      maxWords = this.config.maxWords || 100,
      minLength = this.config.minLength || 2,
      minFrequency = this.config.minFrequency || 2,
      extractMethod = this.config.extractMethod || 'frequency'
    } = options

    const wordData = await this.textProcessor.processMessages(messages, {
      minLength,
      minFrequency,
      maxWords,
      extractMethod
    })

    if (wordData.length === 0) {
      return []
    }

    logger.info(`统计到 ${wordData.length} 个词汇`)

    let wordList

    if (extractMethod === 'tfidf') {
      wordList = wordData.map(item => {
        const scaledWeight = 1 + item.weight * 9
        return [item.word, scaledWeight]
      })
    } else {
      const frequencies = wordData.map(item => item.count)
      const maxFreq = Math.max(...frequencies)
      const minFreq = Math.min(...frequencies)
      const freqRange = maxFreq - minFreq

      wordList = wordData.map(item => {
        let normalizedWeight
        if (freqRange === 0) {
          normalizedWeight = 5
        } else {
          const logFreq = Math.log(item.count)
          const logMin = Math.log(minFreq)
          const logMax = Math.log(maxFreq)
          const logRange = logMax - logMin
          normalizedWeight = 1 + ((logFreq - logMin) / logRange) * 9
        }
        return [item.word, normalizedWeight]
      })
    }

    return wordList
  }

  /**
   * 将 PNG 帧编码为 GIF
   */
  async _encodeGif(frames, delay, width, height) {
    const { default: GIFEncoder } = await import('gif-encoder-2')
    const { PNG } = await import('pngjs')

    const encoder = new GIFEncoder(width, height, 'neuquant')
    encoder.setDelay(delay)
    encoder.setRepeat(0)
    encoder.setQuality(10)
    encoder.start()

    for (const frame of frames) {
      const png = PNG.sync.read(frame)
      encoder.addFrame(png.data)
    }

    encoder.finish()
    return encoder.out.getData()
  }

  /**
   * 生成词云图片
   * @param {array} messages - 消息列表
   * @param {object} options - 选项
   */
  async generate(messages, options = {}) {
    const {
      groupId = 'Unknown',
      groupName = '未知群聊',
      days = 1,
      userName = null,
      width = this.config.width || 1200,
      height = this.config.height || 800,
      backgroundColor = this.config.backgroundColor || '#ffffff'
    } = options

    const renderConfig = this.config.render || {}
    const imgType = renderConfig.imgType || 'png'
    const quality = renderConfig.quality || 100
    const extractMethod = this.config.extractMethod || 'frequency'

    try {
      logger.info(`开始生成词云，消息数: ${messages.length}，提取方式: ${extractMethod}`)

      const wordList = await this._processWordData(messages, options)

      if (wordList.length === 0) {
        logger.warn('没有足够的词汇生成词云')
        return null
      }

      const templateData = {
        groupName,
        timeRange: this.getTimeRangeText(days),
        messageCount: messages.length,
        createTime: moment().format('YYYY-MM-DD HH:mm:ss'),
        wordListJson: JSON.stringify(wordList),
        width,
        height,
        backgroundColor,
        pluResPath: PLUGIN_ROOT + '/resources/',
        userName: userName || '',
        isPersonal: !!userName
      }

      const img = await puppeteer.screenshot('group-insight-wordcloud', {
        tplFile: WORDCLOUD_TEMPLATE_PATH,
        imgType,
        quality,
        ...templateData
      })

      logger.info('词云生成成功')
      return img
    } catch (err) {
      logger.error(`词云生成失败: ${err}`)
      logger.error(err.stack)
      return null
    }
  }

  /**
   * 生成 GIF 动态词云
   */
  async generateGif(messages, options = {}) {
    const {
      groupName = '未知群聊',
      days = 1,
      userName = null
    } = options

    const gifConfig = this.config.gif || {}
    const frameCount = gifConfig.frames || 20
    const duration = gifConfig.duration || 2400
    const delay = Math.max(20, Math.round(duration / frameCount))
    const width = gifConfig.width || 600
    const height = gifConfig.height || 400
    const backgroundColor = this.config.backgroundColor || '#ffffff'
    const effect = gifConfig.effect || 'float'

    try {
      logger.info(`开始生成 GIF 词云，消息数: ${messages.length}，帧数: ${frameCount}`)

      const wordList = await this._processWordData(messages, options)

      if (wordList.length === 0) {
        logger.warn('没有足够的词汇生成词云')
        return null
      }

      const renderer = Renderer.getRenderer()

      const templateData = {
        tplFile: WORDCLOUD_GIF_TEMPLATE_PATH,
        saveId: 'gif-' + Date.now(),
        wordListJson: JSON.stringify(wordList),
        width,
        height,
        backgroundColor,
        frameCount,
        effect,
        groupName,
        timeRange: this.getTimeRangeText(days),
        messageCount: messages.length,
        createTime: moment().format('YYYY-MM-DD HH:mm:ss'),
        userName: userName || '',
        isPersonal: !!userName
      }

      const savePath = renderer.dealTpl('group-insight-wordcloud-gif', templateData)
      if (!savePath) {
        logger.error('GIF 模板渲染失败')
        return null
      }

      const browser = await renderer.browserInit()
      if (!browser) {
        logger.error('浏览器初始化失败')
        return null
      }

      let page
      try {
        page = await browser.newPage()

        // 捕获页面 JS 错误
        page.on('pageerror', err => logger.error(`[GIF 页面错误] ${err}`))

        await page.setViewport({ width, height })
        await page.goto(`file://${_path}${savePath.replace(/^\./, '')}`, {
          timeout: 30000,
          waitUntil: 'load'
        })

        // 检查布局是否完成
        const ready = await page.evaluate(() => window.animationReady).catch(() => false)
        if (!ready) {
          logger.error('GIF 模板 JavaScript 初始化失败，请检查上方页面错误日志')
          return null
        }

        // 逐帧截图
        const frames = []
        for (let i = 0; i < frameCount; i++) {
          await page.evaluate(() => window.nextFrame())
          const buf = await page.screenshot({ type: 'png' })
          frames.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
        }

        logger.info(`GIF 截帧完成，共 ${frames.length} 帧，开始编码...`)

        const gifBuffer = await this._encodeGif(frames, delay, width, height)
        const kb = (gifBuffer.length / 1024).toFixed(2)
        logger.info(`GIF 词云生成成功，大小: ${kb}KB`)

        return segment.image(gifBuffer)
      } finally {
        if (page) page.close().catch(() => {})
      }
    } catch (err) {
      logger.error(`GIF 词云生成失败: ${err}`)
      logger.error(err.stack)
      return null
    }
  }

  /**
   * 获取时间范围文本
   * @param {number} days - 天数
   */
  getTimeRangeText(days) {
    switch (days) {
      case 1:
        return '当天'
      case 3:
        return '近三天'
      case 7:
        return '近七天'
      default:
        return `近${days}天`
    }
  }

  /**
   * 获取热词榜（纯文本）
   * @param {array} messages - 消息列表
   * @param {number} topN - 前 N 个词
   */
  async getTopWords(messages, topN = 10) {
    const wordCount = await this.textProcessor.processMessages(messages, {
      minLength: 2,
      minFrequency: 2,
      maxWords: topN
    })

    return wordCount.slice(0, topN)
  }
}
