import { type TextEventMessage, type WebhookEvent } from '@line/bot-sdk'
import { type Context, type SNSEvent } from 'aws-lambda'

import { HumanMessage } from '@langchain/core/messages'
import { chatGraph } from '../graphs/chat'

import { clearCheckpoints, clearMessages, getConfiguration, setConfiguration, storeMessage } from '../services/dynamoDB'
import { reply, getProfile } from '../services/messagingAPI'
import { getParameter } from '../services/ssm'

import { logger } from '../utils/logger'
import { parseDebugCommand } from '../utils/parser'

const NAME = '香草'

const chat = async (thread_id: string, question: string) => {
  let configuration = await getConfiguration(thread_id)
  if (!configuration) {
    const defaultConfiguration = { thread_id, chat_mode: 'normal', model_name: 'gpt-4o-mini' }
    await setConfiguration(defaultConfiguration)
    configuration = defaultConfiguration
  }

  const { conversation } = await chatGraph().invoke(
    {
      conversation: [new HumanMessage(question)],
      messages: [new HumanMessage(question)]
    },
    {
      configurable: { question, ...configuration }
    }
  )
  const response = conversation[conversation.length - 1].content.toString()

  return response.replace(`${NAME}：`, '') as string
}

const debug = async (replyToken: string, thread_id: string, message: TextEventMessage) => {
  const question = message.text.replaceAll(`@${NAME}`, '').trim()
  const { command, params, error } = parseDebugCommand(question)
  if (error) {
    await reply(replyToken, [{ type: 'text', text: error, quoteToken: message.quoteToken }])
    return
  }

  switch (command) {
    case 'info': {
      let configuration = await getConfiguration(thread_id)
      if (!configuration) {
        const defaultConfiguration = { thread_id, chat_mode: 'normal', model_name: 'gpt-4o-mini' }
        await setConfiguration(defaultConfiguration)
        configuration = defaultConfiguration
      }
      const text = Object.entries(configuration)
        .map(([key, value]) => `${key}：${value}`)
        .join('\n')
      await reply(replyToken, [{ type: 'text', text, quoteToken: message.quoteToken }])
      break
    }

    case 'configure': {
      const chat_mode = params['chat-mode'] || 'normal'
      const model_name = params['model'] || 'gpt-4o-mini'
      await setConfiguration({ thread_id, chat_mode, model_name })
      await reply(replyToken, [{ type: 'text', text: 'OK', quoteToken: message.quoteToken }])
      break
    }

    case 'cleanup': {
      await Promise.all([clearCheckpoints(thread_id), clearMessages(thread_id)])
      await reply(replyToken, [{ type: 'text', text: 'OK', quoteToken: message.quoteToken }])
      break
    }
  }
}

export const handler = async (event: SNSEvent, context: Context) => {
  logger.addContext(context)
  const { events } = JSON.parse(event.Records[0].Sns.Message)

  for (const { source, ...event } of events as WebhookEvent[]) {
    if (event.type !== 'message' || event.message.type !== 'text' || source.type !== 'group') {
      continue
    }

    const { groupId: thread_id, userId } = source
    const { replyToken, message } = event
    const { displayName } = await getProfile(thread_id, userId)
    const question = message.text.replaceAll(`@${NAME}`, '').trim()
    await storeMessage({ thread_id, content: `${displayName}：${question}` })

    if (message.text.includes(`@${NAME}`)) {
      if (question.includes('debug')) {
        await debug(replyToken, thread_id, message)
      }

      process.env.OPENAI_API_KEY = await getParameter('/vanilla/openai/apiKey')
      const response = await chat(thread_id, `${displayName}：${question}`)

      return reply(replyToken, [{ type: 'text', text: response, quoteToken: message.quoteToken }])
    }
  }

  return 'Do nothing'
}
