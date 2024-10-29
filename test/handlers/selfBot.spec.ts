import { HumanMessage } from '@langchain/core/messages'
import { v4 } from 'uuid'
import { when } from 'jest-when'
import { SelfBot } from '../../src/handlers/selfBot'

const handlerMap = new Map<string, (data?: object | string) => void>()

// AWS Service Mocks
const [mockSSMClientSend, mockddbDocClientSend] = [jest.fn(), jest.fn()]
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: mockSSMClientSend })),
  GetParameterCommand: jest.fn((input) => input),
  PutParameterCommand: jest.fn((input) => input)
}))

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockddbDocClientSend })) },
  QueryCommand: jest.fn((input) => input),
  PutCommand: jest.fn((input) => input)
}))

// Line Client Mocks
const [mockLogin, mockStorageGet, mockStorageSet] = [jest.fn(), jest.fn(), jest.fn()]
jest.mock('@evex/linejs', () => ({
  Client: jest.fn(() => ({
    storage: { get: mockStorageGet, set: mockStorageSet },
    login: mockLogin,
    logout: jest.fn(),
    uploadObjTalk: jest.fn(),
    sendSquareMessage: jest.fn(),
    tryRefreshToken: jest.fn(),
    on: jest.fn(async (event: string, handler: (data?: object | string) => void) => {
      if (['ready', 'update:authtoken', 'square:message'].includes(event)) {
        handlerMap.set(event, handler)
      }
    })
  }))
}))

// Chat Graph Mocks
const mockChatGraphInvoke = jest.fn()
jest.mock('../../src/graphs/chat', () => ({
  chatGraph: jest.fn(() => ({
    invoke: mockChatGraphInvoke,
    getGraph: jest.fn(() => ({ drawMermaidPng: jest.fn() }))
  }))
}))

