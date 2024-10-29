import { HumanMessage } from '@langchain/core/messages'
import { type SNSEvent } from 'aws-lambda'
import { v4 } from 'uuid'

import { handler } from '../../src/handlers/lineBot'

// AWS Service Mocks
const [mockSSMClientSend, mockddbDocClientSend] = [jest.fn(), jest.fn()]
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: mockSSMClientSend })),
  GetParameterCommand: jest.fn((input) => input)
}))

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockddbDocClientSend })) },
  QueryCommand: jest.fn((input) => input),
  PutCommand: jest.fn((input) => input)
}))

// Mock the Line SDK
const mockReply = jest.fn()
const mockGetGroupMemberProfile = jest.fn()
jest.mock('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: jest.fn(() => ({
      replyMessage: mockReply,
      getGroupMemberProfile: mockGetGroupMemberProfile
    }))
  }
}))

// Chat Graph Mocks
const mockChatGraphInvoke = jest.fn()
jest.mock('../../src/graphs/chat', () => ({ chatGraph: jest.fn(() => ({ invoke: mockChatGraphInvoke })) }))

describe('Spec: LineBot handler', () => {
  const botName = '香草'

  describe('Given a line message passed from the SNS event', () => {
    const replyToken = v4()
    const quoteToken = v4()

    describe('When it is a debug event', () => {
      const source = { userId: v4(), groupId: v4(), type: 'group' }

      beforeAll(() => {
        mockGetGroupMemberProfile.mockResolvedValue({ displayName: 'Alice' })
      })

      describe('And the command is "info"', () => {
        const content = `@${botName} debug info`
        const message = { text: content, quoteToken, type: 'text' }
        const snsMessage = JSON.stringify({ events: [{ type: 'message', source, replyToken, message }] })
        const event = { Records: [{ Sns: { Message: snsMessage } }] }

        beforeAll(async () => {
          mockddbDocClientSend.mockResolvedValue({})
          await handler(event as SNSEvent)
        })

        it('Then it should call the reply function with the correct input', () => {
          const configuration = { thread_id: source.groupId, chat_mode: 'normal', model_name: 'gpt-4o-mini' }
          const text = Object.entries(configuration)
            .map(([key, value]) => `${key}：${value}`)
            .join('\n')
          expect(mockReply).toHaveBeenCalledWith({
            replyToken,
            messages: [{ type: 'text', text, quoteToken: message.quoteToken }]
          })
        })
      })

      describe('And the command is "configure"', () => {
        const content = `@${botName} debug configure chat-mode=normal model=gpt-4o`
        const message = { text: content, quoteToken, type: 'text' }
        const snsMessage = JSON.stringify({ events: [{ type: 'message', source, replyToken, message }] })
        const event = { Records: [{ Sns: { Message: snsMessage } }] }

        beforeAll(async () => {
          await handler(event as SNSEvent)
        })

        it('Then it should call the reply function with the correct input', () => {
          expect(mockReply).toHaveBeenCalledWith({
            replyToken,
            messages: [{ type: 'text', text: 'OK', quoteToken: message.quoteToken }]
          })
        })
      })

      describe('And the command is "cleanup"', () => {
        const content = `@${botName} debug cleanup`
        const message = { text: content, quoteToken, type: 'text' }
        const snsMessage = JSON.stringify({ events: [{ type: 'message', source, replyToken, message }] })
        const event = { Records: [{ Sns: { Message: snsMessage } }] }

        beforeAll(async () => {
          await handler(event as SNSEvent)
        })

        it('Then it should call the reply function with the correct input', () => {
          expect(mockReply).toHaveBeenCalledWith({
            replyToken,
            messages: [{ type: 'text', text: 'OK', quoteToken: message.quoteToken }]
          })
        })
      })

      describe('And the command is invalid', () => {
        const content = `@${botName} debug invalid`
        const message = { text: content, quoteToken, type: 'text' }
        const snsMessage = JSON.stringify({ events: [{ type: 'message', source, replyToken, message }] })
        const event = { Records: [{ Sns: { Message: snsMessage } }] }

        beforeAll(async () => {
          await handler(event as SNSEvent)
        })

        it('Then it should call the reply function with the correct input', () => {
          expect(mockReply).toHaveBeenCalledWith({
            replyToken,
            messages: [{ type: 'text', text: 'Invalid command format', quoteToken: message.quoteToken }]
          })
        })
      })
    })

    describe('When it is a chat event', () => {
      const user = 'Alice'
      const content = `@${botName} ${v4()}`
      const question = content.replaceAll(`@${botName}`, '').trim()
      const message = { text: content, quoteToken, type: 'text' }
      const source = { userId: v4(), groupId: v4(), type: 'group' }
      const configuration = { thread_id: source.groupId, chat_mode: 'normal', model_name: 'gpt-4o-mini' }
      const snsMessage = JSON.stringify({ events: [{ type: 'message', source, replyToken, message }] })
      const event = { Records: [{ Sns: { Message: snsMessage } }] }
      const response = v4()

      beforeAll(async () => {
        mockddbDocClientSend.mockResolvedValue({})
        mockGetGroupMemberProfile.mockResolvedValue({ displayName: user })
        mockChatGraphInvoke.mockResolvedValue({ conversation: [new HumanMessage(response)] })
        await handler(event as SNSEvent)
      })

      it('Then it should call the reply function with the correct input', () => {
        expect(mockReply).toHaveBeenCalledWith({
          replyToken,
          messages: [{ type: 'text', text: response, quoteToken: message.quoteToken }]
        })
      })

      it('Then it should call the chatGraph invoke function with the correct input', () => {
        expect(mockChatGraphInvoke).toHaveBeenCalledWith(
          {
            conversation: [new HumanMessage(`${user}：${question}`)],
            messages: [new HumanMessage(`${user}：${question}`)]
          },
          {
            configurable: { question: `${user}：${question}`, ...configuration }
          }
        )
      })
    })

    describe('When it is a invalid event', () => {
      const wrongTypeEvent = {
        Records: [
          {
            Sns: {
              Message: JSON.stringify({
                events: [
                  {
                    replyToken,
                    type: 'invalid type',
                    message: { text: v4(), quoteToken, type: 'text' },
                    source: { userId: v4(), groupId: v4(), type: 'group' }
                  }
                ]
              })
            }
          }
        ]
      }

      const wrongMessageTypeEvent = {
        Records: [
          {
            Sns: {
              Message: JSON.stringify({
                events: [
                  {
                    replyToken,
                    type: 'message',
                    message: { text: v4(), quoteToken, type: 'invalid type' },
                    source: { userId: v4(), groupId: v4(), type: 'group' }
                  }
                ]
              })
            }
          }
        ]
      }

      const wrongSourceTypeEvent = {
        Records: [
          {
            Sns: {
              Message: JSON.stringify({
                events: [
                  {
                    replyToken,
                    type: 'message',
                    message: { text: v4(), quoteToken, type: 'text' },
                    source: { userId: v4(), groupId: v4(), type: 'invalid type' }
                  }
                ]
              })
            }
          }
        ]
      }

      beforeAll(async () => {
        mockChatGraphInvoke.mockClear()
        mockReply.mockClear()

        await handler(wrongTypeEvent as SNSEvent)
        await handler(wrongMessageTypeEvent as SNSEvent)
        await handler(wrongSourceTypeEvent as SNSEvent)
      })

      it('Then it should not call the chatGraph invoke function and the reply function', () => {
        expect(mockChatGraphInvoke).not.toHaveBeenCalled()
        expect(mockReply).not.toHaveBeenCalled()
      })
    })
  })
})
