import { Client } from '@evex/linejs'

import { HumanMessage } from '@langchain/core/messages'
import { chatGraph } from '../graphs/chat'

import { clearCheckpoints, clearMessages, getConfiguration, setConfiguration, storeMessage } from '../services/dynamoDB'
import { getParameter, setParameter } from '../services/ssm'
import { parseDebugCommand } from '../utils/parser'

export class SelfBot {
  client: Client
  name: string

  constructor(name: string = '香草') {
    this.client = new Client()
    this.name = name

    this.client.on('ready', async () => {
      process.env.OPENAI_API_KEY = await getParameter('/vanilla/openai/apiKey')
      await setParameter('/vanilla/line/refreshToken', this.client.storage.get('refreshToken') as string)
    })

    this.client.on('update:authtoken', async (authToken) => {
      await setParameter('/vanilla/line/authToken', authToken)
    })

    this.client.on(
      'square:message',
      async ({ author, content, contentMetadata, contentType, squareChatMid, react, reply }) => {
        try {
          if (contentType === 'NONE' && content) {
            const user = await author.displayName
            const question = content.replaceAll(`@${this.name}`, '').trim()
            await storeMessage({ thread_id: squareChatMid, content: `${user}：${question}` })

            if (contentMetadata?.MENTION && content.includes(`@${this.name}`)) {
              if (question.includes('debug')) {
                const state = await this.debug(squareChatMid, question)
                await Promise.all(state === 'OK' ? [react(2)] : [react(6), reply(state)])
              } else {
                const response = await this.chat(squareChatMid, `${user}：${question}`)
                await reply(response)
              }
            }
          }
        } catch (err) {
          await Promise.all([react(6), reply(err.message)])
        }
      }
    )
  }

  private async debug(squareChatMid: string, question: string) {
    const { command, params, error } = parseDebugCommand(question)
    if (error) {
      return error
    }

    switch (command) {
      case 'info': {
        let configuration = await getConfiguration(squareChatMid)
        if (!configuration) {
          await setConfiguration({ thread_id: squareChatMid, chat_mode: 'normal', model_name: 'gpt-4o-mini' })
          configuration = { thread_id: squareChatMid, chat_mode: 'normal', model_name: 'gpt-4o-mini' }
        }
        const message = Object.entries(configuration)
          .map(([key, value]) => `${key}：${value}`)
          .join('\n')
        await this.client.sendSquareMessage({ contentType: 0, squareChatMid, text: message })
        break
      }

      case 'configure': {
        const chat_mode = params['chat-mode']
        const model_name = params['model']
        await setConfiguration({ thread_id: squareChatMid, chat_mode, model_name })
        break
      }

      case 'graph': {
        const expand = params?.expand === 'true'
        const graph = chatGraph().getGraph({ xray: expand })
        const image = await graph.drawMermaidPng({ withStyles: !expand })
        await this.client.uploadObjTalk(squareChatMid, 'image', image)
        break
      }

      case 'cleanup': {
        await Promise.all([clearCheckpoints(squareChatMid), clearMessages(squareChatMid)])
        break
      }

      case 'refresh': {
        await this.client.tryRefreshToken()
        await this.client.logout()
        await this.login()
        break
      }
    }

    return 'OK'
  }

  private async chat(thread_id: string, question: string) {
    let configuration = await getConfiguration(thread_id)
    if (!configuration) {
      await setConfiguration({ thread_id, chat_mode: 'normal', model_name: 'gpt-4o-mini' })
      configuration = { thread_id, chat_mode: 'normal', model_name: 'gpt-4o-mini' }
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

    return response.replace(`${this.name}：`, '') as string
  }

  public async login() {
    const authToken = await getParameter('/vanilla/line/authToken')
    const refreshToken = await getParameter('/vanilla/line/refreshToken')

    if (authToken && refreshToken) {
      this.client.storage.set('refreshToken', refreshToken)
      return this.client.login({ authToken, device: 'DESKTOPMAC', v3: true })
    }

    const email = await getParameter('/vanilla/line/email')
    const password = await getParameter('/vanilla/line/password')

    return this.client.login({ email, password, device: 'DESKTOPMAC', v3: true })
  }
}