describe('Spec: SelfBot Handler', () => {
  describe('Given a SelfBot instance', () => {
    const selfBot = new SelfBot()

    describe('When calling the login method', () => {
      const authTokenParameter = '/vanilla/line/authToken'
      const refreshTokenParameter = '/vanilla/line/refreshToken'
      const emailParameter = '/vanilla/line/email'
      const passwordParameter = '/vanilla/line/password'
      const [authToken, refreshToken, email, password] = [v4(), v4(), v4(), v4()]

      describe('And logging in with the auth token', () => {
        beforeAll(async () => {
          when(mockSSMClientSend)
            .calledWith({ Name: authTokenParameter, WithDecryption: true })
            .mockResolvedValue({ Parameter: { Value: authToken } })

          when(mockSSMClientSend)
            .calledWith({ Name: refreshTokenParameter, WithDecryption: true })
            .mockResolvedValue({ Parameter: { Value: refreshToken } })

          await selfBot.login()
        })

        it('Then it should set the refresh token in the storage', () => {
          expect(mockStorageSet).toHaveBeenCalledWith('refreshToken', refreshToken)
        })

        it('Then it should call the login method with the correct input', () => {
          expect(mockLogin).toHaveBeenCalledWith({ authToken, device: 'DESKTOPMAC', v3: true })
        })
      })

      describe('And logging in with the email and password', () => {
        beforeAll(async () => {
          when(mockSSMClientSend).calledWith({ Name: authTokenParameter, WithDecryption: true }).mockResolvedValue({})

          when(mockSSMClientSend)
            .calledWith({ Name: refreshTokenParameter, WithDecryption: true })
            .mockResolvedValue({})

          when(mockSSMClientSend)
            .calledWith({ Name: emailParameter, WithDecryption: true })
            .mockResolvedValue({ Parameter: { Value: email } })

          when(mockSSMClientSend)
            .calledWith({ Name: passwordParameter, WithDecryption: true })
            .mockResolvedValue({ Parameter: { Value: password } })

          await selfBot.login()
        })

        it('Then it should call the login method with the correct input', () => {
          expect(mockLogin).toHaveBeenCalledWith({ email, password, device: 'DESKTOPMAC', v3: true })
        })
      })
    })

    describe('When triggering the ready event', () => {
      const refreshTokenParameter = '/vanilla/line/refreshToken'
      const openAIApiKey = v4()
      const refreshToken = v4()

      beforeAll(async () => {
        mockSSMClientSend.mockResolvedValue({ Parameter: { Value: openAIApiKey } })
        mockStorageGet.mockReturnValue(refreshToken)
        handlerMap.get('ready')()
      })

      it('Then it should set the openai api key as an environment variable', () => {
        expect(process.env.OPENAI_API_KEY).toEqual(openAIApiKey)
      })

      it('Then it should call the putParameterCommand with the correct input', () => {
        expect(mockSSMClientSend).toHaveBeenCalledWith({
          Name: refreshTokenParameter,
          Value: refreshToken,
          Type: 'SecureString',
          Overwrite: true
        })
      })
    })

    describe('When triggering the update:authtoken event', () => {
      const authTokenParameter = '/vanilla/line/authToken'
      const authToken = v4()

      beforeAll(() => {
        handlerMap.get('update:authtoken')(authToken)
      })

      it('Then it should call the putParameterCommand with the correct input', () => {
        expect(mockSSMClientSend).toHaveBeenCalledWith({
          Name: authTokenParameter,
          Value: authToken,
          Type: 'SecureString',
          Overwrite: true
        })
      })
    })

    describe('When triggering the square:message event', () => {
      const squareChatMid = v4()
      const user = v4()
      const contentType = 'NONE'
      const contentMetadata = { MENTION: v4() }
      const mockReact = jest.fn()
      const mockReply = jest.fn()
      const baseEvent = {
        author: { displayName: user },
        contentType,
        contentMetadata,
        squareChatMid,
        react: mockReact,
        reply: mockReply
      }

      describe('And it is a debug event', () => {
        describe('And the command is info', () => {
          const content = `@${selfBot.name} debug info`

          beforeAll(() => {
            mockddbDocClientSend.mockResolvedValue({})
            handlerMap.get('square:message')({ ...baseEvent, content })
          })

          it('Then it should not call the reply method but call the react method', () => {
            expect(mockReply).not.toHaveBeenCalled()
            expect(mockReact).toHaveBeenCalledWith(2)
          })
        })

        describe('And the command is configure', () => {
          const content = `@${selfBot.name} debug configure -c positive --model gpt-4o`

          beforeAll(() => {
            handlerMap.get('square:message')({ ...baseEvent, content })
          })

          it('Then it should not call the reply method but call the react method', () => {
            expect(mockReply).not.toHaveBeenCalled()
            expect(mockReact).toHaveBeenCalledWith(2)
          })
        })

        describe('And the command is graph', () => {
          const expandedGraphContent = `@${selfBot.name} debug graph -e true`
          const graphContent = `@${selfBot.name} debug graph`

          beforeAll(() => {
            handlerMap.get('square:message')({ ...baseEvent, content: graphContent })
            handlerMap.get('square:message')({ ...baseEvent, content: expandedGraphContent })
          })

          it('Then it should not call the reply method but call the react method', () => {
            expect(mockReply).not.toHaveBeenCalled()
            expect(mockReact).toHaveBeenCalledWith(2)
          })
        })

        describe('And the command is cleanup', () => {
          const content = `@${selfBot.name} debug cleanup`

          beforeAll(() => {
            mockddbDocClientSend.mockResolvedValue({})
            handlerMap.get('square:message')({ ...baseEvent, content })
          })

          it('Then it should not call the reply method but call the react method', () => {
            expect(mockReply).not.toHaveBeenCalled()
            expect(mockReact).toHaveBeenCalledWith(2)
          })
        })

        describe('And the command is revoke', () => {
          const content = `@${selfBot.name} debug revoke`

          beforeAll(() => {
            mockSSMClientSend.mockResolvedValue({ Parameter: { Value: v4() } })
            handlerMap.get('square:message')({ ...baseEvent, content })
          })

          it('Then it should not call the reply method but call the react method', () => {
            expect(mockReply).not.toHaveBeenCalled()
            expect(mockReact).toHaveBeenCalledWith(2)
          })
        })

        describe('And the command is invalid', () => {
          const content = `@${selfBot.name} debug invalid`

          beforeAll(() => {
            handlerMap.get('square:message')({ ...baseEvent, content })
          })

          it('Then it should call the react method and the reply method with the correct input', () => {
            expect(mockReact).toHaveBeenCalledWith(6)
            expect(mockReply).toHaveBeenCalledWith('Invalid command format')
          })
        })
      })

      describe('And it is a chat event', () => {
        const content = `@${selfBot.name} ${v4()}`
        const question = content.replaceAll(`@${selfBot.name}`, '').trim()
        const configuration = { thread_id: squareChatMid, chat_mode: 'normal', model_name: 'gpt-4o-mini' }
        const response = v4()

        beforeAll(() => {
          mockddbDocClientSend.mockResolvedValue({})
          mockChatGraphInvoke.mockResolvedValue({ conversation: [new HumanMessage(response)] })
          handlerMap.get('square:message')({ ...baseEvent, content })
        })

        it('Then it should call the reply method with the correct input', () => {
          expect(mockReply).toHaveBeenCalledWith(response)
        })

        it('Then it should call the invoke method with the correct input', () => {
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

      describe('And an error is thrown', () => {
        const content = `@${selfBot.name} ${v4()}`
        const error = 'Chat Graph Error'

        beforeAll(() => {
          mockChatGraphInvoke.mockRejectedValue({ message: error })
          handlerMap.get('square:message')({ ...baseEvent, content })
        })

        it('Then it should call the react method and the reply method with the correct input', () => {
          expect(mockReact).toHaveBeenCalledWith(6)
          expect(mockReply).toHaveBeenCalledWith(error)
        })
      })
    })
  })
})
