import 'dotenv/config'
process.env.AWS_PROFILE = process.env.AWS_PROFILE || 'default'
process.env.AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-...'

import { v4 } from 'uuid'
import { type BaseMessage, HumanMessage } from '@langchain/core/messages'
import { chatGraph } from '../src/graphs/chat'
import { clearCheckpoints, clearMessages } from '../src/services/dynamoDB'

const question = '記住我的名字是Steve。'
const followUp = '你還記得我的名字嗎？'

const thread_id = `test-thread-${v4()}`
const chat_mode = 'positive'
const model_name = 'gpt-4o-mini'

const run = async () => {
  // First round of chat
  await chatGraph().invoke(
    {
      conversation: [new HumanMessage(question)],
      messages: [new HumanMessage(question)]
    },
    {
      configurable: { thread_id, question, chat_mode, model_name }
    }
  )

  // Second round of chat
  const { conversation } = await chatGraph().invoke(
    {
      conversation: [new HumanMessage(followUp)],
      messages: [new HumanMessage(followUp)]
    },
    {
      configurable: { thread_id, question: followUp, chat_mode, model_name }
    }
  )

  await Promise.all([clearCheckpoints(thread_id), clearMessages(thread_id)])

  return (conversation as BaseMessage[])
    .map((message) => {
      return `${message.getType()}: ${message.content.toString()}`
    })
    .join('\n')
}

;(async () => console.log(await run()))()
