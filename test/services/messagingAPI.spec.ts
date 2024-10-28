import { v4 } from 'uuid'
import { when } from 'jest-when'
import { type Message, reply, getProfile } from '../../src/services/messagingAPI'

const mockSend = jest.fn()

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: mockSend })),
  GetParameterCommand: jest.fn((input) => input),
  PutParameterCommand: jest.fn((input) => input)
}))

const mockReply = jest.fn()
const mockGetProfile = jest.fn()

jest.mock('@line/bot-sdk', () => ({
  messagingApi: {
    MessagingApiClient: jest.fn(() => ({
      replyMessage: mockReply,
      getGroupMemberProfile: mockGetProfile
    }))
  }
}))

describe('Spec: Messaging API Service', () => {
  describe('When calling the reply function', () => {
    const [channelAccessToken, replyToken] = [v4(), v4()]
    const messages = [{ type: 'text', text: 'test-message' }] as Message[]
    const getParameterCommand = { Name: '/vanilla/line/channelAccessToken', WithDecryption: true }

    beforeAll(async () => {
      when(mockSend).calledWith(getParameterCommand).mockResolvedValue(channelAccessToken)
      when(mockReply).calledWith({ replyToken, messages }).mockResolvedValue({})
      await reply(replyToken, messages)
    })

    it('Then it should call the replyMessage with the correct input', async () => {
      expect(mockReply).toHaveBeenCalledWith({ replyToken, messages })
    })
  })

  describe('When calling the getProfile function', () => {
    const [channelAccessToken, thread_id, userId] = [v4(), v4(), v4()]
    const getParameterCommand = { Name: '/vanilla/line/channelAccessToken', WithDecryption: true }

    beforeAll(async () => {
      when(mockSend).calledWith(getParameterCommand).mockResolvedValue(channelAccessToken)
      when(mockGetProfile).calledWith(thread_id, userId).mockResolvedValue({})
      await getProfile(thread_id, userId)
    })

    it('Then it should call the getGroupMemberProfile with the correct input', async () => {
      expect(mockGetProfile).toHaveBeenCalledWith(thread_id, userId)
    })
  })
})
