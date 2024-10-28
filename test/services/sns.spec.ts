import { when } from 'jest-when'
import { publishMessage } from '../../src/services/sns'

const mockSend = jest.fn()

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: mockSend })),
  PublishCommand: jest.fn((input) => input)
}))

describe('Spec: SNS Service', () => {
  describe('Given a message', () => {
    describe('When calling the publish function', () => {
      const topic = 'test-topic'
      const message = 'test-message'
      const publishCommand = { TopicArn: topic, Message: message }

      beforeAll(async () => {
        when(mockSend).calledWith(publishCommand).mockResolvedValue({})
        await publishMessage(topic, message)
      })

      it('Then it should call the PublishCommand with the correct input', () => {
        expect(mockSend).toHaveBeenCalledWith(publishCommand)
      })
    })
  })
})
